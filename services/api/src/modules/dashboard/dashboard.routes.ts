import { Router } from "express";
import { prisma } from "../../prisma.js";
import { ok, badRequest } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";

const router = Router();
const recognizedStatuses = new Set(["DELIVERED", "COMPLETED", "RETURNED"]);
const PAYMENT_META_MARKER = "##PURCHASE_PAYMENT_META##";

type PaymentMeta = {
  cashAmount: number;
  settledAmount: number;
};

function isRecognizedStatus(status: string) {
  return recognizedStatuses.has(status);
}

function parsePaymentNote(rawNote: string | null | undefined): PaymentMeta | null {
  const safe = rawNote || "";
  const markerIndex = safe.indexOf(PAYMENT_META_MARKER);
  if (markerIndex < 0) return null;

  const encodedMeta = safe.slice(markerIndex + PAYMENT_META_MARKER.length).trim();
  if (!encodedMeta) return null;

  try {
    return JSON.parse(encodedMeta) as PaymentMeta;
  } catch {
    return null;
  }
}

function isRefundPayoutNote(rawNote: string | null | undefined) {
  const note = String(rawNote || "");
  return note.includes("settlement=PAYOUT") || note.includes("[Thanh toán: Trả lại tiền]");
}

function toPeriodKey(date: Date, period: string) {
  if (period === "day") {
    return date.toISOString().split("T")[0];
  }

  if (period === "week") {
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return weekStart.toISOString().split("T")[0];
  }

  if (period === "month") {
    return date.toISOString().slice(0, 7);
  }

  if (period === "quarter") {
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    return `${date.getFullYear()}-Q${quarter}`;
  }

  return String(date.getFullYear());
}

function toCashFlowBreakdown(cashIn: number, cashOutSupplier: number, cashOutRefund: number) {
  const operatingCashOut = cashOutSupplier + cashOutRefund;
  const operatingNet = cashIn - operatingCashOut;

  return {
    operating: {
      cashIn,
      cashOut: operatingCashOut,
      netCashFlow: operatingNet
    },
    investing: {
      cashIn: 0,
      cashOut: 0,
      netCashFlow: 0
    },
    financing: {
      cashIn: 0,
      cashOut: 0,
      netCashFlow: 0
    },
    total: {
      cashIn,
      cashOut: operatingCashOut,
      netCashFlow: operatingNet
    }
  };
}

function matchesOverviewTracking(isTrackedInOverview: boolean | null | undefined, overviewTracking: string) {
  const tracked = Boolean(isTrackedInOverview);
  if (overviewTracking === "tracked") return tracked;
  if (overviewTracking === "untracked") return !tracked;
  return true;
}

