import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, forbidden, ok } from "../../utils/http.js";
import bcrypt from "bcryptjs";
import type { AuthRequest } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/authorize.js";
import {
  canAssignRoles,
  canManageTargetRoles,
  getAllRoles,
  normalizeRolesInput,
  serializeRoles
} from "../../security/rbac.js";
import { logRbacAudit } from "../../utils/audit.js";
import { syncUserRoleAssignments } from "../../security/rbac-storage.js";

const router = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  roles: z.union([z.string(), z.array(z.string())]).default("SALES_STAFF"),
  isActive: z.boolean().default(true),
  password: z.string().min(6)
});

const updateUserSchema = createUserSchema.extend({
  password: z.string().min(6).optional()
}).omit({ email: true });

const updateUserRolesSchema = z.object({
  roles: z.union([z.string(), z.array(z.string())])
});

function parseRoles(rawRoles: unknown) {
  const roleList = normalizeRolesInput(rawRoles, "SALES_STAFF");
  if (!roleList.length) {
    return { ok: false as const, message: "roles is required" };
  }
  return { ok: true as const, roleList };
}

// GET all users
router.get("/", requirePermission("users:read"), async (_req, res) => {
  try {
    const data = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        roles: true,
        isActive: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    });
    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch users: ${msg}`);
  }
});

// GET user by id
router.get("/:id", requirePermission("users:read"), async (req, res) => {
  try {
    const data = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        roles: true,
        isActive: true,
        createdAt: true
      }
    });
    if (!data) {
      return badRequest(res, "User not found");
    }
    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch user: ${msg}`);
  }
});

// POST create user
router.post("/", requirePermission("users:create"), async (req: AuthRequest, res) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid user payload");
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email }
    });
    if (existing) {
      return badRequest(res, "Email already in use");
    }

    const parsedRoles = parseRoles(parsed.data.roles);
    if (!parsedRoles.ok) {
      return badRequest(res, parsedRoles.message);
    }

    if (!canAssignRoles(req.user?.roles || [], parsedRoles.roleList)) {
      return forbidden(res, "You are not allowed to assign these roles");
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);

    const newUser = await prisma.user.create({
      data: {
        email: parsed.data.email,
        fullName: parsed.data.fullName,
        isActive: parsed.data.isActive,
        roles: serializeRoles(parsedRoles.roleList),
        passwordHash
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        roles: true,
        isActive: true,
        createdAt: true
      }
    });

    await logRbacAudit({
      actorUserId: req.user?.sub || "unknown",
      actorEmail: req.user?.email,
      actorRoles: req.user?.roles || [],
      action: "users.create",
      targetType: "user",
      targetId: newUser.id,
      targetDisplay: newUser.email,
      after: {
        fullName: newUser.fullName,
        roles: newUser.roles,
        isActive: newUser.isActive
      }
    });

    await syncUserRoleAssignments(newUser.id, newUser.roles);

    return created(res, newUser);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to create user: ${msg}`);
  }
});

// PUT update user
router.put("/:id", requirePermission("users:update"), async (req: AuthRequest, res) => {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid user payload");
    }

    const currentTarget = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, roles: true, fullName: true, isActive: true, email: true }
    });

    if (!currentTarget) {
      return badRequest(res, "User not found");
    }

    const currentTargetRoles = normalizeRolesInput(currentTarget.roles, "SALES_STAFF");
    if (!canManageTargetRoles(req.user?.roles || [], currentTargetRoles)) {
      return forbidden(res, "You are not allowed to modify this user");
    }

    const parsedRoles = parseRoles(parsed.data.roles);
    if (!parsedRoles.ok) {
      return badRequest(res, parsedRoles.message);
    }

    if (!canAssignRoles(req.user?.roles || [], parsedRoles.roleList)) {
      return forbidden(res, "You are not allowed to assign these roles");
    }

    const updateData: {
      fullName: string;
      isActive: boolean;
      roles: string;
      passwordHash?: string;
    } = {
      fullName: parsed.data.fullName,
      isActive: parsed.data.isActive,
      roles: serializeRoles(parsedRoles.roleList)
    };

    if (parsed.data.password) {
      updateData.passwordHash = await bcrypt.hash(parsed.data.password, 10);
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        roles: true,
        isActive: true
      }
    });

    await logRbacAudit({
      actorUserId: req.user?.sub || "unknown",
      actorEmail: req.user?.email,
      actorRoles: req.user?.roles || [],
      action: "users.update",
      targetType: "user",
      targetId: updated.id,
      targetDisplay: updated.email,
      before: {
        fullName: currentTarget.fullName,
        roles: currentTarget.roles,
        isActive: currentTarget.isActive
      },
      after: {
        fullName: updated.fullName,
        roles: updated.roles,
        isActive: updated.isActive
      }
    });

    await syncUserRoleAssignments(updated.id, updated.roles);

    return ok(res, updated);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update user: ${msg}`);
  }
});

// DELETE user (soft delete - set isActive to false)
router.delete("/:id", requirePermission("users:delete"), async (req: AuthRequest, res) => {
  try {
    const before = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, email: true, fullName: true, isActive: true, roles: true }
    });

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false },
      select: { id: true, email: true }
    });

    await logRbacAudit({
      actorUserId: req.user?.sub || "unknown",
      actorEmail: req.user?.email,
      actorRoles: req.user?.roles || [],
      action: "users.deactivate",
      targetType: "user",
      targetId: updated.id,
      targetDisplay: updated.email,
      before,
      after: { isActive: false }
    });

    return ok(res, { message: "User deactivated", user: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to delete user: ${msg}`);
  }
});

router.patch("/:id/roles", requirePermission("users:roles:manage"), async (req: AuthRequest, res) => {
  try {
    const parsed = updateUserRolesSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid role payload");
    }

    const parsedRoles = parseRoles(parsed.data.roles);
    if (!parsedRoles.ok) {
      return badRequest(res, parsedRoles.message);
    }

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, roles: true, email: true, fullName: true }
    });

    if (!target) {
      return badRequest(res, "User not found");
    }

    const targetRoles = normalizeRolesInput(target.roles, "SALES_STAFF");
    if (!canManageTargetRoles(req.user?.roles || [], targetRoles)) {
      return forbidden(res, "You are not allowed to manage target user roles");
    }

    if (!canAssignRoles(req.user?.roles || [], parsedRoles.roleList)) {
      return forbidden(res, "You are not allowed to assign these roles");
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        roles: serializeRoles(parsedRoles.roleList)
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        roles: true,
        isActive: true
      }
    });

    await logRbacAudit({
      actorUserId: req.user?.sub || "unknown",
      actorEmail: req.user?.email,
      actorRoles: req.user?.roles || [],
      action: "users.roles.manage",
      targetType: "user",
      targetId: updated.id,
      targetDisplay: updated.email,
      before: { roles: target.roles },
      after: { roles: updated.roles }
    });

    await syncUserRoleAssignments(updated.id, updated.roles);

    return ok(res, updated, "User roles updated");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update user roles: ${msg}`);
  }
});

router.get("/meta/roles", requirePermission("users:read"), (_req, res) => {
  return ok(res, getAllRoles());
});

export default router;
