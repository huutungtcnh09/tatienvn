import { PrismaClient } from "@prisma/client";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath });

const prisma = new PrismaClient();

async function main() {
  try {
    // Create category
    const existingCategories = await prisma.category.findMany({ where: { name: "Đồ uống" } });
    let category = existingCategories[0];
    if (!category) {
      category = await prisma.category.create({
        data: { name: "Đồ uống" }
      });
    }

    // Create store
    const store = await prisma.store.upsert({
      where: { code: "STORE-HCM-01" },
      update: { name: "Cửa hàng HCM 01" },
      create: { code: "STORE-HCM-01", name: "Cửa hàng HCM 01" }
    });

    // Create products
    const products = [];
    const productData = [
      { sku: "SP-001", name: "Nước cam ép", unit: "chai", defaultPrice: 25000 },
      { sku: "SP-002", name: "Nước dâu tây", unit: "chai", defaultPrice: 30000 },
      { sku: "SP-003", name: "Nước xoài", unit: "chai", defaultPrice: 28000 }
    ];

    for (const data of productData) {
      const product = await prisma.product.upsert({
        where: { sku: data.sku },
        update: {},
        create: {
          sku: data.sku,
          name: data.name,
          categoryId: category.id,
          unit: data.unit,
          defaultPrice: data.defaultPrice
        }
      });
      products.push(product);
      console.log(`✓ Product created: ${product.sku} - ${product.name}`);
    }

    // Create inventory
    for (const product of products) {
      await prisma.inventory.upsert({
        where: {
          productId_storeId: {
            productId: product.id,
            storeId: store.id
          }
        },
        update: { quantity: 100 },
        create: {
          productId: product.id,
          storeId: store.id,
          quantity: 100,
          reservedQuantity: 0
        }
      });
      console.log(`✓ Inventory created for ${product.sku}`);
    }

    console.log("\n✓ All seed data created successfully!");

  } catch (error) {
    console.error("Error seeding:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
