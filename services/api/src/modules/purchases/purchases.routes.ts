import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, forbidden, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { resolveAssignedStoreIdsForUser } from "../../security/store-assignment.js";

const router = Router();

type StoreScopedRequest = AuthRequest & {
  assignedStoreIds?: string[];
};

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function enforceAssignedStores(req: StoreScopedRequest, res: Response, next: NextFunction) {
  const userId = req.user?.sub;
  if (!userId) {
    return forbidden(res, "Missing authenticated user");
  }

  const assignedStoreIds = await resolveAssignedStoreIdsForUser(userId, new Date(), req.user?.roles);
  if (!assignedStoreIds.length) {
    return forbidden(res, "User has no active store assignment");
  }

  req.assignedStoreIds = assignedStoreIds;
  return next();
}

router.use(enforceAssignedStores);

const META_MARKER = "##PURCHASE_META##";
const PAYMENT_META_MARKER = "##PURCHASE_PAYMENT_META##";
const REBATE_BATCH_LINK_PREFIX = "[REBATE_BATCH_REF:";
const REBATE_PAYABLE_ONLY_TAG = "[REBATE_PAYABLE_ONLY]";

type PurchaseMetaItem = {
  productId: string;
  productSku?: string;
  productName: string;
  quantity: number;
  unitCost: number;
  lineAmount: number;
  rebateAllocatedAmount?: number;
  netFinalAmount?: number;
  unitFinalCost?: number;
};

type PurchaseRebateMeta = {
  id?: string;
  rebateBatchId?: string;
  rebateBatchReferenceId?: string;
  isPayableOnly?: boolean;
  rebateBatchTotalAmount?: number;
  label: string;
  amount: number;
  note?: string;
  createdAt?: string;
  purchasedQty: number;
  soldQty: number;
  soldRatio: number;
  cogsAdjustmentAmount: number;
  inventoryAdjustmentAmount: number;
};

type PurchaseMeta = {
  storeId?: string;
  storeName?: string;
  documentDate?: string;
  items?: PurchaseMetaItem[];
  rebates?: PurchaseRebateMeta[];
  rebateInventoryCostAdjustments?: RebateInventoryCostAdjustment[];
};

type PaymentMeta = {
  id?: string;
  cashAmount: number;
  settledAmount: number;
};

type RebateInventoryCostAdjustment = {
  productId: string;
  qtyAtAdjustment: number;
  perUnitAdjustment: number;
  totalAdjustment: number;
  previousCostPrice: number;
  newCostPrice: number;
};

type PurchaseItemInput = {
  productId: string;
  quantity: number;
  unitCost: number;
};

type PurchaseProductLookup = Map<string, { id: string; sku?: string; name: string; costPrice?: number }>;

const createPurchaseSchema = z.object({
  supplierId: z.string(),
  amount: z.number().positive().optional(),
  paidAmount: z.number().min(0).default(0),
  storeId: z.string().optional(),
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().positive(),
      unitCost: z.number().nonnegative(),
    })
  ).optional(),
  invoiceNo: z.string().optional(),
  documentDate: z.string().optional(),
  note: z.string().optional()
});

const createPaymentSchema = z.object({
  supplierId: z.string(),
  amount: z.number().min(0),
  note: z.string().optional()
}).refine((data) => data.amount > 0, {
  message: "Payment amount must be greater than zero"
});

const deletePaymentSchema = z.object({
  supplierId: z.string()
});

const voidPurchaseSchema = z.object({
  supplierId: z.string(),
  reason: z.string().trim().min(3)
});

const purchaseRebateSchema = z.object({
  supplierId: z.string(),
  label: z.string().trim().min(1).default("Chiết khấu thương mại"),
  amount: z.number().min(0),
  note: z.string().optional(),
  referenceIds: z.array(z.string().trim().min(1)).optional()
}).refine((data) => data.amount > 0, {
  message: "Purchase rebate amount must be greater than zero"
});

const deletePurchaseRebateSchema = z.object({
  supplierId: z.string()
});

const deletePurchaseRebateBatchSchema = z.object({
  supplierId: z.string()
});

function buildStatus(totalAmount: number, paidAmount: number, voidedAt?: Date | null) {
  if (voidedAt) return "VOIDED";
  if (paidAmount <= 0) return "UNPAID";
  if (paidAmount >= totalAmount) return "PAID";
  return "PARTIAL";
}

function parsePurchaseNote(rawNote: string | null | undefined): { note: string; meta: PurchaseMeta | null } {
  const safe = rawNote || "";
  const markerIndex = safe.indexOf(META_MARKER);
  if (markerIndex < 0) {
    return { note: safe, meta: null };
  }

  const noteText = safe.slice(0, markerIndex).trim();
  const encodedMeta = safe.slice(markerIndex + META_MARKER.length).trim();
  if (!encodedMeta) {
    return { note: noteText, meta: null };
  }

  try {
    return {
      note: noteText,
      meta: JSON.parse(encodedMeta) as PurchaseMeta
    };
  } catch {
    return { note: noteText, meta: null };
  }
}

function composePurchaseNote(note: string | undefined, meta: PurchaseMeta | null): string {
  const noteText = (note || "").trim();
  if (!meta) {
    return noteText || "Ghi nhan mua hang";
  }

  return `${noteText || "Ghi nhan mua hang"}\n${META_MARKER}${JSON.stringify(meta)}`;
}

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

