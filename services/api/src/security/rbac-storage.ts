import { prisma } from "../prisma.js";
import {
  getAllRoles,
  normalizeRolesInput,
  ROLE_CATALOG,
  ROLE_PERMISSION_MAP
} from "./rbac.js";

type RbacStorageStats = {
  roles: number;
  permissions: number;
  rolePermissions: number;
  userRoles: number;
};

function toPermissionParts(permission: string) {
  if (permission === "*") {
    return { module: "system", action: "all" };
  }

  const [module = "system", action = "read"] = permission.split(":");
  return { module, action };
}

function getAllPermissionKeys() {
  const all = Object.values(ROLE_PERMISSION_MAP)
    .flat()
    .map((p) => String(p));

  return Array.from(new Set(all));
}

export async function syncUserRoleAssignments(userId: string, rawRoles: unknown) {
  const roles = normalizeRolesInput(rawRoles, "SALES_STAFF");

  await prisma.$transaction(async (tx) => {
    await tx.rbacUserRole.deleteMany({ where: { userId } });
    if (!roles.length) return;

    await tx.rbacUserRole.createMany({
      data: roles.map((roleKey) => ({ userId, roleKey })),
      skipDuplicates: true
    });
  });
}

export async function syncRbacCatalogToDb() {
  const roleKeys = getAllRoles();
  const permissionKeys = getAllPermissionKeys();

  await prisma.$transaction(async (tx) => {
    for (const roleKey of roleKeys) {
      const meta = ROLE_CATALOG[roleKey];
      await tx.rbacRole.upsert({
        where: { key: roleKey },
        update: {
          label: meta.label,
          description: meta.description,
          isSystem: true
        },
        create: {
          key: roleKey,
          label: meta.label,
          description: meta.description,
          isSystem: true
        }
      });
    }

    for (const permissionKey of permissionKeys) {
      const parts = toPermissionParts(permissionKey);
      await tx.rbacPermission.upsert({
        where: { key: permissionKey },
        update: {
          module: parts.module,
          action: parts.action
        },
        create: {
          key: permissionKey,
          module: parts.module,
          action: parts.action
        }
      });
    }

    await tx.rbacRolePermission.deleteMany({});
    for (const roleKey of roleKeys) {
      const permissions = (ROLE_PERMISSION_MAP[roleKey] || []).map((p) => String(p));
      if (!permissions.length) continue;

      await tx.rbacRolePermission.createMany({
        data: permissions.map((permissionKey) => ({ roleKey, permissionKey })),
        skipDuplicates: true
      });
    }
  });
}

export async function backfillUserRolesToDb() {
  const users = await prisma.user.findMany({
    select: { id: true, roles: true }
  });

  for (const user of users) {
    await syncUserRoleAssignments(user.id, user.roles);
  }
}

export async function initializeRbacStorage() {
  await syncRbacCatalogToDb();
  await backfillUserRolesToDb();
}

export async function getRbacStorageStats(): Promise<RbacStorageStats> {
  const [roles, permissions, rolePermissions, userRoles] = await Promise.all([
    prisma.rbacRole.count(),
    prisma.rbacPermission.count(),
    prisma.rbacRolePermission.count(),
    prisma.rbacUserRole.count()
  ]);

  return {
    roles,
    permissions,
    rolePermissions,
    userRoles
  };
}
