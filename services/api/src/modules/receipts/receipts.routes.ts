import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, forbidden, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { resolveAssignedStoreIdsForUser } from "../../security/store-assignment.js";

const router = Router();

const RECEIVABLE_ORDER_EXCLUDED_STATUSES = ["DRAFT", "CANCELLED", "REFUNDED"] as const;

const createReceiptSchema = z.object({
  customerId: z.string(),
  storeId: z.string(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD", "MIXED"]),
  amount: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().default(0),
  type: z.enum(["PAYMENT", "DISCOUNT"]).default("PAYMENT"),
  note: z.string().optional(),
  orderIds: z.array(z.string()).default([])
}).superRefine((data, ctx) => {
  const amount = Number(data.amount || 0);
  const discountAmount = Number(data.discountAmount || 0);

  if (amount <= 0 && discountAmount <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "amount or discountAmount must be > 0"
    });
  }

  if (amount > 0 && data.type !== "PAYMENT") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "type must be PAYMENT when amount > 0"
    });
  }

  if (data.type === "DISCOUNT" && amount > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "DISCOUNT receipt cannot have positive amount"
    });
  }

  if (data.type === "DISCOUNT" && discountAmount <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "discountAmount must be > 0 when type is DISCOUNT"
    });
  }
});

function buildReceiptInclude() {
  return {
    customer: true,
    store: true,
    collectedByUser: {
      select: { id: true, fullName: true, email: true }
    },
    voidedByUser: {
      select: { id: true, fullName: true, email: true }
    },
    allocations: {
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            totalAmount: true,
            paidAmount: true,
            debtAmount: true,
            status: true
          }
        }
      },
      orderBy: { createdAt: "asc" }
    }
  } as const;
}

const voidReceiptSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});

router.get("/", requirePermission("receipts:read"), async (req: AuthRequest, res) => {
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

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const dateFrom = fromDate ? new Date(fromDate + "T00:00:00") : todayStart;
  const dateTo = toDate ? new Date(toDate + "T23:59:59") : todayEnd;

  const data = await prisma.receipt.findMany({
    where: {
      storeId: { in: assignedStoreIds },
      createdAt: { gte: dateFrom, lte: dateTo }
    },
    include: buildReceiptInclude(),
    orderBy: { createdAt: "desc" }
  });
  return ok(res, data);
});

router.post("/", requirePermission("receipts:create"), async (req: AuthRequest, res) => {
  const parsed = createReceiptSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid receipt payload");
  }

  const payload = parsed.data;

  const customer = await prisma.partner.findUnique({
    where: { id: payload.customerId },
    select: { id: true, netBalance: true }
  });

  if (!customer) {
    return badRequest(res, "Customer not found");
  }

  const store = await prisma.store.findUnique({
    where: { id: payload.storeId },
    select: { id: true }
  });

  if (!store) {
    return badRequest(res, "Store not found");
  }

  const userId = req.user?.sub;
  if (!userId) {
    return forbidden(res, "Missing authenticated user");
  }

  const assignedStoreIds = await resolveAssignedStoreIdsForUser(userId, new Date(), req.user?.roles);
  if (!assignedStoreIds.includes(payload.storeId)) {
    return forbidden(res, "No store assignment for this store");
  }

  if (payload.orderIds.length > 0) {
    const existingOrders = await prisma.salesOrder.count({
      where: {
        id: { in: payload.orderIds },
        customerId: payload.customerId,
        status: { notIn: [...RECEIVABLE_ORDER_EXCLUDED_STATUSES] }
      }
    });

    if (existingOrders !== payload.orderIds.length) {
      return badRequest(res, "Some orders are invalid for this customer");
    }
  }

  const receipt = await prisma.$transaction(async (tx) => {
    const createdReceipt = await tx.receipt.create({
      data: {
        receiptNo: `PT-${Date.now()}`,
        collectedByUserId: req.user?.sub,
        customerId: payload.customerId,
        storeId: payload.storeId,
        paymentMethod: payload.paymentMethod,
        amount: payload.amount,
        discountAmount: payload.discountAmount,
        type: payload.type,
        note: payload.note
      },
      include: buildReceiptInclude()
    });

    let remaining = payload.amount + payload.discountAmount;
    let applied = 0;

    let allocationOrderIds: string[] = [];

    if (payload.orderIds.length > 0) {
      allocationOrderIds = payload.orderIds;
    } else {
      const autoOrders = await tx.salesOrder.findMany({
        where: {
          customerId: payload.customerId,
          debtAmount: { gt: 0 },
          status: { notIn: [...RECEIVABLE_ORDER_EXCLUDED_STATUSES] }
        },
        select: { id: true, debtAmount: true },
        orderBy: [
          { createdAt: "asc" },
          { id: "asc" }
        ]
      });

      // Auto allocation without explicit orderIds: prioritize opening balance debt first.
      const totalOrderDebt = autoOrders.reduce((sum, order) => sum + Number(order.debtAmount || 0), 0);
      const openingBalanceDebt = Math.max(Number(customer.netBalance || 0) - totalOrderDebt, 0);
      if (openingBalanceDebt > 0 && remaining > 0) {
        const openingPay = Math.min(openingBalanceDebt, remaining);
        remaining -= openingPay;
        applied += openingPay;
      }

      allocationOrderIds = autoOrders.map((order) => order.id);
    }

    if (allocationOrderIds.length > 0) {
      const fetchedOrders = await tx.salesOrder.findMany({
        where: {
          id: { in: allocationOrderIds },
          customerId: payload.customerId
        }
      });
      const orderMap = new Map(fetchedOrders.map((order) => [order.id, order]));

      for (const orderId of allocationOrderIds) {
        if (remaining <= 0) break;

        const order = orderMap.get(orderId);
        if (!order) continue;

        const debt = Number(order.debtAmount);
        if (debt <= 0) continue;

        const pay = Math.min(debt, remaining);
        remaining -= pay;
        applied += pay;

        const newPaid = Number(order.paidAmount) + pay;
        const newDebt = Math.max(debt - pay, 0);

        await tx.salesOrder.update({
          where: { id: order.id },
          data: {
            paidAmount: newPaid,
            debtAmount: newDebt,
            status: newDebt === 0 ? "COMPLETED" : order.status
          }
        });

        await tx.receiptAllocation.create({
          data: {
            receiptId: createdReceipt.id,
            orderId: order.id,
            appliedAmount: pay
          }
        });
      }
    }

    const receiptValue = payload.amount + payload.discountAmount;

    if (receiptValue > 0) {
      await tx.partner.update({
        where: { id: payload.customerId },
        data: {
          netBalance: { decrement: receiptValue }
        }
      });
    }

    if (receiptValue > 0) {
      await tx.partnerTransactionLog.create({
        data: {
          partnerId: payload.customerId,
          transactionType: payload.type === "DISCOUNT" ? "DISCOUNT_VOUCHER" : "PAYMENT_RECEIPT",
          referenceId: createdReceipt.id,
          amount: receiptValue,
          note: payload.note || "Thu tien khach"
        }
      });
    }

    return tx.receipt.findUnique({
      where: { id: createdReceipt.id },
      include: buildReceiptInclude()
    });
  });

  return created(res, receipt, "Receipt created");
});

