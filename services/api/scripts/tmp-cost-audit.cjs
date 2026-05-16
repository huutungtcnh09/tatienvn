const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const productId = 'cmoi45mmj00mkvzrokpjl6yw4';

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, costPrice: true, createdAt: true }
  });

  const poItems = await prisma.purchaseOrderItem.findMany({
    where: {
      productId,
      purchaseOrder: { voidedAt: null }
    },
    select: {
      id: true,
      quantity: true,
      unitCost: true,
      allocatedLandedCost: true,
      netAmount: true,
      unitNetCost: true,
      createdAt: true,
      purchaseOrder: {
        select: {
          referenceId: true,
          createdAt: true,
          documentDate: true,
          amount: true,
          landedCost: true,
          rebateAmount: true,
          rebateInventoryAdjustment: true,
          voidedAt: true
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  const movements = await prisma.inventoryMovement.findMany({
    where: { productId },
    select: {
      id: true,
      movementType: true,
      quantityDelta: true,
      unitCost: true,
      totalCost: true,
      referenceType: true,
      referenceId: true,
      createdAt: true,
      storeId: true
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(JSON.stringify({
    product,
    purchaseItemCount: poItems.length,
    purchaseItems: poItems,
    movementCount: movements.length,
    movements
  }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
