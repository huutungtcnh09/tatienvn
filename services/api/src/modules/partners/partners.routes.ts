import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";
import type { AuthRequest } from "../../middleware/auth.js";

const router = Router();
const PAYMENT_META_MARKER = "##PURCHASE_PAYMENT_META##";
const STORE_SCOPED_ROLES = new Set(["STORE_MANAGER", "SALES_STAFF", "SALE_MOBILE"]);
const HEAD_OFFICE_ROLES = new Set(["SUPER_ADMIN", "HEAD_MANAGER", "ACCOUNTANT", "MARKETING"]);

const debtIncreaseTypes = new Set(["OPENING_BALANCE", "SALE_ORDER"]);
const debtDecreaseTypes = new Set(["PAYMENT_RECEIPT", "DISCOUNT_VOUCHER", "RETURN_ORDER"]);

type PaymentMeta = {
  cashAmount: number;
  settledAmount: number;
};

function parsePaymentNote(rawNote: string | null | undefined): { note: string; meta: PaymentMeta | null } {
  const safe = rawNote || "";
  const markerIndex = safe.indexOf(PAYMENT_META_MARKER);
  if (markerIndex < 0) {
    return { note: safe, meta: null };
  }

  const noteText = safe.slice(0, markerIndex).trim();
  const encodedMeta = safe.slice(markerIndex + PAYMENT_META_MARKER.length).trim();
  if (!encodedMeta) {
    return { note: noteText, meta: null };
  }

  try {
    return {
      note: noteText,
      meta: JSON.parse(encodedMeta) as PaymentMeta
    };
  } catch {
    return { note: noteText, meta: null };
  }
}

function isReturnPayoutNote(rawNote: string | null | undefined) {
  const note = String(rawNote || "");
  return note.includes("settlement=PAYOUT") || note.includes("[Thanh toán: Trả lại tiền]");
}

const createPartnerSchema = z.object({
  code: z.string().min(3),
  name: z.string().min(2),
  ledgerCode: z.string().trim().max(64).optional(),
  phone: z.string().optional(),
  phone2: z.string().optional(),
  phone3: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  isCustomer: z.boolean().default(false),
  isSupplier: z.boolean().default(false),
  isCarrier: z.boolean().default(false),
  businessAreaId: z.string().optional().nullable(),
  ownerStoreId: z.string().optional().nullable(),
  accountOwnerPositionId: z.string().optional().nullable(),
  customerPriceTier: z.enum(["LEVEL_2", "LEVEL_2_SPECIAL"]).optional().nullable(),
  openingBalance: z.number().default(0)
});

function shouldScopePartnerByStore(req: AuthRequest) {
  const roles = req.user?.roles || [];
  if (roles.some((role) => HEAD_OFFICE_ROLES.has(role))) {
    return false;
  }
  return roles.some((role) => STORE_SCOPED_ROLES.has(role));
}

async function resolveActiveStoreIdForUser(userId: string) {
  const now = new Date();
  const [positionAssignment, legacyAssignment] = await Promise.all([
    prisma.orgPositionAssignmentHistory.findFirst({
      where: {
        userId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        position: {
          storeId: { not: null },
          isActive: true
        }
      },
      orderBy: { effectiveFrom: "desc" },
      select: {
        position: {
          select: {
            storeId: true
          }
        }
      }
    }),
    prisma.orgAssignmentHistory.findFirst({
      where: {
        userId,
        storeId: { not: null },
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }]
      },
      orderBy: { effectiveFrom: "desc" },
      select: { storeId: true }
    })
  ]);

  return positionAssignment?.position?.storeId || legacyAssignment?.storeId || null;
}

async function resolvePartnerAccessContext(req: AuthRequest) {
  const scoped = shouldScopePartnerByStore(req);
  if (!scoped) {
    return { scoped: false, storeId: null as string | null };
  }

  const userId = req.user?.sub;
  if (!userId) {
    return { scoped: true, storeId: null as string | null };
  }

  const storeId = await resolveActiveStoreIdForUser(userId);
  return { scoped: true, storeId };
}

async function validateSalesOwnerPosition(positionId?: string | null) {
  if (!positionId) return true;

  const position = await prisma.orgPosition.findUnique({
    where: { id: positionId },
    select: { id: true, roleType: true, isActive: true }
  });

  if (!position || !position.isActive) return false;
  const ACCOUNT_OWNER_ROLES = ["CUSTOMER_SERVICE", "STORE_SUPERVISOR", "DEPUTY_MANAGER", "STORE_MANAGER", "PURCHASER"];
  return ACCOUNT_OWNER_ROLES.includes(position.roleType as string);
}

// GET /partners/watchlist/store/:storeId — get watchlist of all users currently assigned to a store
router.get("/watchlist/store/:storeId", requirePermission("partners:read"), async (req: AuthRequest, res) => {
  try {
    const { storeId } = req.params;

    // Find user IDs currently active in the store via org_assignment_history
    const assignments = await prisma.orgAssignmentHistory.findMany({
      where: {
        storeId,
        effectiveTo: null
      },
      select: { userId: true }
    });

    const userIds = [...new Set(assignments.map((a) => a.userId))];
    if (!userIds.length) return ok(res, []);

    const rows = await prisma.customerWatchlist.findMany({
      where: { userId: { in: userIds } },
      orderBy: { addedAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, phone: true, netBalance: true } },
        user: { select: { id: true, fullName: true } }
      }
    });

    return ok(res, rows.map((row) => ({
      id: row.customerId,
      name: row.customer.name || "-",
      phone: row.customer.phone || "-",
      netBalance: Number(row.customer.netBalance || 0),
      source: row.source,
      addedAt: row.addedAt.getTime(),
      watchedByUserId: row.userId,
      watchedByName: row.user.fullName || "-"
    })));
  } catch (error) {
    return badRequest(res, "Failed to load store watchlist");
  }
});

