import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { unauthorized } from "../utils/http.js";
import { getPermissionsForRoles } from "../security/rbac.js";
import { getUserRolesIfActive } from "../security/rbac-auth.js";

export type JwtPayload = {
  sub: string;
  email: string;
  roles: string[];
  permissions?: string[];
};

export type AuthRequest = Request & {
  user?: JwtPayload;
};

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return unauthorized(res);
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    const roles = await getUserRolesIfActive(decoded.sub, decoded.roles);
    if (!roles) {
      return unauthorized(res, "User is inactive or not found");
    }

    const permissions = getPermissionsForRoles(roles);
    req.user = decoded;
    req.user.roles = roles;
    req.user.permissions = permissions;
    return next();
  } catch {
    return unauthorized(res, "Token invalid or expired");
  }
}
