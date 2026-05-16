import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth.js";
import { forbidden, unauthorized } from "../utils/http.js";
import { hasPermission } from "../security/rbac.js";

export function requirePermission(permission: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return unauthorized(res);
    }

    const granted = req.user.permissions || [];
    const ok = granted.includes("*") || granted.includes(permission) || hasPermission(req.user.roles || [], permission);
    if (!ok) {
      return forbidden(res, `Missing permission: ${permission}`);
    }

    return next();
  };
}

export function requireAnyPermission(permissions: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return unauthorized(res);
    }

    const granted = req.user.permissions || [];
    const ok = permissions.some((permission) =>
      granted.includes("*") || granted.includes(permission) || hasPermission(req.user?.roles || [], permission)
    );
    if (!ok) {
      return forbidden(res, `Missing one of required permissions: ${permissions.join(", ")}`);
    }

    return next();
  };
}