// GET /partners/watchlist — get current user's watched customers
router.get("/watchlist", requirePermission("partners:read"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.sub;
    const rows = await prisma.customerWatchlist.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
      include: { customer: { select: { id: true, name: true, phone: true } } }
    });
    return ok(res, rows.map((row) => ({
      id: row.customerId,
      name: row.customer.name || "-",
      phone: row.customer.phone || "-",
      source: row.source,
      addedAt: row.addedAt.getTime()
    })));
  } catch (error) {
    return badRequest(res, "Failed to load watchlist");
  }
});

// PUT /partners/watchlist — replace full watchlist for current user (max 50)
const updateWatchlistSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    source: z.string().default("debt"),
    addedAt: z.number().optional()
  })).max(50)
});

router.put("/watchlist", requirePermission("partners:read"), async (req: AuthRequest, res) => {
  const parsed = updateWatchlistSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Invalid watchlist payload");

  const userId = req.user!.sub;
  const items = parsed.data.items;

  // Validate all customer IDs exist
  const customerIds = items.map((item) => item.id);
  const existingPartners = customerIds.length
    ? await prisma.partner.findMany({ where: { id: { in: customerIds }, isCustomer: true }, select: { id: true } })
    : [];
  const validIds = new Set(existingPartners.map((p) => p.id));
  const validItems = items.filter((item) => validIds.has(item.id));

  await prisma.$transaction([
    prisma.customerWatchlist.deleteMany({ where: { userId } }),
    ...(validItems.length
      ? [prisma.customerWatchlist.createMany({
          data: validItems.map((item) => ({
            id: `${userId}_${item.id}`,
            userId,
            customerId: item.id,
            source: item.source || "debt",
            addedAt: item.addedAt ? new Date(item.addedAt) : new Date()
          }))
        })]
      : [])
  ]);

  return ok(res, { saved: validItems.length });
});

router.get("/", requirePermission("partners:read"), async (req: AuthRequest, res) => {
  const access = await resolvePartnerAccessContext(req);
  if (access.scoped && !access.storeId) {
    return badRequest(res, "User has no active store assignment");
  }

  const search = ((req.query.search as string) || "").trim();
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "50", 10)));
  const skip = (page - 1) * pageSize;

  const baseWhere = access.scoped
    ? { OR: [{ isCustomer: false }, { ownerStoreId: access.storeId }] }
    : {};

  const searchWhere = search
    ? {
        OR: [
          { name: { contains: search } },
          { code: { contains: search } },
          { phone: { contains: search } },
          { phone2: { contains: search } },
          { email: { contains: search } }
        ]
      }
    : {};

  const where = search
    ? { AND: [baseWhere, searchWhere] }
    : (access.scoped ? baseWhere : undefined);

  const [total, data] = await Promise.all([
    prisma.partner.count({ where }),
    prisma.partner.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { accountOwnerPosition: true, ownerStore: true, businessArea: true },
      take: pageSize,
      skip
    })
  ]);

  return ok(res, { data, total, page, pageSize });
});

router.post("/", requirePermission("partners:create"), async (req: AuthRequest, res) => {
  const access = await resolvePartnerAccessContext(req);
  if (access.scoped && !access.storeId) {
    return badRequest(res, "User has no active store assignment");
  }

  const parsed = createPartnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid partner payload");
  }

  const isValidOwnerPosition = await validateSalesOwnerPosition(parsed.data.accountOwnerPositionId);
  if (!isValidOwnerPosition) {
    return badRequest(res, "accountOwnerPositionId is invalid or not SALES_STAFF role");
  }

  let ownerStoreId = parsed.data.ownerStoreId || null;
  if (parsed.data.isCustomer) {
    if (access.scoped) {
      ownerStoreId = access.storeId;
    }
    if (!ownerStoreId) {
      return badRequest(res, "ownerStoreId is required for customer");
    }
  } else {
    ownerStoreId = null;
  }

  if (ownerStoreId) {
    const store = await prisma.store.findUnique({ where: { id: ownerStoreId }, select: { id: true } });
    if (!store) {
      return badRequest(res, "ownerStoreId is invalid");
    }
  }

  if (parsed.data.businessAreaId) {
    const businessArea = await prisma.businessArea.findUnique({
      where: { id: parsed.data.businessAreaId },
      select: { id: true }
    });
    if (!businessArea) {
      return badRequest(res, "businessAreaId is invalid");
    }
  }

  const normalizedName = parsed.data.name.trim();
  const normalizedPhone = String(parsed.data.phone || "").trim();
  if (parsed.data.isCustomer && normalizedPhone) {
    const duplicateCustomer = await prisma.partner.findFirst({
      where: {
        isCustomer: true,
        ownerStoreId,
        name: normalizedName,
        phone: normalizedPhone
      },
      select: {
        id: true,
        code: true
      }
    });
    if (duplicateCustomer) {
      return badRequest(res, `Customer already exists with same name/phone (code: ${duplicateCustomer.code || duplicateCustomer.id})`);
    }
  }

  const data = await prisma.partner.create({
    data: {
      ...parsed.data,
      name: normalizedName,
      phone: normalizedPhone || parsed.data.phone,
      ownerStoreId,
      netBalance: parsed.data.openingBalance
    },
    include: {
      accountOwnerPosition: true,
      ownerStore: true,
      businessArea: true
    }
  });

  await prisma.partnerTransactionLog.create({
    data: {
      partnerId: data.id,
      transactionType: "OPENING_BALANCE",
      referenceId: data.id,
      amount: parsed.data.openingBalance,
      note: "Nhap so du dau ky"
    }
  });

  return created(res, data, "Partner created");
});

