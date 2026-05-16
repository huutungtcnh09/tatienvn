import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, forbidden, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";
import type { AuthRequest } from "../../middleware/auth.js";

const router = Router();

const fulfilledStatuses = new Set(["DELIVERED", "COMPLETED", "RETURNED", "REFUNDED"]);

function isStockTrackedProduct(productType?: string | null) {
  return productType !== "SERVICE";
}

function normalizePartnerIdentity(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isRewardPointExcludedCustomer(partner?: { name?: string | null; code?: string | null } | null) {
  if (!partner) return false;
  const normalizedName = normalizePartnerIdentity(partner.name);
  const normalizedCode = normalizePartnerIdentity(partner.code);

  return ["khach le", "boc le", "retail", "guest"].includes(normalizedName)
    || ["khach le", "boc le", "retail", "guest"].includes(normalizedCode);
}

const createOrderSchema = z.object({
  storeId: z.string().optional(),
  storeCode: z.string().optional(),
  customerId: z.string(),
  salesPersonId: z.string().optional(),
  salesOwnerPositionId: z.string().optional(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD", "MIXED"]),
  isReserved: z.boolean().default(false),
  asDraft: z.boolean().default(false),
  discountAmount: z.number().default(0),
  paidAmount: z.number().default(0),
  note: z.string().optional(),
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().positive(),
      unitPrice: z.number().nonnegative(),
      discountAmount: z.number().default(0),
      isGift: z.boolean().default(false),
      isUnitPriceManual: z.boolean().optional().default(false)
    }).superRefine((item, ctx) => {
      if (!item.isGift && item.unitPrice <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "unitPrice must be > 0 for non-gift items",
          path: ["unitPrice"]
        });
      }
    })
  ).min(1)
});

const updateOrderStatusSchema = z.object({
  status: z.enum(["DRAFT", "CONFIRMED", "PROCESSING", "DELIVERED", "COMPLETED", "CANCELLED"]),
  note: z.string().optional()
});

const updateOrderItemsSchema = z.object({
  note: z.string().optional(),
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().positive(),
      unitPrice: z.number().nonnegative(),
      discountAmount: z.number().default(0),
      isGift: z.boolean().default(false),
      isUnitPriceManual: z.boolean().optional().default(false)
    }).superRefine((item, ctx) => {
      if (!item.isGift && item.unitPrice <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "unitPrice must be > 0 for non-gift items",
          path: ["unitPrice"]
        });
      }
    })
  ).min(1)
});

const returnRefundSchema = z.object({
  type: z.literal("RETURNED").optional(),
  settlementMode: z.enum(["PAYOUT", "CREDIT_BALANCE"]).optional(),
  amount: z.number().positive().optional(),
  note: z.string().optional(),
  restock: z.boolean().default(true),
  items: z.array(
    z.object({
      orderItemId: z.string(),
      quantity: z.number().int().positive(),
      amount: z.number().positive().optional()
    })
  ).optional()
});