function composePaymentNote(note: string | undefined, meta: PaymentMeta): string {
  const noteText = (note || "").trim() || "Thanh toan nha cung cap";
  return `${noteText}\n${PAYMENT_META_MARKER}${JSON.stringify(meta)}`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isSameMoney(left: number, right: number): boolean {
  return Math.abs(roundMoney(left) - roundMoney(right)) <= 0.01;
}

function buildPurchaseRebateBatchReference() {
  return `PRB-${Date.now()}`;
}

function toDateOnly(value?: string): Date | undefined {
  if (!value) return undefined;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function dateOnlyString(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function allocateAmountByWeight<T>(
  items: T[],
  total: number,
  getWeight: (item: T) => number
): number[] {
  const weights = items.map(getWeight);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0 || items.length === 0) {
    return items.map(() => 0);
  }
  const allocated = weights.map((w) => roundMoney((w / totalWeight) * total));
  const diff = roundMoney(total - allocated.reduce((s, a) => s + a, 0));
  if (diff !== 0 && allocated.length > 0) {
    allocated[allocated.length - 1] = roundMoney(allocated[allocated.length - 1] + diff);
  }
  return allocated;
}

function buildPurchaseItemMeta(
  itemRows: PurchaseItemInput[],
  productsById: PurchaseProductLookup
): PurchaseMetaItem[] {
  return itemRows.map((item) => {
    const lineAmount = roundMoney(item.quantity * item.unitCost);
    const product = productsById.get(item.productId);

    return {
      productId: item.productId,
      productSku: product?.sku,
      productName: product?.name || "N/A",
      quantity: item.quantity,
      unitCost: roundMoney(item.unitCost),
      lineAmount
    };
  });
}

function applyRebateInventoryAdjustmentToItems(
  items: PurchaseMetaItem[],
  adjustments: RebateInventoryCostAdjustment[],
  fallbackTotalAdjustment: number
): PurchaseMetaItem[] {
  if (!items.length) return items;

  const roundedFallback = roundMoney(Number(fallbackTotalAdjustment || 0));
  const groupedByProduct = items.reduce((acc, item, index) => {
    const rows = acc.get(item.productId) || [];
    rows.push({ index, item });
    acc.set(item.productId, rows);
    return acc;
  }, new Map<string, Array<{ index: number; item: PurchaseMetaItem }>>());

  const itemAdjustments = items.map(() => 0);
  const explicitByProduct = adjustments.reduce((acc, adjustment) => {
    acc.set(adjustment.productId, roundMoney((acc.get(adjustment.productId) || 0) + Number(adjustment.totalAdjustment || 0)));
    return acc;
  }, new Map<string, number>());

  const hasExplicitAdjustments = explicitByProduct.size > 0;

  if (hasExplicitAdjustments) {
    for (const [productId, rows] of groupedByProduct.entries()) {
      const productAdjustment = roundMoney(Number(explicitByProduct.get(productId) || 0));
      if (productAdjustment <= 0) continue;

      const totalProductNet = rows.reduce((sum, row) => sum + Number(row.item.lineAmount || 0), 0);
      const totalQty = rows.reduce((sum, row) => sum + Number(row.item.quantity || 0), 0);
      rows.forEach((row, rowIndex) => {
        const isLast = rowIndex === rows.length - 1;
        if (isLast) {
          const allocatedBefore = rows.slice(0, rowIndex).reduce((sum, prev) => sum + Number(itemAdjustments[prev.index] || 0), 0);
          itemAdjustments[row.index] = roundMoney(Math.max(productAdjustment - allocatedBefore, 0));
        } else {
          const ratio = totalProductNet > 0
            ? Number(row.item.lineAmount || 0) / totalProductNet
            : (totalQty > 0 ? Number(row.item.quantity || 0) / totalQty : 0);
          itemAdjustments[row.index] = roundMoney(Math.max(productAdjustment * ratio, 0));
        }
      });
    }
  } else if (roundedFallback > 0) {
    const totalNet = items.reduce((sum, item) => sum + Number(item.lineAmount || 0), 0);
    items.forEach((item, index) => {
      const isLast = index === items.length - 1;
      if (isLast) {
        const allocatedBefore = items.slice(0, index).reduce((sum, _, prevIndex) => sum + Number(itemAdjustments[prevIndex] || 0), 0);
        itemAdjustments[index] = roundMoney(Math.max(roundedFallback - allocatedBefore, 0));
      } else {
        const ratio = totalNet > 0 ? Number(item.lineAmount || 0) / totalNet : 0;
        itemAdjustments[index] = roundMoney(Math.max(roundedFallback * ratio, 0));
      }
    });
  }

  return items.map((item, index) => {
    const rebateAllocatedAmount = roundMoney(Number(itemAdjustments[index] || 0));
    const netFinalAmount = roundMoney(Math.max(Number(item.lineAmount || 0) - rebateAllocatedAmount, 0));
    const unitFinalCost = Number(item.quantity || 0) > 0
      ? roundMoney(netFinalAmount / Number(item.quantity || 0))
      : roundMoney(Number(item.unitCost || 0));

    return {
      ...item,
      rebateAllocatedAmount,
      netFinalAmount,
      unitFinalCost
    };
  });
}

function getEffectivePurchaseAmount(purchaseOrder: { amount: number | { toString(): string }; rebateAmount?: number | { toString(): string } | null }) {
  return Math.max(
    roundMoney(Number(purchaseOrder.amount || 0) - Number(purchaseOrder.rebateAmount || 0)),
    0
  );
}

function getPayableRebateAmountFromMeta(
  rebates: Array<Pick<PurchaseRebateMeta, "amount" | "rebateBatchId">>
) {
  return roundMoney(
    rebates
      .filter((rebate) => !rebate.rebateBatchId)
      .reduce((sum, rebate) => sum + Number(rebate.amount || 0), 0)
  );
}

function isPayableOnlyRebateMeta(rebate: Pick<PurchaseRebateMeta, "rebateBatchId" | "note" | "isPayableOnly">) {
  const noteText = String(rebate.note || "");
  if (Boolean(rebate.isPayableOnly)) {
    return true;
  }
  // Legacy fallback for records created before `isPayableOnly` was stored explicitly.
  return !rebate.rebateBatchId && (
    noteText.includes(REBATE_PAYABLE_ONLY_TAG) ||
    noteText.includes(REBATE_BATCH_LINK_PREFIX)
  );
}

function extractBatchReferenceFromNote(note?: string | null) {
  const text = String(note || "");
  const regex = /\[REBATE_BATCH_REF:([^\]]+)\]/;
  const match = text.match(regex);
  return match?.[1]?.trim() || "";
}

function getCostAllocationRebateAmountFromMeta(
  rebates: Array<Pick<PurchaseRebateMeta, "amount" | "rebateBatchId" | "note" | "isPayableOnly">>
) {
  return roundMoney(
    rebates
      .filter((rebate) => !isPayableOnlyRebateMeta(rebate))
      .reduce((sum, rebate) => sum + Number(rebate.amount || 0), 0)
  );
}

function getEffectivePurchaseAmountFromRebates(
  grossAmount: number,
  rebates: Array<Pick<PurchaseRebateMeta, "amount" | "rebateBatchId">>
) {
  return Math.max(roundMoney(grossAmount - getPayableRebateAmountFromMeta(rebates)), 0);
}

async function listPurchaseRebates(
  tx: Pick<typeof prisma, "purchaseRebate"> | Pick<TxClient, "purchaseRebate">,
  purchaseOrderId: string,
  fallback: PurchaseRebateMeta[]
): Promise<PurchaseRebateMeta[]> {
  const rows = await tx.purchaseRebate.findMany({
    where: { purchaseOrderId },
    orderBy: { createdAt: "asc" }
  });

  if (!rows.length) return fallback;
  return rows.map((row) => ({
    id: row.id,
    rebateBatchId: row.rebateBatchId || undefined,
    rebateBatchReferenceId: row.rebateBatchId || undefined,
    isPayableOnly: Boolean(row.isPayableOnly),
    label: row.label,
    amount: Number(row.amount),
    note: row.note || undefined,
    createdAt: row.createdAt.toISOString(),
    purchasedQty: row.purchasedQty,
    soldQty: row.soldQty,
    soldRatio: Number(row.soldRatio),
    cogsAdjustmentAmount: Number(row.cogsAdjustmentAmount),
    inventoryAdjustmentAmount: Number(row.inventoryAdjustmentAmount)
  }));
}

async function rollbackPurchaseRebateInventoryAdjustments(
  tx: TxClient,
  adjustments: RebateInventoryCostAdjustment[]
) {
  for (const adjustment of adjustments) {
    const product = await tx.product.findUnique({
      where: { id: adjustment.productId },
      select: { id: true, costPrice: true }
    });
    if (!product) continue;

    // Always rollback by delta instead of checking exact equality against
    // adjustment.newCostPrice. Cost price can legitimately change later
    // (e.g. users add landed cost between rebate updates). If we skip rollback
    // in that case, the next rebate application will subtract again and
    // over-decrease cost.
    const rollbackDelta = roundMoney(Number(adjustment.previousCostPrice || 0) - Number(adjustment.newCostPrice || 0));
    if (isSameMoney(rollbackDelta, 0)) continue;

    const nextCostPrice = roundMoney(Math.max(Number(product.costPrice || 0) + rollbackDelta, 0));
    await tx.product.update({
      where: { id: product.id },
      data: { costPrice: nextCostPrice }
    });
  }
}

async function computePurchaseRebateTotals(
  tx: TxClient,
  purchaseOrder: {
    id: string;
    storeId: string | null;
    items: Array<{ productId: string; quantity: number }>;
  },
  totalRebateAmount: number
) {
  const purchasedQtyByProduct = new Map<string, number>();
  for (const item of purchaseOrder.items) {
    purchasedQtyByProduct.set(item.productId, (purchasedQtyByProduct.get(item.productId) || 0) + item.quantity);
  }

  const purchasedQty = Array.from(purchasedQtyByProduct.values()).reduce((sum, quantity) => sum + quantity, 0);
  if (purchasedQty <= 0 || totalRebateAmount <= 0) {
    return {
      purchasedQty,
      soldQty: 0,
      soldRatio: 0,
      cogsAdjustmentAmount: 0,
      inventoryAdjustmentAmount: 0,
      inventoryCostAdjustments: [] as RebateInventoryCostAdjustment[]
    };
  }

  const inventoryRows = await tx.inventory.findMany({
    where: {
      productId: { in: Array.from(purchasedQtyByProduct.keys()) },
      ...(purchaseOrder.storeId ? { storeId: purchaseOrder.storeId } : {}),
      quantity: { gt: 0 }
    },
    select: { productId: true, quantity: true }
  });

  const inventoryQtyByProduct = new Map<string, number>();
  for (const row of inventoryRows) {
    inventoryQtyByProduct.set(row.productId, (inventoryQtyByProduct.get(row.productId) || 0) + row.quantity);
  }

  const orderItemRows = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId: purchaseOrder.id },
    select: { productId: true, quantity: true, lineAmount: true }
  });

  const purchasedNetByProduct = new Map<string, number>();
  for (const row of orderItemRows) {
    purchasedNetByProduct.set(
      row.productId,
      roundMoney((purchasedNetByProduct.get(row.productId) || 0) + Number(row.lineAmount || 0))
    );
  }

  const remainingQtyByProduct = new Map<string, number>();
  const remainingValueByProduct = new Map<string, number>();
  let soldQty = 0;
  let purchasedValue = 0;
  let soldValue = 0;
  let remainingValue = 0;
  let remainingQty = 0;

  for (const [productId, purchased] of purchasedQtyByProduct.entries()) {
    const currentInventoryQty = inventoryQtyByProduct.get(productId) || 0;
    const remaining = Math.min(currentInventoryQty, purchased);
    const sold = Math.max(purchased - remaining, 0);
    const purchasedProductValue = roundMoney(Number(purchasedNetByProduct.get(productId) || 0));
    const remainingProductValue = purchased > 0
      ? roundMoney(purchasedProductValue * (remaining / purchased))
      : 0;
    const soldProductValue = roundMoney(Math.max(purchasedProductValue - remainingProductValue, 0));

    soldQty += sold;
    remainingQty += remaining;
    purchasedValue = roundMoney(purchasedValue + purchasedProductValue);
    soldValue = roundMoney(soldValue + soldProductValue);
    remainingValue = roundMoney(remainingValue + remainingProductValue);

    if (remaining > 0) {
      remainingQtyByProduct.set(productId, remaining);
      remainingValueByProduct.set(productId, remainingProductValue);
    }
  }

  const soldRatio = purchasedValue > 0
    ? Math.min(soldValue / purchasedValue, 1)
    : (purchasedQty > 0 ? Math.min(soldQty / purchasedQty, 1) : 0);
  const cogsAdjustmentAmount = roundMoney(totalRebateAmount * soldRatio);
  const inventoryAdjustmentAmount = roundMoney(totalRebateAmount - cogsAdjustmentAmount);
  const inventoryCostAdjustments: RebateInventoryCostAdjustment[] = [];

  if (inventoryAdjustmentAmount > 0 && remainingQty > 0) {
    const basisByProduct = new Map<string, number>();
    for (const [productId, remainingProductQty] of remainingQtyByProduct.entries()) {
      const remainingProductValue = Number(remainingValueByProduct.get(productId) || 0);
      const basis = remainingValue > 0 ? remainingProductValue : remainingProductQty;
      if (basis > 0) {
        basisByProduct.set(productId, basis);
      }
    }

    const basisEntries = Array.from(basisByProduct.entries());
    const totalBasis = basisEntries.reduce((sum, [, basis]) => sum + basis, 0);
    let allocatedBefore = 0;

    for (const [entryIndex, [productId, basis]] of basisEntries.entries()) {
      const currentInventoryQty = inventoryQtyByProduct.get(productId) || 0;
      if (currentInventoryQty <= 0) continue;

      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { costPrice: true }
      });
      if (!product) continue;

      const isLast = entryIndex === basisEntries.length - 1;
      const productShare = isLast
        ? roundMoney(Math.max(inventoryAdjustmentAmount - allocatedBefore, 0))
        : roundMoney(totalBasis > 0 ? inventoryAdjustmentAmount * (basis / totalBasis) : 0);
      allocatedBefore = roundMoney(allocatedBefore + productShare);

      const perUnitAdjustment = currentInventoryQty > 0 ? productShare / currentInventoryQty : 0;
      const newCostPrice = roundMoney(Math.max(0, Number(product.costPrice) - perUnitAdjustment));

      await tx.product.update({
        where: { id: productId },
        data: { costPrice: newCostPrice }
      });

      inventoryCostAdjustments.push({
        productId,
        qtyAtAdjustment: currentInventoryQty,
        perUnitAdjustment: roundMoney(perUnitAdjustment),
        totalAdjustment: roundMoney(productShare),
        previousCostPrice: roundMoney(Number(product.costPrice)),
        newCostPrice
      });
    }
  }

  return {
    purchasedQty,
    soldQty,
    soldRatio,
    cogsAdjustmentAmount,
    inventoryAdjustmentAmount,
    inventoryCostAdjustments
  };
}

async function recomputeMovingAvgCost(tx: TxClient, productId: string) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { costPrice: true }
  });

  const purchaseItems = await tx.purchaseOrderItem.findMany({
    where: {
      productId,
      purchaseOrder: {
        voidedAt: null
      }
    },
    select: {
      purchaseOrderId: true,
      quantity: true,
      lineAmount: true,
      purchaseOrder: {
        select: {
          id: true,
          note: true,
          rebateInventoryAdjustment: true
        }
      }
    }
  });

  const totalQtyByOrder = new Map<string, number>();
  const totalNetByOrder = new Map<string, number>();

  for (const item of purchaseItems) {
    const orderId = item.purchaseOrderId;
    totalQtyByOrder.set(orderId, (totalQtyByOrder.get(orderId) || 0) + Number(item.quantity || 0));
    totalNetByOrder.set(orderId, roundMoney((totalNetByOrder.get(orderId) || 0) + Number(item.lineAmount || 0)));
  }

  const totalQty = Array.from(totalQtyByOrder.values()).reduce((sum, qty) => sum + qty, 0);
  if (totalQty <= 0) {
    return roundMoney(Number(product?.costPrice || 0));
  }

  const orderIdsWithRebate = [...new Set(
    purchaseItems
      .filter((item) => Number(item.purchaseOrder?.rebateInventoryAdjustment || 0) > 0)
      .map((item) => item.purchaseOrderId)
  )];

  let orderNetByOrderId = new Map<string, number>();
  if (orderIdsWithRebate.length) {
    const allItemsInOrders = await tx.purchaseOrderItem.findMany({
      where: {
        purchaseOrderId: { in: orderIdsWithRebate }
      },
      select: {
        purchaseOrderId: true,
        lineAmount: true
      }
    });

    orderNetByOrderId = allItemsInOrders.reduce((acc, row) => {
      const current = acc.get(row.purchaseOrderId) || 0;
      acc.set(row.purchaseOrderId, roundMoney(current + Number(row.lineAmount || 0)));
      return acc;
    }, new Map<string, number>());
  }

  const sampleByOrderId = purchaseItems.reduce((acc, item) => {
    if (!acc.has(item.purchaseOrderId)) {
      acc.set(item.purchaseOrderId, item);
    }
    return acc;
  }, new Map<string, (typeof purchaseItems)[number]>());

  const adjustedTotalNetAmount = Array.from(sampleByOrderId.entries()).reduce((sum, [orderId, sample]) => {
    const productNetInOrder = roundMoney(Number(totalNetByOrder.get(orderId) || 0));
    const order = sample.purchaseOrder;
    const orderRebateInventoryAdjustment = roundMoney(Number(order?.rebateInventoryAdjustment || 0));

    if (orderRebateInventoryAdjustment <= 0) {
      return roundMoney(sum + productNetInOrder);
    }

    const parsedNote = parsePurchaseNote(order?.note);
    const adjustmentFromMeta = roundMoney((parsedNote.meta?.rebateInventoryCostAdjustments || [])
      .filter((adj) => adj.productId === productId)
      .reduce((adjSum, adj) => adjSum + Number(adj.totalAdjustment || 0), 0));

    let productAdjustment = adjustmentFromMeta;
    if (productAdjustment <= 0) {
      const orderTotalNet = Number(orderNetByOrderId.get(orderId) || 0);
      const ratio = orderTotalNet > 0 ? productNetInOrder / orderTotalNet : 0;
      productAdjustment = roundMoney(orderRebateInventoryAdjustment * ratio);
    }

    const adjustedProductNet = roundMoney(Math.max(productNetInOrder - productAdjustment, 0));
    return roundMoney(sum + adjustedProductNet);
  }, 0);

  const totalNetAmount = roundMoney(Math.max(adjustedTotalNetAmount, 0));
  return roundMoney(totalNetAmount / totalQty);
}