router.get("/:id/aging", requirePermission("partners:aging:read"), async (req: AuthRequest, res) => {
  const access = await resolvePartnerAccessContext(req);
  if (access.scoped && !access.storeId) {
    return badRequest(res, "User has no active store assignment");
  }

  const customer = await prisma.partner.findFirst({
    where: {
      id: req.params.id,
      isCustomer: true,
      ...(access.scoped ? { ownerStoreId: access.storeId } : {})
    }
  });

  if (!customer) {
    return badRequest(res, "Customer not found");
  }

  // Use order.debtAmount as source of truth — always accurate after voids/payments
  const ordersWithDebt = await prisma.salesOrder.findMany({
    where: {
      customerId: req.params.id,
      status: { notIn: ["DRAFT", "CANCELLED", "REFUNDED"] },
      debtAmount: { gt: 0 }
    },
    select: {
      id: true,
      orderNo: true,
      status: true,
      totalAmount: true,
      paidAmount: true,
      debtAmount: true,
      dueDate: true,
      createdAt: true,
      items: {
        select: {
          quantity: true,
          unitPrice: true,
          product: { select: { sku: true } }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  const outstandingEntries: Array<{
    referenceId: string;
    transactionType: string;
    status?: string | null;
    createdAt: Date;
    dueDate: Date | null;
    originalAmount: number;
    remainingAmount: number;
    orderNo: string | null;
    items: Array<{ sku: string; quantity: number; unitPrice: number }>;
  }> = ordersWithDebt.map((order) => ({
    referenceId: order.id,
    transactionType: "SALE_ORDER",
    status: order.status,
    createdAt: order.createdAt,
    dueDate: order.dueDate,
    originalAmount: Number(order.totalAmount),
    remainingAmount: Number(order.debtAmount),
    orderNo: order.orderNo,
    items: order.items.map((item) => ({
      sku: item.product?.sku || "-",
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0)
    }))
  }));

  // Remaining opening balance = netBalance - sum(order debts); if positive, customer still owes from opening
  const totalOrderDebt = outstandingEntries.reduce((s, e) => s + e.remainingAmount, 0);
  const customerNetBalance = Number(customer.netBalance || 0);
  const remainingOpeningBalance = Math.max(customerNetBalance - totalOrderDebt, 0);

  if (remainingOpeningBalance > 0.0001) {
    const originalOpeningBalance = Math.max(Number(customer.openingBalance || 0), remainingOpeningBalance);
    outstandingEntries.unshift({
      referenceId: customer.id,
      transactionType: "OPENING_BALANCE",
      createdAt: customer.createdAt,
      dueDate: null,
      originalAmount: originalOpeningBalance,
      remainingAmount: remainingOpeningBalance,
      orderNo: "Số dư đầu kỳ",
      items: []
    });
  }

  const now = Date.now();
  const buckets = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    ">90": 0
  };

  const outstandingDetails = outstandingEntries
    .filter((entry) => entry.remainingAmount > 0.0001)
    .map((entry) => {
      const debtReferenceDate = entry.dueDate || entry.createdAt;
      const overdueDays = Math.floor((now - new Date(debtReferenceDate).getTime()) / (1000 * 60 * 60 * 24));

      if (overdueDays <= 0) {
        buckets.current += entry.remainingAmount;
      } else if (overdueDays <= 30) {
        buckets["1-30"] += entry.remainingAmount;
      } else if (overdueDays <= 60) {
        buckets["31-60"] += entry.remainingAmount;
      } else if (overdueDays <= 90) {
        buckets["61-90"] += entry.remainingAmount;
      } else {
        buckets[">90"] += entry.remainingAmount;
      }

      return {
        referenceId: entry.referenceId,
        documentNo: entry.orderNo || entry.referenceId,
        orderItemsSummary: entry.items,
        settledAmount: Math.max(entry.originalAmount - entry.remainingAmount, 0),
        transactionType: entry.transactionType,
        status: entry.status || null,
        createdAt: entry.createdAt,
        dueDate: entry.dueDate,
        overdueDays: Math.max(overdueDays, 0),
        originalAmount: entry.originalAmount,
        remainingAmount: entry.remainingAmount
      };
    });

  const debt = outstandingDetails.reduce((sum, entry) => sum + entry.remainingAmount, 0);
  const aging = Object.entries(buckets).map(([bucket, amount]) => ({ bucket, amount }));

  return ok(res, {
    customerId: customer.id,
    debt,
    aging,
    outstandingDetails
  });
});

router.get("/:id", requirePermission("partners:read"), async (req: AuthRequest, res) => {
  const access = await resolvePartnerAccessContext(req);
  if (access.scoped && !access.storeId) {
    return badRequest(res, "User has no active store assignment");
  }

  const partner = await prisma.partner.findFirst({
    where: {
      id: req.params.id,
      ...(access.scoped
        ? {
            OR: [
              { isCustomer: false },
              { ownerStoreId: access.storeId }
            ]
          }
        : {})
    },
      include: { accountOwnerPosition: true, ownerStore: true, businessArea: true }
  });
  if (!partner) return badRequest(res, "Partner not found");
  return ok(res, partner);
});

const updatePartnerSchema = z.object({
  name: z.string().min(2).optional(),
  ledgerCode: z.string().trim().max(64).optional().nullable().or(z.literal("")),
  phone: z.string().optional(),
  phone2: z.string().optional(),
  phone3: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
  businessAreaId: z.string().optional().nullable(),
  ownerStoreId: z.string().optional().nullable(),
  accountOwnerPositionId: z.string().optional().nullable(),
  customerPriceTier: z.enum(["LEVEL_2", "LEVEL_2_SPECIAL"]).optional().nullable()
});

const createCustomerNoteSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  isStarred: z.boolean().default(false)
});

router.put("/:id", requirePermission("partners:update"), async (req: AuthRequest, res) => {
  const access = await resolvePartnerAccessContext(req);
  if (access.scoped && !access.storeId) {
    return badRequest(res, "User has no active store assignment");
  }

  const parsed = updatePartnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid partner payload");
  }

  const existing = await prisma.partner.findUnique({
    where: { id: req.params.id },
    select: { id: true, isCustomer: true, ownerStoreId: true }
  });
  if (!existing) {
    return badRequest(res, "Partner not found");
  }

  if (access.scoped && existing.isCustomer && existing.ownerStoreId !== access.storeId) {
    return badRequest(res, "Customer belongs to another store");
  }

  const update: Record<string, unknown> = { ...parsed.data };
  if (update.email === "") delete update.email;
  if (update.ledgerCode === "") {
    update.ledgerCode = null;
  }
  if ("accountOwnerPositionId" in update && update.accountOwnerPositionId === null) {
    update.accountOwnerPositionId = null;
  }

  if ("ownerStoreId" in update) {
    if (access.scoped) {
      return badRequest(res, "Cannot change ownerStoreId with store-scoped role");
    }

    const nextOwnerStoreId = String(update.ownerStoreId || "") || null;
    if (existing.isCustomer && !nextOwnerStoreId) {
      return badRequest(res, "ownerStoreId is required for customer");
    }
    update.ownerStoreId = nextOwnerStoreId;
  }

  const ownerStoreIdToValidate = ("ownerStoreId" in update ? String(update.ownerStoreId || "") : existing.ownerStoreId) || null;
  if (existing.isCustomer && !ownerStoreIdToValidate) {
    return badRequest(res, "ownerStoreId is required for customer");
  }
  if (ownerStoreIdToValidate) {
    const store = await prisma.store.findUnique({ where: { id: ownerStoreIdToValidate }, select: { id: true } });
    if (!store) {
      return badRequest(res, "ownerStoreId is invalid");
    }
  }

  const isValidOwnerPosition = await validateSalesOwnerPosition(
    ("accountOwnerPositionId" in update ? String(update.accountOwnerPositionId || "") : undefined) || null
  );
  if (!isValidOwnerPosition) {
    return badRequest(res, "accountOwnerPositionId is invalid or not SALES_STAFF role");
  }

  const businessAreaIdToValidate =
    "businessAreaId" in update
      ? ((String(update.businessAreaId || "") || null))
      : undefined;

  if (businessAreaIdToValidate) {
    const businessArea = await prisma.businessArea.findUnique({
      where: { id: businessAreaIdToValidate },
      select: { id: true }
    });
    if (!businessArea) {
      return badRequest(res, "businessAreaId is invalid");
    }
    update.businessAreaId = businessAreaIdToValidate;
  } else if ("businessAreaId" in update) {
    update.businessAreaId = null;
  }

  const partner = await prisma.partner.update({
    where: { id: req.params.id },
    data: update,
    include: { accountOwnerPosition: true, ownerStore: true, businessArea: true }
  });
  return ok(res, partner, "Partner updated");
});

