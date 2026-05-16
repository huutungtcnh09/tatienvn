import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const META_MARKER = "##PURCHASE_META##";
const PAYMENT_META_MARKER = "##PURCHASE_PAYMENT_META##";

function parsePurchaseNote(rawNote) {
  const safe = rawNote || "";
  const markerIndex = safe.indexOf(META_MARKER);
  if (markerIndex < 0) return null;

  const encodedMeta = safe.slice(markerIndex + META_MARKER.length).trim();
  if (!encodedMeta) return null;

  try {
    return JSON.parse(encodedMeta);
  } catch {
    return null;
  }
}

function parsePaymentNote(rawNote) {
  const safe = rawNote || "";
  const markerIndex = safe.indexOf(PAYMENT_META_MARKER);
  if (markerIndex < 0) {
    return { cashAmount: null, discountAmount: null, settledAmount: null };
  }

  const encodedMeta = safe.slice(markerIndex + PAYMENT_META_MARKER.length).trim();
  if (!encodedMeta) {
    return { cashAmount: null, discountAmount: null, settledAmount: null };
  }

  try {
    const parsed = JSON.parse(encodedMeta);
    return {
      cashAmount: Number(parsed?.cashAmount ?? 0),
      discountAmount: Number(parsed?.discountAmount ?? 0),
      settledAmount: Number(parsed?.settledAmount ?? 0)
    };
  } catch {
    return { cashAmount: null, discountAmount: null, settledAmount: null };
  }
}

async function main() {
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    include: {
      supplier: { select: { id: true } }
    }
  });

  let rebateInserted = 0;
  let paymentInserted = 0;

  for (const order of purchaseOrders) {
    const meta = parsePurchaseNote(order.note);

    const existingRebates = await prisma.purchaseRebate.count({ where: { purchaseOrderId: order.id } });
    if (!existingRebates && Array.isArray(meta?.rebates) && meta.rebates.length) {
      for (const rebate of meta.rebates) {
        await prisma.purchaseRebate.create({
          data: {
            purchaseOrderId: order.id,
            supplierId: order.supplierId,
            label: String(rebate?.label || "Chiet khau thuong mai"),
            amount: Number(rebate?.amount || 0),
            note: rebate?.note ? String(rebate.note) : null,
            purchasedQty: Number(rebate?.purchasedQty || 0),
            soldQty: Number(rebate?.soldQty || 0),
            soldRatio: Number(rebate?.soldRatio || 0),
            cogsAdjustmentAmount: Number(rebate?.cogsAdjustmentAmount || 0),
            inventoryAdjustmentAmount: Number(rebate?.inventoryAdjustmentAmount || 0)
          }
        });
        rebateInserted += 1;
      }
    }

    const existingPayments = await prisma.purchasePayment.count({ where: { purchaseOrderId: order.id } });
    if (!existingPayments) {
      const paymentLogs = await prisma.partnerTransactionLog.findMany({
        where: {
          partnerId: order.supplierId,
          transactionType: "PAYMENT_TO_SUPPLIER",
          referenceId: order.referenceId
        },
        orderBy: { createdAt: "asc" }
      });

      for (const log of paymentLogs) {
        const paymentMeta = parsePaymentNote(log.note);
        const settledAmount = Number(paymentMeta.settledAmount ?? log.amount ?? 0);
        const cashAmount = Number(paymentMeta.cashAmount ?? settledAmount);
        const discountAmount = Number(paymentMeta.discountAmount ?? 0);

        await prisma.purchasePayment.create({
          data: {
            purchaseOrderId: order.id,
            supplierId: order.supplierId,
            cashAmount,
            discountAmount,
            settledAmount,
            note: log.note || null,
            createdAt: log.createdAt
          }
        });
        paymentInserted += 1;
      }
    }
  }

  console.log("Backfill completed", {
    orders: purchaseOrders.length,
    rebateInserted,
    paymentInserted
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
