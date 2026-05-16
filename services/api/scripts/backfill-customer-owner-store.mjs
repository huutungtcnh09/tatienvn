import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function resolveDefaultStoreId() {
  const preferred = await prisma.store.findFirst({
    where: { isWarehouse: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, name: true }
  });

  if (preferred) return preferred;

  const fallback = await prisma.store.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, name: true }
  });

  return fallback;
}

async function resolveOwnerStoreId(customerId, accountOwnerPositionId, defaultStoreId) {
  const latestOrder = await prisma.salesOrder.findFirst({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    select: { storeId: true }
  });
  if (latestOrder?.storeId) return latestOrder.storeId;

  const latestReceipt = await prisma.receipt.findFirst({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    select: { storeId: true }
  });
  if (latestReceipt?.storeId) return latestReceipt.storeId;

  if (accountOwnerPositionId) {
    const position = await prisma.orgPosition.findUnique({
      where: { id: accountOwnerPositionId },
      select: { storeId: true }
    });
    if (position?.storeId) return position.storeId;
  }

  return defaultStoreId;
}

async function main() {
  const defaultStore = await resolveDefaultStoreId();
  if (!defaultStore?.id) {
    console.error("Khong tim thay cua hang nao de lam ownerStore mac dinh");
    process.exitCode = 1;
    return;
  }

  const customers = await prisma.partner.findMany({
    where: {
      isCustomer: true,
      ownerStoreId: null
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      accountOwnerPositionId: true
    }
  });

  if (!customers.length) {
    console.log("Khong co khach hang nao can backfill ownerStoreId");
    return;
  }

  let updated = 0;
  let fallbackCount = 0;

  for (const customer of customers) {
    const ownerStoreId = await resolveOwnerStoreId(
      customer.id,
      customer.accountOwnerPositionId,
      defaultStore.id
    );

    if (ownerStoreId === defaultStore.id) {
      fallbackCount += 1;
    }

    await prisma.partner.update({
      where: { id: customer.id },
      data: { ownerStoreId }
    });

    updated += 1;
    console.log(
      `[${updated}/${customers.length}] ${customer.code} - ${customer.name} => store ${ownerStoreId}`
    );
  }

  const remain = await prisma.partner.count({
    where: {
      isCustomer: true,
      ownerStoreId: null
    }
  });

  console.log("Backfill hoan tat");
  console.log(`Tong cap nhat: ${updated}`);
  console.log(`Dung fallback mac dinh: ${fallbackCount}`);
  console.log(`Con null ownerStoreId: ${remain}`);
}

main()
  .catch((error) => {
    console.error("Backfill that bai:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