router.get("/:id/notes", requirePermission("partners:read"), async (req: AuthRequest, res) => {
  const access = await resolvePartnerAccessContext(req);
  if (access.scoped && !access.storeId) {
    return badRequest(res, "User has no active store assignment");
  }

  const customer = await prisma.partner.findFirst({
    where: {
      id: req.params.id,
      isCustomer: true,
      ...(access.scoped ? { ownerStoreId: access.storeId } : {})
    },
    select: { id: true, isCustomer: true }
  });
  if (!customer || !customer.isCustomer) {
    return badRequest(res, "Customer not found");
  }

  const notes = await prisma.customerNote.findMany({
    where: { customerId: req.params.id },
    include: {
      creator: {
        select: {
          id: true,
          fullName: true,
          email: true
        }
      }
    },
    orderBy: [
      { isStarred: "desc" },
      { createdAt: "desc" }
    ]
  });

  return ok(res, notes);
});

router.post("/:id/notes", requirePermission("partners:update"), async (req: AuthRequest, res) => {
  const access = await resolvePartnerAccessContext(req);
  if (access.scoped && !access.storeId) {
    return badRequest(res, "User has no active store assignment");
  }

  const parsed = createCustomerNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid customer note payload");
  }

  const customer = await prisma.partner.findFirst({
    where: {
      id: req.params.id,
      isCustomer: true,
      ...(access.scoped ? { ownerStoreId: access.storeId } : {})
    },
    select: { id: true, isCustomer: true }
  });
  if (!customer || !customer.isCustomer) {
    return badRequest(res, "Customer not found");
  }

  const note = await prisma.customerNote.create({
    data: {
      customerId: req.params.id,
      createdByUserId: req.user?.sub || null,
      content: parsed.data.content,
      isStarred: parsed.data.isStarred
    },
    include: {
      creator: {
        select: {
          id: true,
          fullName: true,
          email: true
        }
      }
    }
  });

  return created(res, note, "Customer note created");
});