async function syncPurchaseRebateState(
  tx: TxClient,
  purchaseOrder: {
    id: string;
    referenceId: string;
    supplierId: string;
    storeId: string | null;
    note: string | null;
    rebateAmount?: number | { toString(): string } | null;
    items: Array<{ productId: string; quantity: number }>;
  },
  baseNote: string,
  rebates: PurchaseRebateMeta[],
  options?: {
    persistRebateRows?: boolean;
  }
) {
  const persistRebateRows = options?.persistRebateRows ?? true;
  const parsedCurrentNote = parsePurchaseNote(purchaseOrder.note);
  await rollbackPurchaseRebateInventoryAdjustments(tx, parsedCurrentNote.meta?.rebateInventoryCostAdjustments || []);

  const totalRebateAmount = roundMoney(rebates.reduce((sum, rebate) => sum + Number(rebate.amount || 0), 0));
  const costAllocationRebateAmount = getCostAllocationRebateAmountFromMeta(rebates);
  const payableRebateAmount = getPayableRebateAmountFromMeta(rebates);
  const previousPayableRebateAmount = roundMoney(Number(purchaseOrder.rebateAmount || 0));
  const rebateDelta = roundMoney(payableRebateAmount - previousPayableRebateAmount);

  const totals = await computePurchaseRebateTotals(tx, {
    id: purchaseOrder.id,
    storeId: purchaseOrder.storeId,
    items: purchaseOrder.items
  }, costAllocationRebateAmount);

  const normalizedRebates = rebates.map((rebate) => {
    const isPayableOnly = isPayableOnlyRebateMeta(rebate);
    const share = isPayableOnly
      ? 0
      : (costAllocationRebateAmount > 0 ? Number(rebate.amount || 0) / costAllocationRebateAmount : 0);
    const rebateAmount = roundMoney(Number(rebate.amount || 0));
    return {
      ...rebate,
      isPayableOnly,
      amount: rebateAmount,
      purchasedQty: totals.purchasedQty,
      soldQty: totals.soldQty,
      soldRatio: totals.soldRatio,
      cogsAdjustmentAmount: roundMoney(totals.cogsAdjustmentAmount * share),
      inventoryAdjustmentAmount: roundMoney(totals.inventoryAdjustmentAmount * share)
    };
  });

  // Fetch full item details to apply per-item rebate allocation
  const itemRows = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId: purchaseOrder.id },
    select: {
      productId: true,
      quantity: true,
      unitCost: true,
      lineAmount: true
    }
  });

  // Convert items to metadata format
  const itemsForAllocation: PurchaseMetaItem[] = itemRows.map((row) => ({
    productId: row.productId,
    quantity: Number(row.quantity),
    unitCost: Number(row.unitCost),
    lineAmount: Number(row.lineAmount),
    productSku: undefined,
    productName: "N/A"
  }));

  // Apply rebate allocation to each item (phân bổ chi tiết cho từng item)
  const itemsWithRebateAllocation = applyRebateInventoryAdjustmentToItems(
    itemsForAllocation,
    totals.inventoryCostAdjustments,
    totals.inventoryAdjustmentAmount
  );

  const nextMeta: PurchaseMeta = {
    ...(parsedCurrentNote.meta || {}),
    items: itemsWithRebateAllocation,
    rebates: normalizedRebates,
    rebateInventoryCostAdjustments: totals.inventoryCostAdjustments
  };

  await tx.purchaseOrder.update({
    where: { referenceId: purchaseOrder.referenceId },
    data: {
      note: composePurchaseNote(baseNote, nextMeta),
      rebateAmount: payableRebateAmount,
      rebateCogsAdjustment: totals.cogsAdjustmentAmount,
      rebateInventoryAdjustment: totals.inventoryAdjustmentAmount,
      rebatePurchasedQty: totals.purchasedQty,
      rebateSoldQty: totals.soldQty
    }
  });

  if (persistRebateRows) {
    // Upsert strategy: update existing rows (preserve ID → applications stay intact),
    // create new rows, delete removed rows. Avoids cascade-deleting purchaseRebateApplication.
    const existingPersisted = await tx.purchaseRebate.findMany({
      where: { purchaseOrderId: purchaseOrder.id },
      select: { id: true }
    });
    const existingIds = new Set(existingPersisted.map((r) => r.id));
    const idsToKeep = new Set(normalizedRebates.filter((r) => r.id && existingIds.has(r.id)).map((r) => r.id!));
    const idsToDelete = [...existingIds].filter((id) => !idsToKeep.has(id));

    if (idsToDelete.length) {
      await tx.purchaseRebate.deleteMany({ where: { id: { in: idsToDelete } } });
    }

    for (const rebate of normalizedRebates) {
      const rebateData = {
        purchaseOrderId: purchaseOrder.id,
        supplierId: purchaseOrder.supplierId,
        rebateBatchId: rebate.rebateBatchId || null,
        isPayableOnly: Boolean(rebate.isPayableOnly),
        label: rebate.label,
        amount: rebate.amount,
        note: rebate.note || null,
        purchasedQty: rebate.purchasedQty,
        soldQty: rebate.soldQty,
        soldRatio: rebate.soldRatio,
        cogsAdjustmentAmount: rebate.cogsAdjustmentAmount,
        inventoryAdjustmentAmount: rebate.inventoryAdjustmentAmount
      };

      if (rebate.id && idsToKeep.has(rebate.id)) {
        await tx.purchaseRebate.update({
          where: { id: rebate.id },
          data: rebateData
        });
      } else {
        await tx.purchaseRebate.create({ data: rebateData });
      }
    }
  }

  const existingRebateLog = await tx.partnerTransactionLog.findFirst({
    where: {
      partnerId: purchaseOrder.supplierId,
      transactionType: "SUPPLIER_REBATE",
      referenceId: purchaseOrder.referenceId
    }
  });

  if (payableRebateAmount > 0) {
    const rebateNote = `Ghi nhan chiet khau thuong mai cho don mua ${purchaseOrder.referenceId}: ${payableRebateAmount.toLocaleString("vi-VN")} đ`;
    if (existingRebateLog) {
      await tx.partnerTransactionLog.update({
        where: { id: existingRebateLog.id },
        data: {
          amount: payableRebateAmount,
          note: rebateNote
        }
      });
    } else {
      await tx.partnerTransactionLog.create({
        data: {
          partnerId: purchaseOrder.supplierId,
          transactionType: "SUPPLIER_REBATE",
          referenceId: purchaseOrder.referenceId,
          amount: payableRebateAmount,
          note: rebateNote
        }
      });
    }
  } else if (existingRebateLog) {
    await tx.partnerTransactionLog.delete({ where: { id: existingRebateLog.id } });
  }

  if (rebateDelta > 0) {
    await tx.partner.update({
      where: { id: purchaseOrder.supplierId },
      data: { netBalance: { decrement: rebateDelta } }
    });
  } else if (rebateDelta < 0) {
    await tx.partner.update({
      where: { id: purchaseOrder.supplierId },
      data: { netBalance: { increment: Math.abs(rebateDelta) } }
    });
  }

  return {
    rebateAmount: payableRebateAmount,
    totalRebateAmount,
    cogsAdjustmentAmount: totals.cogsAdjustmentAmount,
    inventoryAdjustmentAmount: totals.inventoryAdjustmentAmount,
    purchasedQty: totals.purchasedQty,
    soldQty: totals.soldQty,
    soldRatio: totals.soldRatio,
    rebates: normalizedRebates
  };
}

