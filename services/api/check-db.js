import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  try {
    // Test data retrieval
    const users = await prisma.user.findMany();
    const stores = await prisma.store.findMany();
    const products = await prisma.product.findMany();

    console.log('\n✅ Database Connection Successful!');
    console.log('\n📊 Current Data:');
    console.log(`  Users: ${users.length}`);
    console.log(`  Stores: ${stores.length}`);
    console.log(`  Products: ${products.length}`);

    if (users.length > 0) {
      console.log('\n👤 Sample User:');
      const user = users[0];
      console.log(`  ID: ${user.id}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Full Name: ${user.fullName}`);
      console.log(`  Created: ${user.createdAt}`);
    }

    if (stores.length > 0) {
      console.log('\n🏪 Sample Store:');
      const store = stores[0];
      console.log(`  ID: ${store.id}`);
      console.log(`  Code: ${store.code}`);
      console.log(`  Name: ${store.name}`);
      console.log(`  Is Warehouse: ${store.isWarehouse}`);
    }

    console.log('\n✨ Schema Mapping (Field names use snake_case in DB):');
    console.log('  User table columns: id, email, password_hash, full_name, is_active, roles, created_at, updated_at');
    console.log('  Store table columns: id, code, name, is_warehouse, manager_id, created_at');
    console.log('  Product table columns: id, sku, name, category_id, unit, min_price, max_price, default_price, special_price, reward_points, cost_price, image_url, is_active, created_at, updated_at');

    await prisma.$disconnect();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
