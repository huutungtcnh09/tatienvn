import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("delegate.purchaseOrder:", typeof prisma.purchaseOrder);
  console.log("delegate.purchaseOrderItem:", typeof prisma.purchaseOrderItem);
  if (prisma.purchaseOrder) {
    const count = await prisma.purchaseOrder.count();
    console.log("purchaseOrder.count:", count);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