const statusTransitions: Record<string, string[]> = {
  DRAFT: ["CONFIRMED", "DELIVERED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "DELIVERED", "CANCELLED"],
  PROCESSING: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["COMPLETED", "RETURNED"],
  COMPLETED: [],
  CANCELLED: [],
  RETURNED: [],
  REFUNDED: []
};

const orderInclude = {
  customer: true,
  store: true,
  receiptAllocations: {
    include: {
      receipt: {
        select: {
          id: true,
          receiptNo: true,
          paymentMethod: true,
          amount: true,
          discountAmount: true,
          type: true,
          createdAt: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  },
  items: {
    include: {
      product: {
        select: { id: true, name: true, sku: true, unit: true, rewardPoints: true, costPrice: true, productType: true }
      },
      returnItems: {
        select: { id: true, quantity: true, amount: true }
      }
    }
  },
  createdByUser: {
    select: { id: true, fullName: true, email: true }
  },
  salesPerson: {
    select: { id: true, fullName: true, email: true }
  },
  salesOwnerPosition: {
    select: { id: true, code: true, name: true, roleType: true }
  },
  storeManager: {
    select: { id: true, fullName: true, email: true }
  },
  storeManagerPosition: {
    select: { id: true, code: true, name: true, roleType: true }
  },
  storeSupervisor: {
    select: { id: true, fullName: true, email: true }
  },
  storeSupervisorPosition: {
    select: { id: true, code: true, name: true, roleType: true }
  }
} as const;

function normalizeOrderReceivableFields<T extends { totalAmount?: unknown; paidAmount?: unknown; debtAmount?: unknown }>(order: T) {
  const totalAmount = Math.max(Number(order.totalAmount || 0), 0);
  const remainingAmount = Math.max(Number(order.debtAmount || 0), 0);
  const paidAmountRaw = Number(order.paidAmount);
  const paidAmount = Number.isFinite(paidAmountRaw)
    ? Math.max(paidAmountRaw, 0)
    : Math.max(totalAmount - remainingAmount, 0);

  return {
    ...order,
    paidAmount,
    debtAmount: remainingAmount,
    remainingAmount
  };
}

function shouldRecognizeDebtOnCreate(payload: z.infer<typeof createOrderSchema>) {
  if (payload.asDraft) return false;
  return !payload.isReserved;
}

function getReturnQuantitiesByRatio(
  items: Array<{ id: string; quantity: number }>,
  ratio: number
) {
  const clampedRatio = Math.max(0, Math.min(ratio, 1));
  const raws = items.map((item) => {
    const raw = item.quantity * clampedRatio;
    const base = Math.floor(raw);
    return {
      id: item.id,
      quantity: item.quantity,
      raw,
      base,
      fraction: raw - base
    };
  });

  const target = Math.round(items.reduce((sum, item) => sum + item.quantity, 0) * clampedRatio);
  let distributed = raws.reduce((sum, row) => sum + row.base, 0);
  const sortedByFraction = raws
    .slice()
    .sort((left, right) => right.fraction - left.fraction);

  for (const row of sortedByFraction) {
    if (distributed >= target) break;
    if (row.base >= row.quantity) continue;
    row.base += 1;
    distributed += 1;
  }

  return new Map(raws.map((row) => [row.id, row.base]));
}

function normalizePlanAmounts(
  plan: Array<{ orderItemId: string; quantity: number; amount: number }>,
  targetAmount: number
) {
  const safeTarget = Math.max(0, targetAmount);
  if (!plan.length) return plan;

  const currentTotal = plan.reduce((sum, row) => sum + row.amount, 0);
  if (currentTotal <= 0) {
    const even = safeTarget / plan.length;
    return plan.map((row, idx) => ({
      ...row,
      amount: idx === plan.length - 1
        ? safeTarget - even * (plan.length - 1)
        : even
    }));
  }

  let allocated = 0;
  return plan.map((row, idx) => {
    if (idx === plan.length - 1) {
      return {
        ...row,
        amount: Math.max(safeTarget - allocated, 0)
      };
    }

    const scaled = (row.amount / currentTotal) * safeTarget;
    allocated += scaled;
    return {
      ...row,
      amount: scaled
    };
  });
}

function hasRecognizedDebt(order: {
  status: string;
  isReserved: boolean;
}) {
  if (String(order.status) === "DRAFT") return false;
  return !order.isReserved || fulfilledStatuses.has(String(order.status));
}

function hasCommittedInventory(order: {
  status: string;
  isReserved: boolean;
}) {
  if (String(order.status) === "DRAFT") return false;
  return !order.isReserved || fulfilledStatuses.has(String(order.status));
}

function shouldMarkCompleted(
  status: z.infer<typeof updateOrderStatusSchema>["status"],
  debtAmount: number
) {
  if (debtAmount > 0) {
    return status;
  }

  if (["DELIVERED", "COMPLETED"].includes(status)) {
    return "COMPLETED";
  }

  return status;
}

async function resolveOrgSnapshotAtCreate(
  storeId: string,
  snapshotAt: Date
) {
  const [
    managerPosition,
    supervisorPosition,
    managerAssignmentByPosition,
    supervisorAssignmentByPosition,
    managerAssignment,
    supervisorAssignment
  ] = await Promise.all([
    prisma.orgPosition.findFirst({
      where: { storeId, roleType: "STORE_MANAGER", isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    }),
    prisma.orgPosition.findFirst({
      where: { storeId, roleType: "STORE_SUPERVISOR", isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    }),
    prisma.orgPositionAssignmentHistory.findFirst({
      where: {
        position: { storeId, roleType: "STORE_MANAGER" },
        effectiveFrom: { lte: snapshotAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: snapshotAt } }]
      },
      orderBy: { effectiveFrom: "desc" },
      select: { userId: true, positionId: true }
    }),
    prisma.orgPositionAssignmentHistory.findFirst({
      where: {
        position: { storeId, roleType: "STORE_SUPERVISOR" },
        effectiveFrom: { lte: snapshotAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: snapshotAt } }]
      },
      orderBy: { effectiveFrom: "desc" },
      select: { userId: true, positionId: true }
    }),
    prisma.orgAssignmentHistory.findFirst({
      where: {
        roleType: "STORE_MANAGER",
        storeId,
        effectiveFrom: { lte: snapshotAt },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gt: snapshotAt } }
        ]
      },
      orderBy: { effectiveFrom: "desc" },
      select: { userId: true }
    }),
    prisma.orgAssignmentHistory.findFirst({
      where: {
        roleType: "STORE_SUPERVISOR",
        storeId,
        effectiveFrom: { lte: snapshotAt },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gt: snapshotAt } }
        ]
      },
      orderBy: { effectiveFrom: "desc" },
      select: { userId: true }
    })
  ]);

  return {
    storeManagerId: managerAssignmentByPosition?.userId || managerAssignment?.userId || null,
    storeManagerPositionId: managerAssignmentByPosition?.positionId || managerPosition?.id || null,
    storeSupervisorId: supervisorAssignmentByPosition?.userId || supervisorAssignment?.userId || null,
    storeSupervisorPositionId: supervisorAssignmentByPosition?.positionId || supervisorPosition?.id || null
  };
}

async function resolveSalesOwnerByPosition(positionId: string, snapshotAt: Date) {
  const position = await prisma.orgPosition.findUnique({
    where: { id: positionId },
    select: { id: true, roleType: true, isActive: true }
  });

  const SALES_OWNER_ROLES = ["CUSTOMER_SERVICE", "STORE_SUPERVISOR", "DEPUTY_MANAGER", "STORE_MANAGER", "PURCHASER"];
  if (!position || !position.isActive || !SALES_OWNER_ROLES.includes(position.roleType as string)) {
    return null;
  }

  const assignment = await prisma.orgPositionAssignmentHistory.findFirst({
    where: {
      positionId,
      effectiveFrom: { lte: snapshotAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: snapshotAt } }]
    },
    orderBy: { effectiveFrom: "desc" },
    select: { userId: true }
  });

  return {
    positionId,
    userId: assignment?.userId || null
  };
}

const HEAD_OFFICE_ROLES_LOCAL = new Set(["SUPER_ADMIN", "HEAD_MANAGER"]);

async function resolveAssignedStoreIdsForUser(userId: string, snapshotAt = new Date(), roles?: string[]) {
  if (roles?.some((r) => HEAD_OFFICE_ROLES_LOCAL.has(r))) {
    const allStores = await prisma.store.findMany({ select: { id: true } });
    return allStores.map((s) => s.id);
  }
  const [positionAssignments, legacyAssignments] = await Promise.all([
    prisma.orgPositionAssignmentHistory.findMany({
      where: {
        userId,
        effectiveFrom: { lte: snapshotAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: snapshotAt } }],
        position: {
          storeId: { not: null },
          isActive: true
        }
      },
      select: {
        position: {
          select: {
            storeId: true
          }
        }
      }
    }),
    prisma.orgAssignmentHistory.findMany({
      where: {
        userId,
        storeId: { not: null },
        effectiveFrom: { lte: snapshotAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: snapshotAt } }]
      },
      select: { storeId: true }
    })
  ]);

  const storeIdSet = new Set<string>();
  for (const row of positionAssignments) {
    if (row.position.storeId) {
      storeIdSet.add(row.position.storeId);
    }
  }
  for (const row of legacyAssignments) {
    if (row.storeId) {
      storeIdSet.add(row.storeId);
    }
  }

  return Array.from(storeIdSet);
}

async function requireStoreAssignmentForOrderAction(req: AuthRequest, storeId: string) {
  const userId = req.user?.sub;
  if (!userId) return false;
  const assignedStoreIds = await resolveAssignedStoreIdsForUser(userId, new Date(), req.user?.roles);
  return assignedStoreIds.includes(storeId);
}

