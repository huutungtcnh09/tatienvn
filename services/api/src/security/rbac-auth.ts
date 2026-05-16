import { prisma } from "../prisma.js";
import { normalizeRolesInput } from "./rbac.js";

export async function resolveRolesFromStorage(userId: string, fallbackRawRoles?: unknown) {
  const assignments = await prisma.rbacUserRole.findMany({
    where: { userId },
    select: { roleKey: true }
  });

  if (assignments.length) {
    return normalizeRolesInput(assignments.map((row) => row.roleKey), "SALES_STAFF");
  }

  return normalizeRolesInput(fallbackRawRoles, "SALES_STAFF");
}

export async function getUserRolesIfActive(userId: string, fallbackRawRoles?: unknown) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true, roles: true }
  });

  if (!user || !user.isActive) {
    return null;
  }

  const roles = await resolveRolesFromStorage(user.id, user.roles || fallbackRawRoles);
  return roles;
}