router.get("/overview", requirePermission("dashboard:read"), async (req, res) => {
  try {
    const timePeriod = (req.query.timePeriod as string) || "year"; // year, this-year, last-year, this-month, this-quarter
    const productType = (req.query.productType as string) || "all"; // goods, service, all
    const overviewTracking = (req.query.overviewTracking as string) || "all"; // all, tracked, untracked
    const categoryId = typeof req.query.categoryId === "string" && req.query.categoryId.trim()
      ? req.query.categoryId.trim()
      : undefined;
    const storeId = typeof req.query.storeId === "string" && req.query.storeId.trim()
      ? req.query.storeId.trim()
      : undefined;

    // Tính toán date range từ timePeriod
    const now = new Date();
    let dateFromFilter: Date | undefined;
    let dateToFilter: Date | undefined;

    if (timePeriod === "this-year") {
      dateFromFilter = new Date(now.getFullYear(), 0, 1);
      dateToFilter = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    } else if (timePeriod === "last-year") {
      dateFromFilter = new Date(now.getFullYear() - 1, 0, 1);
      dateToFilter = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
    } else if (timePeriod === "this-month") {
      dateFromFilter = new Date(now.getFullYear(), now.getMonth(), 1);
      dateToFilter = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (timePeriod === "this-quarter") {
      const quarter = Math.floor(now.getMonth() / 3);
      dateFromFilter = new Date(now.getFullYear(), quarter * 3, 1);
      dateToFilter = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59);
    }

    const orderWhere: any = {
      status: { in: Array.from(recognizedStatuses) }
    };
    if (dateFromFilter && dateToFilter) {
      orderWhere.createdAt = { gte: dateFromFilter, lte: dateToFilter };
    }
    if (storeId) {
      orderWhere.storeId = storeId;
    }

    const [orders, receipts, partners, inventory, supplierPayments, refundPayoutLogs, rebateAdjustments, salesReturns, giftRedemptions] = await Promise.all([
      prisma.salesOrder.findMany({
        where: orderWhere,
        include: {
          items: {
            include: {
              product: {
                select: { costPrice: true, productType: true, categoryId: true, isTrackedInOverview: true }
              }
            }
          }
        }
      }),
      prisma.receipt.findMany({
        where: dateFromFilter && dateToFilter
          ? {
              createdAt: { gte: dateFromFilter, lte: dateToFilter },
              ...(storeId ? { storeId } : {})
            }
          : storeId
          ? { storeId }
          : {}
      }),
      prisma.partner.findMany({ where: { isCustomer: true } }),
      prisma.inventory.findMany({
        where: storeId ? { storeId } : undefined,
        include: { product: true }
      }),
      prisma.partnerTransactionLog.findMany({
        where: {
          transactionType: "PAYMENT_TO_SUPPLIER",
          ...(dateFromFilter && dateToFilter
            ? { createdAt: { gte: dateFromFilter, lte: dateToFilter } }
            : {})
        },
        select: { amount: true, note: true }
      }),
      prisma.partnerTransactionLog.findMany({
        where: {
          transactionType: "RETURN_ORDER",
          ...(dateFromFilter && dateToFilter
            ? { createdAt: { gte: dateFromFilter, lte: dateToFilter } }
            : {})
        },
        select: { amount: true, note: true }
      }),
      prisma.purchaseOrder.findMany({
        where: {
          voidedAt: null,
          ...(storeId ? { storeId } : {}),
          ...(dateFromFilter && dateToFilter
            ? {
                OR: [
                  { documentDate: { gte: dateFromFilter, lte: dateToFilter } },
                  {
                    AND: [
                      { documentDate: null },
                      { createdAt: { gte: dateFromFilter, lte: dateToFilter } }
                    ]
                  }
                ]
              }
            : {})
        },
        select: { rebateCogsAdjustment: true, rebateAmount: true }
      }),
      prisma.salesOrderReturn.findMany({
        where: { order: orderWhere },
        select: {
          orderId: true,
          amount: true,
          items: {
            select: {
              quantity: true,
              orderItem: { select: { unitCost: true } }
            }
          }
        }
      }),
      prisma.giftRedemption.findMany({
        where: {
          status: "ACTIVE",
          ...(dateFromFilter && dateToFilter
            ? { createdAt: { gte: dateFromFilter, lte: dateToFilter } }
            : {}),
          ...(storeId ? { storeId } : {})
        },
        include: {
          product: {
            select: {
              costPrice: true,
              defaultPrice: true,
              productType: true,
              categoryId: true,
              isTrackedInOverview: true
            }
          }
        }
      })
    ]);

    const recognizedOrders = orders.filter((order) => isRecognizedStatus(String(order.status)));
    
    // Apply product type and category filters to order items
    if (productType !== "all" || categoryId) {
      const targetProductType = productType === "goods" ? "GOODS" : productType === "service" ? "SERVICE" : null;
      recognizedOrders.forEach((order) => {
        order.items = order.items.filter((item) => {
          const matchesType = !targetProductType || item.product.productType === targetProductType;
          const matchesCategory = !categoryId || item.product.categoryId === categoryId;
          const matchesTracking = matchesOverviewTracking(item.product.isTrackedInOverview, overviewTracking);
          return matchesType && matchesCategory && matchesTracking;
        });
      });
    } else if (overviewTracking !== "all") {
      recognizedOrders.forEach((order) => {
        order.items = order.items.filter((item) => matchesOverviewTracking(item.product.isTrackedInOverview, overviewTracking));
      });
    }
    
    const totalRebateCogs = rebateAdjustments.reduce((sum, r) => sum + Number(r.rebateCogsAdjustment), 0);
    const totalTradeRebate = rebateAdjustments.reduce((sum, r) => sum + Number(r.rebateAmount), 0);

    const grossRevenue = recognizedOrders.reduce((sum, order) => {
      return sum + order.items.reduce((itemSum, item) => itemSum + Number(item.totalAmount || 0), 0);
    }, 0);
    const returnedRevenue = (salesReturns as any[]).reduce((sum, r) => sum + Number(r.amount), 0);
    const revenue = grossRevenue - returnedRevenue;
    const rawCogs = recognizedOrders.reduce((sum, order) => {
      const orderCogs = order.items.reduce((itemSum, item) => {
        return itemSum + item.quantity * Number(item.unitCost || item.product.costPrice || 0);
      }, 0);
      return sum + orderCogs;
    }, 0);
    const returnedCogs = (salesReturns as any[]).reduce((sum, r) => {
      return sum + (r.items as any[]).reduce((s: number, item: any) => s + item.quantity * Number(item.orderItem.unitCost || 0), 0);
    }, 0);
    const filteredGiftRedemptions = (giftRedemptions as any[]).filter((gr) => {
      const matchesType = productType === "all"
        ? true
        : productType === "goods"
        ? gr.product?.productType === "GOODS"
        : gr.product?.productType === "SERVICE";
      const matchesCategory = !categoryId || String(gr.product?.categoryId || "") === String(categoryId);
      const matchesTracking = matchesOverviewTracking(gr.product?.isTrackedInOverview, overviewTracking);
      return matchesType && matchesCategory && matchesTracking;
    });

    const giftCogs = filteredGiftRedemptions.reduce((sum, gr) => {
      return sum + gr.quantity * Number(gr.product.costPrice || 0);
    }, 0);

    const giftRedemptionValue = filteredGiftRedemptions.reduce((sum, gr) => {
      return sum + Number(gr.quantity || 0) * Number(gr.product?.defaultPrice || 0);
    }, 0);

    const giftRedemptionRows = filteredGiftRedemptions.map((gr) => ({
      id: gr.id,
      partnerId: gr.partnerId,
      createdAt: gr.createdAt,
      quantity: Number(gr.quantity || 0),
      productId: gr.productId,
      redemptionValue: Number(gr.quantity || 0) * Number(gr.product?.defaultPrice || 0),
      product: {
        defaultPrice: Number(gr.product?.defaultPrice || 0),
        productType: gr.product?.productType || null,
        categoryId: gr.product?.categoryId || null,
        isTrackedInOverview: Boolean(gr.product?.isTrackedInOverview)
      }
    }));

    const cogs = Math.max(0, rawCogs - totalRebateCogs - returnedCogs) + giftCogs;
    const profit = revenue - cogs;
    const cashIn = receipts.reduce((sum, r) => sum + Number(r.amount), 0);
    const supplierPaymentSummary = supplierPayments.reduce(
      (acc, row) => {
        const settledAmount = Number(row.amount);
        const paymentMeta = parsePaymentNote(row.note);
        const cashAmount = paymentMeta?.cashAmount ?? settledAmount;

        acc.cashOutSupplier += cashAmount;
        acc.supplierPaymentSettled += settledAmount;
        return acc;
      },
      { cashOutSupplier: 0, supplierPaymentSettled: 0 }
    );

    const cashOutSupplier = supplierPaymentSummary.cashOutSupplier;
    const cashOutRefund = refundPayoutLogs.reduce((sum, row) => {
      return isRefundPayoutNote(row.note) ? sum + Number(row.amount) : sum;
    }, 0);
    const cashOutTradeRebate = totalTradeRebate;
    // Supplier cash out must reflect actual cash paid; rebate is already captured by payment cashAmount.
    const netCashOutSupplier = cashOutSupplier;
    const cashOut = netCashOutSupplier + cashOutRefund;
    const netCashFlow = cashIn - cashOut;
    const cashFlowBreakdown = toCashFlowBreakdown(cashIn, netCashOutSupplier, cashOutRefund);
    const debt = partners.reduce((sum, p) => {
      const netBalance = Number(p.netBalance || 0);
      return sum + (netBalance > 0 ? netBalance : 0);
    }, 0);
    const advance = partners.reduce((sum, p) => {
      const netBalance = Number(p.netBalance || 0);
      return sum + (netBalance < 0 ? Math.abs(netBalance) : 0);
    }, 0);
    const inventoryValue = inventory.reduce((sum, i) => {
      return sum + i.quantity * Number(i.product.costPrice);
    }, 0);

    return ok(res, {
      grossRevenue: Math.round(grossRevenue),
      returnedRevenue: Math.round(returnedRevenue),
      revenue,
      cogs,
      giftCogs: Math.round(giftCogs),
      giftRedemptionValue: Math.round(giftRedemptionValue),
      giftRedemptions: giftRedemptionRows,
      profit,
      supplierRebateCogs: Math.round(totalRebateCogs),
      cashIn,
      netCashIn: Math.round(cashIn - cashOutRefund),
      cashOut,
      cashOutSupplier: netCashOutSupplier,
      cashOutSupplierGross: cashOutSupplier,
      cashOutTradeRebate: Math.round(cashOutTradeRebate),
      supplierPaymentSettled: supplierPaymentSummary.supplierPaymentSettled,
      cashOutRefund,
      netCashFlow,
      cashFlowBreakdown,
      customerDebt: debt,
      customerAdvance: advance,
      inventoryValue,
      ordersCount: recognizedOrders.filter((order) => order.items.length > 0).length,
      customersCount: partners.length
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get overview: ${msg}`);
  }
});

router.get("/cash-flow-by-period", requirePermission("dashboard:read"), async (req, res) => {
  try {
    const period = (req.query.period as string) || "month";
    const overviewTracking = (req.query.overviewTracking as string) || "all"; // all, tracked, untracked
    const storeId = typeof req.query.storeId === "string" && req.query.storeId.trim()
      ? req.query.storeId.trim()
      : undefined;

    const purchaseRefsForStore = storeId
      ? (await prisma.purchaseOrder.findMany({
          where: { storeId },
          select: { referenceId: true }
        })).map((row) => row.referenceId)
      : null;

    const returnRefsForStore = storeId
      ? (await prisma.salesOrderReturn.findMany({
          where: { order: { storeId } },
          select: { id: true }
        })).map((row) => row.id)
      : null;

    const [receipts, supplierPayments, refundPayoutLogs, rebateAdjustmentsByPeriod, ordersForRatio] = await Promise.all([
      prisma.receipt.findMany({
        where: storeId ? { storeId } : undefined,
        select: {
          amount: true,
          note: true,
          createdAt: true
        }
      }),
      prisma.partnerTransactionLog.findMany({
        where: {
          transactionType: "PAYMENT_TO_SUPPLIER",
          ...(purchaseRefsForStore
            ? {
                referenceId: {
                  in: purchaseRefsForStore.length > 0 ? purchaseRefsForStore : ["__no_match__"]
                }
              }
            : {})
        },
        select: {
          amount: true,
          note: true,
          createdAt: true
        }
      }),
      prisma.partnerTransactionLog.findMany({
        where: {
          transactionType: "RETURN_ORDER",
          ...(returnRefsForStore
            ? {
                referenceId: {
                  in: returnRefsForStore.length > 0 ? returnRefsForStore : ["__no_match__"]
                }
              }
            : {})
        },
        select: {
          amount: true,
          note: true,
          createdAt: true
        }
      }),
      prisma.purchaseOrder.findMany({
        where: {
          voidedAt: null,
          ...(storeId ? { storeId } : {})
        },
        select: { rebateAmount: true, createdAt: true }
      }),
      prisma.salesOrder.findMany({
        where: {
          status: { in: ["DELIVERED", "COMPLETED", "RETURNED"] as any },
          ...(storeId ? { storeId } : {})
        },
        select: {
          createdAt: true,
          items: {
            select: {
              totalAmount: true,
              product: {
                select: {
                  isTrackedInOverview: true
                }
              }
            }
          }
        }
      })
    ]);

    const grouped: Record<string, { cashIn: number; cashOutSupplier: number; cashOutRefund: number; cashOutTradeRebate: number }> = {};

    receipts.forEach((receipt) => {
      const key = toPeriodKey(new Date(receipt.createdAt), period);
      if (!grouped[key]) {
        grouped[key] = { cashIn: 0, cashOutSupplier: 0, cashOutRefund: 0, cashOutTradeRebate: 0 };
      }
      grouped[key].cashIn += Number(receipt.amount);
    });

    supplierPayments.forEach((payment) => {
      const key = toPeriodKey(new Date(payment.createdAt), period);
      if (!grouped[key]) {
        grouped[key] = { cashIn: 0, cashOutSupplier: 0, cashOutRefund: 0, cashOutTradeRebate: 0 };
      }
      const settledAmount = Number(payment.amount);
      const paymentMeta = parsePaymentNote(payment.note);
      const cashAmount = paymentMeta?.cashAmount ?? settledAmount;
      grouped[key].cashOutSupplier += cashAmount;
    });

    refundPayoutLogs.forEach((refund) => {
      if (!isRefundPayoutNote(refund.note)) return;
      const key = toPeriodKey(new Date(refund.createdAt), period);
      if (!grouped[key]) {
        grouped[key] = { cashIn: 0, cashOutSupplier: 0, cashOutRefund: 0, cashOutTradeRebate: 0 };
      }
      grouped[key].cashOutRefund += Number(refund.amount);
    });

    rebateAdjustmentsByPeriod.forEach((rebate) => {
      const key = toPeriodKey(new Date(rebate.createdAt), period);
      if (!grouped[key]) {
        grouped[key] = { cashIn: 0, cashOutSupplier: 0, cashOutRefund: 0, cashOutTradeRebate: 0 };
      }
      grouped[key].cashOutTradeRebate += Number(rebate.rebateAmount);
    });

    const revenueRatioByPeriod: Record<string, number> = {};
    if (overviewTracking !== "all") {
      const totalRevenueByPeriod: Record<string, number> = {};
      const filteredRevenueByPeriod: Record<string, number> = {};

      ordersForRatio.forEach((order: any) => {
        const key = toPeriodKey(new Date(order.createdAt), period);
        const itemTotals = (order.items || []).map((item: any) => Number(item.totalAmount || 0));
        const orderTotalRevenue = itemTotals.reduce((sum: number, value: number) => sum + value, 0);
        totalRevenueByPeriod[key] = (totalRevenueByPeriod[key] || 0) + orderTotalRevenue;

        const filteredOrderRevenue = (order.items || [])
          .filter((item: any) => matchesOverviewTracking(item.product?.isTrackedInOverview, overviewTracking))
          .reduce((sum: number, item: any) => sum + Number(item.totalAmount || 0), 0);
        filteredRevenueByPeriod[key] = (filteredRevenueByPeriod[key] || 0) + filteredOrderRevenue;
      });

      Object.keys(totalRevenueByPeriod).forEach((key) => {
        const total = Number(totalRevenueByPeriod[key] || 0);
        const filtered = Number(filteredRevenueByPeriod[key] || 0);
        revenueRatioByPeriod[key] = total > 0 ? Math.max(0, Math.min(1, filtered / total)) : 0;
      });
    }

    const result = Object.entries(grouped)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([periodKey, data]) => {
        const ratio = overviewTracking === "all" ? 1 : Number(revenueRatioByPeriod[periodKey] ?? 0);
        const scaledCashIn = data.cashIn * ratio;
        const scaledCashOutSupplierGross = data.cashOutSupplier * ratio;
        const scaledCashOutRefund = data.cashOutRefund * ratio;
        const scaledTradeRebate = data.cashOutTradeRebate * ratio;
        // Keep supplier cash out as actual cash movement; do not subtract rebate again.
        const scaledNetCashOutSupplier = scaledCashOutSupplierGross;
        const breakdown = toCashFlowBreakdown(scaledCashIn, scaledNetCashOutSupplier, scaledCashOutRefund);
        const cashOut = breakdown.total.cashOut;
        return {
          period: periodKey,
          cashIn: Math.round(breakdown.total.cashIn),
          netCashIn: Math.round(breakdown.total.cashIn - scaledCashOutRefund),
          cashOut: Math.round(cashOut),
          cashOutSupplier: Math.round(scaledNetCashOutSupplier),
          cashOutRefund: Math.round(scaledCashOutRefund),
          cashOutTradeRebate: Math.round(scaledTradeRebate),
          netCashFlow: Math.round(breakdown.total.netCashFlow),
          cashFlowBreakdown: {
            operating: {
              cashIn: Math.round(breakdown.operating.cashIn),
              cashOut: Math.round(breakdown.operating.cashOut),
              netCashFlow: Math.round(breakdown.operating.netCashFlow)
            },
            investing: {
              cashIn: 0,
              cashOut: 0,
              netCashFlow: 0
            },
            financing: {
              cashIn: 0,
              cashOut: 0,
              netCashFlow: 0
            }
          }
        };
      });

    return ok(res, result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get cash flow by period: ${msg}`);
  }
});

// Revenue by time period
router.get("/revenue-by-period", requirePermission("dashboard:read"), async (req, res) => {
  try {
    const period = (req.query.period as string) || "month"; // day, week, month, quarter, year
    const [orders, rebateAdjustments, allSalesReturns, allGiftRedemptions] = await Promise.all([
      prisma.salesOrder.findMany({
        include: {
          items: {
            include: {
              product: {
                select: { costPrice: true }
              }
            }
          },
          store: true
        }
      }),
      prisma.purchaseOrder.findMany({
        where: { voidedAt: null },
        select: { rebateCogsAdjustment: true, createdAt: true }
      }),
      prisma.salesOrderReturn.findMany({
        select: {
          createdAt: true,
          items: {
            select: {
              quantity: true,
              orderItem: { select: { unitCost: true } }
            }
          }
        }
      }),
      prisma.giftRedemption.findMany({
        select: {
          createdAt: true,
          quantity: true,
          product: { select: { costPrice: true } }
        }
      })
    ]);

    const grouped: Record<string, { revenue: number; rawCogs: number; rebateAdj: number; orders: number }> = {};

    orders.forEach((order) => {
      if (!isRecognizedStatus(String(order.status))) return;

      const key = toPeriodKey(new Date(order.createdAt), period);
      if (!grouped[key]) {
        grouped[key] = { revenue: 0, rawCogs: 0, rebateAdj: 0, orders: 0 };
      }

      const cogs = order.items.reduce((sum, item) => {
        return sum + item.quantity * Number(item.unitCost || item.product.costPrice || 0);
      }, 0);

      grouped[key].revenue += Number(order.totalAmount);
      grouped[key].rawCogs += cogs;
      grouped[key].orders += 1;
    });

    // Phân bổ rebate adjustment vào kỳ tương ứng (theo createdAt của chứng từ chiết khấu)
    rebateAdjustments.forEach((r) => {
      const key = toPeriodKey(new Date(r.createdAt), period);
      if (grouped[key]) {
        grouped[key].rebateAdj += Number(r.rebateCogsAdjustment);
      }
    });

    // Tổng hợp COGS trả hàng theo kỳ (theo createdAt của phiếu trả)
    const returnedCogsByPeriod: Record<string, number> = {};
    (allSalesReturns as any[]).forEach((r) => {
      const key = toPeriodKey(new Date(r.createdAt), period);
      const rCogs = (r.items as any[]).reduce((s: number, item: any) => s + item.quantity * Number(item.orderItem.unitCost || 0), 0);
      returnedCogsByPeriod[key] = (returnedCogsByPeriod[key] || 0) + rCogs;
    });

    // Tổng hợp COGS đổi quà theo kỳ
    const giftCogsByPeriod: Record<string, number> = {};
    (allGiftRedemptions as any[]).forEach((gr) => {
      const key = toPeriodKey(new Date(gr.createdAt), period);
      giftCogsByPeriod[key] = (giftCogsByPeriod[key] || 0) + gr.quantity * Number(gr.product.costPrice || 0);
    });

    const result = Object.entries(grouped)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([periodKey, data]) => {
        const cogs = Math.max(0, data.rawCogs - data.rebateAdj - (returnedCogsByPeriod[periodKey] || 0)) + (giftCogsByPeriod[periodKey] || 0);
        return {
          period: periodKey,
          revenue: Math.round(data.revenue),
          cogs: Math.round(cogs),
          profit: Math.round(data.revenue - cogs),
          orders: data.orders
        };
      });

    return ok(res, result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get revenue by period: ${msg}`);
  }
});

router.get("/revenue-compare-monthly", requirePermission("dashboard:read"), async (req, res) => {
  try {
    const now = new Date();
    const timePeriod = (req.query.timePeriod as string) || "this-year";
    const parsedAnchorYear = Number(req.query.anchorYear);
    const anchorYear = Number.isFinite(parsedAnchorYear) && parsedAnchorYear > 2000
      ? parsedAnchorYear
      : (timePeriod === "last-year" ? now.getFullYear() - 1 : now.getFullYear());
    const previousYear = anchorYear - 1;

    const productType = (req.query.productType as string) || "all"; // goods, service, all
    const overviewTracking = (req.query.overviewTracking as string) || "all"; // all, tracked, untracked
    const categoryId = typeof req.query.categoryId === "string" && req.query.categoryId.trim()
      ? req.query.categoryId.trim()
      : undefined;
    const storeId = typeof req.query.storeId === "string" && req.query.storeId.trim()
      ? req.query.storeId.trim()
      : undefined;

    const fromDate = new Date(previousYear, 0, 1);
    const toDate = new Date(anchorYear, 11, 31, 23, 59, 59);

    const [orders, allSalesReturns]: [Array<any>, Array<any>] = await Promise.all([
      prisma.salesOrder.findMany({
        where: {
          status: { in: ["DELIVERED", "COMPLETED", "RETURNED"] as any },
          createdAt: { gte: fromDate, lte: toDate },
          ...(storeId ? { storeId } : {})
        },
        include: {
          items: {
            include: {
              product: {
                select: {
                  productType: true,
                  categoryId: true,
                  isTrackedInOverview: true
                }
              }
            }
          }
        }
      }),
      prisma.salesOrderReturn.findMany({
        where: { order: { createdAt: { gte: fromDate, lte: toDate } } },
        select: { orderId: true, amount: true }
      })
    ]);

    const currentYearSeries = Array(12).fill(0);
    const previousYearSeries = Array(12).fill(0);
    const targetProductType = productType === "goods" ? "GOODS" : productType === "service" ? "SERVICE" : null;

    const returnAmountByOrder = new Map<string, number>();
    allSalesReturns.forEach((r: any) => {
      returnAmountByOrder.set(r.orderId, (returnAmountByOrder.get(r.orderId) || 0) + Number(r.amount));
    });

    orders.forEach((order) => {
      const created = new Date(order.createdAt);
      const year = created.getFullYear();
      if (year !== anchorYear && year !== previousYear) return;

      const month = created.getMonth();
      const rawOrderRevenue = order.items
        .filter((item) => {
          const matchesType = !targetProductType || item.product.productType === targetProductType;
          const matchesCategory = !categoryId || item.product.categoryId === categoryId;
          const matchesTracking = matchesOverviewTracking(item.product.isTrackedInOverview, overviewTracking);
          return matchesType && matchesCategory && matchesTracking;
        })
        .reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
      const returnedAmount = returnAmountByOrder.get(order.id) || 0;
      const orderRevenue = Math.max(0, rawOrderRevenue - returnedAmount);

      if (year === anchorYear) {
        currentYearSeries[month] += orderRevenue;
      } else {
        previousYearSeries[month] += orderRevenue;
      }
    });

    const roundedCurrent = currentYearSeries.map((value) => Math.round(value));
    const roundedPrevious = previousYearSeries.map((value) => Math.round(value));
    const totalCurrentYear = roundedCurrent.reduce((sum, value) => sum + value, 0);
    const totalPreviousYear = roundedPrevious.reduce((sum, value) => sum + value, 0);
    const deltaPercent = totalPreviousYear > 0
      ? Math.round(((totalCurrentYear - totalPreviousYear) / totalPreviousYear) * 10000) / 100
      : null;

    return ok(res, {
      anchorYear,
      previousYear,
      labels: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"],
      currentYearSeries: roundedCurrent,
      previousYearSeries: roundedPrevious,
      totalCurrentYear,
      totalPreviousYear,
      deltaPercent
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get monthly revenue comparison: ${msg}`);
  }
});

