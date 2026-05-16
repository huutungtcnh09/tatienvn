const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const API_BASE = `${API_BASE_URL}/api`;

async function request(path, token, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    }
    let message = "Request failed";
    try {
      const body = await res.json();
      message = body?.message || message;
    } catch {
      // Keep default message when response body is not JSON.
    }
    throw new Error(message);
  }

  return res.json();
}

export async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!res.ok) throw new Error("Đăng nhập thất bại");
  return res.json();
}

export const api = {
  users: (token) => request("/users", token),
  orgPositions: (token, params = {}) => {
    const qs = new URLSearchParams();
    if (typeof params.isActive === "boolean") qs.set("isActive", String(params.isActive));
    if (params.storeId) qs.set("storeId", params.storeId);
    if (params.roleType) qs.set("roleType", params.roleType);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/org-positions${query}`, token);
  },
  categories: (token) => request("/categories", token),
  createCategory: (token, payload) => request("/categories", token, { method: "POST", body: JSON.stringify(payload) }),
  partners: (token, params = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/partners${query}`, token);
  },
  partnerAging: (token, partnerId) => request(`/partners/${partnerId}/aging`, token),
  partnerTransactions: (token, partnerId) => request(`/partners/${partnerId}/transactions`, token),
  partnerAnalytics: (token, partnerId, period = "month") => request(`/partners/${partnerId}/analytics?period=${period}`, token),
  partnerOverview: (token, partnerId, preset = "this-month") => request(`/partners/${partnerId}/overview?preset=${preset}`, token),
  customerNotes: (token, customerId) => request(`/partners/${customerId}/notes`, token),
  createCustomerNote: (token, customerId, payload) => request(`/partners/${customerId}/notes`, token, { method: "POST", body: JSON.stringify(payload) }),
  giftRedemptions: (token, customerId) => request(`/partners/${customerId}/gift-redemptions`, token),
  createGiftRedemption: (token, customerId, payload) => request(`/partners/${customerId}/gift-redemptions`, token, { method: "POST", body: JSON.stringify(payload) }),
  cancelGiftRedemption: (token, customerId, redemptionId) => request(`/partners/${customerId}/gift-redemptions/${redemptionId}/cancel`, token, { method: "PATCH" }),
  products: (token, params = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/products${query}`, token);
  },
  productAnalytics: (token, productId) => request(`/products/${productId}/analytics`, token),
  productInventoryHistory: (token, productId) => request(`/products/${productId}/inventory-history`, token),
  createProduct: (token, payload) => request("/products", token, { method: "POST", body: JSON.stringify(payload) }),
  customerPriceList: (token, customerId, storeId) => {
    const qs = new URLSearchParams();
    if (storeId) qs.set("storeId", storeId);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/products/price-list/${customerId}${query}`, token);
  },
  stores: (token) => request("/stores", token),
  myAssignedStores: (token) => request("/stores/my-assigned", token),
  inventoryByStore: (token, storeId) => request(`/products/inventory/${storeId}`, token),
  orders: (token, params = {}) => {
    const qs = new URLSearchParams();
    if (params.fromDate) qs.set("fromDate", params.fromDate);
    if (params.toDate) qs.set("toDate", params.toDate);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/orders${query}`, token);
  },
  receipts: (token, params = {}) => {
    const qs = new URLSearchParams();
    if (params.fromDate) qs.set("fromDate", params.fromDate);
    if (params.toDate) qs.set("toDate", params.toDate);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/receipts${query}`, token);
  },
  purchases: (token, params = {}) => {
    const qs = new URLSearchParams();
    if (params.supplierId) qs.set("supplierId", params.supplierId);
    if (params.status) qs.set("status", params.status);
    if (params.search) qs.set("search", params.search);
    if (params.fromDate) qs.set("fromDate", params.fromDate);
    if (params.toDate) qs.set("toDate", params.toDate);
    if (params.storeId) qs.set("storeId", params.storeId);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/purchases${query}`, token);
  },
  purchasesOverview: (token) => request("/purchases/overview", token),
  purchaseByReference: (token, referenceId) => request(`/purchases/${referenceId}`, token),
  updateProduct: (token, id, payload) =>
    request(`/products/${id}`, token, { method: "PUT", body: JSON.stringify(payload) }),
  updateProductConsultation: (token, id, payload) => request(`/products/${id}/consultation`, token, { method: "PUT", body: JSON.stringify(payload) }),
  createOrder: (token, payload) => request("/orders", token, { method: "POST", body: JSON.stringify(payload) }),
  updateOrderItems: (token, orderId, payload) =>
    request(`/orders/${orderId}/items`, token, { method: "PATCH", body: JSON.stringify(payload) }),
  updateOrderStatus: (token, orderId, payload) =>
    request(`/orders/${orderId}/status`, token, { method: "PATCH", body: JSON.stringify(payload) }),
  returnRefundOrder: (token, orderId, payload) =>
    request(`/orders/${orderId}/return-refund`, token, { method: "POST", body: JSON.stringify(payload) }),
  createReceipt: (token, payload) => request("/receipts", token, { method: "POST", body: JSON.stringify(payload) }),
  voidReceipt: (token, receiptId, payload) => request(`/receipts/${receiptId}/void`, token, { method: "POST", body: JSON.stringify(payload) }),
  applyReceiptToOrders: (token, payload) =>
    request("/receipts/apply-order", token, { method: "POST", body: JSON.stringify(payload) }),
  createPartner: (token, payload) => request("/partners", token, { method: "POST", body: JSON.stringify(payload) }),
  updatePartner: (token, partnerId, payload) =>
    request(`/partners/${partnerId}`, token, { method: "PUT", body: JSON.stringify(payload) }),
  updateCustomerPriceList: (token, customerId, productId, payload) =>
    request(`/products/price-list/${customerId}/${productId}`, token, { method: "PUT", body: JSON.stringify(payload) }),
  deleteCustomerPriceList: (token, customerId, productId) =>
    request(`/products/price-list/${customerId}/${productId}`, token, { method: "DELETE" }),
    marketingCustomAudiences: (token) => request("/marketing/custom-audiences", token),
    marketingCustomAudienceById: (token, audienceId) => request(`/marketing/custom-audiences/${audienceId}`, token),
    addMarketingCustomAudienceDetails: (token, audienceId, payload) =>
      request(`/marketing/custom-audiences/${audienceId}/details`, token, { method: "POST", body: JSON.stringify(payload) }),
    removeMarketingCustomAudienceDetail: (token, audienceId, detailId) =>
      request(`/marketing/custom-audiences/${audienceId}/details/${detailId}`, token, { method: "DELETE" }),
  createPurchase: (token, payload) => request("/purchases", token, { method: "POST", body: JSON.stringify(payload) }),
  getLastSupplierPrices: (token, supplierId, productIds) =>
    request(`/purchases/last-supplier-prices?supplierId=${encodeURIComponent(supplierId)}&productIds=${productIds.map(encodeURIComponent).join(",")}`, token),
  payPurchase: (token, referenceId, payload) =>
    request(`/purchases/${referenceId}/pay`, token, { method: "POST", body: JSON.stringify(payload) }),
  updatePurchasePayment: (token, referenceId, paymentId, payload) =>
    request(`/purchases/${referenceId}/payments/${paymentId}`, token, { method: "PATCH", body: JSON.stringify(payload) }),
  deletePurchasePayment: (token, referenceId, paymentId, payload) =>
    request(`/purchases/${referenceId}/payments/${paymentId}`, token, { method: "DELETE", body: JSON.stringify(payload) }),
  voidPurchase: (token, referenceId, payload) =>
    request(`/purchases/${referenceId}/void`, token, { method: "POST", body: JSON.stringify(payload) }),
  createPurchaseRebate: (token, referenceId, payload) =>
    request(`/purchases/${referenceId}/rebates`, token, { method: "POST", body: JSON.stringify(payload) }),
  updatePurchaseRebate: (token, referenceId, rebateIndex, payload) =>
    request(`/purchases/${referenceId}/rebates/${rebateIndex}`, token, { method: "PATCH", body: JSON.stringify(payload) }),
  deletePurchaseRebate: (token, referenceId, rebateIndex, payload) =>
    request(`/purchases/${referenceId}/rebates/${rebateIndex}`, token, { method: "DELETE", body: JSON.stringify(payload) }),
  deletePurchaseRebateBatch: (token, batchReferenceId, payload) =>
    request(`/purchases/rebate-batches/${batchReferenceId}`, token, { method: "DELETE", body: JSON.stringify(payload) }),
  getPromotions: (token) => request("/promotions", token),
  getWatchlist: (token) => request("/partners/watchlist", token),
  updateWatchlist: (token, items) => request("/partners/watchlist", token, { method: "PUT", body: JSON.stringify({ items }) }),
  businessAreas: (token) => request("/business-areas", token),
  businessAreasDashboard: (token, params = {}) => {
    const qs = new URLSearchParams();
    if (params.timePreset) qs.set("timePreset", params.timePreset);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/business-areas/dashboard/overview${query}`, token);
  },
  createBusinessArea: (token, payload) => request("/business-areas", token, { method: "POST", body: JSON.stringify(payload) }),
  updateBusinessArea: (token, id, payload) => request(`/business-areas/${id}`, token, { method: "PUT", body: JSON.stringify(payload) }),
  deleteBusinessArea: (token, id) => request(`/business-areas/${id}`, token, { method: "DELETE" })
};