router.post("/apply-order", requirePermission("receipts:apply-order"), async (req: AuthRequest, res) => {
  const parsed = z.object({
    customerId: z.string().optional(),
    receiptId: z.string().optional(),
    orderIds: z.array(z.string()).min(1),
    amount: z.number().positive().optional()
  }).safeParse(req.body);

  if (!parsed.success) {
    return badRequest(res, "Invalid payload");
  }

  if (!parsed.data.receiptId && !parsed.data.customerId) {
    return badRequest(res, "customerId or receiptId is required");
  }

  const receipt = parsed.data.receiptId
    ? await prisma.receipt.findUnique({
        where: { id: parsed.data.receiptId },
        include: { allocations: true }
      })
    : null;

  if (parsed.data.receiptId && !receipt) {
    return badRequest(res, "Receipt not found");
  }

  const userId = req.user?.sub;
  if (!userId) {
    return forbidden(res, "Missing authenticated user");
  }

  const assignedStoreIds = await resolveAssignedStoreIdsForUser(userId, new Date(), req.user?.roles);
  if (!assignedStoreIds.length) {
    return forbidden(res, "User has no active store assignment");
  }

  if (receipt && !assignedStoreIds.includes(receipt.storeId)) {
    return forbidden(res, "No store assignment for this receipt");
  }

  if (receipt?.status === "VOIDED") {
    return badRequest(res, "Receipt has been voided");
  }

  const customerId = receipt?.customerId || parsed.data.customerId;
  if (!customerId) {
    return badRequest(res, "Customer not found for allocation");
  }

  const baseAmount = receipt
    ? Number(receipt.amount) + Number(receipt.discountAmount) - receipt.allocations.reduce((sum, row) => sum + Number(row.appliedAmount), 0)
    : Number(parsed.data.amount || 0);

  if (baseAmount <= 0) {
    return badRequest(res, "No remaining amount to apply");
  }

  const orders = await prisma.salesOrder.findMany({
    where: {
      id: { in: parsed.data.orderIds },
      customerId,
      storeId: { in: assignedStoreIds },
      status: { notIn: ["DRAFT", "CANCELLED", "REFUNDED"] }
    }
  });

  if (!orders.length) {
    return badRequest(res, "Orders not found");
  }

  const uniqueOrderIds = new Set(parsed.data.orderIds);
  if (orders.length !== uniqueOrderIds.size) {
    return forbidden(res, "One or more orders are outside assigned stores");
  }

  const orderMap = new Map(orders.map((order) => [order.id, order]));

  const result = await prisma.$transaction(async (tx) => {
    let remaining = baseAmount;
    let applied = 0;

    for (const orderId of parsed.data.orderIds) {
      if (remaining <= 0) break;

      const order = orderMap.get(orderId);
      if (!order) continue;

      const debt = Number(order.debtAmount);
      if (debt <= 0) continue;

      const pay = Math.min(debt, remaining);
      remaining -= pay;
      applied += pay;

      const newPaid = Number(order.paidAmount) + pay;
      const newDebt = Math.max(debt - pay, 0);

      await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          paidAmount: newPaid,
          debtAmount: newDebt,
          status: newDebt === 0 ? "COMPLETED" : order.status
        }
      });

      if (receipt) {
        await tx.receiptAllocation.upsert({
          where: {
            receiptId_orderId: {
              receiptId: receipt.id,
              orderId: order.id
            }
          },
          create: {
            receiptId: receipt.id,
            orderId: order.id,
            appliedAmount: pay
          },
          update: {
            appliedAmount: { increment: pay }
          }
        });
      }
    }

    if (!receipt && applied > 0) {
      await tx.partner.update({
        where: { id: customerId },
        data: { netBalance: { decrement: applied } }
      });

      await tx.partnerTransactionLog.create({
        data: {
          partnerId: customerId,
          transactionType: "PAYMENT_RECEIPT",
          referenceId: `APPLY-${Date.now()}`,
          amount: applied,
          note: `Apply phieu thu vao ${parsed.data.orderIds.length} don hang`
        }
      });
    }

    return { applied, remaining };
  });

  return ok(res, result, "Applied payment to orders");
});

