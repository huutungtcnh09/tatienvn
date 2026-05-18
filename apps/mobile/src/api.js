const API_ROOT = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:4000"
).replace(/\/$/, "");

const API_BASE = `${API_ROOT}/api`;

function normalizeArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

function readApiMessage(body, fallbackMessage) {
  if (body && typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }
  return fallbackMessage;
}

async function request(path, token, options = {}) {
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  if (!hasContentType && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    }
    throw new Error(readApiMessage(body, "Không thể kết nối API"));
  }

  return body?.data ?? body;
}

export async function loginWithApi(email, password) {
  const payload = await request("/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

  return {
    token: payload?.accessToken || "",
    user: payload?.user || null
  };
}

export async function updateProductWithApi(token, productId, payload) {
  return request(`/products/${productId}`, token, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function createProductWithApi(token, payload) {
  return request("/products", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function uploadProductImageWithApi(token, productId, file, options = {}) {
  const query = new URLSearchParams();
  if (options.makeDefault !== undefined) {
    query.set("makeDefault", String(Boolean(options.makeDefault)));
  }
  if (options.showOnCorporate !== undefined) {
    query.set("showOnCorporate", String(Boolean(options.showOnCorporate)));
  }

  const formData = new FormData();
  formData.append("image", file);

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request(`/products/${encodeURIComponent(productId)}/image${suffix}`, token, {
    method: "POST",
    body: formData
  });
}

export async function createCustomerWithApi(token, payload) {
  return request("/partners", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updatePartnerWithApi(token, partnerId, payload) {
  return request(`/partners/${encodeURIComponent(partnerId)}`, token, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function getCustomerNotes(token, customerId) {
  const result = await request(`/partners/${encodeURIComponent(customerId)}/notes`, token);
  return Array.isArray(result) ? result : (result?.data ?? []);
}

export async function createCustomerNote(token, customerId, content, isStarred = false) {
  return request(`/partners/${encodeURIComponent(customerId)}/notes`, token, {
    method: "POST",
    body: JSON.stringify({ content, isStarred })
  });
}

export async function getPartnerTransactions(token, partnerId) {
  if (!partnerId) return [];
  const result = await request(`/partners/${encodeURIComponent(partnerId)}/transactions`, token);
  return Array.isArray(result) ? result : (result?.data ?? []);
}

export async function getStoreWatchlist(token, storeId) {
  if (!storeId) return [];
  const result = await request(`/partners/watchlist/store/${encodeURIComponent(storeId)}`, token);
  return Array.isArray(result) ? result : (result?.data ?? []);
}

export async function getStorePositions(token, storeId) {
  if (!storeId) return [];
  const result = await request(`/org-positions?storeId=${encodeURIComponent(storeId)}&isActive=true`, token);
  return normalizeArray(result);
}

export async function getStaffKpiByPosition(token, options = {}) {
  const params = new URLSearchParams();
  params.set("groupBy", "position");
  params.set("roleDimension", "sales_person");
  params.set("timePeriod", options.timePeriod || "this-month");
  if (options.positionId) {
    params.set("positionId", options.positionId);
  }
  const result = await request(`/dashboard/staff-kpi?${params.toString()}`, token);
  return normalizeArray(result);
}

export async function getSuppliersWithApi(token, { search = "", selectedStoreId = "" } = {}) {
  const params = new URLSearchParams();
  params.set("pageSize", "500");
  params.set("page", "1");
  if (search.trim()) params.set("search", search.trim());
  const result = await request(`/partners?${params.toString()}`, token);
  const allRows = normalizeArray(result?.data ?? result);
  const rows = allRows.filter((p) => {
    if (!p?.isSupplier) return false;
    if (selectedStoreId && p.ownerStoreId && String(p.ownerStoreId) !== selectedStoreId) return false;
    return true;
  });
  return rows;
}

export async function getSupplierPurchasesWithApi(token, supplierId, { fromDate, toDate, storeId } = {}) {
  if (!supplierId) return [];
  const params = new URLSearchParams();
  params.set("supplierId", supplierId);
  if (fromDate) params.set("fromDate", fromDate);
  if (toDate) params.set("toDate", toDate);
  if (storeId) params.set("storeId", storeId);
  const result = await request(`/purchases?${params.toString()}`, token);
  return normalizeArray(result);
}

export async function getMaintenanceStatus(token) {
  const result = await request("/system/maintenance", token);
  return { active: Boolean(result?.active), message: String(result?.message || "") };
}

export async function setMaintenanceMode(token, active, message) {
  const body = { active };
  if (message !== undefined) body.message = message;
  const result = await request("/system/maintenance", token, {
    method: "POST",
    body: JSON.stringify(body)
  });
  return { active: Boolean(result?.active), message: String(result?.message || "") };
}

export async function getMobileOrders(token, selectedStoreId = "", options = {}) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - (options.days ?? 90));
  const fromDate = toIsoDate(from);
  const toDate = toIsoDate(today);
  const result = await request(withDateRange("/orders", fromDate, toDate), token);
  const orders = normalizeArray(result);
  return selectedStoreId
    ? orders.filter((order) => String(order?.storeId || "") === selectedStoreId)
    : orders;
}

export async function getMobileReceipts(token, selectedStoreId = "", options = {}) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - (options.days ?? 90));
  const fromDate = toIsoDate(from);
  const toDate = toIsoDate(today);
  const result = await request(withDateRange("/receipts", fromDate, toDate), token);
  const receipts = normalizeArray(result);
  return selectedStoreId
    ? receipts.filter((receipt) => String(receipt?.storeId || "") === selectedStoreId)
    : receipts;
}

function withStoreQuery(path, storeId) {
  if (!storeId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}storeId=${encodeURIComponent(storeId)}`;
}

function toIsoDate(value) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function withDateRange(path, fromDate, toDate) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`;
}

function filterByStore(orders, partners, selectedStoreId) {
  if (!selectedStoreId) {
    return {
      ordersByStore: orders,
      customersByStore: partners.filter((partner) => Boolean(partner?.isCustomer))
    };
  }

  const ordersByStore = orders.filter((order) => String(order?.storeId || "") === selectedStoreId);
  const customersByStore = partners.filter((partner) => {
    if (!partner?.isCustomer) return false;
    return String(partner?.ownerStoreId || "") === selectedStoreId;
  });

  return { ordersByStore, customersByStore };
}

function toSummary({ products, customersByStore, ordersByStore, promotions, overview }) {
  const customersCount = Number(overview.customersCount ?? customersByStore.length);
  const ordersCount = Number(overview.ordersCount ?? ordersByStore.length);
  const revenue = Number(overview.revenue ?? 0);
  const profit = Number(overview.profit ?? 0);
  const pendingOrders = ordersByStore.filter((order) =>
    ["DRAFT", "CONFIRMED", "PROCESSING"].includes(String(order?.status))
  ).length;
  const promotionCount = promotions.length;
  const kpiPercent = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;

  return {
    menuBadges: {
      products: products.length,
      customers: customersCount,
      overview: ordersCount,
      more: pendingOrders + promotionCount
    },
    highlights: {
      productsCount: products.length,
      customersCount,
      ordersCount,
      revenue,
      profit,
      promotionCount,
      pendingOrders,
      kpiPercent
    }
  };
}

export async function getBusinessAreasDashboard(token, timePreset = "this-month") {
  const validPresets = ["today", "this-month", "this-quarter", "this-year", "last-year"];
  const preset = validPresets.includes(timePreset) ? timePreset : "this-month";
  const result = await request(`/business-areas/dashboard/overview?timePreset=${preset}`, token);
  return result?.data ?? result ?? {};
}

export async function getMobileData(token, selectedStoreId = "") {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 365);
  const fromDate = toIsoDate(from);
  const toDate = toIsoDate(today);

  const [storesResult, categoriesResult, productsResult, partnersResult, overviewResult, ordersResult, receiptsResult, purchasesResult, promotionsResult, accountOwnerPositionsResult] = await Promise.allSettled([
    request("/stores", token),
    request("/categories", token),
    request("/products?pageSize=200", token),
    request("/partners?pageSize=500", token),
    request(withStoreQuery("/dashboard/overview?overviewTracking=all&timePeriod=this-year", selectedStoreId), token),
    request(withDateRange("/orders", fromDate, toDate), token),
    request(withDateRange("/receipts", fromDate, toDate), token),
    request(withDateRange("/purchases", fromDate, toDate), token),
    request("/promotions", token),
    request(withStoreQuery("/org-positions?roleType=CUSTOMER_SERVICE&isActive=true", selectedStoreId), token)
  ]);

  const stores = storesResult.status === "fulfilled" ? normalizeArray(storesResult.value) : [];
  const categories = categoriesResult.status === "fulfilled" ? normalizeArray(categoriesResult.value) : [];
  const products = productsResult.status === "fulfilled" ? normalizeArray(productsResult.value) : [];
  const partners = partnersResult.status === "fulfilled" ? normalizeArray(partnersResult.value) : [];
  const overview = overviewResult.status === "fulfilled" ? overviewResult.value || {} : {};
  const orders = ordersResult.status === "fulfilled" ? normalizeArray(ordersResult.value) : [];
  const receipts = receiptsResult.status === "fulfilled" ? normalizeArray(receiptsResult.value) : [];
  const purchases = purchasesResult.status === "fulfilled" ? normalizeArray(purchasesResult.value) : [];
  const promotions = promotionsResult.status === "fulfilled" ? normalizeArray(promotionsResult.value) : [];
  const accountOwnerPositions = accountOwnerPositionsResult.status === "fulfilled"
    ? normalizeArray(accountOwnerPositionsResult.value)
    : [];

  const fallbackStoreId = stores.find((store) => !store?.isWarehouse)?.id || stores[0]?.id || "";
  const resolvedStoreId = selectedStoreId || fallbackStoreId;
  let inventory = [];
  if (resolvedStoreId) {
    try {
      const inventoryResult = await request(`/products/inventory/${resolvedStoreId}`, token);
      inventory = normalizeArray(inventoryResult);
    } catch {
      inventory = [];
    }
  }

  const { ordersByStore, customersByStore } = filterByStore(orders, partners, selectedStoreId);
  const receiptsByStore = selectedStoreId
    ? receipts.filter((receipt) => String(receipt?.storeId || "") === selectedStoreId)
    : receipts;
  const purchasesByStore = selectedStoreId
    ? purchases.filter((purchase) => String(purchase?.storeId || "") === selectedStoreId)
    : purchases;

  const summary = toSummary({
    products,
    customersByStore,
    ordersByStore,
    promotions,
    overview
  });

  return {
    stores,
    categories,
    products,
    overview,
    inventory,
    customers: customersByStore,
    orders: ordersByStore,
    receipts: receiptsByStore,
    purchases: purchasesByStore,
    promotions,
    accountOwnerPositions,
    summary,
    refreshedAt: Date.now()
  };
}