router.get("/:id/transactions", requirePermission("partners:read"), async (req: AuthRequest, res) => {
  const access = await resolvePartnerAccessContext(req);
  if (access.scoped && !access.storeId) {
    return badRequest(res, "User has no active store assignment");
  }

  const partner = await prisma.partner.findFirst({
    where: {
      id: req.params.id,
      ...(access.scoped
        ? {
            OR: [
              { isCustomer: false },
              { ownerStoreId: access.storeId }
            ]
          }
        : {})
    }
  });
  if (!partner) return badRequest(res, "Partner not found");

  const logs = await prisma.partnerTransactionLog.findMany({
    where: { partnerId: req.params.id },
    orderBy: { createdAt: "desc" }
  });

  const txTypeLabel: Record<string, string> = {
    OPENING_BALANCE: "Số dư đầu kỳ",
    SALE_ORDER: "Đơn hàng bán",
    PAYMENT_RECEIPT: "Phiếu thu",
    RECEIPT_VOID: "Hủy phiếu thu",
    DISCOUNT_VOUCHER: "Chiết khấu",
    RETURN_ORDER: "Trả hàng",
    PURCHASE_ORDER: "Đơn mua hàng",
    PURCHASE_VOID: "Hủy đơn mua",
    PAYMENT_TO_SUPPLIER: "Thanh toán NCC"
  };

  const saleOrderIds = Array.from(new Set(
    logs
      .filter((log) => String(log.transactionType) === "SALE_ORDER")
      .map((log) => log.referenceId)
  ));

  const receiptIds = Array.from(new Set(
    logs
      .filter((log) => ["PAYMENT_RECEIPT", "DISCOUNT_VOUCHER", "RECEIPT_VOID"].includes(String(log.transactionType)))
      .map((log) => log.referenceId)
  ));

  const returnIds = Array.from(new Set(
    logs
      .filter((log) => String(log.transactionType) === "RETURN_ORDER")
      .map((log) => log.referenceId)
  ));

  let saleOrders: Array<{
    id: string;
    orderNo: string;
    totalAmount: unknown;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: unknown;
      product: { name: string } | null;
    }>;
  }> = [];

  if (saleOrderIds.length > 0) {
    saleOrders = await prisma.salesOrder.findMany({
      where: { id: { in: saleOrderIds } },
      select: {
        id: true,
        orderNo: true,
        totalAmount: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            unitPrice: true,
            product: {
              select: { name: true }
            }
          }
        }
      }
    });
  }

  let receiptsData: Array<{ id: string; receiptNo: string; amount: unknown; discountAmount: unknown }> = [];
  if (receiptIds.length > 0) {
    receiptsData = await prisma.receipt.findMany({
      where: { id: { in: receiptIds } },
      select: {
        id: true,
        receiptNo: true,
        amount: true,
        discountAmount: true
      }
    });
  }

  let returnDocs: Array<{
    id: string;
    order: { orderNo: string } | null;
    items: Array<{
      quantity: number;
      orderItem: {
        productId: string;
        unitPrice: unknown;
        product: { name: string } | null;
      };
    }>;
  }> = [];

  if (returnIds.length > 0) {
    returnDocs = await prisma.salesOrderReturn.findMany({
      where: { id: { in: returnIds } },
      select: {
        id: true,
        order: {
          select: {
            orderNo: true
          }
        },
        items: {
          select: {
            quantity: true,
            orderItem: {
              select: {
                productId: true,
                unitPrice: true,
                product: {
                  select: { name: true }
                }
              }
            }
          }
        }
      }
    });
  }

  const orderMap = new Map<string, (typeof saleOrders)[number]>(saleOrders.map((order) => [order.id, order]));
  const receiptMap = new Map<string, (typeof receiptsData)[number]>(receiptsData.map((receipt) => [receipt.id, receipt]));
  const returnMap = new Map<string, (typeof returnDocs)[number]>(returnDocs.map((row) => [row.id, row]));

  const buildLineDetails = (lines: string[]) => {
    if (!lines.length) return null;
    const preview = lines.slice(0, 4).join("; ");
    return lines.length > 4 ? `${preview}; ...` : preview;
  };

  return ok(res, logs.map((log) => {
      const type = String(log.transactionType);
      const saleOrder = orderMap.get(log.referenceId);
      const receipt = receiptMap.get(log.referenceId);
      const returnDoc = returnMap.get(log.referenceId);

      const lineDetail = (() => {
        if (type === "SALE_ORDER" && saleOrder) {
          const lines = saleOrder.items.map((item) => {
            const name = item.product?.name || item.productId;
            return `${name}: ${item.quantity} x ${Number(item.unitPrice || 0).toLocaleString("vi-VN")}`;
          });
          return buildLineDetails(lines);
        }

        if (type === "RETURN_ORDER" && returnDoc) {
          const lines = returnDoc.items.map((item) => {
            const name = item.orderItem.product?.name || item.orderItem.productId;
            return `${name}: ${item.quantity} x ${Number(item.orderItem.unitPrice || 0).toLocaleString("vi-VN")}`;
          });
          return buildLineDetails(lines);
        }

        return null;
      })();

      const parsedPaymentNote = type === "PAYMENT_TO_SUPPLIER"
        ? parsePaymentNote(log.note)
        : { note: String(log.note || "").trim(), meta: null };

      const noteParts = [parsedPaymentNote.note].filter(Boolean);
      if (lineDetail) {
        noteParts.push(`Chi tiet: ${lineDetail}`);
      }

      if (type === "PAYMENT_TO_SUPPLIER" && Number(parsedPaymentNote.meta?.cashAmount || 0) > 0) {
        noteParts.push(
          `Tien tra: ${Number(parsedPaymentNote.meta?.cashAmount || 0).toLocaleString("vi-VN")}`
        );
      }

      const documentNo = (() => {
        if (type === "SALE_ORDER" && saleOrder?.orderNo) return saleOrder.orderNo;
        if (["PAYMENT_RECEIPT", "DISCOUNT_VOUCHER", "RECEIPT_VOID"].includes(type) && receipt?.receiptNo) return receipt.receiptNo;
        if (type === "RETURN_ORDER" && returnDoc?.order?.orderNo) {
          return `TH-${returnDoc.order.orderNo}`;
        }
        return log.referenceId;
      })();

      const displayAmount = (() => {
        if (type === "SALE_ORDER" && saleOrder) {
          return Number(saleOrder.totalAmount || 0);
        }
        if (type === "PAYMENT_RECEIPT" && receipt) {
          return Number(receipt.amount || 0);
        }
        if (type === "DISCOUNT_VOUCHER" && receipt) {
          return Number(receipt.discountAmount || 0);
        }
        if (type === "RECEIPT_VOID" && receipt) {
          return Number(receipt.amount || 0) + Number(receipt.discountAmount || 0);
        }
        return Number(log.amount || 0);
      })();

      const cashAmount = (() => {
        if (type === "PAYMENT_RECEIPT" && receipt) {
          return Number(receipt.amount || 0);
        }
        if (type === "RECEIPT_VOID" && receipt) {
          return Number(receipt.amount || 0);
        }
        if (type === "RETURN_ORDER") {
          return isReturnPayoutNote(log.note) ? Number(log.amount || 0) : 0;
        }
        if (type === "PAYMENT_TO_SUPPLIER") {
          return Number(parsedPaymentNote.meta?.cashAmount || 0);
        }
        return 0;
      })();

      return {
        id: log.id,
        transactionType: log.transactionType,
        transactionTypeLabel: txTypeLabel[log.transactionType] || log.transactionType,
        referenceId: log.referenceId,
        documentNo,
        amount: Number(log.amount),
        displayAmount,
        cashAmount,
        note: noteParts.join(" | ") || null,
        createdAt: log.createdAt
      };
  }));
});

// GET customer analytics: revenue/profit by period
router.get("/:id/analytics", requirePermission("partners:read"), async (req: AuthRequest, res) => {
  try {
    const access = await resolvePartnerAccessContext(req);
    if (access.scoped && !access.storeId) {
      return badRequest(res, "User has no active store assignment");
    }

    const partner = await prisma.partner.findFirst({
      where: {
        id: req.params.id,
        ...(access.scoped
          ? {
              OR: [
                { isCustomer: false },
                { ownerStoreId: access.storeId }
              ]
            }
          : {})
      }
    });
    if (!partner) return badRequest(res, "Partner not found");

    const period = (req.query.period as string) || "month"; // month | quarter | year

    const [orders, receipts, priceListRows, returnLogs] = await Promise.all([
      prisma.salesOrder.findMany({
        where: { customerId: req.params.id },
        include: { items: { include: { product: { select: { costPrice: true } } } } },
        orderBy: { createdAt: "asc" }
      }),
      prisma.receipt.findMany({
        where: { customerId: req.params.id },
        orderBy: { createdAt: "desc" }
      }),
      prisma.customerPriceList.findMany({
        where: { customerId: req.params.id },
        include: {
          product: { select: { id: true, name: true, sku: true, defaultPrice: true } }
        },
        orderBy: { updatedAt: "desc" }
      }),
      prisma.partnerTransactionLog.findMany({
        where: {
          partnerId: req.params.id,
          transactionType: "RETURN_ORDER"
        },
        select: {
          amount: true,
          note: true
        }
      })
    ]);

    function periodKey(date: Date): string {
      if (period === "year") return String(date.getFullYear());
      if (period === "quarter") {
        const q = Math.floor(date.getMonth() / 3) + 1;
        return `${date.getFullYear()}-Q${q}`;
      }
      // default: month
      return date.toISOString().slice(0, 7);
    }

    const grouped: Record<string, { revenue: number; cogs: number; orders: number }> = {};

    for (const order of orders) {
      if (["CANCELLED", "REFUNDED", "DRAFT", "CONFIRMED"].includes(order.status)) continue;
      const key = periodKey(new Date(order.createdAt));
      if (!grouped[key]) grouped[key] = { revenue: 0, cogs: 0, orders: 0 };

      const revenue = Number(order.totalAmount);
      const grossRevenue = order.items.reduce((sum, item) => {
        const qty = Number(item.quantity || 0);
        if (qty <= 0) return sum;
        const unitPrice = Number(item.unitPrice || 0);
        const discountAmount = Number(item.discountAmount || 0);
        return sum + Math.max(qty * unitPrice - discountAmount, 0);
      }, 0);
      const rawCogs = order.items.reduce((sum, item) => {
        const unitCost = Number(item.unitCost || item.product.costPrice || 0);
        return sum + item.quantity * unitCost;
      }, 0);
      const cogs = grossRevenue > 0
        ? rawCogs * Math.max(0, Math.min(1, revenue / grossRevenue))
        : 0;

      grouped[key].revenue += revenue;
      grouped[key].cogs += cogs;
      grouped[key].orders += 1;
    }

    const byPeriod = Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, d]) => ({
        period: p,
        revenue: Math.round(d.revenue),
        cogs: Math.round(d.cogs),
        profit: Math.round(d.revenue - d.cogs),
        orders: d.orders
      }));

    const totalRevenue = byPeriod.reduce((s, x) => s + x.revenue, 0);
    const totalProfit = byPeriod.reduce((s, x) => s + x.profit, 0);
    const totalOrders = orders.filter((o) => !["CANCELLED", "REFUNDED", "DRAFT", "CONFIRMED"].includes(o.status)).length;
    const totalPaid = receipts.filter((r) => r.status !== "VOIDED").reduce((s, r) => s + Number(r.amount), 0);
    const totalRefundPayout = returnLogs
      .filter((log) => isReturnPayoutNote(log.note))
      .reduce((sum, log) => sum + Number(log.amount || 0), 0);
    const totalPaidNet = totalPaid - totalRefundPayout;

    const priceList = priceListRows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: row.product.name,
      productSku: row.product.sku,
      defaultPrice: Number(row.product.defaultPrice),
      customPrice: Number(row.price),
      storeId: row.storeId,
      updatedAt: row.updatedAt
    }));

    return ok(res, {
      summary: {
        totalRevenue,
        totalProfit,
        totalOrders,
        totalPaid,
        totalRefundPayout,
        totalPaidNet,
        netBalance: Number(partner.netBalance)
      },
      byPeriod,
      priceList
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get partner analytics: ${msg}`);
  }
});

// Helper: compute date range from preset (week / month / quarter / year / last-year)
function getPresetDateRange(preset: string): { dateFrom: Date; dateTo: Date } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const today = new Date(y, m, d);

  if (preset === "this-week") {
    const dow = today.getDay(); // 0=Sun
    const mondayOff = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(d + mondayOff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { dateFrom: monday, dateTo: sunday };
  }
  if (preset === "this-month") {
    return { dateFrom: new Date(y, m, 1), dateTo: new Date(y, m + 1, 0, 23, 59, 59, 999) };
  }
  if (preset === "this-quarter") {
    const q = Math.floor(m / 3);
    return { dateFrom: new Date(y, q * 3, 1), dateTo: new Date(y, q * 3 + 3, 0, 23, 59, 59, 999) };
  }
  if (preset === "this-year") {
    return { dateFrom: new Date(y, 0, 1), dateTo: new Date(y, 11, 31, 23, 59, 59, 999) };
  }
  if (preset === "last-year") {
    return { dateFrom: new Date(y - 1, 0, 1), dateTo: new Date(y - 1, 11, 31, 23, 59, 59, 999) };
  }
  // default: this-month
  return { dateFrom: new Date(y, m, 1), dateTo: new Date(y, m + 1, 0, 23, 59, 59, 999) };
}

// GET /partners/:id/overview — combined aging + period KPIs + 12-month charts
router.get("/:id/overview", requirePermission("partners:read"), async (req: AuthRequest, res) => {
  try {
    const access = await resolvePartnerAccessContext(req);
    if (access.scoped && !access.storeId) {
      return badRequest(res, "User has no active store assignment");
    }

    const partner = await prisma.partner.findFirst({
      where: {
        id: req.params.id,
        isCustomer: true,
        ...(access.scoped ? { ownerStoreId: access.storeId } : {})
      }
    });
    if (!partner) return badRequest(res, "Customer not found");

    const VALID_PRESETS = ["this-week", "this-month", "this-quarter", "this-year", "last-year"];
    const rawPreset = String(req.query.preset || "this-month").toLowerCase();
    const preset = VALID_PRESETS.includes(rawPreset) ? rawPreset : "this-month";
    const { dateFrom, dateTo } = getPresetDateRange(preset);

    // 12-month window for charts
    const now = new Date();
    const chart12Start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const chart12End = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [allOrdersForAging, periodOrders, chart12Orders, periodReceipts, chart12Receipts, periodGifts] =
      await Promise.all([
        // aging: outstanding orders
        prisma.salesOrder.findMany({
          where: {
            customerId: req.params.id,
            status: { notIn: ["DRAFT", "CANCELLED", "REFUNDED"] },
            debtAmount: { gt: 0 }
          },
          select: { id: true, orderNo: true, totalAmount: true, debtAmount: true, dueDate: true, createdAt: true }
        }),
        // period orders for KPI
        prisma.salesOrder.findMany({
          where: {
            customerId: req.params.id,
            createdAt: { gte: dateFrom, lte: dateTo },
            status: { notIn: ["DRAFT", "CANCELLED", "REFUNDED"] }
          },
          select: { totalAmount: true }
        }),
        // 12-month orders for chart
        prisma.salesOrder.findMany({
          where: {
            customerId: req.params.id,
            createdAt: { gte: chart12Start, lte: chart12End },
            status: { notIn: ["DRAFT", "CANCELLED", "REFUNDED"] }
          },
          select: { totalAmount: true, createdAt: true }
        }),
        // period receipts for KPI
        prisma.receipt.findMany({
          where: {
            customerId: req.params.id,
            createdAt: { gte: dateFrom, lte: dateTo },
            status: { not: "VOIDED" }
          },
          select: { amount: true, note: true }
        }),
        // 12-month receipts for chart
        prisma.receipt.findMany({
          where: {
            customerId: req.params.id,
            createdAt: { gte: chart12Start, lte: chart12End },
            status: { not: "VOIDED" }
          },
          select: { amount: true, note: true, createdAt: true }
        }),
        // period gift redemptions
        prisma.giftRedemption.findMany({
          where: {
            partnerId: req.params.id,
            status: "ACTIVE",
            createdAt: { gte: dateFrom, lte: dateTo }
          },
          select: { quantity: true, product: { select: { defaultPrice: true } } }
        })
      ]);

    // ── Aging ───────────────────────────────────────────────────
    const nowTs = Date.now();
    const agingBuckets = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, ">90": 0 } as Record<string, number>;
    for (const order of allOrdersForAging) {
      const ref = order.dueDate || order.createdAt;
      const days = Math.floor((nowTs - new Date(ref).getTime()) / 86400000);
      const rem = Number(order.debtAmount);
      if (days <= 0) agingBuckets["current"] += rem;
      else if (days <= 30) agingBuckets["1-30"] += rem;
      else if (days <= 60) agingBuckets["31-60"] += rem;
      else if (days <= 90) agingBuckets["61-90"] += rem;
      else agingBuckets[">90"] += rem;
    }
    const totalOrderDebt = allOrdersForAging.reduce((s, o) => s + Number(o.debtAmount), 0);
    const netBalance = Number(partner.netBalance || 0);
    const remainingOpeningBalance = Math.max(netBalance - totalOrderDebt, 0);
    if (remainingOpeningBalance > 0.0001) agingBuckets["current"] += remainingOpeningBalance;
    const totalDebt = Object.values(agingBuckets).reduce((s, v) => s + v, 0);

    // ── Period KPIs ─────────────────────────────────────────────
    const periodRevenue = periodOrders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
    const periodTotalOrders = periodOrders.length;
    const periodCollectionGross = periodReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    const periodRefundPayout = periodReceipts
      .filter((r) => isReturnPayoutNote(r.note))
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    const periodNetCollection = periodCollectionGross - periodRefundPayout;
    const periodGiftValue = periodGifts.reduce(
      (s, g) => s + g.quantity * Number(g.product.defaultPrice || 0), 0
    );

    // ── 12-month revenue chart ───────────────────────────────────
    const monthlyRevenueMap: Record<string, number> = {};
    for (const order of chart12Orders) {
      const key = new Date(order.createdAt).toISOString().slice(0, 7);
      monthlyRevenueMap[key] = (monthlyRevenueMap[key] || 0) + Number(order.totalAmount || 0);
    }

    // ── 12-month collection chart ────────────────────────────────
    const monthlyCollectionMap: Record<string, number> = {};
    for (const receipt of chart12Receipts) {
      if (isReturnPayoutNote(receipt.note)) continue;
      const key = new Date(receipt.createdAt).toISOString().slice(0, 7);
      monthlyCollectionMap[key] = (monthlyCollectionMap[key] || 0) + Number(receipt.amount || 0);
    }

    // Build ordered 12-month array
    const monthlyRevenue: { month: string; revenue: number }[] = [];
    const monthlyCollection: { month: string; amount: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = dt.toISOString().slice(0, 7);
      monthlyRevenue.push({ month: key, revenue: Math.round(monthlyRevenueMap[key] || 0) });
      monthlyCollection.push({ month: key, amount: Math.round(monthlyCollectionMap[key] || 0) });
    }

    return ok(res, {
      preset,
      dateFrom,
      dateTo,
      aging: {
        totalDebt,
        buckets: Object.entries(agingBuckets).map(([bucket, amount]) => ({ bucket, amount: Math.round(amount) }))
      },
      period: {
        revenue: Math.round(periodRevenue),
        totalOrders: periodTotalOrders,
        netCollection: Math.round(periodNetCollection),
        netBalance,
        giftValue: Math.round(periodGiftValue)
      },
      monthlyRevenue,
      monthlyCollection
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get customer overview: ${msg}`);
  }
});

