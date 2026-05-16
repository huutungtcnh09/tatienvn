export const PERMISSION_TREE = {
  dashboard: ["dashboard:read"],
  users: ["users:read", "users:create", "users:update", "users:delete", "users:roles:manage"],
  stores: ["stores:read", "stores:create", "stores:update", "stores:delete"],
  categories: ["categories:read", "categories:create", "categories:update", "categories:delete"],
  "business-areas": ["business-areas:read", "business-areas:create", "business-areas:update", "business-areas:delete"],
  partners: ["partners:read", "partners:create", "partners:update", "partners:delete", "partners:aging:read"],
  products: ["products:read", "products:create", "products:update", "products:delete", "products:inventory:read", "products:price-list:update", "products:bulk-import"],
  orders: ["orders:read", "orders:create", "orders:update", "orders:cancel", "orders:refund"],
  receipts: ["receipts:read", "receipts:create", "receipts:apply-order", "receipts:void"],
  purchases: ["purchases:read", "purchases:create", "purchases:pay", "purchases:void"],
  rbac: ["rbac:read", "rbac:manage"],
  consultations: ["consultations:read", "consultations:write"],
  articles: ["articles:read", "articles:write"]
} as const;

export type PermissionModule = keyof typeof PERMISSION_TREE;
export type Permission = (typeof PERMISSION_TREE)[PermissionModule][number] | "*";

export const ROLE_CATALOG = {
  SUPER_ADMIN: {
    label: "Super Admin",
    description: "Toan quyen he thong"
  },
  HEAD_MANAGER: {
    label: "Quan ly tru so",
    description: "Dieu hanh va kiem soat hoat dong toan he thong"
  },
  ACCOUNTANT: {
    label: "Ke toan",
    description: "Quan ly cong no, thu chi, doi soat"
  },
  MARKETING: {
    label: "Marketing",
    description: "Theo doi chien dich, hieu qua kenh ban"
  },
  STORE_MANAGER: {
    label: "Quan ly cua hang",
    description: "Van hanh cua hang, don hang, ton kho, mua hang"
  },
  SALES_STAFF: {
    label: "Nhan vien ban hang",
    description: "Ban hang, tao don, thu tien co ban"
  },
  SALE_MOBILE: {
    label: "Nhan vien sale di dong",
    description: "Tao don nhanh, theo doi khach hang tren mobile"
  }
} as const;

export type SystemRole = keyof typeof ROLE_CATALOG;

const allPermissions = Object.values(PERMISSION_TREE).flat() as string[];
const allRoles = Object.keys(ROLE_CATALOG) as SystemRole[];

export const ROLE_PERMISSION_MAP: Record<string, Permission[]> = {
  SUPER_ADMIN: ["*"],
  HEAD_MANAGER: [
    "dashboard:read",
    "users:read",
    "users:create",
    "users:update",
    "users:roles:manage",
    "stores:read",
    "stores:create",
    "stores:update",
    "categories:read",
    "categories:create",
    "categories:update",
      "business-areas:read",
      "business-areas:create",
      "business-areas:update",
      "business-areas:delete",
    "partners:read",
    "partners:create",
    "partners:update",
    "partners:aging:read",
    "products:read",
    "products:create",
    "products:update",
    "products:inventory:read",
    "products:price-list:update",
    "products:bulk-import",
    "orders:read",
    "orders:create",
    "orders:update",
    "orders:cancel",
    "orders:refund",
    "receipts:read",
    "receipts:create",
    "receipts:apply-order",
    "receipts:void",
    "purchases:read",
    "purchases:create",
    "purchases:pay",
    "purchases:void",
    "rbac:read",
    "consultations:read",
    "consultations:write",
    "articles:read",
    "articles:write"
  ],
  ACCOUNTANT: [
    "dashboard:read",
    "products:read",
    "products:bulk-import",
    "partners:read",
    "partners:aging:read",
    "orders:read",
    "receipts:read",
    "receipts:create",
    "receipts:apply-order",
    "receipts:void",
    "purchases:read",
    "purchases:pay",
    "purchases:void"
  ],
  MARKETING: ["dashboard:read", "partners:read", "products:read", "orders:read", "consultations:read", "consultations:write", "articles:read", "articles:write"],
  STORE_MANAGER: [
        "business-areas:create",
        "business-areas:update",
      "business-areas:read",
    "dashboard:read",
    "users:read",
    "stores:read",
    "categories:read",
    "categories:create",
    "categories:update",
    "partners:read",
    "partners:create",
    "partners:update",
    "partners:aging:read",
    "products:read",
    "products:create",
    "products:update",
    "products:inventory:read",
    "products:price-list:update",
    "products:bulk-import",
    "orders:read",
    "orders:create",
    "orders:update",
    "orders:cancel",
    "orders:refund",
    "receipts:read",
    "receipts:create",
    "receipts:apply-order",
    "receipts:void",
    "purchases:read",
    "purchases:create",
    "purchases:pay"
  ],
  SALES_STAFF: [
    "stores:read",
    "partners:read",
    "partners:create",
    "partners:aging:read",
    "products:read",
    "products:inventory:read",
    "products:price-list:update",
    "orders:read",
    "orders:create",
    "receipts:read",
    "receipts:create"
  ],
  SALE_MOBILE: [
    "dashboard:read",
    "partners:read",
    "products:read",
    "products:price-list:update",
    "stores:read",
    "orders:read",
    "orders:create"
  ]
};

