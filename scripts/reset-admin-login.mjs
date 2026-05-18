import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const passwordHash = await bcrypt.hash("123456", 10);

  const user = await prisma.user.upsert({
    where: { email: "admin@domain.com" },
    update: {
      fullName: "Quan tri tru so",
      passwordHash,
      isActive: true,
      roles: "SUPER_ADMIN,HEAD_MANAGER"
    },
    create: {
      email: "admin@domain.com",
      fullName: "Quan tri tru so",
      passwordHash,
      isActive: true,
      roles: "SUPER_ADMIN,HEAD_MANAGER"
    }
  });

  console.log(JSON.stringify({
    ok: true,
    email: user.email,
    isActive: user.isActive,
    roles: user.roles
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
