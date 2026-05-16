import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { config } from "../../config.js";
import { badRequest, ok, unauthorized } from "../../utils/http.js";
import { getPermissionsForRoles } from "../../security/rbac.js";
import { resolveRolesFromStorage } from "../../security/rbac-auth.js";
import { loginLimiter } from "../../middleware/rate-limit.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

router.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, parsed.error.flatten().formErrors.join(", ") || "Invalid payload");
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.isActive) {
    return unauthorized(res, "Invalid credentials");
  }

  const isValid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!isValid) {
    return unauthorized(res, "Invalid credentials");
  }

  const roles = await resolveRolesFromStorage(user.id, user.roles);
  const permissions = getPermissionsForRoles(roles);

  const signOptions: SignOptions = {
    expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"]
  };

  const token = jwt.sign(
    { sub: user.id, email: user.email, roles, permissions },
    config.jwtSecret,
    signOptions
  );

  return ok(res, {
    accessToken: token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles,
      permissions
    }
  }, "Login successful");
});

export default router;
