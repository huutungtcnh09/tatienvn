import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const targetEmail = "admin@domain.com";
  const disabledEmail = `disabled+${Date.now()}@invalid.local`;
  const passwordHash = await bcrypt.hash(`disabled-${Date.now()}`, 10);

  const existing = await prisma.user.findUnique({ where: { email: targetEmail } });

  if (!existing) {
    console.log(JSON.stringify({ ok: true, changed: false, reason: "user_not_found" }));
  } else {
    const updated = await prisma.user.update({
      where: { email: targetEmail },
      data: {
        email: disabledEmail,
        isActive: false,
        passwordHash,
        roles: ""
      }
    });

    console.log(JSON.stringify({
      ok: true,
      changed: true,
      oldEmail: targetEmail,
      newEmail: updated.email,
      isActive: updated.isActive
    }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