// GET gift redemption history for a customer
router.get("/:id/gift-redemptions", requirePermission("partners:read"), async (req: AuthRequest, res) => {
  try {
    const rows = await prisma.giftRedemption.findMany({
      where: { partnerId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        product: { select: { id: true, name: true, sku: true, rewardPoints: true, giftPointsCost: true, imageUrl: true } }
      }
    });
    return ok(res, rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.product.name,
      productSku: r.product.sku,
      productImageUrl: r.product.imageUrl,
      storeId: r.storeId,
      quantity: r.quantity,
      pointsCost: r.pointsCost,
      status: r.status,
      note: r.note,
      createdBy: r.createdBy,
      cancelledBy: r.cancelledBy,
      cancelledAt: r.cancelledAt,
      createdAt: r.createdAt
    })));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get gift redemptions: ${msg}`);
  }
});

// POST redeem gift for a customer (deduct reward points + inventory, allow negative points)
router.post("/:id/gift-redemptions", requirePermission("partners:update"), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      productId: z.string().min(1),
      quantity: z.number().int().min(1).default(1),
      note: z.string().optional(),
      storeId: z.string().optional()
    });
    const body = schema.parse(req.body);

    const [partner, product] = await Promise.all([
      prisma.partner.findUnique({ where: { id: req.params.id }, select: { id: true, rewardPoints: true, name: true } }),
      prisma.product.findUnique({ where: { id: body.productId }, select: { id: true, name: true, rewardPoints: true, giftPointsCost: true, productType: true } })
    ]);
    if (!partner) return badRequest(res, "Partner not found");
    if (!product) return badRequest(res, "Product not found");

    const pointsCost = product.giftPointsCost * body.quantity;

    const isStockTracked = product.productType !== "SERVICE";

    // Check inventory if storeId provided and product is stock-tracked
    let inventoryAvailable: number | null = null;
    if (body.storeId && isStockTracked) {
      const inventory = await prisma.inventory.findUnique({
        where: { productId_storeId: { productId: body.productId, storeId: body.storeId } }
      });
      if (inventory) {
        const available = inventory.quantity - inventory.reservedQuantity;
        if (body.quantity > available) {
          return badRequest(res, `Tồn kho không đủ: khả dụng ${available}, yêu cầu ${body.quantity}`);
        }
        inventoryAvailable = available;
      }
      // No inventory record → skip deduction (product may not be tracked at this store)
    }

    const redemption = await prisma.$transaction(async (tx) => {
      const created = await tx.giftRedemption.create({
        data: {
          partnerId: partner.id,
          productId: product.id,
          storeId: body.storeId ?? null,
          quantity: body.quantity,
          pointsCost,
          note: body.note ?? null,
          createdBy: (req as AuthRequest).user?.sub ?? null
        }
      });

      await tx.partner.update({
        where: { id: partner.id },
        data: { rewardPoints: { decrement: pointsCost } }
      });

      // Deduct inventory stock (only if inventory record exists at this store)
      if (body.storeId && isStockTracked && inventoryAvailable != null) {
        await tx.inventory.updateMany({
          where: { productId: body.productId, storeId: body.storeId },
          data: { quantity: { decrement: body.quantity } }
        });
      }

      return created;
    });

    return created(res, {
      id: redemption.id,
      productId: product.id,
      productName: product.name,
      storeId: redemption.storeId,
      quantity: redemption.quantity,
      pointsCost: redemption.pointsCost,
      newRewardPoints: partner.rewardPoints - pointsCost,
      inventoryDeducted: body.storeId != null && isStockTracked && inventoryAvailable != null,
      createdAt: redemption.createdAt
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(res, error.errors.map((e) => e.message).join("; "));
    }
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to redeem gift: ${msg}`);
  }
});

