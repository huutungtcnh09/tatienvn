// @ts-nocheck
import bcrypt from "bcryptjs";
import { PrismaClient, PaymentMethod } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("123456", 10);

  const headManager = await prisma.user.upsert({
    where: { email: "admin@domain.com" },
    update: {},
    create: {
      email: "admin@domain.com",
      fullName: "Quan tri tru so",
      passwordHash,
      roles: "SUPER_ADMIN,HEAD_MANAGER"
    }
  });

  const storeManager = await prisma.user.upsert({
    where: { email: "store@domain.com" },
    update: {},
    create: {
      email: "store@domain.com",
      fullName: "Quan ly cua hang",
      passwordHash,
      roles: "STORE_MANAGER,SALES_STAFF"
    }
  });

  const store = await prisma.store.upsert({
    where: { code: "STORE-HCM-01" },
    update: {},
    create: {
      code: "STORE-HCM-01",
      name: "Cua hang HCM 01",
      managerId: storeManager.id
    }
  });

  await prisma.store.upsert({
    where: { code: "WH-01" },
    update: {},
    create: {
      code: "WH-01",
      name: "Kho trung tam",
      isWarehouse: true,
      managerId: headManager.id
    }
  });

  const category = await prisma.category.create({
    data: {
      name: "Do uong"
    }
  });

  const productA = await prisma.product.upsert({
    where: { sku: "SP-A" },
    update: {},
    create: {
      sku: "SP-A",
      name: "San pham A",
      categoryId: category.id,
      unit: "chai",
      minPrice: 90000,
      maxPrice: 120000,
      defaultPrice: 100000,
      specialPrice: 95000,
      rewardPoints: 10,
      costPrice: 70000
    }
  });

  const productB = await prisma.product.upsert({
    where: { sku: "SP-B" },
    update: {},
    create: {
      sku: "SP-B",
      name: "San pham B",
      categoryId: category.id,
      unit: "chai",
      minPrice: 40000,
      maxPrice: 70000,
      defaultPrice: 50000,
      specialPrice: 45000,
      rewardPoints: 5,
      costPrice: 30000
    }
  });

  const customer = await prisma.partner.upsert({
    where: { code: "CUST-0001" },
    update: {},
    create: {
      code: "CUST-0001",
      name: "Nguyen Van A",
      phone: "0900000000",
      address: "HCM",
      isCustomer: true,
      assignedUserId: storeManager.id,
      openingBalance: 2000000,
      netBalance: 1500000
    }
  });

  await prisma.partner.upsert({
    where: { code: "SUP-0001" },
    update: {},
    create: {
      code: "SUP-0001",
      name: "Nha cung cap 1",
      isSupplier: true
    }
  });

  await prisma.inventory.upsert({
    where: {
      productId_storeId: {
        productId: productA.id,
        storeId: store.id
      }
    },
    update: { quantity: 200 },
    create: {
      productId: productA.id,
      storeId: store.id,
      quantity: 200,
      reservedQuantity: 0
    }
  });

  await prisma.inventory.upsert({
    where: {
      productId_storeId: {
        productId: productB.id,
        storeId: store.id
      }
    },
    update: { quantity: 300 },
    create: {
      productId: productB.id,
      storeId: store.id,
      quantity: 300,
      reservedQuantity: 0
    }
  });

  await prisma.customerPriceList.upsert({
    where: {
      customerId_productId_status: {
        customerId: customer.id,
        productId: productA.id,
        status: "active"
      }
    },
    update: { price: 98000 },
    create: {
      customerId: customer.id,
      productId: productA.id,
      price: 98000,
      status: "active",
      createdBy: headManager.id,
      storeId: store.id
    }
  });

  await prisma.promotion.create({
    data: {
      name: "Mua 10 tang 1",
      type: "buy_x_get_y",
      triggerProductId: productA.id,
      triggerQty: 10,
      rewardProductId: productB.id,
      rewardQty: 1,
      startDate: new Date(),
      endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      isActive: true
    }
  });

  const openingReceipt = await prisma.receipt.create({
    data: {
      receiptNo: `PT-${Date.now()}`,
      customerId: customer.id,
      storeId: store.id,
      type: "PAYMENT",
      paymentMethod: PaymentMethod.CASH,
      amount: 500000,
      discountAmount: 0,
      note: "Thu no dau ky"
    }
  });

  await prisma.partnerTransactionLog.createMany({
    data: [
      {
        partnerId: customer.id,
        transactionType: "OPENING_BALANCE",
        referenceId: customer.id,
        amount: 2000000,
        note: "Nhap so du dau ky"
      },
      {
        partnerId: customer.id,
        transactionType: "PAYMENT_RECEIPT",
        referenceId: openingReceipt.id,
        amount: 500000,
        note: "Thu no dau ky"
      }
    ]
  });

  console.log("Seed completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
