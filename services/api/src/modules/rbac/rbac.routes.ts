import { Router } from "express";
import { ok } from "../../utils/http.js";
import type { AuthRequest } from "../../middleware/auth.js";
import {
  getAllRoles,
  getPermissionTreeForDisplay,
  getPermissionsForRoles,
  getRoleCatalogForDisplay,
  getRolePermissionMatrix
} from "../../security/rbac.js";
import { requirePermission } from "../../middleware/authorize.js";
import { readRbacAudit } from "../../utils/audit.js";
import { getRbacStorageStats, syncRbacCatalogToDb } from "../../security/rbac-storage.js";

const router = Router();

router.get("/tree", requirePermission("rbac:read"), (_req, res) => {
  return ok(res, getPermissionTreeForDisplay());
});

router.get("/roles", requirePermission("rbac:read"), (_req, res) => {
  return ok(res, getRolePermissionMatrix());
});

router.get("/catalog", requirePermission("rbac:read"), (_req, res) => {
  return ok(res, {
    roles: getRoleCatalogForDisplay(),
    roleKeys: getAllRoles(),
    permissions: getPermissionTreeForDisplay(),
    matrix: getRolePermissionMatrix()
  });
});

router.get("/storage", requirePermission("rbac:read"), async (_req, res) => {
  const stats = await getRbacStorageStats();
  return ok(res, stats);
});

router.post("/storage/sync", requirePermission("rbac:manage"), async (_req, res) => {
  await syncRbacCatalogToDb();
  const stats = await getRbacStorageStats();
  return ok(res, stats, "RBAC storage synced");
});

router.get("/audit", requirePermission("rbac:read"), async (req, res) => {
  const data = await readRbacAudit({
    actor: typeof req.query.actor === "string" ? req.query.actor : "",
    action: typeof req.query.action === "string" ? req.query.action : "",
    from: typeof req.query.from === "string" ? req.query.from : "",
    to: typeof req.query.to === "string" ? req.query.to : "",
    page: Number(req.query.page || 1),
    pageSize: Number(req.query.pageSize || req.query.limit || 20)
  });
  return ok(res, data);
});

router.get("/me", (req: AuthRequest, res) => {
  const roles = req.user?.roles || [];
  const permissions = getPermissionsForRoles(roles);

  return ok(res, {
    roles,
    permissions,
    roleKeys: getAllRoles(),
    tree: getPermissionTreeForDisplay(),
    matrix: getRolePermissionMatrix()
  });
});

export default router;
