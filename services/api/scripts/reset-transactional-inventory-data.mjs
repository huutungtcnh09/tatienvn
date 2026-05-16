import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const giftRedemptions = await tx.giftRedemption.deleteMany({});
    const salesOrderReturnItems = await tx.salesOrderReturnItem.deleteMany({});
    const salesOrderReturns = await tx.salesOrderReturn.deleteMany({});
    const receiptAllocations = await tx.receiptAllocation.deleteMany({});
    const receipts = await tx.receipt.deleteMany({});
    const salesOrderItems = await tx.salesOrderItem.deleteMany({});
    const salesOrders = await tx.salesOrder.deleteMany({});

    const purchaseRebateApplications = await tx.purchaseRebateApplication.deleteMany({});
    const purchaseRebates = await tx.purchaseRebate.deleteMany({});
    const purchasePayments = await tx.purchasePayment.deleteMany({});
    const purchaseOrderItems = await tx.purchaseOrderItem.deleteMany({});
    const purchaseOrders = await tx.purchaseOrder.deleteMany({});

    const inventoryMovements = await tx.inventoryMovement.deleteMany({});
    const inventories = await tx.inventory.deleteMany({});
    const partnerTransactionLogs = await tx.partnerTransactionLog.deleteMany({});

    const partnersReset = await tx.$executeRawUnsafe(
      "UPDATE partner SET net_balance = opening_balance"
    );

    return {
      salesOrderReturnItems: salesOrderReturnItems.count,
      salesOrderReturns: salesOrderReturns.count,
      receiptAllocations: receiptAllocations.count,
      receipts: receipts.count,
      salesOrderItems: salesOrderItems.count,
      salesOrders: salesOrders.count,
      giftRedemptions: giftRedemptions.count,
      purchaseRebateApplications: purchaseRebateApplications.count,
      purchaseRebates: purchaseRebates.count,
      purchasePayments: purchasePayments.count,
      purchaseOrderItems: purchaseOrderItems.count,
      purchaseOrders: purchaseOrders.count,
      inventoryMovements: inventoryMovements.count,
      inventories: inventories.count,
      partnerTransactionLogs: partnerTransactionLogs.count,
      partnersReset: Number(partnersReset || 0)
    };
  });

  console.log("Transactional and inventory data cleared:");
  console.table(result);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });