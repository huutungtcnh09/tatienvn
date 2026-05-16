const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const API_BASE = `${API_BASE_URL}/api`;

export async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!res.ok) {
    throw new Error("Đăng nhập thất bại");
  }

  return res.json();
}

export async function getOverview(token, filters = {}) {
  const params = new URLSearchParams();
  if (filters.timePeriod) params.append("timePeriod", filters.timePeriod);
  if (filters.productType) params.append("productType", filters.productType);
  if (filters.categoryId) params.append("categoryId", filters.categoryId);
  if (filters.storeId) params.append("storeId", filters.storeId);
  if (filters.overviewTracking) params.append("overviewTracking", filters.overviewTracking);
  
  const queryString = params.toString();
  const url = `${API_BASE}/dashboard/overview${queryString ? `?${queryString}` : ""}`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được dashboard");
  return res.json();
}

export async function getPromotions(token, options = {}) {
  const qs = new URLSearchParams();
  if (options.all) qs.set("all", "1");
  if (options.type) qs.set("type", String(options.type));
  if (options.fromDate) qs.set("fromDate", String(options.fromDate));
  if (options.toDate) qs.set("toDate", String(options.toDate));
  if (options.isActive === true) qs.set("isActive", "true");
  if (options.isActive === false) qs.set("isActive", "false");

  const res = await fetch(`${API_BASE}/promotions${qs.toString() ? `?${qs.toString()}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Không tải được chương trình khuyến mại";
    throw new Error(message);
  }

  return body;
}

export async function createPromotion(token, payload) {
  const res = await fetch(`${API_BASE}/promotions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Tạo chương trình khuyến mại thất bại";
    throw new Error(message);
  }

  return body;
}

export async function updatePromotion(token, id, payload) {
  const res = await fetch(`${API_BASE}/promotions/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Cập nhật chương trình khuyến mại thất bại";
    throw new Error(message);
  }

  return body;
}

export async function deletePromotion(token, id) {
  const res = await fetch(`${API_BASE}/promotions/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Ngưng áp dụng chương trình khuyến mại thất bại";
    throw new Error(message);
  }

  return body;
}

// ==================== USERS ====================
export async function getUsers(token) {
  const res = await fetch(`${API_BASE}/users`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách người dùng");
  return res.json();
}

export async function getUserById(token, id) {
  const res = await fetch(`${API_BASE}/users/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được thông tin người dùng");
  return res.json();
}

export async function createUser(token, payload) {
  const res = await fetch(`${API_BASE}/users`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Tạo người dùng thất bại");
  return res.json();
}

export async function updateUser(token, id, payload) {
  const res = await fetch(`${API_BASE}/users/${id}`, {
    method: "PUT",
    headers: { 
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Cập nhật người dùng thất bại");
  return res.json();
}

export async function deleteUser(token, id) {
  const res = await fetch(`${API_BASE}/users/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Xóa người dùng thất bại");
  return res.json();
}

// ==================== STORES ====================
export async function getStores(token) {
  const res = await fetch(`${API_BASE}/stores`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách cửa hàng");
  return res.json();
}

export async function getStoreById(token, id) {
  const res = await fetch(`${API_BASE}/stores/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được thông tin cửa hàng");
  return res.json();
}

export async function createStore(token, payload) {
  const res = await fetch(`${API_BASE}/stores`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Tạo cửa hàng thất bại");
  return res.json();
}

export async function updateStore(token, id, payload) {
  const res = await fetch(`${API_BASE}/stores/${id}`, {
    method: "PUT",
    headers: { 
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Cập nhật cửa hàng thất bại");
  return res.json();
}

export async function assignStoreStaff(token, storeId, userId) {
  const res = await fetch(`${API_BASE}/stores/${storeId}/staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ userId })
  });
  if (!res.ok) throw new Error("Gán nhân viên cho cửa hàng thất bại");
  return res.json();
}

export async function removeStoreStaff(token, storeId, userId) {
  const res = await fetch(`${API_BASE}/stores/${storeId}/staff/${userId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Gỡ nhân viên khỏi cửa hàng thất bại");
  return res.json();
}

export async function deleteStore(token, id) {
  const res = await fetch(`${API_BASE}/stores/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Xóa cửa hàng thất bại");
  return res.json();
}

// ==================== CATEGORIES ====================
export async function getCategories(token) {
  const res = await fetch(`${API_BASE}/categories`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách danh mục");
  return res.json();
}

async function readApiErrorMessage(res, fallbackMessage) {
  const body = await res.json().catch(() => null);
  if (body && typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }
  return fallbackMessage;
}

export async function createCategory(token, payload) {
  const res = await fetch(`${API_BASE}/categories`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Tạo danh mục thất bại"));
  return res.json();
}

export async function updateCategory(token, id, payload) {
  const res = await fetch(`${API_BASE}/categories/${id}`, {
    method: "PUT",
    headers: { 
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Cập nhật danh mục thất bại"));
  return res.json();
}

export async function deleteCategory(token, id) {
  const res = await fetch(`${API_BASE}/categories/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Xóa danh mục thất bại"));
  return res.json();
}

// ==================== PRODUCTS ====================
export async function getProducts(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/products${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách sản phẩm");
  const body = await res.json().catch(() => null);
  return body?.data ?? body;
}

export async function getProductById(token, id) {
  const res = await fetch(`${API_BASE}/products/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được thông tin sản phẩm");
  return res.json();
}

export async function createProduct(token, payload) {
  const res = await fetch(`${API_BASE}/products`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Tạo sản phẩm thất bại"));
  return res.json();
}

export async function updateProduct(token, id, payload) {
  const res = await fetch(`${API_BASE}/products/${id}`, {
    method: "PUT",
    headers: { 
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Cập nhật sản phẩm thất bại"));
  return res.json();
}

export async function updateProductConsultation(token, id, payload) {
  const res = await fetch(`${API_BASE}/products/${id}/consultation`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Cập nhật thông tin tư vấn thất bại");
  return res.json();
}

export async function updateProductStockCost(token, id, payload) {
  const res = await fetch(`${API_BASE}/products/${id}/stock-cost`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Cập nhật tồn kho/giá vốn thất bại");
  return res.json();
}

export async function updateProductOverviewTracking(token, id, isTrackedInOverview) {
  const res = await fetch(`${API_BASE}/products/${id}/overview-tracking`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ isTrackedInOverview })
  });
  if (!res.ok) throw new Error("Cập nhật cờ theo dõi tổng quan thất bại");
  return res.json();
}

export async function updateProductCorporateVisibility(token, id, isVisibleOnCorporate) {
  const res = await fetch(`${API_BASE}/products/${id}/corporate-visibility`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ isVisibleOnCorporate: Boolean(isVisibleOnCorporate) })
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Cập nhật hiển thị Corporate thất bại"));
  return res.json();
}

export async function updateProductActiveStatus(token, id, isActive) {
  const res = await fetch(`${API_BASE}/products/${id}/active-status`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ isActive: Boolean(isActive) })
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Cập nhật trạng thái hoạt động thất bại"));
  return res.json();
}

export async function bulkImportProducts(token, rows, options = {}) {
  const dryRun = Boolean(options?.dryRun);
  const res = await fetch(`${API_BASE}/products/bulk-import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ rows, dryRun })
  });
  if (!res.ok) {
    let msg = "Nhập sản phẩm hàng loạt thất bại";
    try { const j = await res.json(); msg = j?.message || j?.error || msg; } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

// ==================== PARTNERS (CUSTOMERS) ====================
export async function getPartners(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/partners${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách khách hàng");
  const body = await res.json().catch(() => null);
  return body?.data ?? body;
}

export async function getPartnerById(token, id) {
  const res = await fetch(`${API_BASE}/partners/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được thông tin khách hàng");
  return res.json();
}

export async function createPartner(token, payload) {
  const res = await fetch(`${API_BASE}/partners`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Tạo khách hàng thất bại"));
  return res.json();
}

export async function updatePartner(token, id, payload) {
  const res = await fetch(`${API_BASE}/partners/${id}`, {
    method: "PUT",
    headers: { 
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Cập nhật khách hàng thất bại");
  return res.json();
}

export async function getPartnerAging(token, id) {
  const res = await fetch(`${API_BASE}/partners/${id}/aging`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được tuổi nợ khách hàng");
  return res.json();
}

export async function getPartnerTransactions(token, id) {
  const res = await fetch(`${API_BASE}/partners/${id}/transactions`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được nhật ký giao dịch");
  return res.json();
}

export async function getPartnerAnalytics(token, id, period = "month") {
  const res = await fetch(`${API_BASE}/partners/${id}/analytics?period=${period}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được phân tích khách hàng");
  return res.json();
}

export async function getBusinessAreas(token) {
  const res = await fetch(`${API_BASE}/business-areas`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách khu vực kinh doanh");
  return res.json();
}

export async function getBusinessAreasDashboard(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.timePreset) qs.set("timePreset", params.timePreset);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/business-areas/dashboard/overview${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được dashboard khu vực kinh doanh");
  return res.json();
}

export async function createBusinessArea(token, payload) {
  const res = await fetch(`${API_BASE}/business-areas`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error?.message || "Không thể tạo khu vực kinh doanh");
  }
  return res.json();
}

export async function updateBusinessArea(token, id, payload) {
  const res = await fetch(`${API_BASE}/business-areas/${id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error?.message || "Không thể cập nhật khu vực kinh doanh");
  }
  return res.json();
}

export async function deleteBusinessArea(token, id) {
  const res = await fetch(`${API_BASE}/business-areas/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error?.message || "Không thể xóa khu vực kinh doanh");
  }
  return res.json();
}

// ==================== PRODUCTS (extended) ====================
export async function getProductAnalytics(token, id) {
  const res = await fetch(`${API_BASE}/products/${id}/analytics`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được phân tích sản phẩm");
  return res.json();
}

export async function getProductsOverview(token) {
  const res = await fetch(`${API_BASE}/products/overview/stats`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được tổng quan sản phẩm");
  return res.json();
}

export async function getInventoryByStore(token, storeId) {
  const res = await fetch(`${API_BASE}/products/inventory/${storeId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được tồn kho theo cửa hàng");
  return res.json();
}

// ==================== ORDERS ====================
export async function getOrders(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.fromDate) qs.set("fromDate", params.fromDate);
  if (params.toDate) qs.set("toDate", params.toDate);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/orders${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách đơn hàng");
  const body = await res.json().catch(() => null);
  return body?.data ?? body;
}

export async function getOrderById(token, id) {
  const res = await fetch(`${API_BASE}/orders/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được chi tiết đơn hàng");
  return res.json();
}

export async function updateOrderStatus(token, id, payload) {
  const res = await fetch(`${API_BASE}/orders/${id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Cập nhật trạng thái đơn hàng thất bại");
  return res.json();
}

// ==================== RECEIPTS ====================
export async function getReceipts(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.fromDate) qs.set("fromDate", params.fromDate);
  if (params.toDate) qs.set("toDate", params.toDate);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/receipts${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách phiếu thu");
  const body = await res.json().catch(() => null);
  return body?.data ?? body;
}

// ==================== PURCHASES ====================
export async function getPurchases(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.supplierId) qs.set("supplierId", params.supplierId);
  if (params.storeId) qs.set("storeId", params.storeId);
  if (params.status) qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  if (params.fromDate) qs.set("fromDate", params.fromDate);
  if (params.toDate) qs.set("toDate", params.toDate);

  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/purchases${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách mua hàng");
  return res.json();
}

export async function getPurchasesOverview(token) {
  const res = await fetch(`${API_BASE}/purchases/overview`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được tổng quan mua hàng");
  return res.json();
}

export async function getPurchaseCashFlowReport(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.supplierId) qs.set("supplierId", params.supplierId);
  if (params.storeId) qs.set("storeId", params.storeId);
  if (params.fromDate) qs.set("fromDate", params.fromDate);
  if (params.toDate) qs.set("toDate", params.toDate);

  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/purchases/cash-flow${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được báo cáo dòng tiền mua hàng");
  return res.json();
}

export async function getPurchaseReconciliationReport(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.supplierId) qs.set("supplierId", params.supplierId);
  if (params.storeId) qs.set("storeId", params.storeId);
  if (params.fromDate) qs.set("fromDate", params.fromDate);
  if (params.toDate) qs.set("toDate", params.toDate);

  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/purchases/reconciliation${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được báo cáo đối soát mua hàng");
  return res.json();
}

export async function getPurchaseByReference(token, referenceId) {
  const res = await fetch(`${API_BASE}/purchases/${referenceId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được chi tiết chứng từ mua hàng");
  return res.json();
}

export async function createPurchase(token, payload) {
  const res = await fetch(`${API_BASE}/purchases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Tạo chứng từ mua hàng thất bại");
  return res.json();
}

export async function getLastSupplierPrices(token, supplierId, productIds) {
  const res = await fetch(
    `${API_BASE}/purchases/last-supplier-prices?supplierId=${encodeURIComponent(supplierId)}&productIds=${productIds.map(encodeURIComponent).join(",")}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return {};
  return res.json();
}

export async function createSupplierPayment(token, referenceId, payload) {
  const res = await fetch(`${API_BASE}/purchases/${referenceId}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Ghi nhận thanh toán nhà cung cấp thất bại");
  return res.json();
}

export async function createPurchaseRebate(token, referenceId, payload) {
  const res = await fetch(`${API_BASE}/purchases/${referenceId}/rebates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Ghi nhận chiết khấu nhà cung cấp thất bại");
  return data;
}

export async function updatePurchaseRebate(token, referenceId, rebateIndex, payload) {
  const res = await fetch(`${API_BASE}/purchases/${referenceId}/rebates/${rebateIndex}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload || {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Cập nhật chiết khấu thất bại");
  return data;
}

export async function deletePurchaseRebate(token, referenceId, rebateIndex, payload) {
  const res = await fetch(`${API_BASE}/purchases/${referenceId}/rebates/${rebateIndex}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload || {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Hủy chứng từ chiết khấu thất bại");
  return data;
}

export async function deletePurchaseRebateBatch(token, batchReferenceId, payload) {
  const res = await fetch(`${API_BASE}/purchases/rebate-batches/${batchReferenceId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload || {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Hủy chứng từ chiết khấu tổng thất bại");
  return data;
}

export async function voidPurchase(token, referenceId, payload) {
  const res = await fetch(`${API_BASE}/purchases/${referenceId}/void`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Hủy chứng từ mua hàng thất bại");
  return data;
}

// ==================== RBAC ====================
export async function getRbacCatalog(token) {
  const res = await fetch(`${API_BASE}/rbac/catalog`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được cấu hình phân quyền");
  return res.json();
}

export async function getRbacAudit(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.actor) qs.set("actor", params.actor);
  if (params.action) qs.set("action", params.action);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));

  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/rbac/audit${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được nhật ký phân quyền");
  return res.json();
}

export async function getRoleKeys(token) {
  const res = await fetch(`${API_BASE}/users/meta/roles`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách vai trò");
  return res.json();
}

export async function patchUserRoles(token, userId, roles) {
  const res = await fetch(`${API_BASE}/users/${userId}/roles`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ roles })
  });
  if (!res.ok) throw new Error("Cập nhật vai trò người dùng thất bại");
  return res.json();
}

// ==================== DASHBOARD ====================
export async function getRevenueByPeriod(token, period = "month", filters = {}) {
  const qs = new URLSearchParams({ period });
  if (filters.timePeriod) qs.set("timePeriod", filters.timePeriod);
  if (filters.productType) qs.set("productType", filters.productType);
  if (filters.categoryId) qs.set("categoryId", filters.categoryId);
  if (filters.customerType) qs.set("customerType", filters.customerType);
  const res = await fetch(`${API_BASE}/dashboard/revenue-by-period?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được doanh thu theo thời kỳ");
  return res.json();
}

export async function getCashFlowByPeriod(token, period = "month", storeId, overviewTracking, filters = {}) {
  const qs = new URLSearchParams({ period });
  if (storeId) qs.set("storeId", storeId);
  if (overviewTracking) qs.set("overviewTracking", overviewTracking);
  if (filters.timePeriod) qs.set("timePeriod", filters.timePeriod);
  if (filters.productType) qs.set("productType", filters.productType);
  if (filters.categoryId) qs.set("categoryId", filters.categoryId);
  if (filters.customerType) qs.set("customerType", filters.customerType);
  const res = await fetch(`${API_BASE}/dashboard/cash-flow-by-period?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được dòng tiền theo thời kỳ");
  return res.json();
}

export async function getRevenueCompareMonthly(token, filters = {}) {
  const qs = new URLSearchParams();
  if (filters.timePeriod) qs.set("timePeriod", filters.timePeriod);
  if (filters.anchorYear) qs.set("anchorYear", String(filters.anchorYear));
  if (filters.storeId) qs.set("storeId", filters.storeId);
  if (filters.productType) qs.set("productType", filters.productType);
  if (filters.categoryId) qs.set("categoryId", filters.categoryId);
  if (filters.overviewTracking) qs.set("overviewTracking", filters.overviewTracking);
  const query = qs.toString() ? `?${qs.toString()}` : "";

  const res = await fetch(`${API_BASE}/dashboard/revenue-compare-monthly${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Khong tai duoc so sanh doanh thu theo thang");
  return res.json();
}

export async function getRevenueByStore(token, filters = {}) {
  const qs = new URLSearchParams();
  if (filters.timePeriod) qs.set("timePeriod", filters.timePeriod);
  if (filters.productType) qs.set("productType", filters.productType);
  if (filters.categoryId) qs.set("categoryId", filters.categoryId);
  if (filters.customerType) qs.set("customerType", filters.customerType);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/dashboard/revenue-by-store${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được doanh thu theo cửa hàng");
  return res.json();
}

export async function getRevenueByProduct(token, filters = {}) {
  const qs = new URLSearchParams();
  if (filters.timePeriod) qs.set("timePeriod", filters.timePeriod);
  if (filters.productType) qs.set("productType", filters.productType);
  if (filters.categoryId) qs.set("categoryId", filters.categoryId);
  if (filters.customerType) qs.set("customerType", filters.customerType);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/dashboard/revenue-by-product${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được doanh thu theo sản phẩm");
  return res.json();
}

export async function getStaffKpi(token, filters = {}) {
  const qs = new URLSearchParams();
  if (filters.timePeriod) qs.set("timePeriod", filters.timePeriod);
  if (filters.productType) qs.set("productType", filters.productType);
  if (filters.categoryId) qs.set("categoryId", filters.categoryId);
  if (filters.customerType) qs.set("customerType", filters.customerType);
  if (filters.roleDimension) qs.set("roleDimension", filters.roleDimension);
  if (filters.groupBy) qs.set("groupBy", filters.groupBy);
  if (filters.positionId) qs.set("positionId", filters.positionId);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/dashboard/staff-kpi${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được KPI nhân viên");
  return res.json();
}

// ==================== ORG POSITIONS ====================
export async function getOrgPositions(token, filters = {}) {
  const qs = new URLSearchParams();
  if (filters.roleType) qs.set("roleType", filters.roleType);
  if (filters.storeId) qs.set("storeId", filters.storeId);
  if (typeof filters.isActive === "boolean") qs.set("isActive", String(filters.isActive));
  const query = qs.toString() ? `?${qs.toString()}` : "";

  const res = await fetch(`${API_BASE}/org-positions${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Không tải được danh sách vị trí tổ chức");
  return data;
}

export async function createOrgPosition(token, payload) {
  const res = await fetch(`${API_BASE}/org-positions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Tạo vị trí tổ chức thất bại");
  return data;
}

export async function getOrgPositionAssignments(token, positionId) {
  const res = await fetch(`${API_BASE}/org-positions/${positionId}/assignments`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Không tải được lịch sử bổ nhiệm vị trí");
  return data;
}

export async function createOrgPositionAssignment(token, positionId, payload) {
  const res = await fetch(`${API_BASE}/org-positions/${positionId}/assignments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Tạo bổ nhiệm vị trí thất bại");
  return data;
}

export async function closeOrgPositionAssignment(token, assignmentId, effectiveTo) {
  const res = await fetch(`${API_BASE}/org-positions/assignments/${assignmentId}/close`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ effectiveTo })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Đóng hiệu lực bổ nhiệm vị trí thất bại");
  return data;
}

export async function getOrgPositionHandoverLogs(token, filters = {}) {
  const qs = new URLSearchParams();
  if (filters.storeId) qs.set("storeId", filters.storeId);
  if (filters.roleType) qs.set("roleType", filters.roleType);
  const query = qs.toString() ? `?${qs.toString()}` : "";

  const res = await fetch(`${API_BASE}/org-positions/handover-logs${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Không tải được lịch sử bàn giao");
  return data;
}

export async function executeOrgPositionHandover(token, payload) {
  const res = await fetch(`${API_BASE}/org-positions/handover/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Thực thi bàn giao thất bại");
  return data;
}

// ==================== ORG ASSIGNMENTS ====================
export async function getOrgAssignments(token, filters = {}) {
  const qs = new URLSearchParams();
  if (filters.roleType) qs.set("roleType", filters.roleType);
  if (filters.storeId) qs.set("storeId", filters.storeId);
  const query = qs.toString() ? `?${qs.toString()}` : "";

  const res = await fetch(`${API_BASE}/org-assignments${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được lịch sử phân công tổ chức");
  return res.json();
}

export async function createOrgAssignment(token, payload) {
  const res = await fetch(`${API_BASE}/org-assignments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || "Tạo quyết định phân công thất bại");
  }
  return data;
}

export async function closeOrgAssignment(token, assignmentId, effectiveTo) {
  const res = await fetch(`${API_BASE}/org-assignments/${assignmentId}/close`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ effectiveTo })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || "Đóng hiệu lực phân công thất bại");
  }
  return data;
}

export async function getFacebookCampaigns(token, config = {}) {
  const accessToken = String(config.accessToken || "").trim();
  const adAccountId = String(config.adAccountId || "").trim();
  const appSecret = String(config.appSecret || "").trim();
  const appId = String(config.appId || "").trim();

  const res = await fetch(`${API_BASE}/marketing/facebook/campaigns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      appId,
      appSecret,
      accessToken,
      adAccountId,
      limit: 200
    })
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body?.message || "Không tải được danh sách chiến dịch Facebook";
    throw new Error(message);
  }

  return body;
}

export async function getFacebookCustomAudiences(token, config = {}) {
  const accessToken = String(config.accessToken || "").trim();
  const adAccountId = String(config.adAccountId || "").trim();
  const appSecret = String(config.appSecret || "").trim();
  const appId = String(config.appId || "").trim();


  const res = await fetch(`${API_BASE}/marketing/facebook/custom-audiences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      appId,
      appSecret,
      accessToken,
      adAccountId,
      limit: 200
    })
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body?.message || "Không tải được danh sách đối tượng tùy chỉnh";
    throw new Error(message);
  }

  return body;
}

export async function addFacebookAudienceUsers(token, config, audienceId, users) {
  const accessToken = String(config.accessToken || "").trim();
  const appSecret = String(config.appSecret || "").trim();
  const appId = String(config.appId || "").trim();

  if (!audienceId) throw new Error("Thiếu ID đối tượng tùy chỉnh");
  if (!Array.isArray(users) || users.length === 0) throw new Error("Danh sách khách hàng không hợp lệ");

  const res = await fetch(`${API_BASE}/marketing/facebook/custom-audiences/${audienceId}/add-users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      appId,
      appSecret,
      accessToken,
      users
    })
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body?.message || "Không thêm được khách hàng";
    throw new Error(message);
  }

  return body;
}

export async function removeFacebookAudienceUsers(token, config, audienceId, users) {
  const accessToken = String(config.accessToken || "").trim();
  const appSecret = String(config.appSecret || "").trim();
  const appId = String(config.appId || "").trim();

  if (!audienceId) throw new Error("Thiếu ID đối tượng tùy chỉnh");
  if (!Array.isArray(users) || users.length === 0) throw new Error("Danh sách khách hàng không hợp lệ");

  const res = await fetch(`${API_BASE}/marketing/facebook/custom-audiences/${audienceId}/remove-users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      appId,
      appSecret,
      accessToken,
      users
    })
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body?.message || "Không xóa được khách hàng";
    throw new Error(message);
  }

  return body;
}

export async function getFacebookAccountInfo(token, config) {
  const accessToken = String(config.accessToken || "").trim();
  const adAccountId = String(config.adAccountId || "").trim();
  const appSecret = String(config.appSecret || "").trim();
  const appId = String(config.appId || "").trim();


  const res = await fetch(`${API_BASE}/marketing/facebook/account-info`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      appId,
      appSecret,
      accessToken,
      adAccountId
    })
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body?.message || "Không tải được thông tin tài khoản";
    throw new Error(message);
  }

  return body;
}

export async function getFacebookConfig(token) {
  const res = await fetch(`${API_BASE}/marketing/facebook/config`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Không tải được cấu hình Facebook";
    throw new Error(message);
  }

  return body;
}

export async function saveFacebookConfig(token, payload) {
  const res = await fetch(`${API_BASE}/marketing/facebook/config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Không lưu được cấu hình Facebook";
    throw new Error(message);
  }

  return body;
}

export async function getMarketingCustomAudiences(token) {
  const res = await fetch(`${API_BASE}/marketing/custom-audiences`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Không tải được danh sách đối tượng tùy chỉnh";
    throw new Error(message);
  }

  return body;
}

export async function getMarketingCustomAudienceById(token, id) {
  const res = await fetch(`${API_BASE}/marketing/custom-audiences/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Không tải được chi tiết đối tượng tùy chỉnh";
    throw new Error(message);
  }

  return body;
}

export async function createMarketingCustomAudience(token, payload) {
  const res = await fetch(`${API_BASE}/marketing/custom-audiences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Tạo đối tượng tùy chỉnh thất bại";
    throw new Error(message);
  }

  return body;
}

export async function addMarketingCustomAudienceDetails(token, audienceId, payload) {
  const res = await fetch(`${API_BASE}/marketing/custom-audiences/${audienceId}/details`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Thêm chi tiết đối tượng tùy chỉnh thất bại";
    throw new Error(message);
  }

  return body;
}

export async function removeMarketingCustomAudienceDetail(token, audienceId, detailId) {
  const res = await fetch(`${API_BASE}/marketing/custom-audiences/${audienceId}/details/${detailId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || "Xóa khách hàng khỏi đối tượng thất bại";
    throw new Error(message);
  }

  return body;
}

export async function pushCustomAudienceToFacebook(token, audienceId) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const maxAttempts = 3;
  const retryDelaysMs = [2000, 4000];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(`${API_BASE}/marketing/custom-audiences/${audienceId}/push-to-facebook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({})
    });

    const body = await res.json().catch(() => null);
    if (res.ok) {
      return body;
    }

    const facebookError = body?.facebookError || null;
    const isAudienceUpdating =
      (res.status === 409 || res.status === 400) &&
      facebookError?.code === 2650 &&
      facebookError?.subcode === 1870145;

    if (isAudienceUpdating && attempt < maxAttempts) {
      await sleep(retryDelaysMs[attempt - 1] || 4000);
      continue;
    }

    const message = body?.message || "Đẩy danh sách lên Facebook thất bại";
    const error = new Error(message);
    error.facebookError = facebookError;
    throw error;
  }

  const error = new Error("Đẩy danh sách lên Facebook thất bại");
  throw error;
}

// ==================== CONSULTATIONS ====================
export async function getConsultations(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/consultations${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Không tải được danh sách tư vấn");
  const body = await res.json().catch(() => null);
  return body?.data ?? body;
}

export async function updateConsultation(token, id, payload) {
  const res = await fetch(`${API_BASE}/consultations/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || "Cập nhật tư vấn thất bại");
  return body;
}

// ==================== ARTICLES ====================

export async function getArticles(token, params = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.category) qs.set("category", params.category);
  if (params.search) qs.set("search", params.search);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${API_BASE}/articles${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || "Không tải được danh sách bài viết");
  return body?.data ?? body;
}

export async function getArticleById(token, id) {
  const res = await fetch(`${API_BASE}/articles/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || "Không tải được bài viết");
  return body?.data ?? body;
}

export async function createArticle(token, payload) {
  const res = await fetch(`${API_BASE}/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || "Tạo bài viết thất bại");
  return body?.data ?? body;
}

export async function updateArticle(token, id, payload) {
  const res = await fetch(`${API_BASE}/articles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || "Cập nhật bài viết thất bại");
  return body?.data ?? body;
}

export async function patchArticleStatus(token, id, status) {
  const res = await fetch(`${API_BASE}/articles/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status })
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || "Cập nhật trạng thái thất bại");
  return body?.data ?? body;
}

export async function deleteArticle(token, id) {
  const res = await fetch(`${API_BASE}/articles/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || "Xóa bài viết thất bại");
  return body;
}

