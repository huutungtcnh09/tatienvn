import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const API_BASE = "http://localhost:4000/api";

async function ensureStore(code, name) {
  return prisma.store.upsert({
    where: { code },
    update: { name },
    create: { code, name }
  });
}

async function ensureStoreUser(email, fullName) {
  const passwordHash = await bcrypt.hash("123456", 10);
  return prisma.user.upsert({
    where: { email },
    update: {
      fullName,
      roles: "STORE_MANAGER,SALES_STAFF",
      isActive: true,
      passwordHash
    },
    create: {
      email,
      fullName,
      roles: "STORE_MANAGER,SALES_STAFF",
      isActive: true,
      passwordHash
    }
  });
}

async function ensureActiveStoreAssignment(userId, storeId) {
  const now = new Date();
  const active = await prisma.orgAssignmentHistory.findFirst({
    where: {
      userId,
      roleType: "STORE_MANAGER",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }]
    },
    orderBy: { effectiveFrom: "desc" }
  });

  if (active?.storeId === storeId) return;

  if (active?.id) {
    await prisma.orgAssignmentHistory.update({
      where: { id: active.id },
      data: { effectiveTo: new Date(now.getTime() - 1000) }
    });
  }

  await prisma.orgAssignmentHistory.create({
    data: {
      userId,
      roleType: "STORE_MANAGER",
      scopeType: "STORE",
      storeId,
      effectiveFrom: new Date(now.getTime() - 60 * 1000),
      effectiveTo: null,
      note: "Auto-assigned for hard ownership verification"
    }
  });
}

async function ensureCustomer(code, name, phone, ownerStoreId) {
  return prisma.partner.upsert({
    where: { code },
    update: {
      name,
      phone,
      isCustomer: true,
      isSupplier: false,
      isCarrier: false,
      ownerStoreId
    },
    create: {
      code,
      name,
      phone,
      isCustomer: true,
      isSupplier: false,
      isCarrier: false,
      ownerStoreId,
      openingBalance: 0,
      netBalance: 0
    }
  });
}

async function ensureInventoryForStore(storeId) {
  const product = await prisma.product.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, defaultPrice: true }
  });

  if (!product) {
    throw new Error("Khong tim thay san pham active de test tao don hang");
  }

  await prisma.inventory.upsert({
    where: {
      productId_storeId: {
        productId: product.id,
        storeId
      }
    },
    update: { quantity: 100, reservedQuantity: 0 },
    create: {
      productId: product.id,
      storeId,
      quantity: 100,
      reservedQuantity: 0
    }
  });

  return { productId: product.id, unitPrice: Number(product.defaultPrice || 1000) };
}

async function login(email, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Login fail ${email}: ${body?.message || response.status}`);
  }
  return body?.data?.accessToken;
}

async function apiRequest(path, token, method = "GET", payload) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: payload ? JSON.stringify(payload) : undefined
  });

  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    body
  };
}

async function main() {
  const store1 = await ensureStore("STORE-HCM-01", "Cua hang HCM 01");
  const store2 = await ensureStore("STORE-HCM-02", "Cua hang HCM 02");

  const user1 = await ensureStoreUser("store@domain.com", "Quan ly Cua hang 01");
  const user2 = await ensureStoreUser("store2@domain.com", "Quan ly Cua hang 02");

  await ensureActiveStoreAssignment(user1.id, store1.id);
  await ensureActiveStoreAssignment(user2.id, store2.id);

  const customer1 = await ensureCustomer("OWN-S1", "Khach So Huu CH1", "0901000001", store1.id);
  const customer2 = await ensureCustomer("OWN-S2", "Khach So Huu CH2", "0902000002", store2.id);

  const { productId, unitPrice } = await ensureInventoryForStore(store1.id);

  const token1 = await login("store@domain.com", "123456");
  const token2 = await login("store2@domain.com", "123456");

  const list1 = await apiRequest("/partners", token1);
  const list2 = await apiRequest("/partners", token2);

  if (!list1.ok || !list2.ok) {
    throw new Error(`Khong tai duoc danh sach partners: ${list1.status}/${list2.status}`);
  }

  const customers1 = (list1.body?.data || []).filter((row) => row?.isCustomer);
  const customers2 = (list2.body?.data || []).filter((row) => row?.isCustomer);

  const user1HasOwn = customers1.some((row) => row.id === customer1.id);
  const user1HasForeign = customers1.some((row) => row.id === customer2.id);
  const user2HasOwn = customers2.some((row) => row.id === customer2.id);
  const user2HasForeign = customers2.some((row) => row.id === customer1.id);

  const detailForeign = await apiRequest(`/partners/${customer2.id}`, token1);

  const crossOrder = await apiRequest("/orders", token1, "POST", {
    storeId: store1.id,
    customerId: customer2.id,
    paymentMethod: "CASH",
    discountAmount: 0,
    paidAmount: 0,
    items: [
      {
        productId,
        quantity: 1,
        unitPrice,
        discountAmount: 0,
        isGift: false
      }
    ]
  });

  const checks = [
    { name: "User1 thay khach own store", pass: user1HasOwn },
    { name: "User1 khong thay khach store khac", pass: !user1HasForeign },
    { name: "User2 thay khach own store", pass: user2HasOwn },
    { name: "User2 khong thay khach store khac", pass: !user2HasForeign },
    { name: "User1 khong xem duoc chi tiet khach store2", pass: !detailForeign.ok },
    {
      name: "User1 khong tao duoc don hang cho khach store2",
      pass: !crossOrder.ok && String(crossOrder.body?.message || "").toLowerCase().includes("another store")
    }
  ];

  for (const check of checks) {
    console.log(`${check.pass ? "PASS" : "FAIL"} - ${check.name}`);
  }

  if (checks.some((check) => !check.pass)) {
    console.error("Hard ownership verification FAILED");
    process.exitCode = 1;
    return;
  }

  console.log("Hard ownership verification PASSED");
}

main()
  .catch((error) => {
    console.error("Verification error:", error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