// Revenue by store
router.get("/revenue-by-store", requirePermission("dashboard:read"), async (_req, res) => {
  try {
    const [stores, orders, rebateAdjustments, allSalesReturns, allGiftRedemptions] = await Promise.all([
      prisma.store.findMany(),
      prisma.salesOrder.findMany({
        include: {
          items: {
            include: {
              product: {
                select: { costPrice: true }
              }
            }
          }
        }
      }),
      prisma.purchaseOrder.findMany({
        where: { voidedAt: null },
        select: { rebateCogsAdjustment: true }
      }),
      prisma.salesOrderReturn.findMany({
        select: {
          orderId: true,
          items: {
            select: {
              quantity: true,
              orderItem: { select: { unitCost: true } }
            }
          }
        }
      }),
      prisma.giftRedemption.findMany({
        select: {
          storeId: true,
          quantity: true,
          product: { select: { costPrice: true } }
        }
      })
    ]);

    const totalRebateCogs = rebateAdjustments.reduce((sum, r) => sum + Number(r.rebateCogsAdjustment), 0);
    const recognizedOrders = orders.filter((o) => isRecognizedStatus(String(o.status)));
    const totalRawCogs = recognizedOrders.reduce((sum, order) =>
      sum + order.items.reduce((s, item) => s + item.quantity * Number(item.unitCost || item.product.costPrice || 0), 0), 0
    );

    const returnedCogsByOrder = new Map<string, number>();
    (allSalesReturns as any[]).forEach((r) => {
      const rCogs = (r.items as any[]).reduce((s: number, item: any) => s + item.quantity * Number(item.orderItem.unitCost || 0), 0);
      returnedCogsByOrder.set(r.orderId, (returnedCogsByOrder.get(r.orderId) || 0) + rCogs);
    });

    const data = stores.map((store) => {
      const storeOrders = orders.filter((o) => o.storeId === store.id && isRecognizedStatus(String(o.status)));
      const revenue = storeOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
      const rawCogs = storeOrders.reduce((sum, order) => {
        return sum + order.items.reduce((itemSum, item) => {
          return itemSum + item.quantity * Number(item.unitCost || item.product.costPrice || 0);
        }, 0);
      }, 0);
      // Phân bổ rebate theo tỷ lệ COGS cửa hàng / tổng COGS
      const returnedCogs = storeOrders.reduce((sum, o) => sum + (returnedCogsByOrder.get(o.id) || 0), 0);
      const storeRebateAdj = totalRawCogs > 0 ? totalRebateCogs * (rawCogs / totalRawCogs) : 0;
      const storeGiftCogs = (allGiftRedemptions as any[])
        .filter((gr) => gr.storeId === store.id)
        .reduce((sum, gr) => sum + gr.quantity * Number(gr.product.costPrice || 0), 0);
      const cogs = Math.max(0, rawCogs - storeRebateAdj - returnedCogs) + storeGiftCogs;
      const profit = revenue - cogs;

      return {
        storeId: store.id,
        storeName: store.name,
        revenue,
        cogs,
        profit,
        ordersCount: storeOrders.length
      };
    });

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get revenue by store: ${msg}`);
  }
});

// Revenue by product
router.get("/revenue-by-product", requirePermission("dashboard:read"), async (_req, res) => {
  try {
    const [products, orderItems, rebateItems, returnItems, productGiftRedemptions] = await Promise.all([
      prisma.product.findMany(),
      prisma.salesOrderItem.findMany({
        where: {
          order: {
            status: {
              in: ["DELIVERED", "COMPLETED", "RETURNED"]
            }
          }
        },
        include: { product: true }
      }),
      // Lấy rebate theo supplierId + kỳ để phân bổ theo sản phẩm
      // Đơn giản hóa: lấy tổng COGS rebate và phân bổ theo tỷ lệ số lượng bán của từng sản phẩm
      prisma.purchaseOrder.findMany({
        where: { voidedAt: null },
        select: { rebateCogsAdjustment: true }
      }),
      prisma.salesOrderReturnItem.findMany({
        select: {
          quantity: true,
          amount: true,
          orderItem: { select: { productId: true, unitCost: true } }
        }
      }),
      prisma.giftRedemption.findMany({
        select: {
          productId: true,
          quantity: true,
          product: { select: { costPrice: true } }
        }
      })
    ]);

    const totalRebateCogs = rebateItems.reduce((sum, r) => sum + Number(r.rebateCogsAdjustment), 0);
    // Tổng COGS toàn hệ thống để tính tỷ lệ phân bổ rebate theo sản phẩm
    const totalRawCogs = orderItems.reduce((sum, oi) => sum + oi.quantity * Number(oi.unitCost || oi.product.costPrice), 0);

    const returnedQtyByProduct = new Map<string, number>();
    const returnedRevenueByProduct = new Map<string, number>();
    const returnedCogsByProduct = new Map<string, number>();
    (returnItems as any[]).forEach((ri) => {
      const pid = ri.orderItem.productId;
      returnedQtyByProduct.set(pid, (returnedQtyByProduct.get(pid) || 0) + ri.quantity);
      returnedRevenueByProduct.set(pid, (returnedRevenueByProduct.get(pid) || 0) + Number(ri.amount));
      returnedCogsByProduct.set(pid, (returnedCogsByProduct.get(pid) || 0) + ri.quantity * Number(ri.orderItem.unitCost || 0));
    });

    const data = products.map((product) => {
      const items = orderItems.filter((oi) => oi.productId === product.id);
      const quantity = Math.max(0, items.reduce((sum, oi) => sum + oi.quantity, 0) - (returnedQtyByProduct.get(product.id) || 0));
      const revenue = Math.max(0, items.reduce((sum, oi) => sum + Number(oi.totalAmount), 0) - (returnedRevenueByProduct.get(product.id) || 0));
      const rawCogs = Math.max(0, items.reduce((sum, oi) => sum + oi.quantity * Number(oi.unitCost || product.costPrice), 0) - (returnedCogsByProduct.get(product.id) || 0));
      // Phân bổ rebate theo tỷ lệ COGS sản phẩm / tổng COGS
      const productRebateAdj = totalRawCogs > 0 ? totalRebateCogs * (rawCogs / totalRawCogs) : 0;
      const productGiftCogs = (productGiftRedemptions as any[])
        .filter((gr) => gr.productId === product.id)
        .reduce((sum, gr) => sum + gr.quantity * Number(gr.product.costPrice || 0), 0);
      const cogs = Math.max(0, rawCogs - productRebateAdj) + productGiftCogs;
      const profit = revenue - cogs;

      return {
        productId: product.id,
        productName: product.name,
        quantity,
        revenue,
        profit,
        margin: revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : 0
      };
    });

    return ok(res, data.filter((d) => d.quantity > 0));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get revenue by product: ${msg}`);
  }
});