export function getAllPermissions() {
  return [...allPermissions];
}

export function getAllRoles() {
  return [...allRoles];
}

export function isValidRole(role: string): role is SystemRole {
  return allRoles.includes(role as SystemRole);
}

export function normalizeRolesInput(input: unknown, fallbackRole: SystemRole = "SALES_STAFF") {
  const rawList = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];

  const normalized = rawList
    .map((r) => String(r).trim().toUpperCase())
    .filter((r): r is SystemRole => isValidRole(r));

  const deduped = Array.from(new Set(normalized));
  if (!deduped.length) {
    return [fallbackRole];
  }

  return deduped;
}

export function serializeRoles(roles: string[]) {
  return normalizeRolesInput(roles).join(",");
}

export function canManageTargetRoles(actorRoles: string[], targetRoles: string[]) {
  const actor = normalizeRolesInput(actorRoles, "SALES_STAFF");
  const target = normalizeRolesInput(targetRoles, "SALES_STAFF");

  const actorIsSuperAdmin = actor.includes("SUPER_ADMIN");
  const targetHasSuperAdmin = target.includes("SUPER_ADMIN");

  if (!actorIsSuperAdmin && targetHasSuperAdmin) {
    return false;
  }

  return true;
}

export function canAssignRoles(actorRoles: string[], assignedRoles: string[]) {
  const actor = normalizeRolesInput(actorRoles, "SALES_STAFF");
  const assigned = normalizeRolesInput(assignedRoles, "SALES_STAFF");

  const actorIsSuperAdmin = actor.includes("SUPER_ADMIN");
  const assignSuperAdmin = assigned.includes("SUPER_ADMIN");

  if (!actorIsSuperAdmin && assignSuperAdmin) {
    return false;
  }

  return true;
}

export function getPermissionsForRoles(roles: string[]) {
  const validRoles = normalizeRolesInput(roles, "SALES_STAFF");
  const result = new Set<string>();

  for (const role of validRoles) {
    const roleKey = role.trim().toUpperCase();
    const permissions = ROLE_PERMISSION_MAP[roleKey] || [];

    if (permissions.includes("*")) {
      result.add("*");
      allPermissions.forEach((p) => result.add(p));
      continue;
    }

    permissions.forEach((p) => result.add(p));
  }

  return Array.from(result);
}

export function hasPermission(roles: string[], requiredPermission: string) {
  const granted = getPermissionsForRoles(roles);
  return granted.includes("*") || granted.includes(requiredPermission);
}

export function getPermissionTreeForDisplay() {
  return Object.entries(PERMISSION_TREE).map(([module, permissions]) => ({
    module,
    permissions
  }));
}

export function getRolePermissionMatrix() {
  return ROLE_PERMISSION_MAP;
}

export function getRoleCatalogForDisplay() {
  return Object.entries(ROLE_CATALOG).map(([role, meta]) => ({
    role,
    label: meta.label,
    description: meta.description,
    permissions: ROLE_PERMISSION_MAP[role] || []
  }));
}