router.get("/", requirePermission("orders:read"), async (req: AuthRequest, res) => {
  const userId = req.user?.sub;
  if (!userId) {
    return forbidden(res, "Missing authenticated user");
  }

  const assignedStoreIds = await resolveAssignedStoreIdsForUser(userId, new Date(), req.user?.roles);
  if (!assignedStoreIds.length) {
    return forbidden(res, "User has no active store assignment");
  }

  const fromDate = req.query.fromDate as string | undefined;
  const toDate = req.query.toDate as string | undefined;

  // Default: load all dates if no date range provided (10 years back to today)
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  tenYearsAgo.setHours(0, 0, 0, 0);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const dateFrom = fromDate ? new Date(fromDate + "T00:00:00") : tenYearsAgo;
  const dateTo = toDate ? new Date(toDate + "T23:59:59") : todayEnd;

  const data = await prisma.salesOrder.findMany({
    where: {
      storeId: { in: assignedStoreIds },
      createdAt: { gte: dateFrom, lte: dateTo }
    },
    include: orderInclude,
    orderBy: { createdAt: "desc" }
  });
  return ok(res, data.map((order) => normalizeOrderReceivableFields(order)));
});

router.get("/:id", requirePermission("orders:read"), async (req: AuthRequest, res) => {
  const order = await prisma.salesOrder.findUnique({
    where: { id: req.params.id },
    include: orderInclude
  });

  if (!order) {
    return badRequest(res, "Order not found");
  }

  const canAccess = await requireStoreAssignmentForOrderAction(req, order.storeId);
  if (!canAccess) {
    return forbidden(res, "No store assignment for this order");
  }

  return ok(res, normalizeOrderReceivableFields(order));
});

