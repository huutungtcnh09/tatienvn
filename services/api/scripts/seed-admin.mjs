import bcrypt from "bcryptjs";
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
    // Hash password: admin123
    const passwordHash = await bcrypt.hash("admin123", 10);

    const admin = await prisma.user.upsert({
      where: { email: "admin@domain.com" },
      update: { passwordHash },
      create: {
        email: "admin@domain.com",
        fullName: "Admin",
        passwordHash,
        roles: "SUPER_ADMIN,HEAD_MANAGER,SALE_MOBILE"
      }
    });

    console.log("✓ Admin account created/updated:", admin.email);

    // Also create superadmin with different email
    const superAdmin = await prisma.user.upsert({
      where: { email: "superadmin@tatien.vn" },
      update: {},
      create: {
        email: "superadmin@tatien.vn",
        fullName: "Super Admin",
        passwordHash,
        roles: "SUPER_ADMIN"
      }
    });

    console.log("✓ Super admin account created:", superAdmin.email);

  } catch (error) {
    console.error("Error seeding database:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