// PATCH cancel a gift redemption (revert points + restock inventory)
router.patch("/:id/gift-redemptions/:redemptionId/cancel", requirePermission("partners:update"), async (req: AuthRequest, res) => {
  try {
    const redemption = await prisma.giftRedemption.findUnique({
      where: { id: req.params.redemptionId },
      include: { product: { select: { id: true, productType: true } } }
    });

    if (!redemption) return badRequest(res, "Gift redemption not found");
    if (redemption.partnerId !== req.params.id) return badRequest(res, "Redemption does not belong to this partner");
    if (redemption.status === "CANCELLED") return badRequest(res, "Redemption is already cancelled");

    const isStockTracked = redemption.product.productType !== "SERVICE";
    const cancelledBy = (req as AuthRequest).user?.sub ?? null;

    await prisma.$transaction(async (tx) => {
      await tx.giftRedemption.update({
        where: { id: redemption.id },
        data: {
          status: "CANCELLED",
          cancelledBy,
          cancelledAt: new Date()
        }
      });

      // Restore reward points
      await tx.partner.update({
        where: { id: redemption.partnerId },
        data: { rewardPoints: { increment: redemption.pointsCost } }
      });

      // Restock inventory if storeId was recorded
      if (redemption.storeId && isStockTracked) {
        await tx.inventory.updateMany({
          where: { productId: redemption.productId, storeId: redemption.storeId },
          data: { quantity: { increment: redemption.quantity } }
        });
      }
    });

    return ok(res, { success: true, message: "Đã hủy tặng quà và hoàn điểm, cộng lại tồn kho" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to cancel gift redemption: ${msg}`);
  }
});

export default router;