router.get("/staff-kpi", requirePermission("dashboard:read"), async (req, res) => {
  try {
    const timePeriod = (req.query.timePeriod as string) || "this-year";
    const productType = (req.query.productType as string) || "all";
    const categoryId = typeof req.query.categoryId === "string" && req.query.categoryId.trim()
      ? req.query.categoryId.trim()
      : undefined;
    const customerType = typeof req.query.customerType === "string" && req.query.customerType.trim()
      ? req.query.customerType.trim().toUpperCase()
      : undefined;
    const roleDimension = ((req.query.roleDimension as string) || "sales_person").toLowerCase();
    const groupBy = ((req.query.groupBy as string) || "user").toLowerCase() === "position"
      ? "position"
      : "user";
    const positionId = typeof req.query.positionId === "string" && req.query.positionId.trim()
      ? req.query.positionId.trim()
      : undefined;

    const now = new Date();
    let dateFromFilter: Date | undefined;
    let dateToFilter: Date | undefined;
    if (timePeriod === "this-year") {
      dateFromFilter = new Date(now.getFullYear(), 0, 1);
      dateToFilter = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    } else if (timePeriod === "last-year") {
      dateFromFilter = new Date(now.getFullYear() - 1, 0, 1);
      dateToFilter = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
    } else if (timePeriod === "this-month") {
      dateFromFilter = new Date(now.getFullYear(), now.getMonth(), 1);
      dateToFilter = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (timePeriod === "this-quarter") {
      const quarter = Math.floor(now.getMonth() / 3);
      dateFromFilter = new Date(now.getFullYear(), quarter * 3, 1);
      dateToFilter = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59);
    }

    const targetProductType = productType === "goods" ? "GOODS" : productType === "service" ? "SERVICE" : null;
    const roleField = roleDimension === "store_manager"
      ? "storeManagerId"
      : roleDimension === "store_supervisor"
        ? "storeSupervisorId"
        : "salesPersonId";
    const rolePositionField = roleDimension === "store_manager"
      ? "storeManagerPositionId"
      : roleDimension === "store_supervisor"
        ? "storeSupervisorPositionId"
        : "salesOwnerPositionId";

    const [users, orders, rebateAdjustments, salesReturnsForKpi] = await Promise.all([
      prisma.user.findMany(),
      prisma.salesOrder.findMany({
        where: {
          status: { in: ["DELIVERED", "COMPLETED", "RETURNED"] as any },
          ...(dateFromFilter && dateToFilter ? { createdAt: { gte: dateFromFilter, lte: dateToFilter } } : {})
        },
        include: {
          customer: true,
          items: {
            include: {
              product: {
                select: { costPrice: true, productType: true, categoryId: true }
              }
            }
          },
          salesPerson: { select: { id: true } },
          salesOwnerPosition: { select: { id: true, code: true, name: true } },
          storeManager: { select: { id: true } },
          storeManagerPosition: { select: { id: true, code: true, name: true } },
          storeSupervisor: { select: { id: true } },
          storeSupervisorPosition: { select: { id: true, code: true, name: true } }
        }
      }),
      prisma.purchaseOrder.findMany({
        where: {
          voidedAt: null,
          ...(dateFromFilter && dateToFilter
            ? {
                OR: [
                  { documentDate: { gte: dateFromFilter, lte: dateToFilter } },
                  {
                    AND: [
                      { documentDate: null },
                      { createdAt: { gte: dateFromFilter, lte: dateToFilter } }
                    ]
                  }
                ]
              }
            : {})
        },
        select: { rebateCogsAdjustment: true }
      }),
      prisma.salesOrderReturn.findMany({
        where: {
          ...(dateFromFilter && dateToFilter ? { order: { createdAt: { gte: dateFromFilter, lte: dateToFilter } } } : {})
        },
        select: {
          orderId: true,
          amount: true,
          items: {
            select: {
              quantity: true,
              orderItem: { select: { unitCost: true } }
            }
          }
        }
      })
    ]);

    const totalRebateCogs = rebateAdjustments.reduce((sum, r) => sum + Number(r.rebateCogsAdjustment), 0);
    const recognizedOrders = orders
      .filter((o) => isRecognizedStatus(String(o.status)))
      .map((order) => {
        const filteredItems = order.items.filter((item) => {
          const matchesType = !targetProductType || item.product.productType === targetProductType;
          const matchesCategory = !categoryId || item.product.categoryId === categoryId;
          return matchesType && matchesCategory;
        });
        return {
          ...order,
          items: filteredItems
        };
      })
      .filter((order) => {
        if (customerType) {
          const tier = String(order.customer?.customerPriceTier || "").toUpperCase();
          if (tier !== customerType) return false;
        }
        if (positionId) {
          const rolePosition = rolePositionField === "storeManagerPositionId"
            ? order.storeManagerPositionId
            : rolePositionField === "storeSupervisorPositionId"
              ? order.storeSupervisorPositionId
              : order.salesOwnerPositionId;
          if (rolePosition !== positionId) return false;
        }
        return order.items.length > 0;
      });

    const userNameById = new Map(users.map((u) => [u.id, u.fullName]));

    const returnAmountByOrderKpi = new Map<string, number>();
    const returnCogsByOrderKpi = new Map<string, number>();
    (salesReturnsForKpi as any[]).forEach((r) => {
      returnAmountByOrderKpi.set(r.orderId, (returnAmountByOrderKpi.get(r.orderId) || 0) + Number(r.amount));
      const returnCogs = (r.items as any[]).reduce((sum: number, item: any) => {
        return sum + item.quantity * Number(item.orderItem.unitCost || 0);
      }, 0);
      returnCogsByOrderKpi.set(r.orderId, (returnCogsByOrderKpi.get(r.orderId) || 0) + returnCogs);
    });

    const getRoleUserId = (order: any) => {
      if (roleField === "storeManagerId") return order.storeManagerId;
      if (roleField === "storeSupervisorId") return order.storeSupervisorId;
      return order.salesPersonId;
    };
    const getRolePositionId = (order: any) => {
      if (rolePositionField === "storeManagerPositionId") return order.storeManagerPositionId;
      if (rolePositionField === "storeSupervisorPositionId") return order.storeSupervisorPositionId;
      return order.salesOwnerPositionId;
    };
    const getRolePositionMeta = (order: any) => {
      if (rolePositionField === "storeManagerPositionId") return order.storeManagerPosition;
      if (rolePositionField === "storeSupervisorPositionId") return order.storeSupervisorPosition;
      return order.salesOwnerPosition;
    };
    const getOrderRevenue = (order: any) => {
      const itemsRevenue = order.items.reduce((sum: number, item: any) => sum + Number(item.totalAmount || 0), 0);
      const returnedAmount = returnAmountByOrderKpi.get(order.id) || 0;
      return Math.max(0, itemsRevenue - returnedAmount);
    };
    const getOrderRawCogs = (order: any) => {
      const rawCogs = order.items.reduce((sum: number, item: any) => {
        return sum + item.quantity * Number(item.unitCost || item.product.costPrice || 0);
      }, 0);
      const returnedCogs = returnCogsByOrderKpi.get(order.id) || 0;
      return Math.max(0, rawCogs - returnedCogs);
    };

    const totalRawCogs = recognizedOrders.reduce((sum, order) => sum + getOrderRawCogs(order), 0);

    if (groupBy === "position") {
      const aggregates = new Map<string, {
        positionId: string;
        positionCode: string | null;
        positionName: string | null;
        revenue: number;
        rawCogs: number;
        customers: Set<string>;
        ordersCount: number;
        userIds: Set<string>;
      }>();

      for (const order of recognizedOrders) {
        const currentPositionId = getRolePositionId(order);
        if (!currentPositionId) continue;

        const positionMeta = getRolePositionMeta(order);
        const ownerUserId = getRoleUserId(order);
        const row = aggregates.get(currentPositionId) || {
          positionId: currentPositionId,
          positionCode: positionMeta?.code || null,
          positionName: positionMeta?.name || null,
          revenue: 0,
          rawCogs: 0,
          customers: new Set<string>(),
          ordersCount: 0,
          userIds: new Set<string>()
        };

        row.revenue += getOrderRevenue(order);
        row.rawCogs += getOrderRawCogs(order);
        row.customers.add(order.customerId);
        row.ordersCount += 1;
        if (ownerUserId) {
          row.userIds.add(ownerUserId);
        }
        if (!row.positionCode && positionMeta?.code) row.positionCode = positionMeta.code;
        if (!row.positionName && positionMeta?.name) row.positionName = positionMeta.name;

        aggregates.set(currentPositionId, row);
      }

      const kpiByPosition = Array.from(aggregates.values()).map((row) => {
        const rebateAdj = totalRawCogs > 0 ? totalRebateCogs * (row.rawCogs / totalRawCogs) : 0;
        const cogs = Math.max(0, row.rawCogs - rebateAdj);
        const profit = row.revenue - cogs;

        return {
          positionId: row.positionId,
          positionCode: row.positionCode,
          positionName: row.positionName,
          roleDimension,
          groupBy,
          revenue: row.revenue,
          cogs,
          profit,
          customersActive: row.customers.size,
          ordersCount: row.ordersCount,
          usersInvolved: Array.from(row.userIds).map((id) => ({ id, fullName: userNameById.get(id) || null }))
        };
      }).filter((row) => row.ordersCount > 0 || row.revenue > 0);

      return ok(res, kpiByPosition);
    }

    const userAggregates = new Map<string, {
      userId: string;
      fullName: string | null;
      revenue: number;
      rawCogs: number;
      customers: Set<string>;
      ordersCount: number;
    }>();

    for (const order of recognizedOrders) {
      const ownerUserId = getRoleUserId(order);
      if (!ownerUserId) continue;

      const row = userAggregates.get(ownerUserId) || {
        userId: ownerUserId,
        fullName: userNameById.get(ownerUserId) || null,
        revenue: 0,
        rawCogs: 0,
        customers: new Set<string>(),
        ordersCount: 0
      };

      row.revenue += getOrderRevenue(order);
      row.rawCogs += getOrderRawCogs(order);
      row.customers.add(order.customerId);
      row.ordersCount += 1;

      userAggregates.set(ownerUserId, row);
    }

    const kpi = Array.from(userAggregates.values()).map((row) => {
      const rebateAdj = totalRawCogs > 0 ? totalRebateCogs * (row.rawCogs / totalRawCogs) : 0;
      const cogs = Math.max(0, row.rawCogs - rebateAdj);
      const profit = row.revenue - cogs;

      return {
        userId: row.userId,
        fullName: row.fullName,
        roleDimension,
        groupBy,
        revenue: row.revenue,
        cogs,
        profit,
        customersActive: row.customers.size,
        ordersCount: row.ordersCount
      };
    }).filter((row) => row.ordersCount > 0 || row.revenue > 0);

    return ok(res, kpi);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get staff KPI: ${msg}`);
  }
});

export default router;