async function recomputePurchaseRebateStateWithApplications(
  tx: TxClient,
  purchaseOrderId: string
) {
  const purchaseOrder = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { items: true }
  });
  if (!purchaseOrder) {
    throw new Error("Không tìm thấy chứng từ mua hàng để tính lại chiết khấu");
  }

  const parsedNote = parsePurchaseNote(purchaseOrder.note);
  const storedRebates = await listPurchaseRebates(tx, purchaseOrder.id, []);
  const applicationRows = await tx.purchaseRebateApplication.findMany({
    where: { purchaseOrderId },
    include: {
      purchaseRebate: {
        select: {
          id: true,
          label: true,
          note: true,
          createdAt: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  const syntheticApplicationRebates: PurchaseRebateMeta[] = applicationRows.map((row) => ({
    id: `APP-${row.id}`,
    rebateBatchId: `REBATE_DOC:${row.purchaseRebateId}`,
    rebateBatchReferenceId: `REBATE_DOC:${row.purchaseRebateId}`,
    isPayableOnly: false,
    label: row.purchaseRebate.label,
    amount: Number(row.allocatedAmount || 0),
    note: row.purchaseRebate.note || undefined,
    createdAt: row.purchaseRebate.createdAt.toISOString(),
    purchasedQty: 0,
    soldQty: 0,
    soldRatio: 0,
    cogsAdjustmentAmount: 0,
    inventoryAdjustmentAmount: 0
  }));

  return syncPurchaseRebateState(
    tx,
    purchaseOrder,
    parsedNote.note,
    [...storedRebates, ...syntheticApplicationRebates],
    { persistRebateRows: false }
  );
}

router.get("/last-supplier-prices", requirePermission("purchases:read"), async (req: StoreScopedRequest, res) => {
  try {
    const supplierId = (req.query.supplierId as string || "").trim();
    const rawProductIds = req.query.productIds as string | undefined;
    if (!supplierId || !rawProductIds) return res.json({});

    const productIds = rawProductIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (productIds.length === 0) return res.json({});

    // For each productId, find the most recent non-voided PO item from this supplier
    const rows = await prisma.purchaseOrderItem.findMany({
      where: {
        productId: { in: productIds },
        purchaseOrder: {
          supplierId,
          voidedAt: null
        }
      },
      select: {
        productId: true,
        unitCost: true,
        purchaseOrder: { select: { createdAt: true } }
      },
      orderBy: { purchaseOrder: { createdAt: "desc" } }
    });

    // Take the first (most recent) entry per productId
    const result: Record<string, number> = {};
    for (const row of rows) {
      if (!(row.productId in result)) {
        result[row.productId] = Number(row.unitCost);
      }
    }
    return res.json(result);
  } catch (err) {
    console.error("last-supplier-prices error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/", requirePermission("purchases:read"), async (req: StoreScopedRequest, res) => {
  try {
    const assignedStoreIds = req.assignedStoreIds || [];
    const supplierId = req.query.supplierId as string | undefined;
    const status = req.query.status as string | undefined;
    const search = ((req.query.search as string) || "").trim().toLowerCase();
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const storeIdFilter = req.query.storeId as string | undefined;

    if (storeIdFilter && !assignedStoreIds.includes(storeIdFilter)) {
      return forbidden(res, "No store assignment for this store");
    }

    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    const documentDateFilter: { gte?: Date; lte?: Date } = {};
    if (fromDate) {
      const parsedFrom = new Date(`${fromDate}T00:00:00`);
      if (!Number.isNaN(parsedFrom.getTime())) {
        createdAtFilter.gte = parsedFrom;
      }
      const parsedFromDocument = toDateOnly(fromDate);
      if (parsedFromDocument) {
        documentDateFilter.gte = parsedFromDocument;
      }
    }
    if (toDate) {
      const parsedTo = new Date(`${toDate}T23:59:59.999`);
      if (!Number.isNaN(parsedTo.getTime())) {
        createdAtFilter.lte = parsedTo;
      }
      const parsedToDocument = toDateOnly(toDate);
      if (parsedToDocument) {
        documentDateFilter.lte = parsedToDocument;
      }
    }

    const showVoided = status === "VOIDED";
    const hasDateFilter = Object.keys(createdAtFilter).length > 0 || Object.keys(documentDateFilter).length > 0;
    const scopedStoreWhere = storeIdFilter
      ? { storeId: storeIdFilter }
      : { storeId: { in: assignedStoreIds } };
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: {
        ...(supplierId ? { supplierId } : {}),
        ...scopedStoreWhere,
        ...(hasDateFilter
          ? {
              OR: [
                ...(Object.keys(documentDateFilter).length ? [{ documentDate: documentDateFilter }] : []),
                ...(Object.keys(createdAtFilter).length
                  ? [{ AND: [{ documentDate: null }, { createdAt: createdAtFilter }] }]
                  : [])
              ]
            }
          : {}),
        ...(showVoided ? { NOT: { voidedAt: null } } : { voidedAt: null })
      },
      include: {
        supplier: true
      },
      orderBy: { createdAt: "desc" }
    });

    const purchaseIds = purchaseOrders.map((row) => row.id);
    const payments = purchaseIds.length
      ? await prisma.purchasePayment.findMany({
          where: { purchaseOrderId: { in: purchaseIds } },
          orderBy: { createdAt: "desc" }
        })
      : [];

    const batchRebateRows = purchaseIds.length
      ? await prisma.purchaseRebate.findMany({
          where: {
            purchaseOrderId: { in: purchaseIds },
            rebateBatchId: { not: null }
          },
          select: { purchaseOrderId: true }
        })
      : [];
    const hasBatchRebateByPurchaseId = new Set(batchRebateRows.map((row) => row.purchaseOrderId));

    const refByPurchaseId = new Map(purchaseOrders.map((order) => [order.id, order.referenceId]));
    const supplierByPurchaseId = new Map(purchaseOrders.map((order) => [order.id, order.supplierId]));

    const paidByRef: Record<string, number> = {};
    const paidCashByRef: Record<string, number> = {};
    const paymentCountByRef: Record<string, number> = {};
    const lastPaymentAtByRef: Record<string, Date> = {};

    for (const pay of payments) {
      const key = refByPurchaseId.get(pay.purchaseOrderId);
      if (!key) continue;
      const purchaseSupplierId = supplierByPurchaseId.get(pay.purchaseOrderId);
      if (!purchaseSupplierId || pay.supplierId !== purchaseSupplierId) continue;
      const settledAmount = Number(pay.settledAmount);
      const cashAmount = Number(pay.cashAmount);

      paidByRef[key] = (paidByRef[key] || 0) + settledAmount;
      paidCashByRef[key] = (paidCashByRef[key] || 0) + cashAmount;
      paymentCountByRef[key] = (paymentCountByRef[key] || 0) + 1;
      if (!lastPaymentAtByRef[key]) {
        lastPaymentAtByRef[key] = pay.createdAt;
      }
    }

    let data = purchaseOrders.map((order) => {
      const parsedNote = parsePurchaseNote(order.note);
      const grossAmount = Number(order.amount);
      const rebateAmount = Number(order.rebateAmount || 0);
      const totalAmount = getEffectivePurchaseAmount(order);
      const paidAmount = paidByRef[order.referenceId] ?? Number(order.paidAmount);
      const debtAmount = Math.max(totalAmount - paidAmount, 0);

      return {
        id: order.id,
        referenceId: order.referenceId,
        supplierId: order.supplierId,
        supplierName: order.supplier.name,
        storeId: order.storeId,
        storeName: parsedNote.meta?.storeName,
        documentDate: dateOnlyString(order.documentDate) || parsedNote.meta?.documentDate,
        amount: totalAmount,
        grossAmount,
        rebateAmount,
        hasBatchRebate: hasBatchRebateByPurchaseId.has(order.id),
        rebateCogsAdjustment: Number(order.rebateCogsAdjustment || 0),
        rebateInventoryAdjustment: Number(order.rebateInventoryAdjustment || 0),
        paidAmount,
        paidCashAmount: paidCashByRef[order.referenceId] ?? paidAmount,
        debtAmount,
        status: buildStatus(totalAmount, paidAmount, order.voidedAt),
        voidedAt: order.voidedAt,
        voidReason: order.voidReason,
        note: parsedNote.note,
        createdAt: order.createdAt,
        paymentCount: paymentCountByRef[order.referenceId] || 0,
        lastPaymentAt: lastPaymentAtByRef[order.referenceId] || null
      };
    });

    if (search) {
      data = data.filter((row) =>
        row.referenceId.toLowerCase().includes(search) ||
        row.supplierName.toLowerCase().includes(search) ||
        (row.note || "").toLowerCase().includes(search)
      );
    }

    if (status && status !== "ALL") {
      data = data.filter((row) => row.status === status);
    }

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get purchases: ${msg}`);
  }
});

router.get("/overview", requirePermission("purchases:read"), async (req: StoreScopedRequest, res) => {
  try {
    const assignedStoreIds = req.assignedStoreIds || [];
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: {
        voidedAt: null,
        storeId: { in: assignedStoreIds }
      },
      select: {
        id: true,
        referenceId: true,
        amount: true,
        rebateAmount: true,
        paidAmount: true
      }
    });

    const purchaseIds = purchaseOrders.map((row) => row.id);
    const payments = purchaseIds.length
      ? await prisma.purchasePayment.findMany({
          where: { purchaseOrderId: { in: purchaseIds } },
          select: {
            settledAmount: true,
            cashAmount: true,
          }
        })
      : [];

    const paymentSummary = payments.reduce(
      (acc, payment) => {
        const settledAmount = Number(payment.settledAmount || 0);
        const cashAmount = Number(payment.cashAmount || 0);

        acc.totalPaid += settledAmount;
        acc.totalPaidCash += cashAmount;
        return acc;
      },
      { totalPaid: 0, totalPaidCash: 0 }
    );

    const totalPurchases = purchaseOrders.length;
    const totalAmount = purchaseOrders.reduce((sum, p) => sum + getEffectivePurchaseAmount(p), 0);
    const totalPaid = paymentSummary.totalPaid || purchaseOrders.reduce((sum, p) => sum + Number(p.paidAmount), 0);
    const totalPaidCash = paymentSummary.totalPaidCash;
    const totalDebt = Math.max(totalAmount - totalPaid, 0);
    const totalRebate = purchaseOrders.reduce((sum, p) => sum + Number(p.rebateAmount || 0), 0);

    return ok(res, {
      totalPurchases,
      totalAmount,
      totalRebate,
      totalPaid,
      totalPaidCash,
      totalDebt
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get purchases overview: ${msg}`);
  }
});

router.get("/cash-flow", requirePermission("purchases:read"), async (req: StoreScopedRequest, res) => {
  try {
    const assignedStoreIds = req.assignedStoreIds || [];
    const supplierId = req.query.supplierId as string | undefined;
    const storeIdFilter = req.query.storeId as string | undefined;
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;

    if (storeIdFilter && !assignedStoreIds.includes(storeIdFilter)) {
      return forbidden(res, "No store assignment for this store");
    }

    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    const documentDateFilter: { gte?: Date; lte?: Date } = {};
    if (fromDate) {
      const parsedFrom = new Date(`${fromDate}T00:00:00`);
      if (!Number.isNaN(parsedFrom.getTime())) {
        createdAtFilter.gte = parsedFrom;
      }
      const parsedFromDocument = toDateOnly(fromDate);
      if (parsedFromDocument) {
        documentDateFilter.gte = parsedFromDocument;
      }
    }
    if (toDate) {
      const parsedTo = new Date(`${toDate}T23:59:59.999`);
      if (!Number.isNaN(parsedTo.getTime())) {
        createdAtFilter.lte = parsedTo;
      }
      const parsedToDocument = toDateOnly(toDate);
      if (parsedToDocument) {
        documentDateFilter.lte = parsedToDocument;
      }
    }

    const hasDateFilter = Object.keys(createdAtFilter).length > 0 || Object.keys(documentDateFilter).length > 0;
    const scopedStoreWhere = storeIdFilter
      ? { storeId: storeIdFilter }
      : { storeId: { in: assignedStoreIds } };

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: {
        voidedAt: null,
        ...(supplierId ? { supplierId } : {}),
        ...scopedStoreWhere,
        ...(hasDateFilter
          ? {
              OR: [
                ...(Object.keys(documentDateFilter).length ? [{ documentDate: documentDateFilter }] : []),
                ...(Object.keys(createdAtFilter).length
                  ? [{ AND: [{ documentDate: null }, { createdAt: createdAtFilter }] }]
                  : [])
              ]
            }
          : {})
      },
      include: {
        supplier: { select: { id: true, name: true } },
        payments: {
          select: {
            supplierId: true,
            cashAmount: true,
            settledAmount: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const grouped = new Map<string, {
      supplierId: string;
      supplierName: string;
      purchaseCount: number;
      goodsAndCostAmount: number;
      rebateAmount: number;
      payableAmount: number;
      paidCashAmount: number;
      settledAmount: number;
      outstandingAmount: number;
    }>();

    for (const order of purchaseOrders) {
      const key = order.supplierId;
      const current = grouped.get(key) || {
        supplierId: key,
        supplierName: order.supplier.name,
        purchaseCount: 0,
        goodsAndCostAmount: 0,
        rebateAmount: 0,
        payableAmount: 0,
        paidCashAmount: 0,
        settledAmount: 0,
        outstandingAmount: 0
      };

      const goodsAndCostAmount = roundMoney(Number(order.amount || 0));
      const rebateAmount = roundMoney(Number(order.rebateAmount || 0));
      const payableAmount = Math.max(roundMoney(goodsAndCostAmount - rebateAmount), 0);
      const paidCashAmount = roundMoney(order.payments
        .filter((payment) => payment.supplierId === order.supplierId)
        .reduce((sum, payment) => sum + Number(payment.cashAmount || 0), 0));
      const settledAmount = roundMoney(order.payments
        .filter((payment) => payment.supplierId === order.supplierId)
        .reduce((sum, payment) => sum + Number(payment.settledAmount || 0), 0));
      const outstandingAmount = Math.max(roundMoney(payableAmount - settledAmount), 0);

      current.purchaseCount += 1;
      current.goodsAndCostAmount = roundMoney(current.goodsAndCostAmount + goodsAndCostAmount);
      current.rebateAmount = roundMoney(current.rebateAmount + rebateAmount);
      current.payableAmount = roundMoney(current.payableAmount + payableAmount);
      current.paidCashAmount = roundMoney(current.paidCashAmount + paidCashAmount);
      current.settledAmount = roundMoney(current.settledAmount + settledAmount);
      current.outstandingAmount = roundMoney(current.outstandingAmount + outstandingAmount);

      grouped.set(key, current);
    }

    const rows = Array.from(grouped.values()).sort((a, b) => b.payableAmount - a.payableAmount);
    const totals = rows.reduce((acc, row) => {
      acc.purchaseCount += row.purchaseCount;
      acc.goodsAndCostAmount = roundMoney(acc.goodsAndCostAmount + row.goodsAndCostAmount);
      acc.rebateAmount = roundMoney(acc.rebateAmount + row.rebateAmount);
      acc.payableAmount = roundMoney(acc.payableAmount + row.payableAmount);
      acc.paidCashAmount = roundMoney(acc.paidCashAmount + row.paidCashAmount);
      acc.settledAmount = roundMoney(acc.settledAmount + row.settledAmount);
      acc.outstandingAmount = roundMoney(acc.outstandingAmount + row.outstandingAmount);
      return acc;
    }, {
      purchaseCount: 0,
      goodsAndCostAmount: 0,
      rebateAmount: 0,
      payableAmount: 0,
      paidCashAmount: 0,
      settledAmount: 0,
      outstandingAmount: 0
    });

    return ok(res, {
      filters: { supplierId: supplierId || null, storeId: storeIdFilter || null, fromDate: fromDate || null, toDate: toDate || null },
      totals,
      rows
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get purchase cash flow report: ${msg}`);
  }
});

router.get("/reconciliation", requirePermission("purchases:read"), async (req: StoreScopedRequest, res) => {
  try {
    const assignedStoreIds = req.assignedStoreIds || [];
    const supplierId = req.query.supplierId as string | undefined;
    const storeIdFilter = req.query.storeId as string | undefined;
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;

    if (storeIdFilter && !assignedStoreIds.includes(storeIdFilter)) {
      return forbidden(res, "No store assignment for this store");
    }

    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    const documentDateFilter: { gte?: Date; lte?: Date } = {};
    if (fromDate) {
      const parsedFrom = new Date(`${fromDate}T00:00:00`);
      if (!Number.isNaN(parsedFrom.getTime())) {
        createdAtFilter.gte = parsedFrom;
      }
      const parsedFromDocument = toDateOnly(fromDate);
      if (parsedFromDocument) {
        documentDateFilter.gte = parsedFromDocument;
      }
    }
    if (toDate) {
      const parsedTo = new Date(`${toDate}T23:59:59.999`);
      if (!Number.isNaN(parsedTo.getTime())) {
        createdAtFilter.lte = parsedTo;
      }
      const parsedToDocument = toDateOnly(toDate);
      if (parsedToDocument) {
        documentDateFilter.lte = parsedToDocument;
      }
    }

    const hasDateFilter = Object.keys(createdAtFilter).length > 0 || Object.keys(documentDateFilter).length > 0;
    const scopedStoreWhere = storeIdFilter
      ? { storeId: storeIdFilter }
      : { storeId: { in: assignedStoreIds } };

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: {
        voidedAt: null,
        ...(supplierId ? { supplierId } : {}),
        ...scopedStoreWhere,
        ...(hasDateFilter
          ? {
              OR: [
                ...(Object.keys(documentDateFilter).length ? [{ documentDate: documentDateFilter }] : []),
                ...(Object.keys(createdAtFilter).length
                  ? [{ AND: [{ documentDate: null }, { createdAt: createdAtFilter }] }]
                  : [])
              ]
            }
          : {})
      },
      include: {
        supplier: { select: { id: true, name: true } },
        store: { select: { id: true, code: true, name: true } },
        items: {
          select: {
            quantity: true,
            unitCost: true,
            lineAmount: true
          }
        },
        payments: {
          select: {
            supplierId: true,
            settledAmount: true,
            cashAmount: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const rows = purchaseOrders.map((order) => {
      const lineAmount = roundMoney(order.items.reduce((sum, item) => sum + Number(item.lineAmount || 0), 0));
      const rebateAmount = roundMoney(Number(order.rebateAmount || 0));
      const payableByFormula = Math.max(roundMoney(lineAmount - rebateAmount), 0);
      const payableStored = getEffectivePurchaseAmount(order);
      const payableDiff = roundMoney(payableByFormula - payableStored);
      const paidSettledAmount = roundMoney(order.payments
        .filter((payment) => payment.supplierId === order.supplierId)
        .reduce((sum, payment) => sum + Number(payment.settledAmount || 0), 0));
      const paidCashAmount = roundMoney(order.payments
        .filter((payment) => payment.supplierId === order.supplierId)
        .reduce((sum, payment) => sum + Number(payment.cashAmount || 0), 0));
      const outstandingAmount = Math.max(roundMoney(payableStored - paidSettledAmount), 0);

      return {
        referenceId: order.referenceId,
        documentDate: dateOnlyString(order.documentDate),
        supplierId: order.supplierId,
        supplierName: order.supplier.name,
        storeId: order.storeId,
        storeName: order.store?.name,
        lineAmount,
        rebateAmount,
        payableByFormula,
        payableStored,
        payableDiff,
        paidSettledAmount,
        paidCashAmount,
        outstandingAmount,
        status: buildStatus(payableStored, paidSettledAmount, order.voidedAt),
        createdAt: order.createdAt
      };
    });

    const totals = rows.reduce((acc, row) => {
      acc.lineAmount = roundMoney(acc.lineAmount + row.lineAmount);
      acc.rebateAmount = roundMoney(acc.rebateAmount + row.rebateAmount);
      acc.payableByFormula = roundMoney(acc.payableByFormula + row.payableByFormula);
      acc.payableStored = roundMoney(acc.payableStored + row.payableStored);
      acc.payableDiff = roundMoney(acc.payableDiff + row.payableDiff);
      acc.paidSettledAmount = roundMoney(acc.paidSettledAmount + row.paidSettledAmount);
      acc.paidCashAmount = roundMoney(acc.paidCashAmount + row.paidCashAmount);
      acc.outstandingAmount = roundMoney(acc.outstandingAmount + row.outstandingAmount);
      return acc;
    }, {
      lineAmount: 0,
      rebateAmount: 0,
      payableByFormula: 0,
      payableStored: 0,
      payableDiff: 0,
      paidSettledAmount: 0,
      paidCashAmount: 0,
      outstandingAmount: 0
    });

    return ok(res, {
      filters: { supplierId: supplierId || null, storeId: storeIdFilter || null, fromDate: fromDate || null, toDate: toDate || null },
      totals,
      rows
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get purchase reconciliation report: ${msg}`);
  }
});

router.get("/:referenceId", requirePermission("purchases:read"), async (req: StoreScopedRequest, res, next) => {
  try {
    const referenceId = req.params.referenceId;

    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { referenceId },
      include: {
        supplier: true,
        payments: {
          orderBy: { createdAt: "desc" }
        },
        rebates: {
          orderBy: { createdAt: "asc" }
        },
        items: {
          include: {
            product: {
              select: { sku: true, name: true }
            }
          }
        }
      }
    });

    if (!purchaseOrder) {
      return badRequest(res, "Purchase document not found");
    }

    const assignedStoreIds = req.assignedStoreIds || [];
    if (!purchaseOrder.storeId || !assignedStoreIds.includes(purchaseOrder.storeId)) {
      return forbidden(res, "No store assignment for this purchase document");
    }

    const amount = getEffectivePurchaseAmount(purchaseOrder);
    const grossAmount = Number(purchaseOrder.amount);
    const rebateAmount = Number(purchaseOrder.rebateAmount || 0);
    const paidAmount = purchaseOrder.payments
      .filter((payment) => payment.supplierId === purchaseOrder.supplierId)
      .reduce((sum, payment) => sum + Number(payment.settledAmount), 0);
    const debtAmount = Math.max(amount - paidAmount, 0);
    const parsedNote = parsePurchaseNote(purchaseOrder.note);

    const itemsFromTable: PurchaseMetaItem[] = purchaseOrder.items.map((line) => ({
      productId: line.productId,
      productSku: line.product?.sku,
      productName: line.product?.name || "N/A",
      quantity: line.quantity,
      unitCost: Number(line.unitCost),
      lineAmount: Number(line.lineAmount)
    }));

    const fallbackMetaItems = parsedNote.meta?.items || [];
    const rebateInventoryCostAdjustments = parsedNote.meta?.rebateInventoryCostAdjustments || [];
    const effectiveItems = itemsFromTable.length ? itemsFromTable : fallbackMetaItems;
    const itemsWithAdjustedCost = applyRebateInventoryAdjustmentToItems(
      effectiveItems,
      rebateInventoryCostAdjustments,
      Number(purchaseOrder.rebateInventoryAdjustment || 0)
    );

    const payments = purchaseOrder.payments.map((payment) => {
      const settledAmount = Number(payment.settledAmount);
      return {
        id: payment.id,
        supplierId: payment.supplierId,
        amount: settledAmount,
        cashAmount: Number(payment.cashAmount),
        settledAmount,
        note: payment.note,
        createdAt: payment.createdAt
      };
    });

    const rebates = purchaseOrder.rebates.map((rebate) => {
      const rebateValue = Number(rebate.amount);
      const isBatchRebate = Boolean(rebate.rebateBatchId);
      const isPayableOnly = Boolean(rebate.isPayableOnly)
        || (!isBatchRebate && String(rebate.note || "").includes(REBATE_BATCH_LINK_PREFIX));
      return {
        id: rebate.id,
        rebateBatchId: rebate.rebateBatchId || undefined,
        rebateBatchReferenceId: rebate.rebateBatchId || undefined,
        isPayableOnly,
        label: rebate.label,
        amount: rebateValue,
        affectsPayable: !isBatchRebate,
        payableImpactAmount: isBatchRebate ? 0 : rebateValue,
        costAllocationAmount: isPayableOnly ? 0 : rebateValue,
        note: rebate.note || undefined,
        createdAt: rebate.createdAt.toISOString(),
        purchasedQty: rebate.purchasedQty,
        soldQty: rebate.soldQty,
        soldRatio: Number(rebate.soldRatio),
        cogsAdjustmentAmount: Number(rebate.cogsAdjustmentAmount),
        inventoryAdjustmentAmount: Number(rebate.inventoryAdjustmentAmount)
      };
    });
    const totalRebateAmount = roundMoney(rebates.reduce((sum, rebate) => sum + Number(rebate.amount || 0), 0));
    const costOnlyRebateAmount = roundMoney(
      Number(purchaseOrder.rebateCogsAdjustment || 0) + Number(purchaseOrder.rebateInventoryAdjustment || 0)
    );

    return ok(res, {
      id: purchaseOrder.id,
      referenceId: purchaseOrder.referenceId,
      supplierId: purchaseOrder.supplierId,
      supplierName: purchaseOrder.supplier.name,
      storeId: purchaseOrder.storeId || parsedNote.meta?.storeId,
      storeName: parsedNote.meta?.storeName,
      documentDate: dateOnlyString(purchaseOrder.documentDate) || parsedNote.meta?.documentDate,
      amount,
      grossAmount,
      paidAmount,
      debtAmount,
      status: buildStatus(amount, paidAmount, purchaseOrder.voidedAt),
      voidedAt: purchaseOrder.voidedAt,
      voidReason: purchaseOrder.voidReason,
      note: parsedNote.note,
      createdAt: purchaseOrder.createdAt,
      rebateAmount,
      payableRebateAmount: rebateAmount,
      totalRebateAmount,
      costOnlyRebateAmount,
      rebateCogsAdjustment: Number(purchaseOrder.rebateCogsAdjustment || 0),
      rebateInventoryAdjustment: Number(purchaseOrder.rebateInventoryAdjustment || 0),
      rebatePurchasedQty: Number(purchaseOrder.rebatePurchasedQty || 0),
      rebateSoldQty: Number(purchaseOrder.rebateSoldQty || 0),
      rebates,
      items: itemsWithAdjustedCost,
      payments
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get purchase detail: ${msg}`);
  }
});

router.get("/:referenceId/movements", requirePermission("purchases:read"), async (req: StoreScopedRequest, res) => {
  try {
    const referenceId = req.params.referenceId;
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { referenceId },
      select: { id: true, storeId: true }
    });

    if (!purchaseOrder) {
      return badRequest(res, "Purchase document not found");
    }

    const assignedStoreIds = req.assignedStoreIds || [];
    if (!purchaseOrder.storeId || !assignedStoreIds.includes(purchaseOrder.storeId)) {
      return forbidden(res, "No store assignment for this purchase document");
    }

    const rows = await prisma.inventoryMovement.findMany({
      where: {
        referenceType: "PURCHASE_ORDER",
        referenceId,
        storeId: purchaseOrder.storeId
      },
      include: {
        product: {
          select: { id: true, sku: true, name: true, unit: true }
        },
        store: {
          select: { id: true, code: true, name: true }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    return ok(res, rows.map((row) => ({
      id: row.id,
      movementType: row.movementType,
      quantityDelta: row.quantityDelta,
      unitCost: Number(row.unitCost || 0),
      totalCost: Number(row.totalCost || 0),
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      note: row.note,
      createdAt: row.createdAt,
      product: row.product,
      store: row.store
    })));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get purchase movements: ${msg}`);
  }
});

router.post("/", requirePermission("purchases:create"), async (req: StoreScopedRequest, res) => {
  try {
    const parsed = createPurchaseSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid purchase payload");
    }

    const payload = parsed.data;
    const assignedStoreIds = req.assignedStoreIds || [];

    if (!payload.storeId) {
      return badRequest(res, "storeId is required");
    }
    if (!assignedStoreIds.includes(payload.storeId)) {
      return forbidden(res, "No store assignment for this store");
    }

    const supplier = await prisma.partner.findUnique({ where: { id: payload.supplierId } });
    if (!supplier || !supplier.isSupplier) {
      return badRequest(res, "Supplier not found or partner is not a supplier");
    }

    const referenceId = payload.invoiceNo?.trim() || `PO-${Date.now()}`;

    const existingPurchase = await prisma.purchaseOrder.findUnique({ where: { referenceId } });
    if (existingPurchase) {
      return badRequest(res, `Purchase reference already exists: ${referenceId}`);
    }

    const itemRows = payload.items || [];
    const hasItems = itemRows.length > 0;
    const hasManualAmount = typeof payload.amount === "number";

    if (!hasItems && !hasManualAmount) {
      return badRequest(res, "Provide amount or at least one purchase item");
    }

    const baseItemsAmount = roundMoney(
      itemRows.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)
    );

    const totalAmount = hasItems ? baseItemsAmount : Number(payload.amount || 0);
    if (totalAmount <= 0) {
      return badRequest(res, "Final purchase amount must be greater than 0");
    }

    if (payload.paidAmount > totalAmount) {
      return badRequest(res, "paidAmount cannot be greater than amount");
    }

    let resolvedStore: { id: string; name: string } | null = null;
    if (payload.storeId) {
      const store = await prisma.store.findUnique({ where: { id: payload.storeId } });
      if (!store) {
        return badRequest(res, "Store not found");
      }
      resolvedStore = { id: store.id, name: store.name };
    }

    let productsById = new Map<string, { id: string; sku: string; name: string; costPrice: number }>();
    if (hasItems) {
      const productIds = [...new Set(itemRows.map((item) => item.productId))];
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, sku: true, name: true, costPrice: true }
      });

      if (products.length !== productIds.length) {
        return badRequest(res, "One or more products not found");
      }

      productsById = new Map(
        products.map((product) => [
          product.id,
          { id: product.id, sku: product.sku, name: product.name, costPrice: Number(product.costPrice) }
        ])
      );
    }

    const itemMeta = buildPurchaseItemMeta(itemRows, productsById);

    const documentDate = toDateOnly(payload.documentDate);

    const purchaseMeta: PurchaseMeta | null = hasItems
      ? {
          storeId: resolvedStore?.id,
          storeName: resolvedStore?.name,
          documentDate: dateOnlyString(documentDate),
          rebates: [],
          rebateInventoryCostAdjustments: [],
          items: itemMeta
        }
      : null;

    const result = await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          referenceId,
          supplierId: payload.supplierId,
          storeId: resolvedStore?.id,
          invoiceNo: payload.invoiceNo?.trim() || null,
          documentDate: documentDate || null,
          amount: totalAmount,
          paidAmount: payload.paidAmount,
          rebateAmount: 0,
          rebateCogsAdjustment: 0,
          rebateInventoryAdjustment: 0,
          rebatePurchasedQty: 0,
          rebateSoldQty: 0,
          note: (payload.note || "").trim() || "Ghi nhan mua hang"
        }
      });

      if (hasItems && itemMeta.length) {
        await tx.purchaseOrderItem.createMany({
          data: itemMeta.map((line) => ({
            purchaseOrderId: purchaseOrder.id,
            productId: line.productId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            lineAmount: line.lineAmount
          }))
        });
      }

      await tx.partnerTransactionLog.create({
        data: {
          partnerId: payload.supplierId,
          transactionType: "PURCHASE_ORDER",
          referenceId,
          amount: totalAmount,
          note: composePurchaseNote(payload.note, purchaseMeta)
        }
      });

      if (hasItems && resolvedStore) {
        for (const line of itemMeta) {
          const product = productsById.get(line.productId);
          if (!product) {
            throw new Error(`Product ${line.productId} not found`);
          }

          const inventory = await tx.inventory.findUnique({
            where: {
              productId_storeId: {
                productId: line.productId,
                storeId: resolvedStore.id
              }
            }
          });

          const oldQty = inventory?.quantity || 0;
          const oldCost = Number(product.costPrice || 0);
          const newQty = oldQty + line.quantity;
          const newCost = newQty > 0
            ? roundMoney(((oldQty * oldCost) + (line.quantity * line.unitCost)) / newQty)
            : roundMoney(line.unitCost);

          if (inventory) {
            await tx.inventory.update({
              where: { id: inventory.id },
              data: { quantity: { increment: line.quantity } }
            });
          } else {
            await tx.inventory.create({
              data: {
                productId: line.productId,
                storeId: resolvedStore.id,
                quantity: line.quantity,
                reservedQuantity: 0
              }
            });
          }

          await tx.product.update({
            where: { id: line.productId },
            data: { costPrice: newCost }
          });

          await tx.inventoryMovement.create({
            data: {
              productId: line.productId,
              storeId: resolvedStore.id,
              movementType: "PURCHASE_RECEIPT",
              quantityDelta: line.quantity,
              unitCost: line.unitCost,
              totalCost: line.lineAmount,
              referenceType: "PURCHASE_ORDER",
              referenceId,
              note: `Nhap kho tu don mua ${referenceId}`
            }
          });
        }
      }

      if (payload.paidAmount > 0) {
        await tx.purchasePayment.create({
          data: {
            purchaseOrderId: purchaseOrder.id,
            supplierId: payload.supplierId,
            cashAmount: payload.paidAmount,
            settledAmount: payload.paidAmount,
            note: "Thanh toan nha cung cap"
          }
        });

        await tx.partnerTransactionLog.create({
          data: {
            partnerId: payload.supplierId,
            transactionType: "PAYMENT_TO_SUPPLIER",
            referenceId,
            amount: payload.paidAmount,
            note: "Thanh toan nha cung cap"
          }
        });
      }

      const debtIncrease = totalAmount - payload.paidAmount;
      if (debtIncrease !== 0) {
        await tx.partner.update({
          where: { id: payload.supplierId },
          data: {
            netBalance: { increment: debtIncrease }
          }
        });
      }

      return purchaseOrder;
    });

    const paidAmount = payload.paidAmount;
    const status = buildStatus(totalAmount, paidAmount);

    return created(
      res,
      {
        id: result.id,
        referenceId,
        supplierId: payload.supplierId,
        supplierName: supplier.name,
        storeId: resolvedStore?.id,
        storeName: resolvedStore?.name,
        documentDate: dateOnlyString(documentDate),
        amount: totalAmount,
        paidAmount,
        debtAmount: Math.max(totalAmount - paidAmount, 0),
        status,
        note: payload.note,
        items: itemMeta,
        createdAt: result.createdAt
      },
      "Purchase created"
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to create purchase: ${msg}`);
  }
});

router.post("/:referenceId/pay", requirePermission("purchases:pay"), async (req: StoreScopedRequest, res) => {
  try {
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid payment payload");
    }

    const payload = parsed.data;
    const referenceId = req.params.referenceId;
    const assignedStoreIds = req.assignedStoreIds || [];

    const scopedPurchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { referenceId },
      select: { storeId: true }
    });
    if (!scopedPurchaseOrder) {
      return badRequest(res, "Purchase document not found");
    }
    if (!scopedPurchaseOrder.storeId || !assignedStoreIds.includes(scopedPurchaseOrder.storeId)) {
      return forbidden(res, "No store assignment for this purchase document");
    }

    const paymentResult = await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { referenceId } });
      if (!purchaseOrder || purchaseOrder.supplierId !== payload.supplierId) {
        throw new Error("Purchase document not found");
      }
      if (purchaseOrder.voidedAt) {
        throw new Error("Cannot record payment for voided purchase document");
      }

      const totalAmount = getEffectivePurchaseAmount(purchaseOrder);
      const paidSummary = await tx.purchasePayment.aggregate({
        where: {
          purchaseOrderId: purchaseOrder.id,
          supplierId: payload.supplierId
        },
        _sum: { settledAmount: true }
      });
      const paidAmount = Number(paidSummary._sum.settledAmount || 0);
      const remaining = Math.max(totalAmount - paidAmount, 0);
      const paymentAmount = roundMoney(payload.amount);
      const settledAmount = paymentAmount;

      if (settledAmount > remaining) {
        throw new Error("Payment amount exceeds remaining debt");
      }

      const paymentMeta: PaymentMeta = {
        cashAmount: paymentAmount,
        settledAmount
      };

      await tx.purchasePayment.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          supplierId: payload.supplierId,
          cashAmount: paymentAmount,
          settledAmount,
          note: payload.note?.trim() || null
        }
      });

      await tx.partnerTransactionLog.create({
        data: {
          partnerId: payload.supplierId,
          transactionType: "PAYMENT_TO_SUPPLIER",
          referenceId,
          amount: settledAmount,
          note: composePaymentNote(payload.note, paymentMeta)
        }
      });

      await tx.purchaseOrder.update({
        where: { referenceId },
        data: {
          paidAmount: roundMoney(paidAmount + settledAmount)
        }
      });

      await tx.partner.update({
        where: { id: payload.supplierId },
        data: { netBalance: { decrement: settledAmount } }
      });

      return {
        paidCash: paymentAmount,
        settledAmount,
        remaining: Math.max(remaining - settledAmount, 0)
      };
    });

    return ok(res, {
      referenceId,
      paidCash: paymentResult.paidCash,
      settledAmount: paymentResult.settledAmount,
      remaining: paymentResult.remaining
    }, "Payment recorded");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to record supplier payment: ${msg}`);
  }
});

