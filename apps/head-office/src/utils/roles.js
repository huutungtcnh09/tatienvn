export const SYSTEM_ROLE_OPTIONS = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "HEAD_MANAGER", label: "Quản lý cấp cao" },
  { value: "ACCOUNTANT", label: "Kế toán" },
  { value: "MARKETING", label: "Marketing" },
  { value: "STORE_MANAGER", label: "Quản lý cửa hàng" },
  { value: "SALES_STAFF", label: "Nhân viên bán" },
  { value: "SALE_MOBILE", label: "Nhân viên di động" }
];

export const ORG_ROLE_OPTIONS = [
  { value: "STORE_MANAGER", label: "Quản lý cửa hàng" },
  { value: "STORE_SUPERVISOR", label: "Giám sát cửa hàng" },
  { value: "DEPUTY_MANAGER", label: "Phó quản lý cửa hàng" },
  { value: "CASHIER", label: "Thu ngân" },
  { value: "WAREHOUSE_STAFF", label: "Nhân viên kho" },
  { value: "PURCHASER", label: "Nhân viên thu mua" },
  { value: "CUSTOMER_SERVICE", label: "Chăm sóc khách hàng" },
  { value: "CEO", label: "Giám đốc điều hành (CEO)" },
  { value: "CHIEF_ACCOUNTANT", label: "Kế toán trưởng" }
];

export const ORG_ROLE_TO_SYSTEM_ROLE = {
  STORE_MANAGER: "STORE_MANAGER",
  STORE_SUPERVISOR: "SALES_STAFF",
  DEPUTY_MANAGER: "STORE_MANAGER",
  CASHIER: "SALES_STAFF",
  WAREHOUSE_STAFF: "SALES_STAFF",
  PURCHASER: "SALES_STAFF",
  CUSTOMER_SERVICE: "SALES_STAFF",
  CEO: "HEAD_MANAGER",
  CHIEF_ACCOUNTANT: "ACCOUNTANT"
};

export function getOrgRoleLabel(roleType) {
  const matched = ORG_ROLE_OPTIONS.find((item) => item.value === roleType);
  return matched?.label || roleType || "-";
}

export function getSystemRoleLabel(role) {
  const matched = SYSTEM_ROLE_OPTIONS.find((item) => item.value === role);
  return matched?.label || role || "-";
}

export function getSystemRolesLabel(rolesRaw) {
  const roles = String(rolesRaw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!roles.length) return "-";
  return roles.map((role) => getSystemRoleLabel(role)).join(", ");
}

export function getMappedSystemRoleFromOrgRole(roleType) {
  const mapped = ORG_ROLE_TO_SYSTEM_ROLE[roleType];
  return mapped || "-";
}