router.post("/", requirePermission("orders:create"), async (req: AuthRequest, res) => {
  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid sales order payload");
    }

    const payload = parsed.data;

    let resolvedStoreId = payload.storeId;
    if (!resolvedStoreId && payload.storeCode) {
      const store = await prisma.store.findUnique({ where: { code: payload.storeCode } });
      resolvedStoreId = store?.id;
    }

    if (!resolvedStoreId) {
      return badRequest(res, "storeId or valid storeCode is required");
    }

    const canAccessStore = await requireStoreAssignmentForOrderAction(req, resolvedStoreId);
    if (!canAccessStore) {
      return forbidden(res, "No store assignment for this store");
    }

    const customer = await prisma.partner.findUnique({
      where: { id: payload.customerId },
      select: {
        id: true,
        name: true,
        code: true,
        isCustomer: true,
        ownerStoreId: true,
        netBalance: true,
        customerPriceTier: true,
        accountOwnerPositionId: true
      }
    });

    if (!customer) {
      return badRequest(res, "Customer not found");
    }

    if (customer.isCustomer && !customer.ownerStoreId) {
      return badRequest(res, "Customer has no owner store");
    }

    if (customer.isCustomer && customer.ownerStoreId && customer.ownerStoreId !== resolvedStoreId) {
      return badRequest(res, "Customer belongs to another store");
    }

    const snapshotAt = new Date();
    const salesOwnerPositionIdInput = payload.salesOwnerPositionId || customer.accountOwnerPositionId || null;
    const resolvedSalesOwner = salesOwnerPositionIdInput
      ? await resolveSalesOwnerByPosition(salesOwnerPositionIdInput, snapshotAt)
      : null;
    const salesOwnerPositionId = resolvedSalesOwner?.positionId || null;
    const salesPersonId = payload.salesPersonId || resolvedSalesOwner?.userId || req.user?.sub || null;
    if (salesPersonId) {
      const salesPerson = await prisma.user.findUnique({
        where: { id: salesPersonId },
        select: { id: true, isActive: true }
      });
      if (!salesPerson || !salesPerson.isActive) {
        return badRequest(res, "salesPersonId is invalid or inactive");
      }
    }

    const orgSnapshot = await resolveOrgSnapshotAtCreate(resolvedStoreId, snapshotAt);

    const productIds = payload.items.map((item) => item.productId);
    const productRows = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            costPrice: true,
            productType: true,
            defaultPrice: true,
            level2Price: true,
            level2SpecialPrice: true
          }
        })
      : [];
    const productCostMap = new Map(productRows.map((row) => [row.id, Number(row.costPrice || 0)]));
    const productTypeMap = new Map(productRows.map((row) => [row.id, row.productType]));
    const productMap = new Map(productRows.map((row) => [row.id, row]));

    const priceListRows = productIds.length
      ? await prisma.customerPriceList.findMany({
          where: {
            customerId: payload.customerId,
            productId: { in: productIds },
            status: "active",
            OR: [
              { storeId: resolvedStoreId },
              { storeId: null }
            ]
          },
          orderBy: [
            { storeId: "desc" },
            { updatedAt: "desc" }
          ]
        })
      : [];

    const priceListMap = new Map<string, number>();
    for (const row of priceListRows) {
      if (!priceListMap.has(row.productId)) {
        priceListMap.set(row.productId, Number(row.price));
      }
    }

    const getTierPrice = (productId: string) => {
      const product = productMap.get(productId);
      if (!product) return null;

      if (customer.customerPriceTier === "LEVEL_2_SPECIAL") {
        const value = Number(product.level2SpecialPrice || product.level2Price || product.defaultPrice || 0);
        return value > 0 ? value : null;
      }

      if (customer.customerPriceTier === "LEVEL_2") {
        const value = Number(product.level2Price || product.defaultPrice || 0);
        return value > 0 ? value : null;
      }

      const value = Number(product.defaultPrice || 0);
      return value > 0 ? value : null;
    };

    const resolvedItems = payload.items.map((item) => {
      if (item.isGift) {
        return {
          ...item,
          unitPrice: 0
        };
      }

      const customPrice = priceListMap.get(item.productId);
      const tierPrice = getTierPrice(item.productId);
      const fallbackPrice = Number(item.unitPrice || 0);
      const manualPrice = Boolean(item.isUnitPriceManual);

      return {
        ...item,
        unitPrice: manualPrice
          ? fallbackPrice
          : (customPrice ?? tierPrice ?? fallbackPrice)
      };
    });

    const orderDiscount = Math.max(Number(payload.discountAmount || 0), 0);
    const eligibleIndexes = resolvedItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (item.isGift) return false;
      const lineAmount = item.quantity * item.unitPrice - item.discountAmount;
      return lineAmount > 0;
    });

    const eligibleBaseTotal = eligibleIndexes.reduce((sum, { item }) => {
    return sum + (item.quantity * item.unitPrice - item.discountAmount);
  }, 0);

    const allocatedOrderDiscount = Math.min(orderDiscount, eligibleBaseTotal);

    if (allocatedOrderDiscount > 0 && eligibleIndexes.length > 0) {
    let distributed = 0;
    eligibleIndexes.forEach(({ item, index }, eligibleIdx) => {
      const lineAmount = item.quantity * item.unitPrice - item.discountAmount;
      const isLast = eligibleIdx === eligibleIndexes.length - 1;
      const rawShare = isLast
        ? allocatedOrderDiscount - distributed
        : Math.floor((allocatedOrderDiscount * lineAmount) / eligibleBaseTotal);
      const share = Math.min(Math.max(rawShare, 0), lineAmount);
      resolvedItems[index] = {
        ...item,
        discountAmount: item.discountAmount + share
      };
      distributed += share;
    });
  }

    const subtotal = resolvedItems.reduce((sum, item) => {
    return sum + item.quantity * item.unitPrice - item.discountAmount;
  }, 0);

    const totalAmount = Math.max(subtotal, 0);
    const manualPaidAmount = Math.min(Math.max(Number(payload.paidAmount || 0), 0), totalAmount);
    const availableCredit = Math.max(-Number(customer.netBalance || 0), 0);
    const autoAppliedFromBalance = payload.asDraft
      ? 0
      : Math.min(availableCredit, Math.max(totalAmount - manualPaidAmount, 0));
    const paidAmount = Math.min(totalAmount, manualPaidAmount + autoAppliedFromBalance);
    const debtAmount = Math.max(totalAmount - paidAmount, 0);
    const recognizeDebtNow = shouldRecognizeDebtOnCreate(payload);

    if (!payload.asDraft) {
    for (const item of resolvedItems) {
      if (!isStockTrackedProduct(productTypeMap.get(item.productId))) {
        continue;
      }

      const inventory = await prisma.inventory.findUnique({
        where: {
          productId_storeId: {
            productId: item.productId,
            storeId: resolvedStoreId
          }
        }
      });

      if (!inventory) {
        return badRequest(res, `Inventory not found for product ${item.productId}`);
      }

      const available = inventory.quantity - inventory.reservedQuantity;
      if (item.quantity > available) {
        return badRequest(res, `Not enough inventory for product ${item.productId}`);
      }
    }
  }

    const orderStatus = payload.asDraft
    ? "DRAFT"
    : debtAmount > 0
      ? "DELIVERED"
      : "COMPLETED";

    const dueDateOnCreate = (() => {
    if (orderStatus === "DELIVERED" && debtAmount > 0) {
      const due = new Date();
      due.setDate(due.getDate() + 30);
      due.setHours(23, 59, 59, 999);
      return due;
    }
    return null;
  })();

    const customerExcludedFromRewards = isRewardPointExcludedCustomer(customer);

    const order = await prisma.$transaction(async (tx) => {
    const createdOrder = await tx.salesOrder.create({
      data: {
        orderNo: `SO-${Date.now()}`,
        storeId: resolvedStoreId,
        customerId: payload.customerId,
        createdByUserId: req.user?.sub,
        salesPersonId,
        salesOwnerPositionId,
        storeManagerId: orgSnapshot.storeManagerId,
        storeManagerPositionId: orgSnapshot.storeManagerPositionId,
        storeSupervisorId: orgSnapshot.storeSupervisorId,
        storeSupervisorPositionId: orgSnapshot.storeSupervisorPositionId,
        orgSnapshotAt: snapshotAt,
        paymentMethod: payload.paymentMethod,
        status: orderStatus,
        subtotal,
        discountAmount: allocatedOrderDiscount,
        totalAmount,
        paidAmount,
        appliedFromBalance: autoAppliedFromBalance,
        debtAmount,
        isReserved: payload.isReserved,
        dueDate: dueDateOnCreate,
        note: payload.note,
        items: {
          create: resolvedItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitCost: productCostMap.get(item.productId) || 0,
            discountAmount: item.discountAmount,
            totalAmount: item.quantity * item.unitPrice - item.discountAmount,
            isGift: item.isGift
          }))
        }
      },
      include: orderInclude
    });

      if (payload.isReserved || recognizeDebtNow) {
        for (const item of resolvedItems) {
          if (!isStockTrackedProduct(productTypeMap.get(item.productId))) {
            continue;
          }

          await tx.inventory.update({
            where: {
              productId_storeId: {
                productId: item.productId,
                storeId: resolvedStoreId
              }
            },
            data: payload.isReserved
              ? { reservedQuantity: { increment: item.quantity } }
              : { quantity: { decrement: item.quantity } }
          });
        }
      }

    const rewardPointIncrease = resolvedItems.reduce((sum, item) => {
      if (item.isGift) return sum;
      const product = createdOrder.items.find((orderItem) => orderItem.productId === item.productId)?.product;
      return sum + (Number(product?.rewardPoints || 0) * item.quantity);
    }, 0);

    const partnerUpdate: {
      netBalance?: { increment?: number; decrement?: number };
      rewardPoints?: { increment: number };
    } = {};

    if (recognizeDebtNow) {
      const netBalanceIncrement = debtAmount + autoAppliedFromBalance;
      if (netBalanceIncrement > 0) {
        partnerUpdate.netBalance = { increment: netBalanceIncrement };
      }
    }

    if (!recognizeDebtNow && !payload.asDraft && paidAmount > 0) {
      partnerUpdate.netBalance = { decrement: paidAmount };
    }

    if (recognizeDebtNow && rewardPointIncrease > 0 && !customerExcludedFromRewards) {
      partnerUpdate.rewardPoints = { increment: rewardPointIncrease };
    }

    if (Object.keys(partnerUpdate).length > 0) {
      await tx.partner.update({
        where: { id: payload.customerId },
        data: partnerUpdate
      });
    }

    if (recognizeDebtNow) {
      await tx.partnerTransactionLog.create({
        data: {
          partnerId: payload.customerId,
          transactionType: "SALE_ORDER",
          referenceId: createdOrder.id,
          amount: debtAmount,
          note: [
            `Tao don hang ${createdOrder.orderNo}`,
            `tong=${totalAmount}`,
            `da_thu=${manualPaidAmount}`,
            `can_tru_so_du=${autoAppliedFromBalance}`,
            `cong_no=${debtAmount}`
          ].join(" | ")
        }
      });
    }

    let createdReceiptId: string | null = null;
    if (manualPaidAmount > 0 && !payload.asDraft) {
      const createdReceipt = await tx.receipt.create({
        data: {
          receiptNo: `PT-${Date.now()}`,
          customerId: payload.customerId,
          storeId: resolvedStoreId,
          collectedByUserId: req.user?.sub,
          paymentMethod: payload.paymentMethod,
          amount: manualPaidAmount,
          discountAmount: 0,
          type: payload.isReserved ? "PREPAYMENT" : "PAYMENT",
          note: payload.note
            ? `Thu tien khi tao don ${createdOrder.orderNo} | ${payload.note}`
            : `Thu tien khi tao don ${createdOrder.orderNo}`
        }
      });

      createdReceiptId = createdReceipt.id;

      await tx.receiptAllocation.create({
        data: {
          receiptId: createdReceipt.id,
          orderId: createdOrder.id,
          appliedAmount: manualPaidAmount
        }
      });
    }

    if (manualPaidAmount > 0 && !payload.asDraft) {
      await tx.partnerTransactionLog.create({
        data: {
          partnerId: payload.customerId,
          transactionType: "PAYMENT_RECEIPT",
          referenceId: createdReceiptId || createdOrder.id,
          amount: recognizeDebtNow ? 0 : manualPaidAmount,
          note: [
            `Thu tien khi tao don ${createdOrder.orderNo}`,
            `so_tien=${manualPaidAmount}`,
            recognizeDebtNow ? "hieu_luc_cong_no=0" : "hieu_luc_cong_no=giam"
          ].join(" | ")
        }
      });
    }

    const refreshedOrder = await tx.salesOrder.findUnique({
      where: { id: createdOrder.id },
      include: orderInclude
    });

    return refreshedOrder || createdOrder;
  });

    return created(res, normalizeOrderReceivableFields(order), "Sales order created");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to create sales order: ${msg}`);
  }
});

router.patch("/:id/status", requirePermission("orders:update"), async (req: AuthRequest, res) => {
  const parsed = updateOrderStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid order status payload");
  }

  const order = await prisma.salesOrder.findUnique({
    where: { id: req.params.id },
    include: {
      customer: {
        select: {
          name: true,
          code: true
        }
      },
      items: {
        include: {
          product: {
            select: { rewardPoints: true, productType: true }
          }
        }
      }
    }
  });

  if (!order) {
    return badRequest(res, "Order not found");
  }

  const canAccess = await requireStoreAssignmentForOrderAction(req, order.storeId);
  if (!canAccess) {
    return forbidden(res, "No store assignment for this order");
  }

  const fromStatus = String(order.status);
  const toStatus = parsed.data.status;
  const allowed = statusTransitions[fromStatus] || [];

  if (fromStatus !== toStatus && !allowed.includes(toStatus)) {
    return badRequest(res, `Cannot change status from ${fromStatus} to ${toStatus}`);
  }

  const note = parsed.data.note
    ? [order.note, parsed.data.note].filter(Boolean).join(" | ")
    : order.note;

  const customerExcludedFromRewards = isRewardPointExcludedCustomer(order.customer);
  const isDraftConfirming = fromStatus === "DRAFT" && !["CANCELLED", "DELIVERED", "COMPLETED"].includes(toStatus);
  const shouldAutoReserve = isDraftConfirming && !order.isReserved;
  const shouldSettleDebtOnDraftTransition = isDraftConfirming && toStatus !== "CONFIRMED";

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const recognizedDebt = hasRecognizedDebt({
      status: String(order.status),
      isReserved: order.isReserved
      });
      const committedInventory = hasCommittedInventory({
      status: String(order.status),
      isReserved: order.isReserved
      });
      const reachesFulfillment = !fulfilledStatuses.has(fromStatus) && ["DELIVERED", "COMPLETED"].includes(toStatus);
      let nextPaidAmount = Number(order.paidAmount || 0);
      let nextDebtAmount = Number(order.debtAmount || 0);
      let nextAppliedFromBalance = Number(order.appliedFromBalance || 0);

      // Auto-reserve stock when confirming draft orders
      const effectiveIsReserved = shouldAutoReserve ? true : order.isReserved;

    // Confirming a draft reserves stock for reserved orders, and commits stock for non-reserved orders.
    if (isDraftConfirming) {
      for (const item of order.items) {
        if (!isStockTrackedProduct(item.product?.productType)) continue;

        const inventory = await tx.inventory.findUnique({
          where: { productId_storeId: { productId: item.productId, storeId: order.storeId } },
          select: { quantity: true, reservedQuantity: true }
        });

        if (!inventory) {
          throw new Error(`Inventory not found for product ${item.productId}`);
        }

        const available = Number(inventory.quantity || 0) - Number(inventory.reservedQuantity || 0);
        if (item.quantity > available) {
          throw new Error(`Not enough inventory for product ${item.productId}`);
        }

        await tx.inventory.update({
          where: { productId_storeId: { productId: item.productId, storeId: order.storeId } },
          data: effectiveIsReserved
            ? { reservedQuantity: { increment: item.quantity } }
            : { quantity: { decrement: item.quantity } }
        });
      }

      const rewardPointIncrease = order.items.reduce((sum, item) => {
        if (item.isGift) return sum;
        return sum + Number(item.product?.rewardPoints || 0) * item.quantity;
      }, 0);

      if (shouldSettleDebtOnDraftTransition) {
        const draftSettle: {
          netBalance?: { increment: number };
          rewardPoints?: { increment: number };
        } = {};

        const netBalanceIncrement = Number(order.debtAmount) + Number(order.appliedFromBalance || 0);
        if (netBalanceIncrement > 0) {
          draftSettle.netBalance = { increment: netBalanceIncrement };
        }
        if (rewardPointIncrease > 0 && !customerExcludedFromRewards) {
          draftSettle.rewardPoints = { increment: rewardPointIncrease };
        }

        if (Object.keys(draftSettle).length > 0) {
          await tx.partner.update({ where: { id: order.customerId }, data: draftSettle });
        }

        if (Number(order.debtAmount) > 0 || Number(order.totalAmount) > 0) {
          await tx.partnerTransactionLog.create({
            data: {
              partnerId: order.customerId,
              transactionType: "SALE_ORDER",
              referenceId: order.id,
              amount: Number(order.debtAmount),
              note: `Xac nhan don hang ${order.orderNo} tu trang thai Nhap`
            }
          });
        }
      }
    }

    if (toStatus === "CANCELLED") {
      for (const item of order.items) {
        if (!isStockTrackedProduct(item.product?.productType)) {
          continue;
        }

        const inventoryUpdateData = committedInventory
          ? { quantity: { increment: item.quantity } }
          : order.isReserved
            ? { reservedQuantity: { decrement: item.quantity } }
            : null;

        // Draft orders that never reserved/committed stock should not touch inventory on cancel.
        if (!inventoryUpdateData) {
          continue;
        }

        const existingInventory = await tx.inventory.findUnique({
          where: {
            productId_storeId: {
              productId: item.productId,
              storeId: order.storeId
            }
          },
          select: { productId: true }
        });

        // Be tolerant for legacy/incomplete inventory rows when cancelling orders.
        if (!existingInventory) {
          continue;
        }

        await tx.inventory.update({
          where: {
            productId_storeId: {
              productId: item.productId,
              storeId: order.storeId
            }
          },
          data: inventoryUpdateData
        });
      }

      const partnerRollback: {
        netBalance?: { increment?: number; decrement?: number };
      } = {};

      if (recognizedDebt && Number(order.debtAmount) > 0) {
        const rollbackAmount = Number(order.debtAmount) + Number(order.appliedFromBalance || 0);
        partnerRollback.netBalance = { decrement: rollbackAmount };
      }

      if (!recognizedDebt && Number(order.paidAmount) > 0) {
        partnerRollback.netBalance = { increment: Number(order.paidAmount) };
      }

      if (Object.keys(partnerRollback).length > 0) {
        await tx.partner.update({
          where: { id: order.customerId },
          data: partnerRollback
        });
      }
    }

    if (reachesFulfillment && !committedInventory) {
      for (const item of order.items) {
        if (!isStockTrackedProduct(item.product?.productType)) {
          continue;
        }

        const inventory = await tx.inventory.findUnique({
          where: {
            productId_storeId: {
              productId: item.productId,
              storeId: order.storeId
            }
          },
          select: { quantity: true, reservedQuantity: true }
        });

        if (!inventory) {
          throw new Error(`Inventory not found for product ${item.productId}`);
        }

        if (order.isReserved && Number(inventory.reservedQuantity || 0) < item.quantity) {
          throw new Error(`Reserved quantity is not enough for product ${item.productId}`);
        }

        const available = Number(inventory.quantity || 0) - Number(inventory.reservedQuantity || 0);
        if (!order.isReserved && item.quantity > available) {
          throw new Error(`Not enough inventory for product ${item.productId}`);
        }

        await tx.inventory.update({
          where: {
            productId_storeId: {
              productId: item.productId,
              storeId: order.storeId
            }
          },
          data: order.isReserved
            ? {
                quantity: { decrement: item.quantity },
                reservedQuantity: { decrement: item.quantity }
              }
            : { quantity: { decrement: item.quantity } }
        });
      }

      const rewardPointIncrease = order.items.reduce((sum, item) => {
        if (item.isGift) return sum;
        return sum + Number(item.product?.rewardPoints || 0) * item.quantity;
      }, 0);

      // At fulfillment time, apply any available prepaid balance to keep paid/debt and payment badge in sync.
      if (!recognizedDebt && nextDebtAmount > 0) {
        const partnerSnapshot = await tx.partner.findUnique({
          where: { id: order.customerId },
          select: { netBalance: true }
        });

        const availableCredit = Math.max(-Number(partnerSnapshot?.netBalance || 0), 0);
        const autoAppliedAtFulfillment = Math.min(availableCredit, nextDebtAmount);
        if (autoAppliedAtFulfillment > 0) {
          nextAppliedFromBalance += autoAppliedAtFulfillment;
          nextPaidAmount = Math.min(Number(order.totalAmount || 0), nextPaidAmount + autoAppliedAtFulfillment);
          nextDebtAmount = Math.max(Number(order.totalAmount || 0) - nextPaidAmount, 0);
        }
      }

      const partnerSettle: {
        netBalance?: { increment: number };
        rewardPoints?: { increment: number };
      } = {};

      if (!recognizedDebt) {
        const netBalanceIncrement = Math.max(nextDebtAmount + nextAppliedFromBalance, 0);
        if (netBalanceIncrement > 0) {
          partnerSettle.netBalance = { increment: netBalanceIncrement };
        }
      }

      if (rewardPointIncrease > 0 && !customerExcludedFromRewards) {
        partnerSettle.rewardPoints = { increment: rewardPointIncrease };
      }

      if (Object.keys(partnerSettle).length > 0) {
        await tx.partner.update({
          where: { id: order.customerId },
          data: partnerSettle
        });
      }

      if (!recognizedDebt && nextDebtAmount > 0) {
        await tx.partnerTransactionLog.create({
          data: {
            partnerId: order.customerId,
            transactionType: "SALE_ORDER",
            referenceId: order.id,
            amount: nextDebtAmount,
            note: `Ghi nhan cong no khi giao hang ${order.orderNo}`
          }
        });
      }
    }

    const shouldSetDueDate = reachesFulfillment && nextDebtAmount > 0;
    const nextDueDate = (() => {
      if (shouldSetDueDate) {
        const due = new Date();
        due.setDate(due.getDate() + 30);
        due.setHours(23, 59, 59, 999);
        return due;
      }

      if (nextDebtAmount <= 0) {
        return null;
      }

      return order.dueDate;
    })();

      return tx.salesOrder.update({
        where: { id: req.params.id },
        data: {
          status: shouldMarkCompleted(toStatus, nextDebtAmount),
          paidAmount: nextPaidAmount,
          debtAmount: nextDebtAmount,
          appliedFromBalance: nextAppliedFromBalance,
          dueDate: nextDueDate,
          note,
          // Auto-reserve stock when confirming draft orders
          ...(shouldAutoReserve && { isReserved: true })
        },
        include: orderInclude
      });
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, msg);
  }

  return ok(res, normalizeOrderReceivableFields(updated), "Order status updated");
});

router.patch("/:id/items", requirePermission("orders:update"), async (req: AuthRequest, res) => {
  const parsed = updateOrderItemsSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid order items payload");
  }

  const order = await prisma.salesOrder.findUnique({
    where: { id: req.params.id },
    include: {
      items: true,
      receiptAllocations: { select: { id: true } }
    }
  });

  if (!order) {
    return badRequest(res, "Order not found");
  }

  const canAccess = await requireStoreAssignmentForOrderAction(req, order.storeId);
  if (!canAccess) {
    return forbidden(res, "No store assignment for this order");
  }

  if (!["DRAFT", "CONFIRMED"].includes(String(order.status))) {
    return badRequest(res, "Only draft or confirmed orders can be edited");
  }

  const payloadItems = parsed.data.items.map((item) => ({
    ...item,
    discountAmount: Math.max(Number(item.discountAmount || 0), 0)
  }));

  const productIds = Array.from(new Set(payloadItems.map((item) => item.productId)));
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, costPrice: true, productType: true }
      })
    : [];

  if (products.length !== productIds.length) {
    return badRequest(res, "One or more products are invalid");
  }

  const productCostMap = new Map(products.map((row) => [row.id, Number(row.costPrice || 0)]));
  const productTypeMap = new Map(products.map((row) => [row.id, row.productType]));

  const oldQtyMap = new Map<string, number>();
  for (const row of order.items) {
    oldQtyMap.set(row.productId, (oldQtyMap.get(row.productId) || 0) + Number(row.quantity || 0));
  }

  const nextQtyMap = new Map<string, number>();
  for (const row of payloadItems) {
    nextQtyMap.set(row.productId, (nextQtyMap.get(row.productId) || 0) + Number(row.quantity || 0));
  }

  const inventoryProductIds = Array.from(new Set([...oldQtyMap.keys(), ...nextQtyMap.keys()]))
    .filter((productId) => isStockTrackedProduct(productTypeMap.get(productId)));
  const inventories = inventoryProductIds.length
    ? await prisma.inventory.findMany({
        where: {
          storeId: order.storeId,
          productId: { in: inventoryProductIds }
        },
        select: { productId: true, quantity: true, reservedQuantity: true }
      })
    : [];

  const inventoryMap = new Map(inventories.map((row) => [row.productId, row]));
  for (const productId of inventoryProductIds) {
    if (!inventoryMap.has(productId)) {
      return badRequest(res, `Inventory not found for product ${productId}`);
    }
  }

  if (order.isReserved) {
    for (const productId of inventoryProductIds) {
      const oldQty = oldQtyMap.get(productId) || 0;
      const newQty = nextQtyMap.get(productId) || 0;
      const delta = newQty - oldQty;
      if (delta <= 0) continue;

      const inventory = inventoryMap.get(productId);
      if (!inventory) continue;
      const available = Number(inventory.quantity || 0) - Number(inventory.reservedQuantity || 0);
      if (delta > available) {
        return badRequest(res, `Not enough inventory for product ${productId}`);
      }
    }
  }

  const subtotal = payloadItems.reduce((sum, item) => {
    const lineTotal = Number(item.quantity || 0) * Number(item.unitPrice || 0) - Number(item.discountAmount || 0);
    return sum + Math.max(lineTotal, 0);
  }, 0);

  const totalAmount = Math.max(subtotal, 0);
  const paidAmount = 0;
  const debtAmount = Math.max(totalAmount - paidAmount, 0);
  const note = parsed.data.note
    ? [order.note, parsed.data.note].filter(Boolean).join(" | ")
    : order.note;

  const updated = await prisma.$transaction(async (tx) => {
    if (order.isReserved) {
      for (const productId of inventoryProductIds) {
        const oldQty = oldQtyMap.get(productId) || 0;
        const newQty = nextQtyMap.get(productId) || 0;
        const delta = newQty - oldQty;
        if (delta === 0) continue;

        await tx.inventory.update({
          where: {
            productId_storeId: {
              productId,
              storeId: order.storeId
            }
          },
          data: {
            reservedQuantity: delta > 0
              ? { increment: delta }
              : { decrement: Math.abs(delta) }
          }
        });
      }
    }

    await tx.salesOrderItem.deleteMany({
      where: { orderId: order.id }
    });

    await tx.salesOrder.update({
      where: { id: order.id },
      data: {
        subtotal,
        discountAmount: payloadItems.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0),
        totalAmount,
        paidAmount,
        appliedFromBalance: 0,
        debtAmount,
        dueDate: null,
        note,
        items: {
          create: payloadItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitCost: productCostMap.get(item.productId) || 0,
            discountAmount: item.discountAmount,
            totalAmount: item.quantity * item.unitPrice - item.discountAmount,
            isGift: item.isGift
          }))
        }
      }
    });

    return tx.salesOrder.findUnique({
      where: { id: order.id },
      include: orderInclude
    });
  });

  if (!updated) {
    return badRequest(res, "Order not found after update");
  }

  return ok(res, normalizeOrderReceivableFields(updated), "Order items updated");
});

router.post("/:id/return-refund", requirePermission("orders:refund"), async (req: AuthRequest, res) => {
  const parsed = returnRefundSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid return/refund payload");
  }
  const returnType = "RETURNED";
  const settlementMode = parsed.data.settlementMode || "CREDIT_BALANCE";

  const order = await prisma.salesOrder.findUnique({
    where: { id: req.params.id },
    include: {
      items: {
        include: {
          product: {
            select: { rewardPoints: true, productType: true }
          }
        }
      }
    }
  });

  if (!order) {
    return badRequest(res, "Order not found");
  }

  const canAccess = await requireStoreAssignmentForOrderAction(req, order.storeId);
  if (!canAccess) {
    return forbidden(res, "No store assignment for this order");
  }

  if (["CANCELLED", "RETURNED", "REFUNDED"].includes(String(order.status))) {
    return badRequest(res, "Order is already closed");
  }

  const currentTotal = Number(order.totalAmount);
  const currentPaid = Number(order.paidAmount);
  const currentDebt = Number(order.debtAmount);
  const orderItemMap = new Map(order.items.map((item) => [item.id, item]));

  let returnPlan: Array<{ orderItemId: string; quantity: number; amount: number }> = [];

  if (parsed.data.items?.length) {
    const seen = new Set<string>();
    for (const line of parsed.data.items) {
      if (seen.has(line.orderItemId)) {
        return badRequest(res, `Duplicate orderItemId in items: ${line.orderItemId}`);
      }
      seen.add(line.orderItemId);

      const orderItem = orderItemMap.get(line.orderItemId);
      if (!orderItem) {
        return badRequest(res, `Order item not found: ${line.orderItemId}`);
      }

      if (line.quantity > orderItem.quantity) {
        return badRequest(res, `Return quantity exceeds sold quantity for item ${line.orderItemId}`);
      }

      const maxLineAmount = (Number(orderItem.totalAmount) / orderItem.quantity) * line.quantity;
      const lineAmount = Math.min(line.amount ?? maxLineAmount, maxLineAmount);
      returnPlan.push({
        orderItemId: line.orderItemId,
        quantity: line.quantity,
        amount: lineAmount
      });
    }
  }

  const planAmount = returnPlan.reduce((sum, row) => sum + row.amount, 0);
  const amount = Math.min(
    parsed.data.items?.length
      ? (parsed.data.amount ? Math.min(parsed.data.amount, planAmount) : planAmount)
      : (parsed.data.amount || currentTotal),
    currentTotal
  );

  if (amount <= 0) {
    return badRequest(res, "Return amount must be greater than 0");
  }

  if (!returnPlan.length) {
    const returnRatio = currentTotal > 0 ? amount / currentTotal : 0;
    const returnQtyMap = getReturnQuantitiesByRatio(
      order.items.map((item) => ({ id: item.id, quantity: item.quantity })),
      returnRatio
    );

    returnPlan = order.items
      .map((item) => {
        const quantity = returnQtyMap.get(item.id) || 0;
        if (quantity <= 0) return null;

        const amountByQty = (Number(item.totalAmount) / item.quantity) * quantity;
        return {
          orderItemId: item.id,
          quantity,
          amount: amountByQty
        };
      })
      .filter((row): row is { orderItemId: string; quantity: number; amount: number } => Boolean(row));
  }

  returnPlan = normalizePlanAmounts(returnPlan, amount);

  const nextTotal = Math.max(currentTotal - amount, 0);
  const nextPaid = Math.min(currentPaid, nextTotal);
  const nextDebt = Math.max(nextTotal - nextPaid, 0);

  const note = parsed.data.note
    ? [order.note, parsed.data.note].filter(Boolean).join(" | ")
    : order.note;

  const updated = await prisma.$transaction(async (tx) => {
    const recognizedDebt = hasRecognizedDebt({
      status: String(order.status),
      isReserved: order.isReserved
    });
    const committedInventory = hasCommittedInventory({
      status: String(order.status),
      isReserved: order.isReserved
    });
    const paidReduction = Math.max(currentPaid - nextPaid, 0);
    const effectiveSettlementMode = paidReduction > 0
      ? settlementMode
      : "DEBT_REDUCTION_ONLY";
    const debtReduction = recognizedDebt ? Math.max(currentDebt - nextDebt, 0) : 0;
    const currentAppliedFromBalance = Number(order.appliedFromBalance || 0);
    const appliedBalanceReduction = recognizedDebt
      ? Math.min(currentAppliedFromBalance, paidReduction)
      : 0;

    const partnerBalanceReduction = debtReduction + appliedBalanceReduction;
    if (partnerBalanceReduction > 0) {
      await tx.partner.update({
        where: { id: order.customerId },
        data: { netBalance: { decrement: partnerBalanceReduction } }
      });
    }

    if (!recognizedDebt && paidReduction > 0) {
      await tx.partner.update({
        where: { id: order.customerId },
        data: { netBalance: { increment: paidReduction } }
      });
    }

    // Với đơn đã ghi nhận công nợ: phần tiền trả dư sau trả hàng có thể
    // trả lại ngay (PAYOUT) hoặc giữ thành số dư khách hàng (CREDIT_BALANCE).
    if (recognizedDebt && paidReduction > 0 && effectiveSettlementMode === "CREDIT_BALANCE") {
      await tx.partner.update({
        where: { id: order.customerId },
        data: { netBalance: { decrement: paidReduction } }
      });
    }

    if (parsed.data.restock) {
      const returnQtyMap = new Map(returnPlan.map((row) => [row.orderItemId, row.quantity]));

      for (const item of order.items) {
        if (!isStockTrackedProduct(item.product?.productType)) {
          continue;
        }

        const returnedQty = returnQtyMap.get(item.id) || 0;
        if (returnedQty <= 0) continue;

        await tx.inventory.update({
          where: {
            productId_storeId: {
              productId: item.productId,
              storeId: order.storeId
            }
          },
          data: committedInventory
            ? { quantity: { increment: returnedQty } }
            : order.isReserved
              ? { reservedQuantity: { decrement: returnedQty } }
              : {}
        });
      }
    }

    const rewardPointReduction = committedInventory
      ? Math.round(order.items.reduce((sum, item) => {
          if (item.isGift) return sum;
          const returnedQty = returnPlan.find((row) => row.orderItemId === item.id)?.quantity || 0;
          return sum + Number(item.product?.rewardPoints || 0) * returnedQty;
        }, 0))
      : 0;

    if (rewardPointReduction > 0) {
      await tx.partner.update({
        where: { id: order.customerId },
        data: { rewardPoints: { decrement: rewardPointReduction } }
      });
    }

    const returnDoc = await tx.salesOrderReturn.create({
      data: {
        orderId: order.id,
        type: returnType,
        amount,
        note: parsed.data.note,
        restock: parsed.data.restock
      }
    });

    if (returnPlan.length > 0) {
      await tx.salesOrderReturnItem.createMany({
        data: returnPlan.map((row) => ({
          returnId: returnDoc.id,
          orderItemId: row.orderItemId,
          quantity: row.quantity,
          amount: row.amount
        }))
      });
    }

    await tx.partnerTransactionLog.create({
      data: {
        partnerId: order.customerId,
        transactionType: "RETURN_ORDER",
        referenceId: returnDoc.id,
        amount,
        note: parsed.data.note || `Xu ly ${returnType} cho ${order.orderNo} | settlement=${effectiveSettlementMode}`
      }
    });

    return tx.salesOrder.update({
      where: { id: req.params.id },
      data: {
        status: returnType,
        totalAmount: nextTotal,
        paidAmount: nextPaid,
        appliedFromBalance: Math.max(currentAppliedFromBalance - appliedBalanceReduction, 0),
        debtAmount: nextDebt,
        note
      },
      include: orderInclude
    });
  });

  return ok(res, normalizeOrderReceivableFields(updated), "Order return completed");
});

export default router;