router.patch("/:referenceId/payments/:paymentId", requirePermission("purchases:pay"), async (req: StoreScopedRequest, res) => {
  try {
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid payment payload");
    }

    const payload = parsed.data;
    const referenceId = req.params.referenceId;
    const paymentId = req.params.paymentId;
    const assignedStoreIds = req.assignedStoreIds || [];

    const scopedPurchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { referenceId },
      select: { storeId: true }
    });
    if (!scopedPurchaseOrder) {
      return badRequest(res, "Purchase document not found");
    }
    if (!scopedPurchaseOrder.storeId || !assignedStoreIds.includes(scopedPurchaseOrder.storeId)) {
      return forbidden(res, "No store assignment for this purchase document");
    }

    const result = await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { referenceId } });
      if (!purchaseOrder || purchaseOrder.supplierId !== payload.supplierId) {
        throw new Error("Purchase document not found");
      }
      if (purchaseOrder.voidedAt) {
        throw new Error("Cannot edit payment of voided purchase document");
      }

      const paymentLog = await tx.purchasePayment.findFirst({
        where: {
          id: paymentId,
          purchaseOrderId: purchaseOrder.id,
          supplierId: payload.supplierId
        }
      });

      if (!paymentLog) {
        throw new Error("Payment document not found");
      }

      const totalPaidSummary = await tx.purchasePayment.aggregate({
        where: {
          purchaseOrderId: purchaseOrder.id,
          supplierId: payload.supplierId
        },
        _sum: { settledAmount: true }
      });

      const totalPaid = Number(totalPaidSummary._sum.settledAmount || 0);
      const previousSettledAmount = roundMoney(Number(paymentLog.settledAmount || 0));
      const nextSettledAmount = roundMoney(payload.amount);
      const totalAmount = getEffectivePurchaseAmount(purchaseOrder);
      const nextPaidAmount = roundMoney(Math.max(totalPaid - previousSettledAmount + nextSettledAmount, 0));
      if (nextPaidAmount > totalAmount) {
        throw new Error("Payment amount exceeds remaining debt");
      }

      await tx.purchasePayment.update({
        where: { id: paymentLog.id },
        data: {
          cashAmount: nextSettledAmount,
          settledAmount: nextSettledAmount,
          note: payload.note?.trim() || null
        }
      });

      await tx.partnerTransactionLog.updateMany({
        where: {
          transactionType: "PAYMENT_TO_SUPPLIER",
          referenceId,
          partnerId: payload.supplierId,
          amount: previousSettledAmount
        },
        data: {
          amount: nextSettledAmount,
          note: composePaymentNote(payload.note, {
            id: paymentLog.id,
            cashAmount: nextSettledAmount,
            settledAmount: nextSettledAmount
          })
        }
      });

      await tx.purchaseOrder.update({
        where: { referenceId },
        data: {
          paidAmount: nextPaidAmount
        }
      });

      const paymentDelta = roundMoney(nextSettledAmount - previousSettledAmount);
      if (paymentDelta > 0) {
        await tx.partner.update({
          where: { id: payload.supplierId },
          data: { netBalance: { decrement: paymentDelta } }
        });
      } else if (paymentDelta < 0) {
        await tx.partner.update({
          where: { id: payload.supplierId },
          data: { netBalance: { increment: Math.abs(paymentDelta) } }
        });
      }

      return {
        paidCash: nextSettledAmount,
        settledAmount: nextSettledAmount,
        remaining: Math.max(totalAmount - nextPaidAmount, 0)
      };
    });

    return ok(res, {
      referenceId,
      paymentId,
      paidCash: result.paidCash,
      settledAmount: result.settledAmount,
      remaining: result.remaining
    }, "Payment updated");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update supplier payment: ${msg}`);
  }
});

router.delete("/:referenceId/payments/:paymentId", requirePermission("purchases:pay"), async (req: StoreScopedRequest, res) => {
  try {
    const parsed = deletePaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid payment delete payload");
    }

    const payload = parsed.data;
    const referenceId = req.params.referenceId;
    const paymentId = req.params.paymentId;
    const assignedStoreIds = req.assignedStoreIds || [];

    const scopedPurchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { referenceId },
      select: { storeId: true }
    });
    if (!scopedPurchaseOrder) {
      return badRequest(res, "Purchase document not found");
    }
    if (!scopedPurchaseOrder.storeId || !assignedStoreIds.includes(scopedPurchaseOrder.storeId)) {
      return forbidden(res, "No store assignment for this purchase document");
    }

    const result = await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { referenceId } });
      if (!purchaseOrder || purchaseOrder.supplierId !== payload.supplierId) {
        throw new Error("Purchase document not found");
      }
      if (purchaseOrder.voidedAt) {
        throw new Error("Cannot delete payment of voided purchase document");
      }

      const paymentLog = await tx.purchasePayment.findFirst({
        where: {
          id: paymentId,
          purchaseOrderId: purchaseOrder.id,
          supplierId: payload.supplierId
        }
      });
      if (!paymentLog) {
        throw new Error("Payment document not found");
      }

      const settledAmount = roundMoney(Number(paymentLog.settledAmount || 0));
      const totalAmount = getEffectivePurchaseAmount(purchaseOrder);
      const nextPaidAmount = roundMoney(Math.max(Number(purchaseOrder.paidAmount || 0) - settledAmount, 0));

      await tx.purchasePayment.delete({ where: { id: paymentLog.id } });
      await tx.partnerTransactionLog.deleteMany({
        where: {
          transactionType: "PAYMENT_TO_SUPPLIER",
          referenceId,
          partnerId: payload.supplierId,
          amount: settledAmount
        }
      });
      await tx.purchaseOrder.update({
        where: { referenceId },
        data: { paidAmount: nextPaidAmount }
      });
      await tx.partner.update({
        where: { id: payload.supplierId },
        data: { netBalance: { increment: settledAmount } }
      });

      return {
        settledAmount,
        remaining: Math.max(totalAmount - nextPaidAmount, 0)
      };
    });

    return ok(res, {
      referenceId,
      paymentId,
      settledAmount: result.settledAmount,
      remaining: result.remaining
    }, "Payment deleted");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to delete supplier payment: ${msg}`);
  }
});