router.post("/:id/void", requirePermission("receipts:void"), async (req: AuthRequest, res) => {
  const parsed = voidReceiptSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid void payload");
  }

  const receipt = await prisma.receipt.findUnique({
    where: { id: req.params.id },
    include: {
      allocations: true
    }
  });

  if (!receipt) {
    return badRequest(res, "Receipt not found");
  }

  const userId = req.user?.sub;
  if (!userId) {
    return forbidden(res, "Missing authenticated user");
  }

  const assignedStoreIds = await resolveAssignedStoreIdsForUser(userId, new Date(), req.user?.roles);
  if (!assignedStoreIds.includes(receipt.storeId)) {
    return forbidden(res, "No store assignment for this receipt");
  }

  if (receipt.status === "VOIDED") {
    return badRequest(res, "Receipt already voided");
  }

  const next = await prisma.$transaction(async (tx) => {
    if (receipt.allocations.length > 0) {
      const orderIds = Array.from(new Set(receipt.allocations.map((row) => row.orderId)));
      const orders = await tx.salesOrder.findMany({
        where: { id: { in: orderIds } }
      });
      const orderMap = new Map(orders.map((order) => [order.id, order]));

      for (const allocation of receipt.allocations) {
        const order = orderMap.get(allocation.orderId);
        if (!order) continue;

        const appliedAmount = Number(allocation.appliedAmount || 0);
        if (appliedAmount <= 0) continue;

        const currentPaid = Number(order.paidAmount || 0);
        const currentDebt = Number(order.debtAmount || 0);
        const newPaid = Math.max(currentPaid - appliedAmount, 0);
        const newDebt = currentDebt + appliedAmount;

        const fulfilledStatuses = new Set(["COMPLETED", "DELIVERED", "RETURNED", "REFUNDED"]);
        let nextStatus = order.status;
        if (newDebt > 0 && order.status === "COMPLETED") {
          nextStatus = "DELIVERED";
        }

        let nextDueDate = order.dueDate;
        if (newDebt > 0 && !order.dueDate) {
          const due = new Date();
          due.setDate(due.getDate() + 30);
          due.setHours(23, 59, 59, 999);
          nextDueDate = due;
        } else if (newDebt <= 0) {
          nextDueDate = null;
        }

        await tx.salesOrder.update({
          where: { id: order.id },
          data: {
            paidAmount: newPaid,
            debtAmount: newDebt,
            status: nextStatus,
            dueDate: nextDueDate
          }
        });
      }
    }

    const receiptValue = Number(receipt.amount || 0) + Number(receipt.discountAmount || 0);
    if (receiptValue > 0) {
      await tx.partner.update({
        where: { id: receipt.customerId },
        data: {
          netBalance: { increment: receiptValue }
        }
      });

      await tx.partnerTransactionLog.create({
        data: {
          partnerId: receipt.customerId,
          transactionType: "RECEIPT_VOID",
          referenceId: receipt.id,
          amount: receiptValue,
          note: `Huy phieu thu ${receipt.receiptNo}: ${parsed.data.reason}`
        }
      });
    }

    await tx.receipt.update({
      where: { id: receipt.id },
      data: {
        status: "VOIDED",
        voidReason: parsed.data.reason,
        voidedAt: new Date(),
        voidedByUserId: req.user?.sub || null
      }
    });

    return tx.receipt.findUnique({
      where: { id: receipt.id },
      include: buildReceiptInclude()
    });
  });

  return ok(res, next, "Receipt voided");
});

export default router;