router.post("/:referenceId/void", requirePermission("purchases:void"), async (req: StoreScopedRequest, res) => {
  try {
    const parsed = voidPurchaseSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.errors[0]?.message || "Invalid void payload");
    }

    const { supplierId, reason } = parsed.data;
    const referenceId = req.params.referenceId;
    const actorUserId = (req as any).user?.id as string | undefined;

    // ── Kiểm tra điều kiện trước khi hủy ──────────────────────────────
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { referenceId },
      include: { items: true }
    });

    if (!purchaseOrder) {
      return badRequest(res, "Không tìm thấy chứng từ mua hàng");
    }
    const assignedStoreIds = req.assignedStoreIds || [];
    if (!purchaseOrder.storeId || !assignedStoreIds.includes(purchaseOrder.storeId)) {
      return forbidden(res, "No store assignment for this purchase document");
    }
    if (purchaseOrder.supplierId !== supplierId) {
      return badRequest(res, "Nhà cung cấp không khớp với chứng từ");
    }
    if (purchaseOrder.voidedAt !== null) {
      return badRequest(res, "Chứng từ này đã bị hủy trước đó");
    }

    // Kiểm tra thanh toán thực tế từ log (chính xác hơn paidAmount trên PO)
    const paymentLogs = await prisma.partnerTransactionLog.findMany({
      where: { referenceId, transactionType: "PAYMENT_TO_SUPPLIER" }
    });
    const totalPaid = paymentLogs.reduce((s, p) => s + Number(p.amount), 0);

    const totalAmount = getEffectivePurchaseAmount(purchaseOrder);
    const hasItems = purchaseOrder.items.length > 0;
    const parsedNote = parsePurchaseNote(purchaseOrder.note);

    // Kiểm tra tồn kho âm (nếu có dòng hàng chi tiết)
    if (hasItems && purchaseOrder.storeId) {
      const storeId = purchaseOrder.storeId;
      for (const item of purchaseOrder.items) {
        const inv = await prisma.inventory.findUnique({
          where: { productId_storeId: { productId: item.productId, storeId } }
        });
        const currentQty = inv?.quantity ?? 0;
        if (currentQty < item.quantity) {
          const product = await prisma.product.findUnique({
            where: { id: item.productId },
            select: { name: true }
          });
          return badRequest(
            res,
            `Không thể hủy: sản phẩm "${product?.name || item.productId}" chỉ còn ` +
            `${currentQty} đơn vị trong kho (chứng từ ghi ${item.quantity}). ` +
            "Hàng hóa có thể đã được bán ra. Hãy điều chỉnh tồn kho trước khi hủy."
          );
        }
      }
    }

    // ── Thực thi hủy trong một transaction ────────────────────────────
    await prisma.$transaction(async (tx) => {
      await rollbackPurchaseRebateInventoryAdjustments(tx, parsedNote.meta?.rebateInventoryCostAdjustments || []);

      // 1. Đánh dấu chứng từ là đã hủy
      await tx.purchaseOrder.update({
        where: { referenceId },
        data: {
          voidedAt: new Date(),
          voidReason: reason,
          voidedByUserId: actorUserId || null
        }
      });

      if (hasItems && purchaseOrder.storeId) {
        const storeId = purchaseOrder.storeId;
        const affectedProductIds = [...new Set(purchaseOrder.items.map((i) => i.productId))];

        // 2. Đảo ngược tồn kho kho
        for (const item of purchaseOrder.items) {
          await tx.inventory.update({
            where: { productId_storeId: { productId: item.productId, storeId } },
            data: { quantity: { decrement: item.quantity } }
          });

          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              storeId,
              movementType: "PURCHASE_VOID",
              quantityDelta: -item.quantity,
              unitCost: item.unitCost,
              totalCost: Number(item.unitCost) * item.quantity,
              referenceType: "PURCHASE_ORDER",
              referenceId,
              note: `Xuat giam kho do huy don mua ${referenceId}`
            }
          });
        }

        // 3. Tính lại giá vốn bình quân di động từ đầu cho từng sản phẩm bị ảnh hưởng
        for (const productId of affectedProductIds) {
          const recomputedCost = await recomputeMovingAvgCost(tx, productId);
          await tx.product.update({
            where: { id: productId },
            data: { costPrice: recomputedCost }
          });
        }
      }

      // 4. Tạo bút toán đảo ngược trong nhật ký giao dịch đối tác
      await tx.partnerTransactionLog.create({
        data: {
          partnerId: supplierId,
          transactionType: "PURCHASE_VOID",
          referenceId: `VOID-${referenceId}`,
          amount: totalAmount,
          note: `Hủy chứng từ ${referenceId}: ${reason}${totalPaid > 0 ? ` [Đã thanh toán ${totalPaid.toLocaleString("vi-VN")} ₫ — cần xử lý hoàn tiền với NCC]` : ""}`
        }
      });

      // 5. Đảo ngược công nợ còn lại với nhà cung cấp
      // Net hiệu ứng trên netBalance = totalAmount - totalPaid (phần nợ chưa trả)
      const netDebtToReverse = roundMoney(Math.max(totalAmount - totalPaid, 0));
      if (netDebtToReverse > 0) {
        await tx.partner.update({
          where: { id: supplierId },
          data: { netBalance: { decrement: netDebtToReverse } }
        });
      }

      await tx.partnerTransactionLog.deleteMany({
        where: {
          partnerId: supplierId,
          transactionType: "SUPPLIER_REBATE",
          referenceId
        }
      });
    });

    return ok(res, { referenceId, voided: true }, "Chứng từ mua hàng đã được hủy thành công");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to void purchase: ${msg}`);
  }
});

router.post("/rebate-batches", requirePermission("purchases:create"), async (req: StoreScopedRequest, res) => {
  return badRequest(res, "Luồng rebate tổng đã ngừng sử dụng. Vui lòng dùng ghi nhận chiết khấu theo chứng từ mua hàng (1 chứng từ chiết khấu).\n");
});

router.post("/:referenceId/rebates", requirePermission("purchases:create"), async (req: StoreScopedRequest, res) => {
  try {
    const parsed = purchaseRebateSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.errors[0]?.message || "Invalid purchase rebate payload");
    }

    const payload = parsed.data;
    const referenceId = req.params.referenceId;
    const assignedStoreIds = req.assignedStoreIds || [];

    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { referenceId },
      include: { items: true }
    });

    if (!purchaseOrder || purchaseOrder.supplierId !== payload.supplierId) {
      return badRequest(res, "Không tìm thấy chứng từ mua hàng");
    }
    if (!purchaseOrder.storeId || !assignedStoreIds.includes(purchaseOrder.storeId)) {
      return forbidden(res, "No store assignment for this purchase document");
    }
    if (purchaseOrder.voidedAt) {
      return badRequest(res, "Không thể ghi nhận chiết khấu cho chứng từ đã hủy");
    }
    if (!purchaseOrder.items.length) {
      return badRequest(res, "Chỉ có thể ghi nhận chiết khấu cho chứng từ có dòng hàng chi tiết");
    }

    const targetReferenceIds = Array.from(new Set(
      (payload.referenceIds || [referenceId])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ));
    if (!targetReferenceIds.includes(referenceId)) {
      targetReferenceIds.unshift(referenceId);
    }

    const result = await prisma.$transaction(async (tx) => {
      const targetOrders = await tx.purchaseOrder.findMany({
        where: {
          referenceId: { in: targetReferenceIds },
          supplierId: payload.supplierId
        },
        include: { items: true }
      });
      if (targetOrders.length !== targetReferenceIds.length) {
        throw new Error("Một hoặc nhiều chứng từ áp dụng không tồn tại hoặc không thuộc nhà cung cấp đã chọn");
      }

      const targetOrderByReference = targetOrders.reduce((acc, order) => {
        acc.set(order.referenceId, order);
        return acc;
      }, new Map<string, (typeof targetOrders)[number]>());

      for (const targetReferenceId of targetReferenceIds) {
        const order = targetOrderByReference.get(targetReferenceId);
        if (!order) {
          throw new Error(`Không tìm thấy chứng từ ${targetReferenceId}`);
        }
        if (!order.storeId || !assignedStoreIds.includes(order.storeId)) {
          throw new Error(`Không có quyền thao tác với chứng từ ${targetReferenceId}`);
        }
        if (order.voidedAt) {
          throw new Error(`Không thể áp dụng chiết khấu vào chứng từ đã hủy: ${targetReferenceId}`);
        }
        if (!order.items.length) {
          throw new Error(`Chứng từ ${targetReferenceId} không có dòng hàng để áp dụng chiết khấu`);
        }
      }

      const parsedNote = parsePurchaseNote(purchaseOrder.note);
      const currentRebates = await listPurchaseRebates(tx, purchaseOrder.id, []);
      const nextRebates: PurchaseRebateMeta[] = [
        ...currentRebates,
        {
          isPayableOnly: true,
          label: payload.label.trim(),
          amount: roundMoney(payload.amount),
          note: payload.note?.trim() || undefined,
          createdAt: new Date().toISOString(),
          purchasedQty: 0,
          soldQty: 0,
          soldRatio: 0,
          cogsAdjustmentAmount: 0,
          inventoryAdjustmentAmount: 0
        }
      ];

      const nextEffectiveAmount = getEffectivePurchaseAmountFromRebates(Number(purchaseOrder.amount), nextRebates);
      const totalPaid = Number(purchaseOrder.paidAmount || 0);
      if (nextEffectiveAmount < totalPaid) {
        throw new Error("Chiết khấu vượt quá phần còn lại của chứng từ đã thanh toán");
      }

      await syncPurchaseRebateState(tx, purchaseOrder, parsedNote.note, nextRebates);

      const persistedRows = await tx.purchaseRebate.findMany({
        where: { purchaseOrderId: purchaseOrder.id },
        orderBy: { createdAt: "asc" }
      });
      const createdDocument = persistedRows[persistedRows.length - 1];
      if (!createdDocument) {
        throw new Error("Không thể tạo chứng từ chiết khấu");
      }

      const orderedTargets = targetReferenceIds.map((id) => targetOrderByReference.get(id)!);
      const allocatedAmounts = allocateAmountByWeight(orderedTargets, roundMoney(payload.amount), (order) => Number(order.amount || 0));
      await tx.purchaseRebateApplication.createMany({
        data: orderedTargets.map((order, index) => ({
          purchaseRebateId: createdDocument.id,
          purchaseOrderId: order.id,
          allocatedAmount: roundMoney(allocatedAmounts[index] || 0)
        }))
      });

      let totalCogsAdjustmentAmount = 0;
      let totalInventoryAdjustmentAmount = 0;
      for (const order of orderedTargets) {
        const recomputed = await recomputePurchaseRebateStateWithApplications(tx, order.id);
        totalCogsAdjustmentAmount = roundMoney(totalCogsAdjustmentAmount + Number(recomputed.cogsAdjustmentAmount || 0));
        totalInventoryAdjustmentAmount = roundMoney(totalInventoryAdjustmentAmount + Number(recomputed.inventoryAdjustmentAmount || 0));
      }

      const refreshedAnchor = await tx.purchaseOrder.findUnique({
        where: { id: purchaseOrder.id },
        select: {
          amount: true,
          rebateAmount: true,
          paidAmount: true
        }
      });
      const amount = refreshedAnchor
        ? getEffectivePurchaseAmount({ amount: refreshedAnchor.amount, rebateAmount: refreshedAnchor.rebateAmount })
        : nextEffectiveAmount;
      const paidAmount = Number(refreshedAnchor?.paidAmount || totalPaid);

      return {
        referenceId,
        targetCount: orderedTargets.length,
        totalAmount: roundMoney(payload.amount),
        cogsAdjustmentAmount: totalCogsAdjustmentAmount,
        inventoryAdjustmentAmount: totalInventoryAdjustmentAmount,
        amount,
        debtAmount: Math.max(roundMoney(amount - paidAmount), 0)
      };
    });

    return ok(res, result, "Đã ghi nhận chứng từ chiết khấu");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to create purchase rebate: ${msg}`);
  }
});

router.patch("/:referenceId/rebates/:rebateIndex", requirePermission("purchases:create"), async (req: StoreScopedRequest, res) => {
  try {
    const parsed = purchaseRebateSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.errors[0]?.message || "Invalid purchase rebate payload");
    }

    const payload = parsed.data;
    const referenceId = req.params.referenceId;
    const rebateIndex = Number(req.params.rebateIndex);
    if (!Number.isInteger(rebateIndex) || rebateIndex < 0) {
      return badRequest(res, "Rebate index is invalid");
    }

    const assignedStoreIds = req.assignedStoreIds || [];
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { referenceId },
      include: { items: true }
    });

    if (!purchaseOrder || purchaseOrder.supplierId !== payload.supplierId) {
      return badRequest(res, "Không tìm thấy chứng từ mua hàng");
    }
    if (!purchaseOrder.storeId || !assignedStoreIds.includes(purchaseOrder.storeId)) {
      return forbidden(res, "No store assignment for this purchase document");
    }
    if (purchaseOrder.voidedAt) {
      return badRequest(res, "Không thể sửa chiết khấu cho chứng từ đã hủy");
    }

    const parsedNote = parsePurchaseNote(purchaseOrder.note);
    const currentRebates = await listPurchaseRebates(prisma, purchaseOrder.id, []);
    if (rebateIndex >= currentRebates.length) {
      return badRequest(res, "Không tìm thấy khoản chiết khấu cần sửa");
    }
    const targetRebate = currentRebates[rebateIndex];
    if (targetRebate?.id) {
      const applicationCount = await prisma.purchaseRebateApplication.count({
        where: { purchaseRebateId: targetRebate.id }
      });
      if (applicationCount > 0) {
        return badRequest(res, "Khoản chiết khấu này đang áp dụng cho nhiều PO. Hãy xóa và tạo lại để đảm bảo rollback chính xác.");
      }
    }
    if (currentRebates[rebateIndex]?.rebateBatchId) {
      return badRequest(res, "Khoản chiết khấu này thuộc chứng từ rebate tổng. Hãy chỉnh sửa hoặc xóa chứng từ tổng.");
    }
    if (isPayableOnlyRebateMeta(currentRebates[rebateIndex])) {
      return badRequest(res, "Khoản chiết khấu này đang liên kết với rebate tổng để giảm công nợ. Hãy xóa và tạo lại từ popup ghi nhận chiết khấu.");
    }

    const nextRebates = currentRebates.map((rebate, index) => (
      index === rebateIndex
        ? {
            ...rebate,
            label: payload.label.trim(),
            amount: roundMoney(payload.amount),
            note: payload.note?.trim() || undefined
          }
        : rebate
    ));
    const nextEffectiveAmount = getEffectivePurchaseAmountFromRebates(Number(purchaseOrder.amount), nextRebates);
    const totalPaid = Number(purchaseOrder.paidAmount || 0);
    if (nextEffectiveAmount < totalPaid) {
      return badRequest(res, "Chiết khấu vượt quá phần còn lại của chứng từ đã thanh toán");
    }

    const result = await prisma.$transaction(async (tx) => {
      const syncResult = await syncPurchaseRebateState(tx, purchaseOrder, parsedNote.note, nextRebates);
      return syncResult;
    });

    return ok(res, {
      referenceId,
      rebateIndex,
      ...result,
      amount: nextEffectiveAmount,
      debtAmount: Math.max(nextEffectiveAmount - totalPaid, 0)
    }, "Đã cập nhật chiết khấu thương mại của đơn mua hàng");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update purchase rebate: ${msg}`);
  }
});

router.delete("/:referenceId/rebates/:rebateIndex", requirePermission("purchases:create"), async (req: StoreScopedRequest, res) => {
  try {
    const parsed = deletePurchaseRebateSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid purchase rebate delete payload");
    }

    const payload = parsed.data;
    const referenceId = req.params.referenceId;
    const rebateIndex = Number(req.params.rebateIndex);
    if (!Number.isInteger(rebateIndex) || rebateIndex < 0) {
      return badRequest(res, "Rebate index is invalid");
    }

    const assignedStoreIds = req.assignedStoreIds || [];
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { referenceId },
      include: { items: true }
    });

    if (!purchaseOrder || purchaseOrder.supplierId !== payload.supplierId) {
      return badRequest(res, "Không tìm thấy chứng từ mua hàng");
    }
    if (!purchaseOrder.storeId || !assignedStoreIds.includes(purchaseOrder.storeId)) {
      return forbidden(res, "No store assignment for this purchase document");
    }
    if (purchaseOrder.voidedAt) {
      return badRequest(res, "Không thể xóa chiết khấu cho chứng từ đã hủy");
    }

    const parsedNote = parsePurchaseNote(purchaseOrder.note);
    const currentRebates = await listPurchaseRebates(prisma, purchaseOrder.id, []);
    if (rebateIndex >= currentRebates.length) {
      return badRequest(res, "Không tìm thấy khoản chiết khấu cần xóa");
    }
    const targetRebate = currentRebates[rebateIndex];
    if (targetRebate?.id) {
      const applicationRows = await prisma.purchaseRebateApplication.findMany({
        where: { purchaseRebateId: targetRebate.id },
        select: { purchaseOrderId: true }
      });
      if (applicationRows.length > 0) {
        const rollbackResult = await prisma.$transaction(async (tx) => {
          await tx.purchaseRebateApplication.deleteMany({ where: { purchaseRebateId: targetRebate.id } });
          await tx.purchaseRebate.delete({ where: { id: targetRebate.id } });

          const affectedOrderIds = Array.from(new Set([
            purchaseOrder.id,
            ...applicationRows.map((row) => row.purchaseOrderId)
          ]));

          for (const orderId of affectedOrderIds) {
            await recomputePurchaseRebateStateWithApplications(tx, orderId);
          }

          const refreshedAnchor = await tx.purchaseOrder.findUnique({
            where: { id: purchaseOrder.id },
            select: {
              amount: true,
              rebateAmount: true,
              paidAmount: true
            }
          });

          const amount = refreshedAnchor
            ? getEffectivePurchaseAmount({ amount: refreshedAnchor.amount, rebateAmount: refreshedAnchor.rebateAmount })
            : getEffectivePurchaseAmount({ amount: purchaseOrder.amount, rebateAmount: 0 });
          const paidAmount = Number(refreshedAnchor?.paidAmount || 0);

          return {
            referenceId,
            rebateIndex,
            amount,
            debtAmount: Math.max(roundMoney(amount - paidAmount), 0),
            affectedReferences: affectedOrderIds.length
          };
        });

        return ok(res, rollbackResult, "Đã xóa chứng từ chiết khấu và rollback giá vốn/tồn kho");
      }
    }
    if (currentRebates[rebateIndex]?.rebateBatchId) {
      return badRequest(res, "Khoản chiết khấu này thuộc chứng từ rebate tổng. Hãy xóa chứng từ tổng để rollback tất cả PO liên quan.");
    }

    const nextRebates = currentRebates.filter((_, index) => index !== rebateIndex);
    const nextEffectiveAmount = getEffectivePurchaseAmountFromRebates(Number(purchaseOrder.amount), nextRebates);
    const totalPaid = Number(purchaseOrder.paidAmount || 0);
    if (nextEffectiveAmount < totalPaid) {
      return badRequest(res, "Không thể xóa chiết khấu vì chứng từ đã thanh toán vượt mức cho phép");
    }

    const result = await prisma.$transaction(async (tx) => {
      const syncResult = await syncPurchaseRebateState(tx, purchaseOrder, parsedNote.note, nextRebates);
      return syncResult;
    });

    return ok(res, {
      referenceId,
      rebateIndex,
      ...result,
      amount: nextEffectiveAmount,
      debtAmount: Math.max(nextEffectiveAmount - totalPaid, 0)
    }, "Đã xóa chiết khấu thương mại khỏi đơn mua hàng");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to delete purchase rebate: ${msg}`);
  }
});

router.delete("/rebate-batches/:batchReferenceId", requirePermission("purchases:create"), async (req: StoreScopedRequest, res) => {
  try {
    const parsed = deletePurchaseRebateBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid purchase rebate batch delete payload");
    }

    const payload = parsed.data;
    const batchReferenceId = req.params.batchReferenceId;
    const assignedStoreIds = req.assignedStoreIds || [];

    const result = await prisma.$transaction(async (tx) => {
      const batchRebates = await tx.purchaseRebate.findMany({
        where: {
          rebateBatchId: batchReferenceId,
          supplierId: payload.supplierId
        },
        include: {
          purchaseOrder: {
            include: { items: true }
          }
        },
        orderBy: { createdAt: "asc" }
      });

      if (!batchRebates.length) {
        return {
          referenceId: batchReferenceId,
          supplierId: payload.supplierId,
          affectedReferences: [] as string[]
        };
      }

      const affectedReferences: string[] = [];
      for (const batchRebate of batchRebates) {
        const purchaseOrder = batchRebate.purchaseOrder;
        if (!purchaseOrder.storeId || !assignedStoreIds.includes(purchaseOrder.storeId)) {
          throw new Error(`Không có quyền thao tác với chứng từ ${purchaseOrder.referenceId}`);
        }
        if (purchaseOrder.voidedAt) {
          throw new Error(`Không thể rollback rebate tổng vì chứng từ ${purchaseOrder.referenceId} đã bị hủy`);
        }

        const parsedNote = parsePurchaseNote(purchaseOrder.note);
        const currentRebates = await listPurchaseRebates(tx, purchaseOrder.id, []);
        const nextRebates = currentRebates.filter((rebate) => rebate.rebateBatchId !== batchReferenceId);
        await syncPurchaseRebateState(tx, purchaseOrder, parsedNote.note, nextRebates);
        affectedReferences.push(purchaseOrder.referenceId);
      }

      return {
        referenceId: batchReferenceId,
        supplierId: payload.supplierId,
        affectedReferences
      };
    });

    return ok(res, result, "Đã xóa chứng từ rebate tổng và rollback toàn bộ chứng từ liên quan");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to delete purchase rebate batch: ${msg}`);
  }
});

export default router;

