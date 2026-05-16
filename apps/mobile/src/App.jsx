import { useEffect, useMemo, useRef, useState } from "react";
import { createCustomerWithApi, createProductWithApi, getMobileData, getMobileOrders, getMobileReceipts, getStoreWatchlist, loginWithApi, updatePartnerWithApi, updateProductWithApi, getMaintenanceStatus, setMaintenanceMode, getCustomerNotes, createCustomerNote, getPartnerTransactions, getStorePositions, getStaffKpiByPosition, getSuppliersWithApi, getSupplierPurchasesWithApi, getBusinessAreasDashboard } from "./api";

const TOKEN_KEY = "mobile_token";
const USER_KEY = "mobile_user";
const STORE_KEY = "mobile_store_id";

const navItems = [
  { id: "products", label: "Sản phẩm", icon: BoxIcon },
  { id: "customers", label: "Khách hàng", icon: UsersIcon },
  { id: "overview", label: "Tổng quan", icon: ChartIcon },
  { id: "more", label: "Chức năng khác", icon: GridIcon }
];

const SUB_SCREEN_LABELS = {
  "staff-kpi": "KPI nhân viên",
  orders: "Đơn hàng",
  receipts: "Phiếu thu",
  watchlist: "Khách theo dõi",
  suppliers: "Nhà cung cấp",
  maintenance: "Bảo trì website",
  articles: "Bài viết & Tin tức"
};

const money = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});

const number = new Intl.NumberFormat("vi-VN");

const MOBILE_ALLOWED_ROLES = ["SALE_MOBILE", "SUPER_ADMIN"];
const MAX_IMAGE_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
const MOBILE_REVENUE_STATUSES = new Set(["DELIVERED", "COMPLETED", "RETURNED"]);

function isMobileRevenueStatus(status) {
  return MOBILE_REVENUE_STATUSES.has(String(status || "").toUpperCase());
}

function getOrderItemNetQuantity(item) {
  const quantity = Number(item?.quantity || 0);
  if (quantity <= 0) return 0;
  const returnedQty = (item?.returnItems || []).reduce((sum, row) => sum + Number(row?.quantity || 0), 0);
  return Math.max(quantity - returnedQty, 0);
}

function getOrderItemNetRevenue(item) {
  const quantity = Number(item?.quantity || 0);
  if (quantity <= 0) return 0;
  const unitPrice = Number(item?.unitPrice || 0);
  const discountAmount = Number(item?.discountAmount || 0);
  const returnedRevenue = (item?.returnItems || []).reduce((sum, row) => sum + Number(row?.amount || 0), 0);
  return Math.max(quantity * unitPrice - discountAmount - returnedRevenue, 0);
}

function getOrderNetRevenue(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.reduce((sum, item) => sum + getOrderItemNetRevenue(item), 0);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Không đọc được tệp ảnh."));
    reader.readAsDataURL(file);
  });
}

function getTokenRoles(rawToken) {
  try {
    const rawPayload = rawToken.split(".")[1];
    const json = decodeURIComponent(atob(rawPayload.replace(/-/g, "+").replace(/_/g, "/")).split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
    const data = JSON.parse(json);
    const rawRoles = data?.roles;
    if (Array.isArray(rawRoles)) return rawRoles.map((r) => String(r).toUpperCase());
    if (typeof rawRoles === "string") return rawRoles.split(",").map((r) => r.trim().toUpperCase()).filter(Boolean);
    return [];
  } catch (_e) {
    return [];
  }
}

function App() {
  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem(TOKEN_KEY) || "";
    if (saved && !getTokenRoles(saved).some((r) => MOBILE_ALLOWED_ROLES.includes(r))) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(STORE_KEY);
      return "";
    }
    return saved;
  });
  const [userName, setUserName] = useState(() => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return "Tài khoản";
    try {
      const parsed = JSON.parse(raw);
      return parsed?.fullName || parsed?.email || "Tài khoản";
    } catch {
      return "Tài khoản";
    }
  });
  const [activeTab, setActiveTab] = useState("products");
  const [selectedStoreId, setSelectedStoreId] = useState(() => localStorage.getItem(STORE_KEY) || "");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showStorePicker, setShowStorePicker] = useState(false);
  const [subScreen, setSubScreen] = useState(null);
  const [payload, setPayload] = useState({
    stores: [],
    categories: [],
    products: [],
    overview: {},
    inventory: [],
    customers: [],
    accountOwnerPositions: [],
    orders: [],
    receipts: [],
    purchases: [],
    promotions: [],
    summary: {
      menuBadges: { products: 0, customers: 0, overview: 0, more: 0 },
      highlights: {
        productsCount: 0,
        customersCount: 0,
        ordersCount: 0,
        revenue: 0,
        profit: 0,
        promotionCount: 0,
        pendingOrders: 0,
        kpiPercent: 0
      }
    },
    refreshedAt: 0
  });

  const activeLabel = useMemo(() => {
    if (subScreen && SUB_SCREEN_LABELS[subScreen]) return SUB_SCREEN_LABELS[subScreen];
    const found = navItems.find((item) => item.id === activeTab);
    return found ? found.label.replace("\n", " ") : "";
  }, [activeTab, subScreen]);

  const storeOptions = payload.stores || [];

  const handleStoreChange = (nextStoreId) => {
    setSelectedStoreId(nextStoreId);
    localStorage.setItem(STORE_KEY, nextStoreId);
    setShowStorePicker(false);
  };

  const loadData = async (quiet = false) => {
    if (!token) return;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const data = await getMobileData(token, selectedStoreId);
      setPayload((prev) => ({ ...prev, ...data }));
      if (!selectedStoreId && data.stores.length > 0) {
        const fallbackStore = data.stores.find((store) => !store?.isWarehouse)?.id || data.stores[0]?.id || "";
        if (fallbackStore) {
          setSelectedStoreId(fallbackStore);
          localStorage.setItem(STORE_KEY, fallbackStore);
        }
      }
    } catch (loadError) {
      const msg = loadError instanceof Error ? loadError.message : "Không tải được dữ liệu";
      setError(msg);
      if (msg.toLowerCase().includes("đăng nhập")) {
        handleLogout();
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadData(false);
  }, [token, selectedStoreId]);

  useEffect(() => {
    if (activeTab !== "more") {
      setShowStorePicker(false);
      setSubScreen(null);
    }
  }, [activeTab]);

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(STORE_KEY);
    setToken("");
    setUserName("Tài khoản");
    setSelectedStoreId("");
    setShowStorePicker(false);
    setQuery("");
    setPayload({
      stores: [],
      categories: [],
      products: [],
      overview: {},
      inventory: [],
      customers: [],
      accountOwnerPositions: [],
      orders: [],
      receipts: [],
      purchases: [],
      promotions: [],
      summary: {
        menuBadges: { products: 0, customers: 0, overview: 0, more: 0 },
        highlights: {
          productsCount: 0,
          customersCount: 0,
          ordersCount: 0,
          revenue: 0,
          profit: 0,
          promotionCount: 0,
          pendingOrders: 0,
          kpiPercent: 0
        }
      },
      refreshedAt: 0
    });
    setError("");
  };

  const saveSupplierQuote = async (product, values) => {
    const payloadUpdate = {
      sku: product.sku,
      name: product.name,
      productType: product.productType || "GOODS",
      isTrackedInOverview: Boolean(product.isTrackedInOverview ?? true),
      categoryId: product.categoryId,
      unit: product.unit || "cái",
      salePrice: Number(product.defaultPrice || 0),
      priceLevel2: Number(product.level2Price || product.defaultPrice || 0),
      priceLevel2Special: Number(product.level2SpecialPrice || product.level2Price || product.defaultPrice || 0),
      promoPrice: product.promoPrice != null ? Number(product.promoPrice) : undefined,
      supplierQuotedPrice: values.supplierQuotedPrice,
      supplierQuoteNote: values.supplierQuoteNote,
      ingredients: product.ingredients || undefined,
      benefits: product.benefits || undefined,
      usageGuide: product.usageGuide || undefined,
      rewardPoints: Number(product.rewardPoints || 0),
      costPrice: Number(product.costPrice || 0),
      imageUrl: product.imageUrl || undefined,
      isActive: product.isActive !== false
    };

    const updated = await updateProductWithApi(token, product.id, payloadUpdate);
    setPayload((prev) => ({
      ...prev,
      products: (prev.products || []).map((item) => (item.id === product.id ? { ...item, ...updated } : item))
    }));
    return updated;
  };

  const updateProduct = async (product, values) => {
    const payloadUpdate = {
      sku: values.sku,
      name: values.name,
      productType: values.productType || "GOODS",
      isTrackedInOverview: Boolean(product.isTrackedInOverview ?? true),
      categoryId: values.categoryId,
      unit: values.unit || "cái",
      salePrice: Number(values.defaultPrice || 0),
      priceLevel2: Number(product.level2Price || values.defaultPrice || 0),
      priceLevel2Special: Number(product.level2SpecialPrice || product.level2Price || values.defaultPrice || 0),
      promoPrice: product.promoPrice != null ? Number(product.promoPrice) : undefined,
      supplierQuotedPrice: Number(product.supplierQuotedPrice || 0),
      supplierQuoteNote: product.supplierQuoteNote || undefined,
      ingredients: product.ingredients || undefined,
      benefits: product.benefits || undefined,
      usageGuide: product.usageGuide || undefined,
      rewardPoints: Number(product.rewardPoints || 0),
      costPrice: Number(values.costPrice || 0),
      imageUrl: values.imageUrl || undefined,
      imageGallery: (values.imageGallery && values.imageGallery.length > 0) ? values.imageGallery : undefined,
      isActive: values.isActive !== false
    };

    const updated = await updateProductWithApi(token, product.id, payloadUpdate);
    setPayload((prev) => {
      const resolvedCategoryId = updated?.categoryId || values.categoryId || product.categoryId;
      const resolvedCategory = updated?.category
        || prev.categories.find((item) => item.id === resolvedCategoryId)
        || product.category;
      const merged = { ...product, ...updated, category: resolvedCategory };
      return {
        ...prev,
        products: (prev.products || []).map((item) => (item.id === product.id ? merged : item))
      };
    });
    return updated;
  };

  const createProduct = async (payloadCreate) => {
    const created = await createProductWithApi(token, payloadCreate);
    await loadData(true);
    return created;
  };

  const createCustomer = async (payloadCreate) => {
    const created = await createCustomerWithApi(token, payloadCreate);
    await loadData(true);
    return created;
  };

  if (!token) {
    return (
      <LoginScreen
        onLogin={(auth) => {
          setToken(auth.token);
          setUserName(auth.user?.fullName || auth.user?.email || "Tài khoản");
        }}
      />
    );
  }

  const storeLabel = storeOptions.find((store) => store.id === selectedStoreId)?.name || "Tất cả cửa hàng";

  return (
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="mobile-header-left">
          {subScreen ? (
            <button type="button" className="header-back-btn" onClick={() => setSubScreen(null)} aria-label="Quay lại">‹</button>
          ) : null}
          <h1>{activeLabel}</h1>
        </div>
        <div className="mobile-user">{userName}</div>
      </header>

      {activeTab === "products" || activeTab === "customers" ? (
        <section className="toolbar-card">
          <div className="toolbar-grid">
            <label className="toolbar-search-wrap" aria-label="Tìm kiếm nhanh">
              <SearchMonoIcon />
              <input
                className="toolbar-search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm nhanh theo tên/mã..."
              />
            </label>
          </div>
        </section>
      ) : null}

      {error ? <p className="form-error in-page">{error}</p> : null}

      <main className="mobile-content">
        {activeTab === "products" && (
          <ProductsPanel
            payload={payload}
            query={query}
            loading={loading}
            onSaveSupplierQuote={saveSupplierQuote}
            onCreateProduct={createProduct}
            onUpdateProduct={updateProduct}
          />
        )}
        {activeTab === "customers" && (
          <CustomersPanel
            token={token}
            payload={payload}
            query={query}
            loading={loading}
            selectedStoreId={selectedStoreId}
            onCreateCustomer={createCustomer}
          />
        )}
        {activeTab === "overview" && <OverviewPanel payload={payload} loading={loading} token={token} />}
        {activeTab === "more" && !subScreen && (
          <MorePanel
            token={token}
            payload={payload}
            loading={loading}
            onLogout={handleLogout}
            storeOptions={storeOptions}
            selectedStoreId={selectedStoreId}
            storeLabel={storeLabel}
            showStorePicker={showStorePicker}
            onToggleStorePicker={() => setShowStorePicker((prev) => !prev)}
            onStoreChange={handleStoreChange}
            onNavigate={setSubScreen}
          />
        )}
        {activeTab === "more" && subScreen === "staff-kpi" && (
          <StaffKpiScreen token={token} selectedStoreId={selectedStoreId} payload={payload} />
        )}
        {activeTab === "more" && subScreen === "orders" && (
          <OrdersScreen token={token} selectedStoreId={selectedStoreId} />
        )}
        {activeTab === "more" && subScreen === "receipts" && (
          <ReceiptsScreen token={token} selectedStoreId={selectedStoreId} />
        )}
        {activeTab === "more" && subScreen === "watchlist" && (
          <WatchlistScreen token={token} selectedStoreId={selectedStoreId} payload={payload} />
        )}
        {activeTab === "more" && subScreen === "suppliers" && (
          <SuppliersScreen token={token} selectedStoreId={selectedStoreId} />
        )}
        {activeTab === "more" && subScreen === "maintenance" && (
          <MaintenanceScreen token={token} />
        )}
        {activeTab === "more" && subScreen === "articles" && (
          <ArticlesScreen />
        )}
      </main>

      <nav className="bottom-nav" aria-label="Điều hướng chính">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeTab;
          const badge = payload.summary.menuBadges[item.id] || 0;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${isActive ? "active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span className="nav-icon-wrap">
                <Icon />
                {badge > 0 ? <em className="nav-badge">{badge > 99 ? "99+" : badge}</em> : null}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Vui lòng nhập email và mật khẩu.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const payload = await loginWithApi(email.trim(), password.trim());
      if (!payload.token) throw new Error("Đăng nhập thất bại");
      // Kiểm tra quyền truy cập app mobile
      const tokenRoles = getTokenRoles(payload.token);
      const hasAccess = tokenRoles.some((r) => MOBILE_ALLOWED_ROLES.includes(r));
      if (!hasAccess) {
        setError("Tài khoản không có quyền truy cập ứng dụng Mobile. Vui lòng dùng đúng ứng dụng theo vai trò của bạn.");
        return;
      }
      localStorage.setItem(TOKEN_KEY, payload.token);
      localStorage.setItem(USER_KEY, JSON.stringify(payload.user || {}));
      onLogin(payload);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Đăng nhập thất bại");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <p className="badge">Hệ thống APP_KD</p>
        <h1>Đăng nhập Mobile</h1>
        <p className="login-sub">Phiên đăng nhập sẽ được lưu đến khi bạn bấm đăng xuất.</p>

        <form onSubmit={submit} className="login-form">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="vd: admin@domain.com"
            autoComplete="username"
          />

          <label htmlFor="password">Mật khẩu</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Nhập mật khẩu"
            autoComplete="current-password"
          />

          {error ? <p className="form-error">{error}</p> : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Đang đăng nhập..." : "Vào ứng dụng"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ProductsPanel({ payload, query, loading, onSaveSupplierQuote, onCreateProduct, onUpdateProduct }) {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const createFileInputRef = useRef(null);
  const [createUploadingImage, setCreateUploadingImage] = useState(false);
  const [createForm, setCreateForm] = useState({
    sku: "",
    name: "",
    categoryId: "",
    productType: "GOODS",
    unit: "cái",
    salePrice: "",
    costPrice: "0",
    imageUrl: "",
    imageGallery: []
  });
  const [analysisFrom, setAnalysisFrom] = useState(() => dateInputValueDaysAgo(30));
  const [analysisTo, setAnalysisTo] = useState(() => dateInputValueDaysAgo(0));
  const [quotePrice, setQuotePrice] = useState("");
  const [quoteNote, setQuoteNote] = useState("");
  const [savingQuote, setSavingQuote] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState("");
  const [visibleProductCount, setVisibleProductCount] = useState(20);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [productFilter, setProductFilter] = useState("NONE");
  const editImageInputRef = useRef(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showEditProductDialog, setShowEditProductDialog] = useState(false);
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [editForm, setEditForm] = useState({
    sku: "",
    name: "",
    categoryId: "",
    productType: "GOODS",
    unit: "cái",
    defaultPrice: "",
    costPrice: "",
    priceLevel2: "",
    priceLevel2Special: "",
    promoPrice: "",
    rewardPoints: "0",
    giftPointsCost: "0",
    imageUrl: "",
    imageGallery: [],
    ingredients: "",
    benefits: "",
    usageGuide: "",
    isActive: true
  });

  const buildEditForm = (product) => ({
    sku: product?.sku || "",
    name: product?.name || "",
    categoryId: product?.categoryId || product?.category?.id || "",
    productType: product?.productType || "GOODS",
    unit: product?.unit || "cái",
    defaultPrice: String(Number(product?.defaultPrice || 0)),
    costPrice: String(Number(product?.costPrice || 0)),
    priceLevel2: String(Number(product?.priceLevel2 ?? product?.level2Price ?? product?.defaultPrice ?? 0)),
    priceLevel2Special: String(Number(product?.priceLevel2Special ?? product?.level2SpecialPrice ?? product?.level2Price ?? product?.defaultPrice ?? 0)),
    promoPrice: String(Number(product?.promoPrice ?? 0)),
    rewardPoints: String(Number(product?.rewardPoints ?? 0)),
    giftPointsCost: String(Number(product?.giftPointsCost ?? 0)),
    imageUrl: product?.imageUrl || "",
    imageGallery: Array.isArray(product?.imageGallery) ? product.imageGallery : [],
    ingredients: product?.ingredients || "",
    benefits: product?.benefits || "",
    usageGuide: product?.usageGuide || "",
    isActive: product?.isActive !== false
  });

  const productFilterLabel = useMemo(() => {
    switch (productFilter) {
      case "LOW_STOCK":
        return "Tồn thấp";
      case "HIGH_STOCK":
        return "Tồn cao";
      case "COST_DESC":
        return "Giá vốn giảm dần";
      case "COST_ASC":
        return "Giá vốn tăng dần";
      default:
        return "Lọc";
    }
  }, [productFilter]);

  const inventoryMap = useMemo(() => {
    const map = new Map();
    for (const row of payload.inventory || []) {
      if (!row?.productId) continue;
      map.set(row.productId, Number(row.availableQuantity ?? row.quantity ?? 0));
    }
    return map;
  }, [payload.inventory]);

  const q = query.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    const rows = (payload.products || [])
      .filter((item) => {
        if (!q) return true;
        const text = `${item?.sku || ""} ${item?.name || ""} ${item?.category?.name || ""}`.toLowerCase();
        return text.includes(q);
      })
      .slice();

    switch (productFilter) {
      case "LOW_STOCK":
        rows.sort((left, right) => (inventoryMap.get(left?.id) || 0) - (inventoryMap.get(right?.id) || 0));
        break;
      case "HIGH_STOCK":
        rows.sort((left, right) => (inventoryMap.get(right?.id) || 0) - (inventoryMap.get(left?.id) || 0));
        break;
      case "COST_DESC":
        rows.sort((left, right) => Number(right?.costPrice || 0) - Number(left?.costPrice || 0));
        break;
      case "COST_ASC":
        rows.sort((left, right) => Number(left?.costPrice || 0) - Number(right?.costPrice || 0));
        break;
      default:
        break;
    }

    return rows;
  }, [inventoryMap, payload.products, productFilter, q]);
  const rows = filteredRows.slice(0, visibleProductCount);

  useEffect(() => {
    setVisibleProductCount(20);
  }, [q, payload.products, productFilter]);

  const analysisMetrics = useMemo(() => {
    if (!selectedProduct?.id) {
      return {
        totalQuantity: 0,
        ordersCount: 0,
        averageSellPrice: 0,
        averageCost: Number(selectedProduct?.costPrice || 0),
        averageProfitPerUnit: 0
      };
    }

    const startAt = new Date(`${analysisFrom}T00:00:00`).getTime();
    const endAt = new Date(`${analysisTo}T23:59:59`).getTime();
    if (Number.isNaN(startAt) || Number.isNaN(endAt) || startAt > endAt) {
      return {
        totalQuantity: 0,
        ordersCount: 0,
        averageSellPrice: 0,
        averageCost: Number(selectedProduct.costPrice || 0),
        averageProfitPerUnit: 0
      };
    }

    let totalQuantity = 0;
    let totalRevenue = 0;
    let totalCost = 0;
    let ordersCount = 0;

    for (const order of payload.orders || []) {
      const status = String(order?.status || "").toUpperCase();
      if (!isMobileRevenueStatus(status)) continue;
      const createdAt = new Date(order?.createdAt || 0).getTime();
      if (Number.isNaN(createdAt) || createdAt < startAt || createdAt > endAt) continue;

      const items = Array.isArray(order?.items) ? order.items : [];
      const matched = items.filter((item) => item?.productId === selectedProduct.id);
      if (!matched.length) continue;

      const matchedRevenue = matched.reduce((sum, item) => {
        const quantity = Number(item?.quantity || 0);
        if (quantity <= 0) return sum;
        const unitPrice = Number(item?.unitPrice || 0);
        const discountAmount = Number(item?.discountAmount || 0);
        const grossRevenue = Math.max(quantity * unitPrice - discountAmount, 0);
        const returnedRevenue = (item?.returnItems || []).reduce((s, r) => s + Number(r?.amount || 0), 0);
        return sum + Math.max(grossRevenue - returnedRevenue, 0);
      }, 0);

      const matchedRawCost = matched.reduce((sum, item) => {
        const quantity = Number(item?.quantity || 0);
        if (quantity <= 0) return sum;
        const unitCost = Number(item?.unitCost ?? item?.product?.costPrice ?? selectedProduct?.costPrice ?? 0);
        const returnedQty = (item?.returnItems || []).reduce((s, r) => s + Number(r?.quantity || 0), 0);
        const netQty = Math.max(quantity - returnedQty, 0);
        return sum + netQty * unitCost;
      }, 0);

      ordersCount += 1;

      for (const item of matched) {
        const quantity = Number(item?.quantity || 0);
        if (quantity <= 0) continue;
        const returnedQty = (item?.returnItems || []).reduce((s, r) => s + Number(r?.quantity || 0), 0);
        totalQuantity += Math.max(quantity - returnedQty, 0);
      }

      totalRevenue += matchedRevenue;
      totalCost += matchedRawCost;
    }

    const averageSellPrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;
    const averageCost = totalQuantity > 0 ? totalCost / totalQuantity : Number(selectedProduct?.costPrice || 0);
    return {
      totalQuantity,
      ordersCount,
      totalRevenue,
      totalProfit: totalRevenue - totalCost,
      averageSellPrice,
      averageCost,
      averageProfitPerUnit: averageSellPrice - averageCost
    };
  }, [analysisFrom, analysisTo, payload.orders, selectedProduct]);

  const trendSeries = useMemo(() => {
    if (!selectedProduct?.id) return [];

    const startAt = new Date(`${analysisFrom}T00:00:00`).getTime();
    const endAt = new Date(`${analysisTo}T23:59:59`).getTime();
    if (Number.isNaN(startAt) || Number.isNaN(endAt) || startAt > endAt) return [];

    const dayMap = new Map();
    for (const order of payload.orders || []) {
      const status = String(order?.status || "").toUpperCase();
      if (!isMobileRevenueStatus(status)) continue;
      const createdAtDate = new Date(order?.createdAt || 0);
      const createdAt = createdAtDate.getTime();
      if (Number.isNaN(createdAt) || createdAt < startAt || createdAt > endAt) continue;

      const key = createdAtDate.toISOString().slice(0, 10);
      const bucket = dayMap.get(key) || { quantity: 0, revenue: 0, cost: 0 };
      const items = Array.isArray(order?.items) ? order.items : [];
      let matchedRevenue = 0;
      let matchedRawCost = 0;
      let matchedQuantity = 0;
      for (const item of items) {
        if (item?.productId !== selectedProduct.id) continue;
        const quantity = Number(item?.quantity || 0);
        if (quantity <= 0) continue;
        const unitPrice = Number(item?.unitPrice || 0);
        const discountAmount = Number(item?.discountAmount || 0);
        const unitCost = Number(item?.unitCost ?? item?.product?.costPrice ?? selectedProduct?.costPrice ?? 0);
        const returnedQty = (item?.returnItems || []).reduce((s, r) => s + Number(r?.quantity || 0), 0);
        const returnedRevenue = (item?.returnItems || []).reduce((s, r) => s + Number(r?.amount || 0), 0);
        const netQty = Math.max(quantity - returnedQty, 0);
        matchedQuantity += netQty;
        matchedRevenue += Math.max(quantity * unitPrice - discountAmount - returnedRevenue, 0);
        matchedRawCost += netQty * unitCost;
      }

      if (matchedQuantity <= 0) continue;

      bucket.quantity += matchedQuantity;
      bucket.revenue += matchedRevenue;
      bucket.cost += matchedRawCost;
      dayMap.set(key, bucket);
    }

    return Array.from(dayMap.entries())
      .map(([date, value]) => ({
        date,
        avgSell: value.quantity > 0 ? value.revenue / value.quantity : 0,
        avgCost: value.quantity > 0 ? value.cost / value.quantity : 0
      }))
      .sort((left, right) => left.date.localeCompare(right.date));
  }, [analysisFrom, analysisTo, payload.orders, selectedProduct]);

  const trendChart = useMemo(() => {
    if (!trendSeries.length) return null;
    const width = 320;
    const height = 120;
    const padX = 16;
    const padY = 12;
    const values = trendSeries.flatMap((item) => [item.avgSell, item.avgCost]);
    const maxValue = Math.max(...values, 1);

    const toPoint = (index, value) => {
      const x = trendSeries.length === 1
        ? width / 2
        : padX + (index * (width - padX * 2)) / (trendSeries.length - 1);
      const y = height - padY - (value / maxValue) * (height - padY * 2);
      return `${x},${y}`;
    };

    const sellPath = trendSeries.map((item, idx) => toPoint(idx, item.avgSell)).join(" ");
    const costPath = trendSeries.map((item, idx) => toPoint(idx, item.avgCost)).join(" ");
    return { width, height, sellPath, costPath };
  }, [trendSeries]);

  const top10Customers = useMemo(() => {
    if (!selectedProduct?.id) return [];
    const startAt = new Date(`${analysisFrom}T00:00:00`).getTime();
    const endAt = new Date(`${analysisTo}T23:59:59`).getTime();
    const customerMap = new Map();
    for (const order of payload.orders || []) {
      const status = String(order?.status || "").toUpperCase();
      if (!isMobileRevenueStatus(status)) continue;
      const createdAt = new Date(order?.createdAt || 0).getTime();
      if (Number.isNaN(createdAt) || createdAt < startAt || createdAt > endAt) continue;
      const items = Array.isArray(order?.items) ? order.items : [];
      for (const item of items) {
        if (item?.productId !== selectedProduct.id) continue;
        const quantity = getOrderItemNetQuantity(item);
        if (quantity <= 0) continue;
        const revenue = getOrderItemNetRevenue(item);
        const customerId = order?.customerId || "__guest__";
        const customerName = order?.customer?.name || order?.customer?.phone || customerId;
        const bucket = customerMap.get(customerId) || { name: customerName, quantity: 0, revenue: 0 };
        bucket.quantity += quantity;
        bucket.revenue += revenue;
        customerMap.set(customerId, bucket);
      }
    }
    return Array.from(customerMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
  }, [analysisFrom, analysisTo, payload.orders, selectedProduct]);

  const openProductDetail = (item) => {
    setSelectedProduct(item);
    setEditForm(buildEditForm(item));
    setEditMessage("");
    setShowEditProductDialog(false);
    setShowQuoteDialog(false);
    setAnalysisFrom(dateInputValueDaysAgo(30));
    setAnalysisTo(dateInputValueDaysAgo(0));
    setQuotePrice(String(Number(item?.supplierQuotedPrice || 0)));
    setQuoteNote(item?.supplierQuoteNote || "");
    setQuoteMessage("");
  };

  const handleEditFieldChange = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditMoneyChange = (field, value) => {
    const normalized = String(value || "").replace(/[^\d]/g, "");
    setEditForm((prev) => ({ ...prev, [field]: normalized }));
  };

  const handlePickEditImage = () => {
    if (uploadingImage) return;
    editImageInputRef.current?.click();
  };

  const handleEditImageFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setEditMessage("Lỗi: Vui lòng chọn tệp ảnh hợp lệ.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
      setEditMessage("Lỗi: Ảnh vượt quá 5MB.");
      event.target.value = "";
      return;
    }

    try {
      setUploadingImage(true);
      const dataUrl = await fileToDataUrl(file);
      setEditForm((prev) => {
        const gallery = Array.isArray(prev.imageGallery) ? prev.imageGallery : [];
        const isDefault = gallery.length === 0;
        return { ...prev, imageGallery: [...gallery, { url: dataUrl, isDefault, showOnCorporate: true }] };
      });
      setEditMessage("Đã tải ảnh lên, nhớ bấm lưu sản phẩm.");
    } catch (error) {
      setEditMessage(`Lỗi: ${error instanceof Error ? error.message : "Không tải được ảnh"}`);
    } finally {
      setUploadingImage(false);
      event.target.value = "";
    }
  };

  const submitEditProduct = async () => {
    if (!selectedProduct?.id || !onUpdateProduct) return;

    const sku = String(editForm.sku || "").trim();
    const name = String(editForm.name || "").trim();
    const categoryId = String(editForm.categoryId || "").trim();
    const defaultPrice = Number(String(editForm.defaultPrice || "0").replace(/[^\d.]/g, ""));
    const costPrice = Number(String(editForm.costPrice || "0").replace(/[^\d.]/g, ""));
    const priceLevel2 = Number(String(editForm.priceLevel2 || "0").replace(/[^\d.]/g, ""));
    const priceLevel2Special = Number(String(editForm.priceLevel2Special || "0").replace(/[^\d.]/g, ""));
    const promoPrice = Number(String(editForm.promoPrice || "0").replace(/[^\d.]/g, ""));
    const rewardPoints = Math.max(0, parseInt(String(editForm.rewardPoints || "0"), 10) || 0);
    const giftPointsCost = Math.max(0, parseInt(String(editForm.giftPointsCost || "0"), 10) || 0);
    const ingredients = String(editForm.ingredients || "").trim();
    const benefits = String(editForm.benefits || "").trim();
    const usageGuide = String(editForm.usageGuide || "").trim();

    if (!sku || sku.length < 2) {
      setEditMessage("Lỗi: Mã SKU phải có ít nhất 2 ký tự.");
      return;
    }
    if (!name || name.length < 2) {
      setEditMessage("Lỗi: Tên sản phẩm phải có ít nhất 2 ký tự.");
      return;
    }
    if (!categoryId) {
      setEditMessage("Lỗi: Vui lòng chọn ngành hàng.");
      return;
    }
    if (Number.isNaN(defaultPrice) || defaultPrice <= 0) {
      setEditMessage("Lỗi: Giá bán phải lớn hơn 0.");
      return;
    }

    try {
      setSavingEdit(true);
      setEditMessage("");
      const updated = await onUpdateProduct(selectedProduct, {
        ...editForm,
        sku,
        name,
        categoryId,
        defaultPrice,
        costPrice,
        priceLevel2: priceLevel2 > 0 ? priceLevel2 : defaultPrice,
        priceLevel2Special: priceLevel2Special > 0 ? priceLevel2Special : (priceLevel2 > 0 ? priceLevel2 : defaultPrice),
        promoPrice: promoPrice > 0 ? promoPrice : undefined,
        rewardPoints,
        giftPointsCost,
        ingredients: ingredients || undefined,
        benefits: benefits || undefined,
        usageGuide: usageGuide || undefined,
        imageGallery: editForm.imageGallery && editForm.imageGallery.length > 0 ? editForm.imageGallery : undefined,
        imageUrl: (editForm.imageGallery || []).find(g => g.isDefault)?.url || (editForm.imageGallery || [])[0]?.url || String(editForm.imageUrl || "").trim() || undefined
      });
      const resolvedCategory = updated?.category
        || payload.categories?.find((item) => item.id === (updated?.categoryId || categoryId))
        || selectedProduct.category;
      const merged = { ...selectedProduct, ...updated, category: resolvedCategory };
      setSelectedProduct(merged);
      setEditForm(buildEditForm(merged));
      setShowEditProductDialog(false);
      setEditMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không cập nhật được sản phẩm";
      setEditMessage(`Lỗi: ${message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const openCreateProductDialog = () => {
    const defaultCategoryId = payload.categories?.[0]?.id || "";
    setCreateForm({
      sku: "",
      name: "",
      categoryId: defaultCategoryId,
      productType: "GOODS",
      unit: "cái",
      salePrice: "",
      costPrice: "0",
      imageUrl: "",
      imageGallery: []
    });
    setCreateMessage("");
    setShowCreateDialog(true);
  };

  const handleCreateImageFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setCreateMessage("Lỗi: Vui lòng chọn tệp ảnh hợp lệ.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
      setCreateMessage("Lỗi: Ảnh vượt quá 5MB.");
      event.target.value = "";
      return;
    }
    try {
      setCreateUploadingImage(true);
      const dataUrl = await fileToDataUrl(file);
      setCreateForm((prev) => {
        const gallery = Array.isArray(prev.imageGallery) ? prev.imageGallery : [];
        const isDefault = gallery.length === 0;
        return { ...prev, imageGallery: [...gallery, { url: dataUrl, isDefault, showOnCorporate: true }] };
      });
      setCreateMessage("Đã tải ảnh lên.");
    } catch (error) {
      setCreateMessage(`Lỗi: ${error instanceof Error ? error.message : "Không tải được ảnh"}`);
    } finally {
      setCreateUploadingImage(false);
      event.target.value = "";
    }
  };

  const submitCreateProduct = async () => {
    if (!onCreateProduct) return;
    const sku = String(createForm.sku || "").trim();
    const name = String(createForm.name || "").trim();
    const categoryId = String(createForm.categoryId || "").trim();
    const salePrice = Number(String(createForm.salePrice || "0").replace(/[^\d.]/g, ""));
    const costPrice = Number(String(createForm.costPrice || "0").replace(/[^\d.]/g, ""));

    if (!sku || sku.length < 2) {
      setCreateMessage("Lỗi: Mã SKU phải có ít nhất 2 ký tự.");
      return;
    }
    if (!name || name.length < 2) {
      setCreateMessage("Lỗi: Tên sản phẩm phải có ít nhất 2 ký tự.");
      return;
    }
    if (!categoryId) {
      setCreateMessage("Lỗi: Vui lòng chọn ngành hàng.");
      return;
    }
    if (Number.isNaN(salePrice) || salePrice <= 0) {
      setCreateMessage("Lỗi: Giá bán phải lớn hơn 0.");
      return;
    }
    if (Number.isNaN(costPrice) || costPrice < 0) {
      setCreateMessage("Lỗi: Giá vốn không hợp lệ.");
      return;
    }

    try {
      setSavingCreate(true);
      setCreateMessage("");
      await onCreateProduct({
        sku,
        name,
        categoryId,
        productType: createForm.productType,
        unit: createForm.unit || "cái",
        salePrice,
        costPrice,
        imageGallery: createForm.imageGallery && createForm.imageGallery.length > 0 ? createForm.imageGallery : undefined,
        imageUrl: (createForm.imageGallery || []).find(g => g.isDefault)?.url || (createForm.imageGallery || [])[0]?.url || String(createForm.imageUrl || "").trim() || undefined,
        isTrackedInOverview: true,
        rewardPoints: 0
      });
      setShowCreateDialog(false);
      setCreateMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không tạo được sản phẩm";
      setCreateMessage(`Lỗi: ${message}`);
    } finally {
      setSavingCreate(false);
    }
  };

  const submitSupplierQuote = async () => {
    if (!selectedProduct?.id || !onSaveSupplierQuote) return;

    const parsedQuote = Number(String(quotePrice || "0").replace(/[^\d.]/g, ""));
    if (Number.isNaN(parsedQuote) || parsedQuote < 0) {
      setQuoteMessage("Lỗi: Chào giá NCC không hợp lệ.");
      return;
    }

    try {
      setSavingQuote(true);
      const updated = await onSaveSupplierQuote(selectedProduct, {
        supplierQuotedPrice: parsedQuote,
        supplierQuoteNote: quoteNote.trim()
      });
      setSelectedProduct((prev) => ({ ...prev, ...updated }));
      setShowQuoteDialog(false);
      setQuoteMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không lưu được chào giá NCC";
      setQuoteMessage(`Lỗi: ${message}`);
    } finally {
      setSavingQuote(false);
    }
  };

  return (
    <>
      <section className="list-card">
        <header>
          <h3>Danh sách sản phẩm</h3>
          <div className="list-card-actions">
            <span>{number.format(filteredRows.length)} bản ghi</span>
            <div className="filter-menu-wrap">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowFilterMenu((open) => !open)}
                aria-expanded={showFilterMenu}
              >
                {productFilterLabel}
              </button>
              {showFilterMenu ? (
                <div className="filter-dropdown" role="menu" aria-label="Bộ lọc sản phẩm">
                  <button
                    type="button"
                    className={`filter-option ${productFilter === "LOW_STOCK" ? "active" : ""}`}
                    onClick={() => { setProductFilter("LOW_STOCK"); setShowFilterMenu(false); }}
                  >
                    Tồn kho thấp
                  </button>
                  <button
                    type="button"
                    className={`filter-option ${productFilter === "HIGH_STOCK" ? "active" : ""}`}
                    onClick={() => { setProductFilter("HIGH_STOCK"); setShowFilterMenu(false); }}
                  >
                    Tồn kho cao
                  </button>
                  <button
                    type="button"
                    className={`filter-option ${productFilter === "COST_DESC" ? "active" : ""}`}
                    onClick={() => { setProductFilter("COST_DESC"); setShowFilterMenu(false); }}
                  >
                    Giá vốn thấp giảm dần
                  </button>
                  <button
                    type="button"
                    className={`filter-option ${productFilter === "COST_ASC" ? "active" : ""}`}
                    onClick={() => { setProductFilter("COST_ASC"); setShowFilterMenu(false); }}
                  >
                    Giá vốn tăng dần
                  </button>
                  <button
                    type="button"
                    className="filter-option filter-option-reset"
                    onClick={() => { setProductFilter("NONE"); setShowFilterMenu(false); }}
                  >
                    Đặt lại bộ lọc
                  </button>
                </div>
              ) : null}
            </div>
            <button type="button" className="btn-primary" onClick={openCreateProductDialog}>+ Tạo mới</button>
          </div>
        </header>
        <ul>
          {rows.map((item) => (
            <li key={item.id} className="product-row">
              <div className="product-row-main">
                <div className="product-thumb-wrap">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name || "Sản phẩm"} className="product-thumb" />
                  ) : (
                    <div className="product-thumb product-thumb-fallback">{(item.name || "SP").slice(0, 2).toUpperCase()}</div>
                  )}
                </div>
                <div>
                  <strong>{item.name || "Không tên"}</strong>
                  <p>{item.sku || "-"} · {item.category?.name || "Chưa phân loại"}</p>
                  <div className="product-inline-tags">
                    <span className="product-chip">Tồn: {number.format(inventoryMap.get(item.id) || 0)}</span>
                    <span className="product-chip">Giá vốn: {money.format(Number(item.costPrice || 0))}</span>
                  </div>
                </div>
              </div>
              <div className="product-row-actions">
                <span>{money.format(Number(item.defaultPrice || 0))}</span>
                <button
                  type="button"
                  className="view-btn"
                  onMouseDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    openProductDetail(item);
                  }}
                >
                  Xem
                </button>
              </div>
            </li>
          ))}
          {!rows.length ? <li className="empty-row">Không có dữ liệu phù hợp.</li> : null}
        </ul>
        {rows.length < filteredRows.length ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setVisibleProductCount((count) => count + 20)}
          >
            Xem thêm 20 sản phẩm
          </button>
        ) : null}
      </section>

      {selectedProduct ? (
        <div className="dialog-overlay">
          <div className="dialog-panel mobile-product-detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>{selectedProduct.name || "Chi tiết sản phẩm"}</h2>
                <p className="product-create-subtitle">Chỉnh sửa thông tin và phân tích sản phẩm.</p>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: "4px 12px", fontSize: "0.8rem" }}
                  onClick={() => {
                    setEditForm(buildEditForm(selectedProduct));
                    setEditMessage("");
                    setShowEditProductDialog(true);
                  }}
                >
                  Sửa
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: "4px 12px", fontSize: "0.8rem" }}
                  onClick={() => {
                    setQuotePrice(String(Number(selectedProduct?.supplierQuotedPrice || 0)));
                    setQuoteNote(selectedProduct?.supplierQuoteNote || "");
                    setQuoteMessage("");
                    setShowQuoteDialog(true);
                  }}
                >
                  Chào giá
                </button>
                <button
                  className="close-btn"
                  type="button"
                  onClick={() => {
                    setShowEditProductDialog(false);
                    setShowQuoteDialog(false);
                    setSelectedProduct(null);
                  }}
                  aria-label="Đóng"
                >
                  x
                </button>
              </div>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 10 }}>
              <section className="detail-card detail-card-grid">
                <div className="cinfo-row"><span>Mã hàng</span><span>{selectedProduct.sku || "-"}</span></div>
                <div className="cinfo-row"><span>Nhóm</span><span>{selectedProduct.category?.name || "-"}</span></div>
                <div className="cinfo-row"><span>Tồn kho</span><span>{number.format(inventoryMap.get(selectedProduct.id) || 0)}</span></div>
                <div className="cinfo-row"><span>Giá bán hiện tại</span><span>{money.format(Number(selectedProduct.defaultPrice || 0))}</span></div>
                <div className="cinfo-row"><span>Giá vốn hiện tại</span><span>{money.format(Number(selectedProduct.costPrice || 0))}</span></div>
                <div className="cinfo-row"><span>Chào giá NCC</span><span>{money.format(Number(selectedProduct.supplierQuotedPrice || 0))}</span></div>
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 8 }}>
                <h3 style={{ margin: 0 }}>Chọn thời gian phân tích</h3>
                <div className="mobile-date-range-grid">
                  <label>
                    Từ ngày
                    <input
                      type="date"
                      value={analysisFrom}
                      onChange={(event) => setAnalysisFrom(event.target.value)}
                    />
                  </label>
                  <label>
                    Đến ngày
                    <input
                      type="date"
                      value={analysisTo}
                      onChange={(event) => setAnalysisTo(event.target.value)}
                    />
                  </label>
                </div>
                <div className="mobile-quick-range-row">
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(7)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>
                    7 ngày
                  </button>
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(30)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>
                    30 ngày
                  </button>
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(90)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>
                    90 ngày
                  </button>
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(180)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>
                    6 tháng
                  </button>
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(365)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>
                    1 năm
                  </button>
                </div>
              </section>

              <section className="detail-card detail-card-grid">
                <div className="cinfo-row"><span>Số đơn phát sinh</span><span>{number.format(analysisMetrics.ordersCount)}</span></div>
                <div className="cinfo-row"><span>Sản lượng bán</span><span>{number.format(analysisMetrics.totalQuantity)}</span></div>
                <div className="cinfo-row"><span>Doanh thu</span><span style={{ color: "#16a34a", fontWeight: 600 }}>{money.format(analysisMetrics.totalRevenue)}</span></div>
                <div className="cinfo-row"><span>Lợi nhuận gộp</span><span style={{ color: analysisMetrics.totalProfit >= 0 ? "#16a34a" : "#ef4444", fontWeight: 600 }}>{money.format(analysisMetrics.totalProfit)}</span></div>
                <div className="cinfo-row"><span>Giá bán trung bình</span><span>{money.format(analysisMetrics.averageSellPrice)}</span></div>
                <div className="cinfo-row"><span>Giá vốn trung bình</span><span>{money.format(analysisMetrics.averageCost)}</span></div>
                <div className="cinfo-row"><span>Lãi gộp trung bình/SP</span><span>{money.format(analysisMetrics.averageProfitPerUnit)}</span></div>
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 6 }}>
                <h3 style={{ margin: 0 }}>Biểu đồ giá bán trung bình và giá vốn trung bình</h3>
                {trendChart ? (
                  <>
                    <svg viewBox={`0 0 ${trendChart.width} ${trendChart.height}`} className="mobile-trend-chart" role="img" aria-label="Biểu đồ giá trung bình theo ngày">
                      <polyline points={trendChart.costPath} fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points={trendChart.sellPath} fill="none" stroke="#ef6f51" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="mobile-trend-legend">
                      <span><i className="legend-dot legend-dot--sell" />Giá bán TB</span>
                      <span><i className="legend-dot legend-dot--cost" />Giá vốn TB</span>
                    </div>
                  </>
                ) : (
                  <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>Không có dữ liệu phát sinh theo khoảng thời gian đã chọn.</p>
                )}
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 6 }}>
                <h3 style={{ margin: 0 }}>Top 10 khách hàng mua nhiều nhất</h3>
                {top10Customers.length > 0 ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9" }}>
                        <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600 }}>#</th>
                        <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600 }}>Khách hàng</th>
                        <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 600 }}>SL</th>
                        <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 600 }}>Doanh thu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top10Customers.map((customer, index) => (
                        <tr key={index} style={{ borderTop: "1px solid #e2e8f0" }}>
                          <td style={{ padding: "4px 6px", color: "#64748b" }}>{index + 1}</td>
                          <td style={{ padding: "4px 6px" }}>{customer.name}</td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>{number.format(customer.quantity)}</td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>{money.format(customer.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>Không có dữ liệu trong khoảng thời gian đã chọn.</p>
                )}
              </section>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-primary" onClick={() => setSelectedProduct(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showEditProductDialog && selectedProduct ? (
        <div className="dialog-overlay" onClick={() => (!savingEdit ? setShowEditProductDialog(false) : null)}>
          <div className="dialog-panel mobile-product-detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Sửa sản phẩm</h2>
                <p className="product-create-subtitle">{selectedProduct.sku || selectedProduct.id}</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowEditProductDialog(false)} aria-label="Đóng" disabled={savingEdit}>x</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 10 }}>
              <section className="detail-card" style={{ display: "grid", gap: 10 }}>
                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Ngành hàng
                    <select value={editForm.categoryId} onChange={(event) => handleEditFieldChange("categoryId", event.target.value)}>
                      <option value="">-- Chọn ngành hàng --</option>
                      {(payload.categories || []).map((category) => (
                        <option key={category.id} value={category.id}>{category.name || category.id}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mobile-detail-field">
                    Tên sản phẩm
                    <input value={editForm.name} onChange={(event) => handleEditFieldChange("name", event.target.value)} placeholder="Nhập tên sản phẩm" />
                  </label>
                </div>

                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Loại hàng
                    <select value={editForm.productType} onChange={(event) => handleEditFieldChange("productType", event.target.value)}>
                      <option value="GOODS">Hàng hóa</option>
                      <option value="SERVICE">Dịch vụ</option>
                    </select>
                  </label>
                  <label className="mobile-detail-field">
                    Đơn vị
                    <input value={editForm.unit} onChange={(event) => handleEditFieldChange("unit", event.target.value)} placeholder="cái" />
                  </label>
                </div>

                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Trạng thái kinh doanh
                    <select
                      value={editForm.isActive ? "ACTIVE" : "INACTIVE"}
                      onChange={(event) => handleEditFieldChange("isActive", event.target.value === "ACTIVE")}
                    >
                      <option value="ACTIVE">Hoạt động</option>
                      <option value="INACTIVE">Ngừng kinh doanh</option>
                    </select>
                  </label>
                </div>

                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Giá bán
                    <input inputMode="numeric" value={formatMoneyInput(editForm.defaultPrice)} onChange={(event) => handleEditMoneyChange("defaultPrice", event.target.value)} placeholder="0" />
                  </label>
                  <label className="mobile-detail-field">
                    Giá cấp 2
                    <input inputMode="numeric" value={formatMoneyInput(editForm.priceLevel2)} onChange={(event) => handleEditMoneyChange("priceLevel2", event.target.value)} placeholder="0" />
                  </label>
                </div>

                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Giá cấp 2 ĐB
                    <input inputMode="numeric" value={formatMoneyInput(editForm.priceLevel2Special)} onChange={(event) => handleEditMoneyChange("priceLevel2Special", event.target.value)} placeholder="0" />
                  </label>
                  <label className="mobile-detail-field">
                    Giá KM
                    <input inputMode="numeric" value={formatMoneyInput(editForm.promoPrice)} onChange={(event) => handleEditMoneyChange("promoPrice", event.target.value)} placeholder="0 (không KM)" />
                  </label>
                </div>

                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Điểm thưởng
                    <input inputMode="numeric" value={editForm.rewardPoints} onChange={(event) => handleEditFieldChange("rewardPoints", event.target.value.replace(/\D/g, ""))} placeholder="0" />
                  </label>
                  <label className="mobile-detail-field">
                    Điểm đổi quà
                    <input inputMode="numeric" value={editForm.giftPointsCost} onChange={(event) => handleEditFieldChange("giftPointsCost", event.target.value.replace(/\D/g, ""))} placeholder="0" />
                  </label>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {(editForm.imageGallery || []).length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(editForm.imageGallery || []).map((img, idx) => (
                        <div key={idx} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <img src={img.url} alt={`Ảnh ${idx + 1}`} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", border: img.isDefault ? "2px solid #3b82f6" : "1px solid #e2e8f0" }} />
                          <div style={{ display: "flex", gap: 3 }}>
                            {!img.isDefault ? (
                              <button type="button" style={{ fontSize: 11, padding: "1px 5px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer", color: "#2563eb" }}
                                onClick={() => setEditForm((prev) => ({ ...prev, imageGallery: (prev.imageGallery || []).map((g, i) => ({ ...g, isDefault: i === idx })) }))}>
                                Mặc định
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 600 }}>✓ M.định</span>
                            )}
                            <button type="button" style={{ fontSize: 11, padding: "1px 5px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer", color: "#dc2626" }}
                              onClick={() => setEditForm((prev) => {
                                const next = (prev.imageGallery || []).filter((_, i) => i !== idx);
                                if (next.length > 0 && !next.some(g => g.isDefault)) next[0] = { ...next[0], isDefault: true };
                                return { ...prev, imageGallery: next };
                              })}>
                              Xóa
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      ref={editImageInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={handleEditImageFileChange}
                    />
                    <button type="button" className="btn-secondary" onClick={handlePickEditImage} disabled={uploadingImage || savingEdit}>
                      {uploadingImage ? "Đang tải ảnh..." : "Thêm ảnh"}
                    </button>
                  </div>
                </div>

                <label className="mobile-detail-field">
                  Mô tả / Thành phần
                  <textarea
                    rows={2}
                    value={editForm.ingredients}
                    onChange={(event) => handleEditFieldChange("ingredients", event.target.value)}
                    placeholder="Nhập thành phần sản phẩm..."
                    maxLength={500}
                  />
                  <small style={{ color: "#64748b" }}>{String(editForm.ingredients || "").length}/500</small>
                </label>

                <label className="mobile-detail-field">
                  Công dụng / Lợi ích
                  <textarea
                    rows={2}
                    value={editForm.benefits}
                    onChange={(event) => handleEditFieldChange("benefits", event.target.value)}
                    placeholder="Nhập công dụng, lợi ích..."
                    maxLength={500}
                  />
                  <small style={{ color: "#64748b" }}>{String(editForm.benefits || "").length}/500</small>
                </label>

                <label className="mobile-detail-field">
                  Hướng dẫn sử dụng / Tư vấn
                  <textarea
                    rows={2}
                    value={editForm.usageGuide}
                    onChange={(event) => handleEditFieldChange("usageGuide", event.target.value)}
                    placeholder="Nhập hướng dẫn, ghi chú tư vấn..."
                    maxLength={500}
                  />
                  <small style={{ color: "#64748b" }}>{String(editForm.usageGuide || "").length}/500</small>
                </label>

                {editMessage ? (
                  <p className={`form-error ${editMessage.startsWith("Lỗi:") ? "" : "form-success"}`}>{editMessage}</p>
                ) : null}
              </section>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowEditProductDialog(false)} disabled={savingEdit}>Hủy</button>
              <button type="button" className="btn-primary" disabled={savingEdit} onClick={submitEditProduct}>
                {savingEdit ? "Đang lưu..." : "Lưu sản phẩm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showQuoteDialog && selectedProduct ? (
        <div className="dialog-overlay" onClick={() => (!savingQuote ? setShowQuoteDialog(false) : null)}>
          <div className="dialog-panel" style={{ background: "#fff", padding: 10, borderRadius: 12, margin: "auto", width: "min(96vw, 520px)" }} onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Chào giá</h2>
                <p className="product-create-subtitle">{selectedProduct.name || selectedProduct.sku || "Sản phẩm"}</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowQuoteDialog(false)} aria-label="Đóng" disabled={savingQuote}>x</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 8 }}>
              <label className="mobile-detail-field">
                Chào giá NCC
                <input
                  type="text"
                  inputMode="decimal"
                  value={quotePrice}
                  onChange={(event) => setQuotePrice(event.target.value)}
                  placeholder="Nhập chào giá NCC"
                />
              </label>
              <label className="mobile-detail-field">
                Ghi chú chào giá
                <textarea
                  rows={3}
                  value={quoteNote}
                  onChange={(event) => setQuoteNote(event.target.value)}
                  placeholder="Nhập ghi chú chào giá..."
                />
              </label>
              {quoteMessage ? (
                <p className={`form-error ${quoteMessage.startsWith("Lỗi:") ? "" : "form-success"}`}>{quoteMessage}</p>
              ) : null}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowQuoteDialog(false)} disabled={savingQuote}>Hủy</button>
              <button type="button" className="btn-primary" disabled={savingQuote} onClick={submitSupplierQuote}>
                {savingQuote ? "Đang lưu..." : "Lưu chào giá"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateDialog ? (
        <div className="dialog-overlay" onClick={() => (!savingCreate ? setShowCreateDialog(false) : null)}>
          <div className="dialog-panel mobile-product-detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Tạo sản phẩm mới</h2>
                <p className="product-create-subtitle">Thêm nhanh sản phẩm để bán ngay trên mobile.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowCreateDialog(false)} aria-label="Đóng" disabled={savingCreate}>x</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 10 }}>
              <section className="detail-card" style={{ display: "grid", gap: 8 }}>
                <label className="mobile-detail-field">
                  Mã SKU
                  <input value={createForm.sku} onChange={(event) => setCreateForm((prev) => ({ ...prev, sku: event.target.value }))} placeholder="VD: SP001" />
                </label>
                <label className="mobile-detail-field">
                  Tên sản phẩm
                  <input value={createForm.name} onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Nhập tên sản phẩm" />
                </label>
                <label className="mobile-detail-field">
                  Ngành hàng
                  <select value={createForm.categoryId} onChange={(event) => setCreateForm((prev) => ({ ...prev, categoryId: event.target.value }))}>
                    <option value="">-- Chọn ngành hàng --</option>
                    {(payload.categories || []).map((category) => (
                      <option key={category.id} value={category.id}>{category.name || category.id}</option>
                    ))}
                  </select>
                </label>
                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Loại hàng
                    <select value={createForm.productType} onChange={(event) => setCreateForm((prev) => ({ ...prev, productType: event.target.value }))}>
                      <option value="GOODS">Hàng hóa</option>
                      <option value="SERVICE">Dịch vụ</option>
                    </select>
                  </label>
                  <label className="mobile-detail-field">
                    Đơn vị
                    <input value={createForm.unit} onChange={(event) => setCreateForm((prev) => ({ ...prev, unit: event.target.value }))} placeholder="cái" />
                  </label>
                </div>
                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Giá bán
                    <input inputMode="decimal" value={createForm.salePrice} onChange={(event) => setCreateForm((prev) => ({ ...prev, salePrice: event.target.value }))} placeholder="0" />
                  </label>
                  <label className="mobile-detail-field">
                    Giá vốn
                    <input inputMode="decimal" value={createForm.costPrice} onChange={(event) => setCreateForm((prev) => ({ ...prev, costPrice: event.target.value }))} placeholder="0" />
                  </label>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {(createForm.imageGallery || []).length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(createForm.imageGallery || []).map((img, idx) => (
                        <div key={idx} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <img src={img.url} alt={`Ảnh ${idx + 1}`} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", border: img.isDefault ? "2px solid #3b82f6" : "1px solid #e2e8f0" }} />
                          <div style={{ display: "flex", gap: 3 }}>
                            {!img.isDefault ? (
                              <button type="button" style={{ fontSize: 11, padding: "1px 5px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer", color: "#2563eb" }}
                                onClick={() => setCreateForm((prev) => ({ ...prev, imageGallery: (prev.imageGallery || []).map((g, i) => ({ ...g, isDefault: i === idx })) }))}>
                                Mặc định
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 600 }}>✓ M.định</span>
                            )}
                            <button type="button" style={{ fontSize: 11, padding: "1px 5px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer", color: "#dc2626" }}
                              onClick={() => setCreateForm((prev) => {
                                const next = (prev.imageGallery || []).filter((_, i) => i !== idx);
                                if (next.length > 0 && !next.some(g => g.isDefault)) next[0] = { ...next[0], isDefault: true };
                                return { ...prev, imageGallery: next };
                              })}>
                              Xóa
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      ref={createFileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={handleCreateImageFileChange}
                    />
                    <button type="button" className="btn-secondary" onClick={() => createFileInputRef.current?.click()} disabled={createUploadingImage || savingCreate}>
                      {createUploadingImage ? "Đang tải ảnh..." : "Thêm ảnh"}
                    </button>
                  </div>
                </div>
                {createMessage ? (
                  <p className={`form-error ${createMessage.startsWith("Lỗi:") ? "" : "form-success"}`}>{createMessage}</p>
                ) : null}
              </section>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowCreateDialog(false)} disabled={savingCreate}>Hủy</button>
              <button type="button" className="btn-primary" onClick={submitCreateProduct} disabled={savingCreate}>
                {savingCreate ? "Đang tạo..." : "Tạo sản phẩm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function CustomersPanel({ token, payload, query, loading, selectedStoreId, onCreateCustomer }) {
  const customerTierLabel = {
    LEVEL_2_SPECIAL: "Khách đặc biệt",
    LEVEL_2: "Khách bán sỉ",
    __none__: "Khách lẻ"
  };

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [analysisFrom, setAnalysisFrom] = useState(() => dateInputValueDaysAgo(30));
  const [analysisTo, setAnalysisTo] = useState(() => dateInputValueDaysAgo(0));
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [createForm, setCreateForm] = useState({
    code: "",
    name: "",
    phone: "",
    email: "",
    address: "",
    ledgerCode: "",
    openingBalance: "0",
    accountOwnerPositionId: ""
  });
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    phone2: "",
    phone3: "",
    email: "",
    address: "",
    ledgerCode: "",
    customerPriceTier: "__none__",
    accountOwnerPositionId: ""
  });
  const [visibleCustomerCount, setVisibleCustomerCount] = useState(20);
  const [showCustomerFilterMenu, setShowCustomerFilterMenu] = useState(false);
  const [customerFilter, setCustomerFilter] = useState("NONE");

  // Ghi chú khách hàng
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [newNoteStarred, setNewNoteStarred] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteMsg, setNoteMsg] = useState("");
  const [customerTransactions, setCustomerTransactions] = useState([]);

  const loadNotes = (customerId) => {
    setNotesLoading(true);
    setNotes([]);
    getCustomerNotes(token, customerId)
      .then((list) => setNotes(Array.isArray(list) ? list : []))
      .catch(() => setNotes([]))
      .finally(() => setNotesLoading(false));
  };

  const loadCustomerTransactions = (customerId) => {
    setCustomerTransactions([]);
    getPartnerTransactions(token, customerId)
      .then((list) => setCustomerTransactions(Array.isArray(list) ? list : []))
      .catch(() => setCustomerTransactions([]));
  };

  const isReturnPayoutNote = (note, tx) => {
    const raw = String(note || "");
    if (raw.includes("settlement=PAYOUT")) return true;
    if (raw.includes("[Thanh toán: Trả lại tiền]")) return true;
    return Number(tx?.cashAmount || 0) > 0;
  };

  const handleAddNote = async () => {
    if (!newNoteContent.trim() || !selectedCustomer?.id) return;
    setSavingNote(true);
    setNoteMsg("");
    try {
      const created = await createCustomerNote(token, selectedCustomer.id, newNoteContent.trim(), newNoteStarred);
      setNotes((prev) => {
        const next = [created, ...prev];
        return next.sort((a, b) => (b.isStarred ? 1 : 0) - (a.isStarred ? 1 : 0) || new Date(b.createdAt) - new Date(a.createdAt));
      });
      setNewNoteContent("");
      setNewNoteStarred(false);
    } catch (err) {
      setNoteMsg(err?.message || "Lỗi tạo ghi chú");
    } finally {
      setSavingNote(false);
    }
  };

  const openEditDialog = (customer) => {
    setEditForm({
      name: customer.name || "",
      phone: customer.phone || "",
      phone2: customer.phone2 || "",
      phone3: customer.phone3 || "",
      email: customer.email || "",
      address: customer.address || "",
      ledgerCode: customer.ledgerCode || "",
      customerPriceTier: customer.customerPriceTier || "__none__",
      accountOwnerPositionId: customer.accountOwnerPositionId || ""
    });
    setEditMessage("");
    setShowEditDialog(true);
  };

  const submitEditCustomer = async () => {
    if (!selectedCustomer?.id) return;
    const name = editForm.name.trim();
    if (name.length < 2) {
      setEditMessage("Đặt tên khách hàng tối thiểu 2 ký tự.");
      return;
    }
    try {
      setSavingEdit(true);
      setEditMessage("");
      await updatePartnerWithApi(token, selectedCustomer.id, {
        name,
        phone: editForm.phone.trim() || undefined,
        phone2: editForm.phone2.trim() || undefined,
        phone3: editForm.phone3.trim() || undefined,
        email: editForm.email.trim() || undefined,
        address: editForm.address.trim() || undefined,
        ledgerCode: editForm.ledgerCode.trim() || undefined,
        customerPriceTier: editForm.customerPriceTier === "__none__" ? null : editForm.customerPriceTier,
        accountOwnerPositionId: editForm.accountOwnerPositionId || null
      });
      const nextOwnerPosition = accountOwnerPositions.find((item) => item.id === editForm.accountOwnerPositionId) || null;
      setSelectedCustomer((prev) => prev ? {
        ...prev,
        name,
        phone: editForm.phone.trim(),
        phone2: editForm.phone2.trim(),
        phone3: editForm.phone3.trim(),
        email: editForm.email.trim(),
        address: editForm.address.trim(),
        ledgerCode: editForm.ledgerCode.trim(),
        customerPriceTier: editForm.customerPriceTier === "__none__" ? null : editForm.customerPriceTier,
        accountOwnerPositionId: editForm.accountOwnerPositionId || null,
        accountOwnerPosition: nextOwnerPosition
      } : prev);
      setShowEditDialog(false);
      if (onCreateCustomer) onCreateCustomer();
    } catch (err) {
      setEditMessage(err?.message || "Đã xảy ra lỗi khi cập nhật khách hàng.");
    } finally {
      setSavingEdit(false);
    }
  };

  const customerFilterLabel = useMemo(() => {
    switch (customerFilter) {
      case "REVENUE_ASC":
        return "Doanh thu tăng";
      case "REVENUE_DESC":
        return "Doanh thu giảm";
      case "DEBT_ASC":
        return "Công nợ tăng";
      case "DEBT_DESC":
        return "Công nợ giảm";
      default:
        return "Lọc";
    }
  }, [customerFilter]);

  const accountOwnerPositions = useMemo(() => {
    return (payload.accountOwnerPositions || []).filter((position) => position?.isActive !== false);
  }, [payload.accountOwnerPositions]);

  const formatAccountOwnerPositionLabel = (position) => {
    const activeUser = position?.assignments?.[0]?.user;
    if (activeUser?.fullName) {
      return `${position.name || position.code || "CSKH"} - ${activeUser.fullName}`;
    }
    return position?.name || position?.code || position?.id || "-";
  };

  const customerRevenueMap = useMemo(() => {
    const map = new Map();
    for (const order of payload.orders || []) {
      const customerId = order?.customerId;
      if (!customerId) continue;
      const status = String(order?.status || "").toUpperCase();
      if (!isMobileRevenueStatus(status)) continue;
      const prev = map.get(customerId) || 0;
      map.set(customerId, prev + getOrderNetRevenue(order));
    }
    return map;
  }, [payload.orders]);

  const highlights = payload.summary.highlights;
  const q = query.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    const rows = (payload.customers || [])
      .filter((item) => {
        if (!q) return true;
        const text = `${item?.name || ""} ${item?.phone || ""}`.toLowerCase();
        return text.includes(q);
      })
      .slice();

    switch (customerFilter) {
      case "REVENUE_ASC":
        rows.sort((left, right) => (customerRevenueMap.get(left?.id) || 0) - (customerRevenueMap.get(right?.id) || 0));
        break;
      case "REVENUE_DESC":
        rows.sort((left, right) => (customerRevenueMap.get(right?.id) || 0) - (customerRevenueMap.get(left?.id) || 0));
        break;
      case "DEBT_ASC":
        rows.sort((left, right) => Number(left?.netBalance || 0) - Number(right?.netBalance || 0));
        break;
      case "DEBT_DESC":
        rows.sort((left, right) => Number(right?.netBalance || 0) - Number(left?.netBalance || 0));
        break;
      default:
        break;
    }

    return rows;
  }, [customerFilter, customerRevenueMap, payload.customers, q]);
  const rows = filteredRows.slice(0, visibleCustomerCount);

  useEffect(() => {
    setVisibleCustomerCount(20);
  }, [q, payload.customers, customerFilter]);

  const customerAnalysis = useMemo(() => {
    if (!selectedCustomer?.id) {
      return {
        orderCount: 0,
        totalRevenue: 0,
        totalPaid: 0,
        receiptDiscount: 0,
        totalGiftValue: 0,
        totalDebt: 0,
        totalProfit: 0,
        totalCashFlow: 0,
        avgOrderValue: 0,
        avgCycleDays: 0,
        completionRate: 0,
        trendSeries: [],
        categoryBreakdown: [],
        recentOrders: []
      };
    }

    const startAt = new Date(`${analysisFrom}T00:00:00`).getTime();
    const endAt = new Date(`${analysisTo}T23:59:59`).getTime();
    if (Number.isNaN(startAt) || Number.isNaN(endAt) || startAt > endAt) {
      return {
        orderCount: 0,
        totalRevenue: 0,
        totalPaid: 0,
        receiptDiscount: 0,
        totalGiftValue: 0,
        totalDebt: 0,
        totalProfit: 0,
        totalCashFlow: 0,
        avgOrderValue: 0,
        avgCycleDays: 0,
        completionRate: 0,
        trendSeries: [],
        categoryBreakdown: [],
        recentOrders: []
      };
    }

    const relevantOrders = (payload.orders || [])
      .filter((order) => order?.customerId === selectedCustomer.id)
      .filter((order) => {
        const status = String(order?.status || "").toUpperCase();
        if (!isMobileRevenueStatus(status)) return false;
        const createdAt = new Date(order?.createdAt || 0).getTime();
        return !Number.isNaN(createdAt) && createdAt >= startAt && createdAt <= endAt;
      })
      .sort((left, right) => new Date(left?.createdAt || 0).getTime() - new Date(right?.createdAt || 0).getTime());

    const orderCount = relevantOrders.length;
    const totalRevenue = relevantOrders.reduce((sum, order) => sum + getOrderNetRevenue(order), 0);
    const relevantTransactions = (customerTransactions || []).filter((tx) => {
      const createdAt = new Date(tx?.createdAt || 0).getTime();
      return !Number.isNaN(createdAt) && createdAt >= startAt && createdAt <= endAt;
    });

    const txCashAmount = (tx) => Number(tx?.cashAmount ?? tx?.displayAmount ?? tx?.amount ?? 0);

    const totalPaidGross = relevantTransactions.reduce((sum, tx) => {
      return String(tx?.transactionType || "").toUpperCase() === "PAYMENT_RECEIPT"
        ? sum + txCashAmount(tx)
        : sum;
    }, 0);

    const totalRefundPayout = relevantTransactions.reduce((sum, tx) => {
      if (String(tx?.transactionType || "").toUpperCase() !== "RETURN_ORDER") return sum;
      if (!isReturnPayoutNote(tx?.note, tx)) return sum;
      return sum + txCashAmount(tx);
    }, 0);

    const totalReceiptVoid = relevantTransactions.reduce((sum, tx) => {
      return String(tx?.transactionType || "").toUpperCase() === "RECEIPT_VOID"
        ? sum + txCashAmount(tx)
        : sum;
    }, 0);

    const totalPaid = totalPaidGross - totalReceiptVoid - totalRefundPayout;
    const totalCashFlow = totalPaidGross - totalReceiptVoid - totalRefundPayout;
    const receiptDiscount = (payload.receipts || [])
      .filter((receipt) => receipt?.customerId === selectedCustomer.id)
      .filter((receipt) => String(receipt?.status || "").toUpperCase() !== "VOIDED")
      .filter((receipt) => {
        const createdAt = new Date(receipt?.createdAt || 0).getTime();
        return !Number.isNaN(createdAt) && createdAt >= startAt && createdAt <= endAt;
      })
      .reduce((sum, receipt) => sum + Number(receipt?.discountAmount || 0), 0);
    const totalGiftValue = (payload?.overview?.giftRedemptions || [])
      .filter((row) => row?.partnerId === selectedCustomer.id)
      .filter((row) => {
        const createdAt = new Date(row?.createdAt || 0).getTime();
        return !Number.isNaN(createdAt) && createdAt >= startAt && createdAt <= endAt;
      })
      .reduce((sum, row) => sum + Number(row?.redemptionValue || 0), 0);
    const totalDebt = relevantOrders.reduce((sum, order) => sum + Number(order?.debtAmount || 0), 0);
    const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

    const completedOrders = relevantOrders.filter((order) => ["COMPLETED", "DELIVERED"].includes(String(order?.status || "").toUpperCase())).length;
    const completionRate = orderCount > 0 ? (completedOrders / orderCount) * 100 : 0;

    let avgCycleDays = 0;
    if (relevantOrders.length > 1) {
      let totalGap = 0;
      let gapCount = 0;
      for (let index = 1; index < relevantOrders.length; index += 1) {
        const prev = new Date(relevantOrders[index - 1]?.createdAt || 0).getTime();
        const current = new Date(relevantOrders[index]?.createdAt || 0).getTime();
        if (Number.isNaN(prev) || Number.isNaN(current) || current <= prev) continue;
        totalGap += (current - prev) / (24 * 60 * 60 * 1000);
        gapCount += 1;
      }
      avgCycleDays = gapCount > 0 ? totalGap / gapCount : 0;
    }

    const categoryMap = new Map();
    for (const order of relevantOrders) {
      const items = Array.isArray(order?.items) ? order.items : [];
      for (const item of items) {
        const qty = Number(item?.quantity || 0);
        if (qty <= 0) continue;

        const unitPrice = Number(item?.unitPrice || 0);
        const discountAmount = Number(item?.discountAmount || 0);
        const lineRevenue = Math.max(qty * unitPrice - discountAmount, 0);
        const returnedQty = (item?.returnItems || []).reduce((sum, row) => sum + Number(row?.quantity || 0), 0);
        const returnedRevenue = (item?.returnItems || []).reduce((sum, row) => sum + Number(row?.amount || 0), 0);
        const netQty = Math.max(qty - returnedQty, 0);
        const netRevenue = Math.max(lineRevenue - returnedRevenue, 0);
        if (netQty <= 0 && netRevenue <= 0) continue;

        const rawCategoryName = item?.product?.category?.name
          || item?.category?.name
          || item?.product?.categoryName
          || item?.productCategoryName
          || "Khác";
        const categoryName = String(rawCategoryName || "Khác").trim() || "Khác";
        const orderRef = String(order?.id || order?.orderNo || order?.createdAt || "-");

        const bucket = categoryMap.get(categoryName) || {
          name: categoryName,
          revenue: 0,
          quantity: 0,
          orderRefs: new Set()
        };

        bucket.revenue += netRevenue;
        bucket.quantity += netQty;
        bucket.orderRefs.add(orderRef);
        categoryMap.set(categoryName, bucket);
      }
    }

    const totalCategoryRevenue = Array.from(categoryMap.values()).reduce((sum, item) => sum + item.revenue, 0);
    const categoryBreakdown = Array.from(categoryMap.values())
      .map((item) => ({
        name: item.name,
        revenue: item.revenue,
        quantity: item.quantity,
        orderCount: item.orderRefs.size,
        sharePct: totalCategoryRevenue > 0 ? (item.revenue / totalCategoryRevenue) * 100 : 0
      }))
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 8);

    const dayMap = new Map();
    for (const order of relevantOrders) {
      const dateKey = new Date(order?.createdAt || Date.now()).toISOString().slice(0, 10);
      const items = Array.isArray(order?.items) ? order.items : [];
      const orderNetRevenue = getOrderNetRevenue(order);
      const orderNetCost = items.reduce((sum, item) => {
        const unitCost = Number(item?.unitCost ?? item?.product?.costPrice ?? 0);
        return sum + getOrderItemNetQuantity(item) * unitCost;
      }, 0);
      const orderProfit = orderNetRevenue - orderNetCost;

      const bucket = dayMap.get(dateKey) || { revenue: 0, profit: 0, cashFlow: 0, debt: 0 };
      bucket.revenue += orderNetRevenue;
      bucket.profit += orderProfit;
      bucket.debt += Number(order?.debtAmount || 0);
      dayMap.set(dateKey, bucket);
    }

    for (const tx of relevantTransactions) {
      const dateKey = new Date(tx?.createdAt || Date.now()).toISOString().slice(0, 10);
      const bucket = dayMap.get(dateKey) || { revenue: 0, profit: 0, cashFlow: 0, debt: 0 };
      const type = String(tx?.transactionType || "").toUpperCase();
      const amount = txCashAmount(tx);

      if (type === "PAYMENT_RECEIPT") {
        bucket.cashFlow += amount;
      } else if (type === "RECEIPT_VOID") {
        bucket.cashFlow -= amount;
      } else if (type === "RETURN_ORDER" && isReturnPayoutNote(tx?.note, tx)) {
        bucket.cashFlow -= amount;
      }

      dayMap.set(dateKey, bucket);
    }

    const trendSeries = Array.from(dayMap.entries())
      .map(([date, value]) => ({
        date,
        revenue: value.revenue,
        profit: value.profit,
        cashFlow: value.cashFlow,
        debt: value.debt
      }))
      .sort((left, right) => left.date.localeCompare(right.date));

    const totalProfit = Array.from(dayMap.values()).reduce((sum, b) => sum + b.profit, 0);

    const recentOrders = [...relevantOrders]
      .sort((left, right) => new Date(right?.createdAt || 0).getTime() - new Date(left?.createdAt || 0).getTime())
      .slice(0, 10);

    return {
      orderCount,
      totalRevenue,
      totalPaid,
      receiptDiscount,
      totalGiftValue,
      totalDebt,
      totalProfit,
      totalCashFlow,
      avgOrderValue,
      avgCycleDays,
      completionRate,
      trendSeries,
      categoryBreakdown,
      recentOrders
    };
  }, [analysisFrom, analysisTo, customerTransactions, payload.orders, payload.receipts, selectedCustomer]);

  const customerTrendChart = useMemo(() => {
    const series = customerAnalysis.trendSeries || [];
    if (!series.length) return null;

    const width = 320;
    const height = 120;
    const padX = 16;
    const padY = 12;
    const values = series.flatMap((item) => [item.revenue, item.profit, item.cashFlow, item.debt]);
    const minValue = Math.min(...values, 0);
    const maxValue = Math.max(...values, 1);
    const span = Math.max(maxValue - minValue, 1);

    const toPoint = (index, value) => {
      const x = series.length === 1
        ? width / 2
        : padX + (index * (width - padX * 2)) / (series.length - 1);
      const y = height - padY - ((value - minValue) / span) * (height - padY * 2);
      return `${x},${y}`;
    };

    return {
      width,
      height,
      revenuePath: series.map((item, idx) => toPoint(idx, item.revenue)).join(" "),
      profitPath: series.map((item, idx) => toPoint(idx, item.profit)).join(" "),
      cashFlowPath: series.map((item, idx) => toPoint(idx, item.cashFlow)).join(" "),
      debtPath: series.map((item, idx) => toPoint(idx, item.debt)).join(" ")
    };
  }, [customerAnalysis.trendSeries]);

  const openCustomerDetail = (item) => {
    setSelectedCustomer(item);
    setAnalysisFrom(dateInputValueDaysAgo(30));
    setAnalysisTo(dateInputValueDaysAgo(0));
    setNewNoteContent("");
    setNewNoteStarred(false);
    setNoteMsg("");
    loadNotes(item.id);
    loadCustomerTransactions(item.id);
  };

  const openCreateCustomerDialog = () => {
    const autoCode = `KH${String(Date.now()).slice(-8)}`;
    setCreateForm({
      code: autoCode,
      name: "",
      phone: "",
      email: "",
      address: "",
      ledgerCode: "",
      openingBalance: "0",
      accountOwnerPositionId: ""
    });
    setCreateMessage("");
    setShowCreateDialog(true);
  };

  const submitCreateCustomer = async () => {
    if (!onCreateCustomer) return;
    const code = String(createForm.code || `KH${String(Date.now()).slice(-8)}`).trim();
    const name = String(createForm.name || "").trim();
    const ledgerCode = String(createForm.ledgerCode || "").trim();
    const openingBalance = Number(String(createForm.openingBalance || "0").replace(/[^\d.-]/g, ""));

    if (code.length < 3) {
      setCreateMessage("Lỗi: Mã khách hàng phải có ít nhất 3 ký tự.");
      return;
    }
    if (name.length < 2) {
      setCreateMessage("Lỗi: Tên khách hàng phải có ít nhất 2 ký tự.");
      return;
    }
    if (Number.isNaN(openingBalance)) {
      setCreateMessage("Lỗi: Số dư đầu kỳ không hợp lệ.");
      return;
    }

    try {
      setSavingCreate(true);
      setCreateMessage("");
      await onCreateCustomer({
        code,
        name,
        phone: String(createForm.phone || "").trim() || undefined,
        email: String(createForm.email || "").trim() || undefined,
        address: String(createForm.address || "").trim() || undefined,
        ledgerCode: ledgerCode || undefined,
        isCustomer: true,
        isSupplier: false,
        isCarrier: false,
        ownerStoreId: selectedStoreId || undefined,
        accountOwnerPositionId: String(createForm.accountOwnerPositionId || "").trim() || undefined,
        openingBalance
      });
      setShowCreateDialog(false);
      setCreateMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không tạo được khách hàng";
      setCreateMessage(`Lỗi: ${message}`);
    } finally {
      setSavingCreate(false);
    }
  };

  return (
    <>
      <section className="panel-grid compact-grid">
        <StatCard title="Khách hàng" value={toNumberText(highlights.customersCount, loading)} hint="Theo cửa hàng đã chọn" />
        <StatCard title="Chiến dịch" value={toNumberText(highlights.promotionCount, loading)} hint="Số cấu hình khuyến mãi" />
      </section>
      <section className="list-card">
        <header>
          <h3>Ds khách hàng</h3>
          <div className="list-card-actions">
            <span>{number.format(filteredRows.length)} bản ghi</span>
            <div className="filter-menu-wrap">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCustomerFilterMenu((open) => !open)}
                aria-expanded={showCustomerFilterMenu}
              >
                {customerFilterLabel}
              </button>
              {showCustomerFilterMenu ? (
                <div className="filter-dropdown" role="menu" aria-label="Bộ lọc khách hàng">
                  <button
                    type="button"
                    className={`filter-option ${customerFilter === "REVENUE_ASC" ? "active" : ""}`}
                    onClick={() => { setCustomerFilter("REVENUE_ASC"); setShowCustomerFilterMenu(false); }}
                  >
                    Doanh thu tăng dần
                  </button>
                  <button
                    type="button"
                    className={`filter-option ${customerFilter === "REVENUE_DESC" ? "active" : ""}`}
                    onClick={() => { setCustomerFilter("REVENUE_DESC"); setShowCustomerFilterMenu(false); }}
                  >
                    Doanh thu giảm dần
                  </button>
                  <button
                    type="button"
                    className={`filter-option ${customerFilter === "DEBT_ASC" ? "active" : ""}`}
                    onClick={() => { setCustomerFilter("DEBT_ASC"); setShowCustomerFilterMenu(false); }}
                  >
                    Công nợ tăng dần
                  </button>
                  <button
                    type="button"
                    className={`filter-option ${customerFilter === "DEBT_DESC" ? "active" : ""}`}
                    onClick={() => { setCustomerFilter("DEBT_DESC"); setShowCustomerFilterMenu(false); }}
                  >
                    Công nợ giảm dần
                  </button>
                  <button
                    type="button"
                    className="filter-option filter-option-reset"
                    onClick={() => { setCustomerFilter("NONE"); setShowCustomerFilterMenu(false); }}
                  >
                    Đặt lại bộ lọc
                  </button>
                </div>
              ) : null}
            </div>
            <button type="button" className="btn-primary" onClick={openCreateCustomerDialog}>+Khách hàng</button>
          </div>
        </header>
        <ul>
          {rows.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.name || "Không tên"}</strong>
                <p>{item.phone || "-"}</p>
              </div>
              <div className="customer-row-actions">
                <span>{money.format(Number(item.netBalance || 0))}</span>
                <button type="button" className="view-btn" onClick={() => openCustomerDetail(item)}>Xem</button>
              </div>
            </li>
          ))}
          {!rows.length ? <li className="empty-row">Không có dữ liệu phù hợp.</li> : null}
        </ul>
        {rows.length < filteredRows.length ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setVisibleCustomerCount((count) => count + 20)}
          >
            Xem thêm 20 khách hàng
          </button>
        ) : null}
      </section>

      {selectedCustomer ? (
        <div className="dialog-overlay" onClick={() => setSelectedCustomer(null)}>
          <div className="dialog-panel mobile-customer-detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>{selectedCustomer.name || "Chi tiết khách hàng"}</h2>
                <p className="product-create-subtitle">Phân tích chuyên sâu theo thời gian: doanh thu, công nợ, tần suất mua và trạng thái đơn.</p>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: "4px 12px", fontSize: "0.8rem" }}
                  onClick={() => openEditDialog(selectedCustomer)}
                >
                  Sửa
                </button>
                <button className="close-btn" type="button" onClick={() => setSelectedCustomer(null)} aria-label="Đóng">x</button>
              </div>
            </div>

            <div className="dialog-body" style={{ display: "grid", gap: 10 }}>
              <section className="detail-card detail-card-grid">
                <div className="cinfo-row"><span>Khách hàng</span><span>{selectedCustomer.name || "-"}</span></div>
                <div className="cinfo-row"><span>Điện thoại</span><span>{selectedCustomer.phone || "-"}</span></div>
                <div className="cinfo-row"><span>Điện thoại 2</span><span>{selectedCustomer.phone2 || "-"}</span></div>
                <div className="cinfo-row"><span>Điện thoại 3</span><span>{selectedCustomer.phone3 || "-"}</span></div>
                <div className="cinfo-row"><span>Loại khách hàng</span><span>{customerTierLabel[selectedCustomer.customerPriceTier || "__none__"] || customerTierLabel.__none__}</span></div>
                <div className="cinfo-row"><span>Vị trí phụ trách</span><span>{selectedCustomer.accountOwnerPosition ? formatAccountOwnerPositionLabel(selectedCustomer.accountOwnerPosition) : "-"}</span></div>
                <div className="cinfo-row"><span>Email</span><span>{selectedCustomer.email || "-"}</span></div>
                <div className="cinfo-row"><span>Địa chỉ</span><span>{selectedCustomer.address || "-"}</span></div>
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 8 }}>
                <h3 style={{ margin: 0 }}>Khoảng thời gian phân tích</h3>
                <div className="mobile-date-range-grid">
                  <label>
                    Từ ngày
                    <input type="date" value={analysisFrom} onChange={(event) => setAnalysisFrom(event.target.value)} />
                  </label>
                  <label>
                    Đến ngày
                    <input type="date" value={analysisTo} onChange={(event) => setAnalysisTo(event.target.value)} />
                  </label>
                </div>
                <div className="mobile-quick-range-row">
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(7)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>7 ngày</button>
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(30)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>30 ngày</button>
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(90)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>90 ngày</button>
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(180)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>6 tháng</button>
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(365)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>1 năm</button>
                  <button type="button" className="btn-cancel" onClick={() => { setAnalysisFrom(dateInputValueDaysAgo(730)); setAnalysisTo(dateInputValueDaysAgo(0)); }}>2 năm</button>
                </div>
              </section>

              <section className="detail-card detail-card-grid">
                <div className="cinfo-row"><span>Số đơn</span><span>{number.format(customerAnalysis.orderCount)}</span></div>
                <div className="cinfo-row"><span>Doanh thu</span><span>{money.format(customerAnalysis.totalRevenue)}</span></div>
                <div className="cinfo-row"><span>Lợi nhuận</span><span>{money.format(customerAnalysis.totalProfit)}</span></div>
                <div className="cinfo-row"><span>Đã thu</span><span>{money.format(customerAnalysis.totalPaid)}</span></div>
                <div className="cinfo-row"><span>Chiết khấu phiếu thu</span><span>{money.format(customerAnalysis.receiptDiscount)}</span></div>
                <div className="cinfo-row"><span>Giá trị tặng quà</span><span>{money.format(customerAnalysis.totalGiftValue)}</span></div>
                <div className="cinfo-row"><span>Số dư</span><span>{money.format(Number(selectedCustomer?.netBalance || 0))}</span></div>
                <div className="cinfo-row"><span>Giá trị đơn TB</span><span>{money.format(customerAnalysis.avgOrderValue)}</span></div>
                <div className="cinfo-row"><span>Chu kỳ mua TB</span><span>{customerAnalysis.avgCycleDays ? `${number.format(customerAnalysis.avgCycleDays.toFixed(1))} ngày` : "-"}</span></div>
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 6 }}>
                <h3 style={{ margin: 0 }}>Biểu đồ doanh thu, lợi nhuận, dòng tiền, công nợ theo ngày</h3>
                {customerTrendChart ? (
                  <>
                    <svg viewBox={`0 0 ${customerTrendChart.width} ${customerTrendChart.height}`} className="mobile-trend-chart" role="img" aria-label="Biểu đồ doanh thu, lợi nhuận, dòng tiền và công nợ theo ngày">
                      <polyline points={customerTrendChart.debtPath} fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points={customerTrendChart.cashFlowPath} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points={customerTrendChart.profitPath} fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points={customerTrendChart.revenuePath} fill="none" stroke="#16a34a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="mobile-trend-legend">
                      <span><i className="legend-dot legend-dot--revenue" />Doanh thu</span>
                      <span><i className="legend-dot legend-dot--profit" />Lợi nhuận</span>
                      <span><i className="legend-dot legend-dot--cashflow" />Dòng tiền</span>
                      <span><i className="legend-dot legend-dot--debt" />Công nợ</span>
                    </div>
                  </>
                ) : (
                  <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>Không có dữ liệu phát sinh theo khoảng thời gian đã chọn.</p>
                )}
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 8 }}>
                <h3 style={{ margin: 0 }}>Biểu đồ phân tích ngành hàng đã mua</h3>
                {(customerAnalysis.categoryBreakdown || []).length ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {customerAnalysis.categoryBreakdown.map((category) => (
                      <div key={category.name} style={{ display: "grid", gap: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.82rem" }}>
                          <strong style={{ color: "#1e293b" }}>{category.name}</strong>
                          <span style={{ color: "#475569" }}>
                            {money.format(category.revenue)} ({Number(category.sharePct || 0).toFixed(1)}%)
                          </span>
                        </div>
                        <div style={{ width: "100%", height: 10, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${Math.max(4, Math.min(100, Number(category.sharePct || 0)))}%`,
                              height: "100%",
                              borderRadius: 999,
                              background: "linear-gradient(90deg, #0ea5e9 0%, #2563eb 100%)"
                            }}
                          />
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          {number.format(category.quantity)} sản phẩm • {number.format(category.orderCount)} đơn
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>Không có ngành hàng phát sinh trong khoảng thời gian đã chọn.</p>
                )}
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 6 }}>
                <h3 style={{ margin: 0 }}>Đơn gần nhất</h3>                {(customerAnalysis.recentOrders || []).length ? (
                  <div className="mobile-mini-list">
                    {customerAnalysis.recentOrders.map((order) => (
                      <div key={order.id} className="mobile-mini-row">
                        <strong>{order.orderNo || order.id}</strong>
                        <span>{formatDateTimeVN(order.createdAt)} · {order.status || "-"}</span>
                        <em>{money.format(Number(order.totalAmount || 0))}</em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>Không có đơn phù hợp trong giai đoạn này.</p>
                )}
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 10 }}>
                <h3 style={{ margin: 0 }}>Ghi chú khách hàng</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <textarea
                    rows={3}
                    placeholder="Nhập ghi chú mới..."
                    value={newNoteContent}
                    onChange={(e) => setNewNoteContent(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.85rem", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ padding: "7px 18px", fontSize: "0.85rem" }}
                      disabled={savingNote || !newNoteContent.trim()}
                      onClick={handleAddNote}
                    >{savingNote ? "Đang lưu..." : "Thêm ghi chú"}</button>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.85rem", cursor: "pointer", userSelect: "none" }}>
                      <input
                        type="checkbox"
                        checked={newNoteStarred}
                        onChange={(e) => setNewNoteStarred(e.target.checked)}
                        style={{ width: 15, height: 15, cursor: "pointer" }}
                      />
                      <span style={{ color: newNoteStarred ? "#d97706" : "#64748b" }}>★ Ghim</span>
                    </label>
                    {noteMsg && <span style={{ fontSize: "0.8rem", color: "#dc2626" }}>{noteMsg}</span>}
                  </div>
                </div>
                {notesLoading ? (
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.8rem" }}>Đang tải...</p>
                ) : notes.length === 0 ? (
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.8rem" }}>Chưa có ghi chú nào.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {notes.map((note) => (
                      <div key={note.id} style={{ padding: "10px 12px", background: note.isStarred ? "#fffbeb" : "#f8fafc", border: `1px solid ${note.isStarred ? "#fde68a" : "#e2e8f0"}`, borderRadius: 8 }}>
                        <p style={{ margin: "0 0 6px", fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#1e293b" }}>{note.content}</p>
                        <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                          {note.creator?.fullName || "—"} · {formatDateTimeVN(note.createdAt)}
                          {note.isStarred && <span style={{ marginLeft: 6, color: "#d97706" }}>★</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-primary" onClick={() => setSelectedCustomer(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showEditDialog && selectedCustomer ? (
        <div className="dialog-overlay" onClick={() => (!savingEdit ? setShowEditDialog(false) : null)}>
          <div className="dialog-panel mobile-customer-detail-panel mobile-customer-edit-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Sửa khách hàng</h2>
                <p className="product-create-subtitle">{selectedCustomer.code || selectedCustomer.id}</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowEditDialog(false)} aria-label="Đóng" disabled={savingEdit}>x</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 10 }}>
              <section className="detail-card" style={{ display: "grid", gap: 8 }}>
                <label className="mobile-detail-field">
                  Họ tên <span style={{ color: "#dc2626" }}>*</span>
                  <input value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} placeholder="Nhập họ tên khách hàng" />
                </label>

                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Số điện thoại
                    <input value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} placeholder="Số điện thoại chính" />
                  </label>
                  <label className="mobile-detail-field">
                    Số điện thoại 2
                    <input value={editForm.phone2} onChange={(e) => setEditForm((p) => ({ ...p, phone2: e.target.value }))} placeholder="Số điện thoại phụ" />
                  </label>
                </div>

                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Số điện thoại 3
                    <input value={editForm.phone3} onChange={(e) => setEditForm((p) => ({ ...p, phone3: e.target.value }))} placeholder="Số điện thoại phụ" />
                  </label>
                  <label className="mobile-detail-field">
                    Email
                    <input value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} placeholder="email@domain.com" />
                  </label>
                </div>

                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Loại khách hàng
                    <select value={editForm.customerPriceTier} onChange={(e) => setEditForm((p) => ({ ...p, customerPriceTier: e.target.value }))}>
                      <option value="__none__">Khách lẻ</option>
                      <option value="LEVEL_2">Khách bán sỉ</option>
                      <option value="LEVEL_2_SPECIAL">Khách đặc biệt</option>
                    </select>
                  </label>
                  <label className="mobile-detail-field">
                    Vị trí phụ trách
                    <select value={editForm.accountOwnerPositionId} onChange={(e) => setEditForm((p) => ({ ...p, accountOwnerPositionId: e.target.value }))}>
                      <option value="">-- Chưa chọn --</option>
                      {accountOwnerPositions.map((position) => (
                        <option key={position.id} value={position.id}>
                          {formatAccountOwnerPositionLabel(position)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mobile-two-cols">
                  <label className="mobile-detail-field">
                    Mã sổ gốc
                    <input value={editForm.ledgerCode} onChange={(e) => setEditForm((p) => ({ ...p, ledgerCode: e.target.value }))} placeholder="Ví dụ: SG-001" />
                  </label>
                  <label className="mobile-detail-field">
                    Địa chỉ
                    <input value={editForm.address} onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))} placeholder="Nhập địa chỉ" />
                  </label>
                </div>
              </section>
              {editMessage ? <p style={{ margin: 0, color: "#dc2626", fontSize: "0.82rem" }}>{editMessage}</p> : null}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowEditDialog(false)} disabled={savingEdit}>Hủy</button>
              <button type="button" className="btn-primary" onClick={submitEditCustomer} disabled={savingEdit || !editForm.name.trim()}>
                {savingEdit ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateDialog ? (
        <div className="dialog-overlay" onClick={() => (!savingCreate ? setShowCreateDialog(false) : null)}>
          <div className="dialog-panel mobile-customer-detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Thêm khách hàng</h2>
                <p className="product-create-subtitle">Tạo nhanh khách hàng mới để lập đơn ngay trên mobile.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowCreateDialog(false)} aria-label="Đóng" disabled={savingCreate}>x</button>
            </div>

            <div className="dialog-body" style={{ display: "grid", gap: 10 }}>
              <section className="detail-card" style={{ display: "grid", gap: 8 }}>
                <label className="mobile-detail-field">
                  Tên khách hàng
                  <input value={createForm.name} onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Nhập tên khách hàng" />
                </label>
                <label className="mobile-detail-field">
                  Điện thoại
                  <input value={createForm.phone} onChange={(event) => setCreateForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="Nhập số điện thoại" />
                </label>
                <label className="mobile-detail-field">
                  Email
                  <input type="email" value={createForm.email} onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="Nhập email" />
                </label>
                <label className="mobile-detail-field">
                  Địa chỉ
                  <textarea rows={2} value={createForm.address} onChange={(event) => setCreateForm((prev) => ({ ...prev, address: event.target.value }))} placeholder="Nhập địa chỉ" />
                </label>
                <label className="mobile-detail-field">
                  Sổ gốc
                  <input value={createForm.ledgerCode} onChange={(event) => setCreateForm((prev) => ({ ...prev, ledgerCode: event.target.value }))} placeholder="Nhập mã sổ gốc" />
                </label>
                <label className="mobile-detail-field">
                  Nhân viên chăm sóc
                  <select
                    value={createForm.accountOwnerPositionId}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, accountOwnerPositionId: event.target.value }))}
                  >
                    <option value="">-- Chưa chọn --</option>
                    {accountOwnerPositions.map((position) => {
                      const activeUser = position?.assignments?.[0]?.user;
                      const label = activeUser?.fullName
                        ? `${position.name || position.code || "CSKH"} - ${activeUser.fullName}`
                        : position.name || position.code || position.id;
                      return (
                        <option key={position.id} value={position.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="mobile-detail-field">
                  Số dư đầu kỳ
                  <input inputMode="decimal" value={createForm.openingBalance} onChange={(event) => setCreateForm((prev) => ({ ...prev, openingBalance: event.target.value }))} placeholder="0" />
                </label>
                {createMessage ? (
                  <p className={`form-error ${createMessage.startsWith("Lỗi:") ? "" : "form-success"}`}>{createMessage}</p>
                ) : null}
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowCreateDialog(false)} disabled={savingCreate}>Hủy</button>
              <button type="button" className="btn-primary" onClick={submitCreateCustomer} disabled={savingCreate}>
                {savingCreate ? "Đang tạo..." : "Tạo khách hàng"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const PERIOD_TO_AREA_PRESET = {
  TODAY: "today",
  THIS_WEEK: "this-month",
  THIS_MONTH: "this-month",
  THIS_QUARTER: "this-quarter",
  THIS_YEAR: "this-year",
  LAST_YEAR: "last-year"
};

function OverviewPanel({ payload, loading, token }) {
  const [periodFilter, setPeriodFilter] = useState("THIS_MONTH");
  const [overviewTrackingFilter, setOverviewTrackingFilter] = useState("TRACKED_ONLY");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  const [areaData, setAreaData] = useState(null);
  const [areaLoading, setAreaLoading] = useState(false);
  const [areaLevel, setAreaLevel] = useState("parent");

  useEffect(() => {
    if (!token) return;
    const preset = PERIOD_TO_AREA_PRESET[periodFilter] || "this-month";
    let cancelled = false;
    setAreaLoading(true);
    getBusinessAreasDashboard(token, preset)
      .then((data) => { if (!cancelled) setAreaData(data); })
      .catch(() => { if (!cancelled) setAreaData(null); })
      .finally(() => { if (!cancelled) setAreaLoading(false); });
    return () => { cancelled = true; };
  }, [periodFilter, token]);

  const productMap = useMemo(
    () => new Map((payload.products || []).map((product) => [product.id, product])),
    [payload.products]
  );

  const categoryOptions = useMemo(() => flattenCategories(payload.categories || []), [payload.categories]);
  const range = useMemo(() => getOverviewPresetRange(periodFilter), [periodFilter]);
  const categoryNameById = useMemo(() => {
    const map = new Map();
    for (const category of categoryOptions) {
      map.set(String(category.id), category.name || category.id);
    }
    return map;
  }, [categoryOptions]);

  const matchesProductFilter = (product) => {
    if (!product) return false;
    const sameCategory = categoryFilter === "ALL" || String(product.categoryId || "") === categoryFilter;
    const sameType = typeFilter === "ALL" || String(product.productType || "GOODS") === typeFilter;
    const tracked = Boolean(product.isTrackedInOverview ?? true);
    const sameTracking = overviewTrackingFilter === "ALL" || tracked;
    return sameCategory && sameType && sameTracking;
  };

  const filteredOrderMetrics = useMemo(() => {
    const startAt = range.startAt;
    const endAt = range.endAt;
    const metrics = [];

    for (const order of (payload.orders || [])) {
      const status = String(order?.status || "").toUpperCase();
      if (["DRAFT", "CANCELLED", "REFUNDED"].includes(status)) continue;
      const createdAt = new Date(order?.createdAt || 0).getTime();
      if (Number.isNaN(createdAt) || createdAt < startAt || createdAt > endAt) continue;

      const items = Array.isArray(order?.items) ? order.items : [];
      let matchedGrossRevenue = 0;
      let matchedRawCost = 0;
      let orderGrossRevenueAllItems = 0;
      const matchedCategoryGross = new Map();

      for (const item of items) {
        const quantity = Number(item?.quantity || 0);
        if (quantity <= 0) continue;
        const unitPrice = Number(item?.unitPrice || 0);
        const discountAmount = Number(item?.discountAmount || 0);
        orderGrossRevenueAllItems += Math.max(quantity * unitPrice - discountAmount, 0);
      }

      for (const item of items) {
        const product = productMap.get(item?.productId);
        if (!matchesProductFilter(product)) continue;

        const quantity = Number(item?.quantity || 0);
        if (quantity <= 0) continue;

        const unitPrice = Number(item?.unitPrice || 0);
        const discountAmount = Number(item?.discountAmount || 0);
        const unitCost = Number(item?.unitCost ?? item?.product?.costPrice ?? product?.costPrice ?? 0);
        const itemGrossRevenue = Math.max(quantity * unitPrice - discountAmount, 0);

        matchedGrossRevenue += itemGrossRevenue;
        matchedRawCost += quantity * unitCost;

        const catId = String(product?.categoryId || "__none__");
        matchedCategoryGross.set(catId, (matchedCategoryGross.get(catId) || 0) + itemGrossRevenue);
      }

      if (matchedGrossRevenue <= 0 && matchedRawCost <= 0) continue;

      const orderNetRevenue = Math.max(Number(order?.totalAmount || 0), 0);
      const ratioBase = orderGrossRevenueAllItems > 0 ? orderGrossRevenueAllItems : matchedGrossRevenue;
      const matchedRatio = ratioBase > 0 ? Math.min(1, matchedGrossRevenue / ratioBase) : 0;
      const matchedNetRevenue = Math.max(0, orderNetRevenue * matchedRatio);
      const matchedReturnedRevenue = Math.max(0, matchedGrossRevenue - matchedNetRevenue);
      const matchedNetCost = matchedGrossRevenue > 0
        ? matchedRawCost * Math.max(0, Math.min(1, matchedNetRevenue / matchedGrossRevenue))
        : 0;

      metrics.push({
        order,
        matchedGrossRevenue,
        matchedReturnedRevenue,
        matchedNetRevenue,
        matchedNetCost,
        matchedCategoryGross
      });
    }

    return metrics;
  }, [categoryFilter, typeFilter, overviewTrackingFilter, payload.orders, productMap, range.endAt, range.startAt]);

  const overviewMetrics = useMemo(() => {
    const startAt = range.startAt;
    const endAt = range.endAt;

    let grossRevenue = 0;
    let returnedRevenue = 0;
    let netRevenue = 0;
    let netCost = 0;
    const orderCount = filteredOrderMetrics.length;
    const trendMap = new Map();

    for (const metric of filteredOrderMetrics) {
      grossRevenue += metric.matchedGrossRevenue;
      returnedRevenue += metric.matchedReturnedRevenue;
      netRevenue += metric.matchedNetRevenue;
      netCost += metric.matchedNetCost;

      const dateKey = new Date(metric.order?.createdAt || Date.now()).toISOString().slice(0, 10);
      const bucket = trendMap.get(dateKey) || { revenue: 0, profit: 0, cogs: 0 };
      bucket.revenue += metric.matchedNetRevenue;
      bucket.cogs += metric.matchedNetCost;
      trendMap.set(dateKey, bucket);
    }

    // Rebate cogs adjustment belongs to cost, not cash flow.
    // Allocate by filtered revenue ratio so category/type/tracking filters still work proportionally.
    const allNetRevenueInRange = (payload.orders || [])
      .filter((order) => {
        const status = String(order?.status || "").toUpperCase();
        if (!["DELIVERED", "COMPLETED", "RETURNED"].includes(status)) return false;
        const createdAt = new Date(order?.createdAt || 0).getTime();
        return !Number.isNaN(createdAt) && createdAt >= startAt && createdAt <= endAt;
      })
      .reduce((sum, order) => sum + Math.max(Number(order?.totalAmount || 0), 0), 0);
    const filteredRevenueRatio = allNetRevenueInRange > 0
      ? Math.max(0, Math.min(1, netRevenue / allNetRevenueInRange))
      : 0;

    let rebateCogsAdjustment = 0;
    for (const purchase of (payload.purchases || [])) {
      const createdAt = new Date(purchase?.createdAt || purchase?.purchaseDate || 0).getTime();
      if (Number.isNaN(createdAt) || createdAt < startAt || createdAt > endAt) continue;
      if (["VOIDED", "CANCELLED"].includes(String(purchase?.status || "").toUpperCase())) continue;

      const scaledAdjustment = Number(purchase?.rebateCogsAdjustment || 0) * filteredRevenueRatio;
      if (scaledAdjustment <= 0) continue;
      rebateCogsAdjustment += scaledAdjustment;

      const dateKey = new Date(createdAt).toISOString().slice(0, 10);
      const bucket = trendMap.get(dateKey) || { revenue: 0, profit: 0, cogs: 0 };
      bucket.cogs = Math.max(0, bucket.cogs - scaledAdjustment);
      trendMap.set(dateKey, bucket);
    }

    const totalDebt = (payload.customers || [])
      .reduce((sum, customer) => sum + Math.max(Number(customer?.netBalance || 0), 0), 0);

    const inventoryValue = (payload.inventory || []).reduce((sum, row) => {
      const product = productMap.get(row?.productId);
      if (!matchesProductFilter(product)) return sum;
      const qty = Number(row?.availableQuantity ?? row?.quantity ?? 0);
      const costPrice = Number(product?.costPrice || 0);
      return sum + qty * costPrice;
    }, 0);

    const localCashIn = (payload.receipts || [])
      .filter((receipt) => {
        const createdAt = new Date(receipt?.createdAt || receipt?.receiptDate || 0).getTime();
        if (Number.isNaN(createdAt) || createdAt < startAt || createdAt > endAt) return false;
        return String(receipt?.status || "").toUpperCase() !== "VOIDED";
      })
      .reduce((sum, receipt) => sum + Number(receipt?.amount || 0), 0);

    const localCashOut = (payload.purchases || [])
      .filter((purchase) => {
        const createdAt = new Date(purchase?.createdAt || purchase?.purchaseDate || 0).getTime();
        if (Number.isNaN(createdAt) || createdAt < startAt || createdAt > endAt) return false;
        return !["VOIDED", "CANCELLED"].includes(String(purchase?.status || "").toUpperCase());
      })
      .reduce((sum, purchase) => {
        const paidAmount = Number(purchase?.paidAmount || 0);
        if (paidAmount > 0) return sum + paidAmount;
        if (Array.isArray(purchase?.payments)) {
          return sum + purchase.payments.reduce((s, payment) => s + Number(payment?.amount || 0), 0);
        }
        return sum;
      }, 0);

    const overviewCashIn = Number(payload?.overview?.cashIn);
    const overviewCashOut = Number(payload?.overview?.cashOut);
    const overviewNetCashFlow = Number(payload?.overview?.netCashFlow);
    const useOverviewCashFlow = periodFilter === "THIS_MONTH"
      && Number.isFinite(overviewCashIn)
      && Number.isFinite(overviewCashOut);

    const cashIn = useOverviewCashFlow ? overviewCashIn : localCashIn;
    const cashOut = useOverviewCashFlow ? overviewCashOut : localCashOut;
    const netCashFlow = useOverviewCashFlow && Number.isFinite(overviewNetCashFlow)
      ? overviewNetCashFlow
      : (cashIn - cashOut);

    const giftRows = Array.isArray(payload?.overview?.giftRedemptions) ? payload.overview.giftRedemptions : [];
    let giftValue = 0;
    let giftCogs = 0;
    for (const row of giftRows) {
      const createdAt = new Date(row?.createdAt || 0).getTime();
      if (Number.isNaN(createdAt) || createdAt < startAt || createdAt > endAt) continue;
      const productMeta = row?.product || productMap.get(row?.productId);
      if (!matchesProductFilter(productMeta)) continue;

      const quantity = Number(row?.quantity || 0);
      const costPrice = Number(productMap.get(row?.productId)?.costPrice ?? row?.product?.costPrice ?? 0);
      giftValue += Number(row?.redemptionValue || 0);
      giftCogs += quantity * costPrice;

      const dateKey = new Date(createdAt).toISOString().slice(0, 10);
      const bucket = trendMap.get(dateKey) || { revenue: 0, profit: 0, cogs: 0 };
      bucket.cogs += quantity * costPrice;
      trendMap.set(dateKey, bucket);
    }

    const adjustedCogs = Math.max(0, netCost - rebateCogsAdjustment) + giftCogs;
    const adjustedProfit = netRevenue - adjustedCogs;
    const trendSeries = Array.from(trendMap.entries())
      .map(([date, value]) => {
        const safeCogs = Math.max(0, Number(value.cogs || 0));
        const revenue = Number(value.revenue || 0);
        return {
          date,
          revenue,
          cogs: safeCogs,
          profit: revenue - safeCogs
        };
      })
      .sort((left, right) => left.date.localeCompare(right.date));

    return {
      orderCount,
      grossRevenue,
      returnedRevenue,
      revenue: netRevenue,
      giftValue,
      profit: adjustedProfit,
      marginPercent: netRevenue > 0 ? (adjustedProfit / netRevenue) * 100 : 0,
      totalDebt,
      inventoryValue,
      cashIn,
      cashOut,
      netCashFlow,
      trendSeries
    };
  }, [filteredOrderMetrics, payload.customers, payload.inventory, payload.overview, payload.purchases, payload.receipts, periodFilter, productMap, range.endAt, range.startAt]);

  const trendChart = useMemo(() => {
    const dailySeries = (overviewMetrics.trendSeries || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!dailySeries.length) return null;

    // Nhóm theo tháng khi kỳ >= quý
    const useMonthGroup = ["THIS_QUARTER", "THIS_YEAR", "LAST_YEAR"].includes(periodFilter);

    const groupMap = new Map();
    for (const item of dailySeries) {
      const key = useMonthGroup ? item.date.slice(0, 7) : item.date; // "YYYY-MM" hoặc "YYYY-MM-DD"
      const bucket = groupMap.get(key) || { key, revenue: 0, profit: 0, cogs: 0 };
      bucket.revenue += item.revenue;
      bucket.profit += item.profit;
      bucket.cogs += item.cogs;
      groupMap.set(key, bucket);
    }

    const grouped = Array.from(groupMap.values());

    const formatLabel = (key) => {
      if (useMonthGroup) {
        const [year, month] = key.split("-");
        return `T${Number(month)}/${year}`;
      }
      const d = new Date(`${key}T00:00:00`);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    };

    const maxAbs = Math.max(
      ...grouped.flatMap((item) => [Math.abs(item.revenue), Math.abs(item.profit), Math.abs(item.cogs)]),
      1
    );

    const rows = grouped.map((item) => ({
      label: formatLabel(item.key),
      key: item.key,
      metrics: [
        { key: "revenue", label: "Doanh thu", value: item.revenue, color: "#16a34a" },
        { key: "profit", label: "Lợi nhuận", value: item.profit, color: "#7c3aed" },
        { key: "cogs", label: "Giá vốn", value: item.cogs, color: "#0ea5e9" }
      ]
    }));

    return { maxAbs, rows, groupLabel: useMonthGroup ? "tháng" : "ngày" };
  }, [overviewMetrics.trendSeries, periodFilter]);

  const categoryMetrics = useMemo(() => {
    const catMap = new Map();

    for (const metric of filteredOrderMetrics) {
      const totalGross = metric.matchedGrossRevenue;
      if (totalGross <= 0) continue;

      for (const [catId, catGross] of metric.matchedCategoryGross.entries()) {
        const ratio = Math.max(0, Math.min(1, catGross / totalGross));
        const catName = categoryNameById.get(String(catId)) || "Khác";
        const bucket = catMap.get(catId) || { name: catName, revenue: 0, profit: 0 };
        bucket.revenue += metric.matchedNetRevenue * ratio;
        bucket.profit += (metric.matchedNetRevenue - metric.matchedNetCost) * ratio;
        catMap.set(catId, bucket);
      }
    }

    const totalCategoryRevenue = Array.from(catMap.values()).reduce((sum, item) => sum + Number(item.revenue || 0), 0);
    const allNetRevenueInRange = (payload.orders || [])
      .filter((order) => {
        const status = String(order?.status || "").toUpperCase();
        if (!["DELIVERED", "COMPLETED", "RETURNED"].includes(status)) return false;
        const createdAt = new Date(order?.createdAt || 0).getTime();
        return !Number.isNaN(createdAt) && createdAt >= range.startAt && createdAt <= range.endAt;
      })
      .reduce((sum, order) => sum + Math.max(Number(order?.totalAmount || 0), 0), 0);

    const filteredRevenueRatio = allNetRevenueInRange > 0
      ? Math.max(0, Math.min(1, totalCategoryRevenue / allNetRevenueInRange))
      : 0;

    const rebateAdjustment = (payload.purchases || [])
      .filter((purchase) => {
        const createdAt = new Date(purchase?.createdAt || purchase?.purchaseDate || 0).getTime();
        if (Number.isNaN(createdAt) || createdAt < range.startAt || createdAt > range.endAt) return false;
        return !["VOIDED", "CANCELLED"].includes(String(purchase?.status || "").toUpperCase());
      })
      .reduce((sum, purchase) => sum + Number(purchase?.rebateCogsAdjustment || 0), 0) * filteredRevenueRatio;

    if (rebateAdjustment > 0 && totalCategoryRevenue > 0) {
      for (const bucket of catMap.values()) {
        const share = Math.max(0, Math.min(1, Number(bucket.revenue || 0) / totalCategoryRevenue));
        bucket.profit += rebateAdjustment * share;
      }
    }

    const giftRows = Array.isArray(payload?.overview?.giftRedemptions) ? payload.overview.giftRedemptions : [];
    for (const row of giftRows) {
      const createdAt = new Date(row?.createdAt || 0).getTime();
      if (Number.isNaN(createdAt) || createdAt < range.startAt || createdAt > range.endAt) continue;
      const productMeta = row?.product || productMap.get(row?.productId);
      if (!matchesProductFilter(productMeta)) continue;

      const quantity = Number(row?.quantity || 0);
      const costPrice = Number(productMap.get(row?.productId)?.costPrice ?? row?.product?.costPrice ?? 0);
      const catId = String(productMeta?.categoryId || "__none__");
      const catName = categoryNameById.get(catId) || "Khác";
      const bucket = catMap.get(catId) || { name: catName, revenue: 0, profit: 0 };
      bucket.profit -= quantity * costPrice;
      catMap.set(catId, bucket);
    }

    return Array.from(catMap.values()).sort((a, b) => b.revenue - a.revenue);
  }, [
    categoryNameById,
    filteredOrderMetrics,
    payload.orders,
    payload.overview,
    payload.purchases,
    productMap,
    range.endAt,
    range.startAt
  ]);

  const customerGroupMetrics = useMemo(() => {
    const customerMap = new Map((payload.customers || []).map((c) => [c.id, c]));

    const TIER_LABELS = {
      LEVEL_2_SPECIAL: "Khách đặc biệt",
      LEVEL_2: "Khách bán sỉ",
      __none__: "Khách lẻ"
    };
    const groupMap = new Map();

    for (const metric of filteredOrderMetrics) {
      const customer = customerMap.get(metric.order?.customerId);
      const tierKey = customer?.customerPriceTier || "__none__";
      const tierLabel = TIER_LABELS[tierKey] || tierKey;

      const bucket = groupMap.get(tierKey) || { name: tierLabel, revenue: 0, profit: 0, orderCount: 0 };
      bucket.revenue += metric.matchedNetRevenue;
      bucket.profit += metric.matchedNetRevenue - metric.matchedNetCost;
      bucket.orderCount += 1;
      groupMap.set(tierKey, bucket);
    }

    const totalGroupRevenue = Array.from(groupMap.values()).reduce((sum, item) => sum + Number(item.revenue || 0), 0);
    const allNetRevenueInRange = (payload.orders || [])
      .filter((order) => {
        const status = String(order?.status || "").toUpperCase();
        if (!["DELIVERED", "COMPLETED", "RETURNED"].includes(status)) return false;
        const createdAt = new Date(order?.createdAt || 0).getTime();
        return !Number.isNaN(createdAt) && createdAt >= range.startAt && createdAt <= range.endAt;
      })
      .reduce((sum, order) => sum + Math.max(Number(order?.totalAmount || 0), 0), 0);

    const filteredRevenueRatio = allNetRevenueInRange > 0
      ? Math.max(0, Math.min(1, totalGroupRevenue / allNetRevenueInRange))
      : 0;

    const rebateAdjustment = (payload.purchases || [])
      .filter((purchase) => {
        const createdAt = new Date(purchase?.createdAt || purchase?.purchaseDate || 0).getTime();
        if (Number.isNaN(createdAt) || createdAt < range.startAt || createdAt > range.endAt) return false;
        return !["VOIDED", "CANCELLED"].includes(String(purchase?.status || "").toUpperCase());
      })
      .reduce((sum, purchase) => sum + Number(purchase?.rebateCogsAdjustment || 0), 0) * filteredRevenueRatio;

    if (rebateAdjustment > 0 && totalGroupRevenue > 0) {
      for (const bucket of groupMap.values()) {
        const share = Math.max(0, Math.min(1, Number(bucket.revenue || 0) / totalGroupRevenue));
        bucket.profit += rebateAdjustment * share;
      }
    }

    const giftRows = Array.isArray(payload?.overview?.giftRedemptions) ? payload.overview.giftRedemptions : [];
    for (const row of giftRows) {
      const createdAt = new Date(row?.createdAt || 0).getTime();
      if (Number.isNaN(createdAt) || createdAt < range.startAt || createdAt > range.endAt) continue;
      const productMeta = row?.product || productMap.get(row?.productId);
      if (!matchesProductFilter(productMeta)) continue;

      const customer = customerMap.get(row?.partnerId);
      const tierKey = customer?.customerPriceTier || "__none__";
      const tierLabel = TIER_LABELS[tierKey] || tierKey;
      const quantity = Number(row?.quantity || 0);
      const costPrice = Number(productMap.get(row?.productId)?.costPrice ?? row?.product?.costPrice ?? 0);

      const bucket = groupMap.get(tierKey) || { name: tierLabel, revenue: 0, profit: 0, orderCount: 0 };
      bucket.profit -= quantity * costPrice;
      groupMap.set(tierKey, bucket);
    }

    return Array.from(groupMap.values()).sort((a, b) => b.profit - a.profit);
  }, [
    filteredOrderMetrics,
    payload.customers,
    payload.orders,
    payload.overview,
    payload.purchases,
    productMap,
    range.endAt,
    range.startAt
  ]);

  return (
    <>
      <section className="detail-card" style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Theo dõi tổng quan</h3>
        <div className="overview-filter-grid">
          <label>
            Khoảng thời gian
            <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
              <option value="TODAY">Hôm nay</option>
              <option value="THIS_WEEK">Tuần này</option>
              <option value="THIS_MONTH">Tháng này</option>
              <option value="THIS_QUARTER">Quý này</option>
              <option value="THIS_YEAR">Năm này</option>
              <option value="LAST_YEAR">Năm trước</option>
            </select>
          </label>
          <label>
            Theo dõi Tổng quan
            <select value={overviewTrackingFilter} onChange={(event) => setOverviewTrackingFilter(event.target.value)}>
              <option value="TRACKED_ONLY">Chỉ những sản phẩm theo dõi</option>
              <option value="ALL">Tất cả sản phẩm</option>
            </select>
          </label>
          <label>
            Ngành hàng
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="ALL">Tất cả ngành hàng</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            Loại hàng
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="ALL">Tất cả</option>
              <option value="GOODS">Hàng hóa</option>
              <option value="SERVICE">Dịch vụ</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel-grid compact-grid">
        <StatCard
          title="Doanh thu thuần"
          value={loading ? "..." : money.format(overviewMetrics.revenue)}
          hint={`Gộp ${money.format(overviewMetrics.grossRevenue)} • Trả hàng ${money.format(overviewMetrics.returnedRevenue)}`}
        />
        <StatCard title="Lợi nhuận" value={loading ? "..." : money.format(overviewMetrics.profit)} hint={`Biên lợi nhuận: ${number.format(overviewMetrics.marginPercent.toFixed(1))}%`} />
        <StatCard title="Giá trị tặng quà" value={loading ? "..." : money.format(overviewMetrics.giftValue)} hint="Ước tính theo giá bán của dòng quà tặng" />
        <StatCard title="Công nợ khách hàng" value={loading ? "..." : money.format(overviewMetrics.totalDebt)} hint="Tổng dư nợ hiện tại" />
        <StatCard title="Giá trị tồn kho" value={loading ? "..." : money.format(overviewMetrics.inventoryValue)} hint="Theo giá vốn và tồn khả dụng" />
      </section>

      <section className="detail-card detail-card-grid">
        <div className="cinfo-row"><span>Dòng tiền vào</span><span>{money.format(overviewMetrics.cashIn)}</span></div>
        <div className="cinfo-row"><span>Dòng tiền ra</span><span>{money.format(overviewMetrics.cashOut)}</span></div>
        <div className="cinfo-row"><span>Dòng tiền thuần</span><span>{money.format(overviewMetrics.netCashFlow)}</span></div>
      </section>

      <section className="detail-card" style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Doanh thu theo Ngành hàng</h3>
        {categoryMetrics.length === 0 ? (
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>Không có dữ liệu trong khoảng thời gian đã chọn.</p>
        ) : (
          categoryMetrics.map((cat) => {
            const maxRev = categoryMetrics[0].revenue;
            const pct = maxRev > 0 ? Math.round((cat.revenue / maxRev) * 100) : 0;
            return (
              <div key={`rev-${cat.name}`} style={{ display: "grid", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                  <span>{cat.name}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{money.format(cat.revenue)}</span>
                </div>
                <div style={{ background: "#e2e8f0", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, background: "#16a34a", height: 8, borderRadius: 4, transition: "width 0.3s" }} />
                </div>
              </div>
            );
          })
        )}
      </section>

      <section className="detail-card" style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Lợi nhuận theo Ngành hàng</h3>
        {categoryMetrics.length === 0 ? (
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>Không có dữ liệu trong khoảng thời gian đã chọn.</p>
        ) : (() => {
          const maxProfit = Math.max(...categoryMetrics.map((c) => c.profit), 1);
          return categoryMetrics.map((cat) => {
            const isNeg = cat.profit < 0;
            const pct = maxProfit > 0 ? Math.round((Math.max(cat.profit, 0) / maxProfit) * 100) : 0;
            return (
              <div key={`pft-${cat.name}`} style={{ display: "grid", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                  <span>{cat.name}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: isNeg ? "#dc2626" : "inherit" }}>{money.format(cat.profit)}</span>
                </div>
                <div style={{ background: "#e2e8f0", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, background: isNeg ? "#dc2626" : "#7c3aed", height: 8, borderRadius: 4, transition: "width 0.3s" }} />
                </div>
              </div>
            );
          });
        })()}
      </section>

      <section className="detail-card" style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Lợi nhuận theo nhóm khách hàng</h3>
        {customerGroupMetrics.length === 0 ? (
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>Không có dữ liệu trong khoảng thời gian đã chọn.</p>
        ) : (() => {
          const maxProfit = Math.max(...customerGroupMetrics.map((g) => Math.abs(g.profit)), 1);
          return customerGroupMetrics.map((group) => {
            const isNeg = group.profit < 0;
            const pct = Math.round((Math.abs(group.profit) / maxProfit) * 100);
            return (
              <div key={group.name} style={{ display: "grid", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                  <span>{group.name}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: isNeg ? "#dc2626" : "inherit" }}>{money.format(group.profit)}</span>
                </div>
                <div style={{ background: "#e2e8f0", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, background: isNeg ? "#dc2626" : "#0ea5e9", height: 8, borderRadius: 4, transition: "width 0.3s" }} />
                </div>
                <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                  {group.orderCount} đơn • DT: {money.format(group.revenue)}
                </div>
              </div>
            );
          });
        })()}
      </section>

      <section className="detail-card" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Doanh thu theo Khu vực kinh doanh</h3>
          <div style={{ display: "flex", gap: 4 }}>
            {[{ key: "parent", label: "Cấp 1" }, { key: "child", label: "Cấp 2" }].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setAreaLevel(key)}
                style={{
                  padding: "2px 10px", fontSize: "0.72rem", borderRadius: 12, border: "1px solid",
                  cursor: "pointer", fontWeight: areaLevel === key ? 700 : 400,
                  background: areaLevel === key ? "#f59e0b" : "#fff",
                  color: areaLevel === key ? "#fff" : "#64748b",
                  borderColor: areaLevel === key ? "#f59e0b" : "#cbd5e1"
                }}
              >{label}</button>
            ))}
          </div>
        </div>
        {areaLoading ? (
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>Đang tải...</p>
        ) : (() => {
          const flatAreas = Array.isArray(areaData?.areas) ? areaData.areas : [];
          const UNASSIGNED = "__unassigned__";

          // Tách unassigned ra xử lý riêng
          const unassigned = flatAreas.find((a) => a.id === UNASSIGNED);
          const realAreas = flatAreas.filter((a) => a.id !== UNASSIGNED);
          const parentAreas = realAreas.filter((a) => !a.parentId);
          const childAreas = realAreas.filter((a) => Boolean(a.parentId));
          const parentIds = new Set(parentAreas.map((a) => a.id));

          let displayAreas;
          if (areaLevel === "parent") {
            // Cấp 1: gộp doanh thu con vào cha
            displayAreas = parentAreas.map((parent) => {
              const children = childAreas.filter((c) => c.parentId === parent.id);
              const totalAmt = [parent, ...children].reduce((s, a) => s + Number(a.periodSalesAmount || 0), 0);
              const totalOrders = [parent, ...children].reduce((s, a) => s + Number(a.periodSalesOrders || 0), 0);
              return { ...parent, _amt: totalAmt, _orders: totalOrders };
            });
          } else {
            // Cấp 2: chỉ con; cha không có con thì hiện cha
            const parentsWithChildren = new Set(childAreas.map((c) => c.parentId));
            const childRows = childAreas.map((a) => ({ ...a, _amt: Number(a.periodSalesAmount || 0), _orders: Number(a.periodSalesOrders || 0) }));
            const parentsFallback = parentAreas
              .filter((p) => !parentsWithChildren.has(p.id))
              .map((a) => ({ ...a, _amt: Number(a.periodSalesAmount || 0), _orders: Number(a.periodSalesOrders || 0) }));
            displayAreas = [...childRows, ...parentsFallback];
          }

          // Thêm "Chưa xác định" nếu có
          if (unassigned && Number(unassigned.periodSalesAmount || 0) > 0) {
            displayAreas = [...displayAreas, { ...unassigned, _amt: Number(unassigned.periodSalesAmount || 0), _orders: Number(unassigned.periodSalesOrders || 0) }];
          }

          const withRevenue = displayAreas
            .filter((a) => a._amt > 0)
            .sort((a, b) => b._amt - a._amt);

          if (withRevenue.length === 0) {
            return <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>Không có dữ liệu trong khoảng thời gian đã chọn.</p>;
          }
          const maxAmt = withRevenue[0]._amt;
          return withRevenue.map((area) => {
            const pct = maxAmt > 0 ? Math.round((area._amt / maxAmt) * 100) : 0;
            const isUnassigned = area.id === UNASSIGNED;
            return (
              <div key={area.id} style={{ display: "grid", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%", color: isUnassigned ? "#94a3b8" : undefined }}>
                    {area.code && area.code !== "N/A" ? <strong style={{ marginRight: 4 }}>{area.code}</strong> : null}{area.name}
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{money.format(area._amt)}</span>
                </div>
                <div style={{ background: "#e2e8f0", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, background: isUnassigned ? "#94a3b8" : "#f59e0b", height: 8, borderRadius: 4, transition: "width 0.3s" }} />
                </div>
                <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                  {area._orders} đơn hàng
                </div>
              </div>
            );
          });
        })()}
      </section>
    </>
  );
}

function MorePanel({
  token,
  payload,
  loading,
  onLogout,
  storeOptions,
  selectedStoreId,
  storeLabel,
  showStorePicker,
  onToggleStorePicker,
  onStoreChange,
  onNavigate
}) {
  const [showOrdersDialog, setShowOrdersDialog] = useState(false);
  const [showReceiptsDialog, setShowReceiptsDialog] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [receiptSearch, setReceiptSearch] = useState("");
  const [visibleOrderCount, setVisibleOrderCount] = useState(20);
  const [visibleReceiptCount, setVisibleReceiptCount] = useState(20);
  const [ordersDialogRows, setOrdersDialogRows] = useState([]);
  const [receiptsDialogRows, setReceiptsDialogRows] = useState([]);
  const [ordersDialogLoading, setOrdersDialogLoading] = useState(false);
  const [receiptsDialogLoading, setReceiptsDialogLoading] = useState(false);
  const [ordersDialogError, setOrdersDialogError] = useState("");
  const [receiptsDialogError, setReceiptsDialogError] = useState("");
  const [watchlistRows, setWatchlistRows] = useState([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState("");
  const [maintenanceActive, setMaintenanceActive] = useState(null); // null = chưa load
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState("");
  const [showStaffKpiDialog, setShowStaffKpiDialog] = useState(false);
  const [staffKpiRows, setStaffKpiRows] = useState([]);
  const [staffKpiLoading, setStaffKpiLoading] = useState(false);
  const [staffKpiError, setStaffKpiError] = useState("");
  const [staffKpiTimePeriod, setStaffKpiTimePeriod] = useState("this-month");
  const [staffKpiPositionId, setStaffKpiPositionId] = useState("");
  const [staffKpiPositions, setStaffKpiPositions] = useState([]);
  const [staffKpiPositionsLoading, setStaffKpiPositionsLoading] = useState(false);
  const [selectedStaffKpiRow, setSelectedStaffKpiRow] = useState(null);
  const isSuperAdmin = getTokenRoles(token || "").includes("SUPER_ADMIN");
  const [serverHealth, setServerHealth] = useState(null);
  const [serverHealthLoading, setServerHealthLoading] = useState(false);
  const [serverHealthError, setServerHealthError] = useState("");

  const fetchServerHealth = async () => {
    if (!token) return;
    setServerHealthLoading(true);
    setServerHealthError("");
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE || "http://localhost:4000"}/api/system/health`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      setServerHealth(json.data ?? json);
    } catch (e) {
      setServerHealthError("Không tải được thông tin hệ thống.");
    } finally {
      setServerHealthLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin && token) fetchServerHealth();
  }, [isSuperAdmin, token]);
  const highlights = payload.summary.highlights;
  const orderRows = (ordersDialogRows || [])
    .slice()
    .sort((left, right) => new Date(right?.createdAt || 0).getTime() - new Date(left?.createdAt || 0).getTime())
    ;
  const receiptRows = (receiptsDialogRows || [])
    .slice()
    .sort((left, right) => new Date(right?.createdAt || right?.receiptDate || 0).getTime() - new Date(left?.createdAt || left?.receiptDate || 0).getTime())
    ;
  const normalizedOrderSearch = String(orderSearch || "").trim().toLowerCase();
  const normalizedReceiptSearch = String(receiptSearch || "").trim().toLowerCase();
  const filteredOrderRows = normalizedOrderSearch
    ? orderRows.filter((order) => {
      const text = `${order.orderNo || order.id || ""} ${order.customer?.name || ""} ${order.status || ""}`.toLowerCase();
      return text.includes(normalizedOrderSearch);
    })
    : orderRows;
  const filteredReceiptRows = normalizedReceiptSearch
    ? receiptRows.filter((receipt) => {
      const text = `${receipt.receiptNo || receipt.id || ""} ${receipt.customer?.name || ""} ${receipt.type || ""} ${receipt.status || ""}`.toLowerCase();
      return text.includes(normalizedReceiptSearch);
    })
    : receiptRows;
  const visibleOrderRows = filteredOrderRows.slice(0, visibleOrderCount);
  const visibleReceiptRows = filteredReceiptRows.slice(0, visibleReceiptCount);
  const pendingOrders = payload.orders
    .filter((order) => ["DRAFT", "CONFIRMED", "PROCESSING"].includes(String(order?.status)))
    .slice(0, 12);
  const heldCustomers = useMemo(() => {
    if (!selectedStaffKpiRow?.positionId) return [];
    return (payload.customers || [])
      .filter((customer) => String(customer?.accountOwnerPositionId || "") === String(selectedStaffKpiRow.positionId))
      .sort((left, right) => Number(right?.netBalance || 0) - Number(left?.netBalance || 0));
  }, [payload.customers, selectedStaffKpiRow]);

  useEffect(() => {
    if (showOrdersDialog) {
      setVisibleOrderCount(20);
    }
  }, [showOrdersDialog, normalizedOrderSearch]);

  useEffect(() => {
    if (showReceiptsDialog) {
      setVisibleReceiptCount(20);
    }
  }, [showReceiptsDialog, normalizedReceiptSearch]);

  useEffect(() => {
    if (!showOrdersDialog || !token) return;
    let cancelled = false;

    const loadOrders = async () => {
      try {
        setOrdersDialogLoading(true);
        setOrdersDialogError("");
        const rows = await getMobileOrders(token, selectedStoreId);
        if (!cancelled) {
          setOrdersDialogRows(rows);
        }
      } catch (error) {
        if (!cancelled) {
          setOrdersDialogRows([]);
          setOrdersDialogError(error instanceof Error ? error.message : "Không tải được đơn hàng");
        }
      } finally {
        if (!cancelled) {
          setOrdersDialogLoading(false);
        }
      }
    };

    loadOrders();
    return () => {
      cancelled = true;
    };
  }, [showOrdersDialog, token, selectedStoreId]);

  useEffect(() => {
    if (!showReceiptsDialog || !token) return;
    let cancelled = false;

    const loadReceipts = async () => {
      try {
        setReceiptsDialogLoading(true);
        setReceiptsDialogError("");
        const rows = await getMobileReceipts(token, selectedStoreId);
        if (!cancelled) {
          setReceiptsDialogRows(rows);
        }
      } catch (error) {
        if (!cancelled) {
          setReceiptsDialogRows([]);
          setReceiptsDialogError(error instanceof Error ? error.message : "Không tải được phiếu thu");
        }
      } finally {
        if (!cancelled) {
          setReceiptsDialogLoading(false);
        }
      }
    };

    loadReceipts();
    return () => {
      cancelled = true;
    };
  }, [showReceiptsDialog, token, selectedStoreId]);

  useEffect(() => {
    if (!token || !selectedStoreId) {
      setWatchlistRows([]);
      return;
    }
    let cancelled = false;
    const loadWatchlist = async () => {
      try {
        setWatchlistLoading(true);
        setWatchlistError("");
        const rows = await getStoreWatchlist(token, selectedStoreId);
        if (!cancelled) setWatchlistRows(rows);
      } catch (err) {
        if (!cancelled) {
          setWatchlistRows([]);
          setWatchlistError(err instanceof Error ? err.message : "Không tải được danh sách theo dõi");
        }
      } finally {
        if (!cancelled) setWatchlistLoading(false);
      }
    };
    loadWatchlist();
    return () => { cancelled = true; };
  }, [token, selectedStoreId]);

  useEffect(() => {
    if (!isSuperAdmin || !token) return;
    let cancelled = false;
    getMaintenanceStatus(token)
      .then((status) => { if (!cancelled) setMaintenanceActive(status.active); })
      .catch(() => { if (!cancelled) setMaintenanceActive(false); });
    return () => { cancelled = true; };
  }, [isSuperAdmin, token]);

  useEffect(() => {
    if (!showStaffKpiDialog || !token) return;
    if (!selectedStoreId) {
      setStaffKpiPositions([]);
      setStaffKpiPositionId("");
      return;
    }

    let cancelled = false;

    const loadStorePositions = async () => {
      try {
        setStaffKpiPositionsLoading(true);
        const rows = await getStorePositions(token, selectedStoreId);
        if (cancelled) return;
        setStaffKpiPositions(rows);
        setStaffKpiPositionId((current) => {
          if (current && rows.some((item) => item.id === current)) return current;
          return rows[0]?.id || "";
        });
      } catch (_error) {
        if (!cancelled) {
          setStaffKpiPositions([]);
          setStaffKpiPositionId("");
        }
      } finally {
        if (!cancelled) {
          setStaffKpiPositionsLoading(false);
        }
      }
    };

    loadStorePositions();

    return () => {
      cancelled = true;
    };
  }, [showStaffKpiDialog, token, selectedStoreId]);

  useEffect(() => {
    if (!showStaffKpiDialog || !token) return;
    if (!selectedStoreId) {
      setStaffKpiRows([]);
      setStaffKpiError("Vui lòng chọn cửa hàng trước khi xem KPI nhân viên.");
      return;
    }
    if (!staffKpiPositionId) {
      setStaffKpiRows([]);
      setStaffKpiError("");
      return;
    }

    let cancelled = false;

    const loadStaffKpi = async () => {
      try {
        setStaffKpiLoading(true);
        setStaffKpiError("");
        setSelectedStaffKpiRow(null);
        const rows = await getStaffKpiByPosition(token, {
          timePeriod: staffKpiTimePeriod,
          positionId: staffKpiPositionId
        });
        if (!cancelled) {
          setStaffKpiRows(rows);
        }
      } catch (error) {
        if (!cancelled) {
          setStaffKpiRows([]);
          setStaffKpiError(error instanceof Error ? error.message : "Không tải được KPI nhân viên");
        }
      } finally {
        if (!cancelled) {
          setStaffKpiLoading(false);
        }
      }
    };

    loadStaffKpi();

    return () => {
      cancelled = true;
    };
  }, [showStaffKpiDialog, token, selectedStoreId, staffKpiPositionId, staffKpiTimePeriod]);

  const handleToggleMaintenance = async () => {
    if (!token) return;
    const next = !maintenanceActive;
    setMaintenanceLoading(true);
    setMaintenanceError("");
    try {
      const result = await setMaintenanceMode(token, next);
      setMaintenanceActive(result.active);
    } catch (err) {
      setMaintenanceError(err instanceof Error ? err.message : "Thao tác thất bại");
    } finally {
      setMaintenanceLoading(false);
    }
  };

  return (
    <>
      <section className="store-switch-wrap">
        <button type="button" className="store-switch-btn" onClick={onToggleStorePicker} aria-expanded={showStorePicker}>
          <span>Cửa hàng thao tác</span>
          <strong>{storeLabel}</strong>
        </button>
        {showStorePicker ? (
          <div className="store-switch-panel">
            <button
              type="button"
              className={`store-option ${selectedStoreId === "" ? "active" : ""}`}
              onClick={() => onStoreChange("")}
            >
              Tất cả cửa hàng
            </button>
            {storeOptions.map((store) => (
              <button
                key={store.id}
                type="button"
                className={`store-option ${selectedStoreId === store.id ? "active" : ""}`}
                onClick={() => onStoreChange(store.id)}
              >
                {store.name || store.code || store.id}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="more-menu-grid">
        <button type="button" className="more-menu-card" onClick={() => onNavigate("orders")}>
          <div className="more-menu-icon"><OrderIcon /></div>
          <span className="more-menu-label">Đơn hàng</span>
          {highlights.pendingOrders > 0 ? <em className="more-menu-badge">{highlights.pendingOrders > 99 ? "99+" : highlights.pendingOrders}</em> : null}
        </button>
        <button type="button" className="more-menu-card" onClick={() => onNavigate("receipts")}>
          <div className="more-menu-icon"><ReceiptIcon /></div>
          <span className="more-menu-label">Phiếu thu</span>
        </button>
        <button type="button" className="more-menu-card" onClick={() => onNavigate("staff-kpi")}>
          <div className="more-menu-icon"><KpiIcon /></div>
          <span className="more-menu-label">KPI nhân viên</span>
        </button>
        <button type="button" className="more-menu-card" onClick={() => onNavigate("watchlist")}>
          <div className="more-menu-icon"><UsersIcon /></div>
          <span className="more-menu-label">Khách theo dõi</span>
        </button>
        <button type="button" className="more-menu-card" onClick={() => onNavigate("suppliers")}>
          <div className="more-menu-icon"><TruckIcon /></div>
          <span className="more-menu-label">Nhà cung cấp</span>
        </button>
        <button type="button" className="more-menu-card" onClick={() => onNavigate("articles")}>
          <div className="more-menu-icon"><ArticleIcon /></div>
          <span className="more-menu-label">Bài viết & Tin tức</span>
        </button>
        {isSuperAdmin ? (
          <button type="button" className="more-menu-card" onClick={() => onNavigate("maintenance")}>
            <div className="more-menu-icon"><SettingsIcon /></div>
            <span className="more-menu-label">Bảo trì website</span>
          </button>
        ) : null}
      </section>

      {isSuperAdmin ? (
        <section className="detail-card" style={{ display: "grid", gap: 10, marginTop: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Hệ thống &amp; Cơ sở dữ liệu</h3>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "4px 10px" }}
              onClick={fetchServerHealth}
              disabled={serverHealthLoading}
            >
              {serverHealthLoading ? "Đang tải..." : "Làm mới"}
            </button>
          </div>
          {serverHealthError ? (
            <p style={{ margin: 0, color: "#dc2626", fontSize: "0.82rem" }}>{serverHealthError}</p>
          ) : serverHealth ? (
            <>
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.8rem", color: "#475569", marginBottom: 4 }}>RAM máy chủ</div>
                <div style={{ background: "#e2e8f0", borderRadius: 6, height: 10, overflow: "hidden", marginBottom: 4 }}>
                  <div style={{ width: `${serverHealth.os?.memUsagePct ?? 0}%`, background: (serverHealth.os?.memUsagePct ?? 0) > 85 ? "#ef4444" : "#3b82f6", height: 10, borderRadius: 6, transition: "width 0.4s" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "#64748b" }}>
                  <span>Đã dùng: {serverHealth.os?.usedMemMb ?? "?"} MB</span>
                  <span>Tổng: {serverHealth.os?.totalMemMb ?? "?"} MB ({serverHealth.os?.memUsagePct ?? "?"}%)</span>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 600, fontSize: "0.8rem", color: "#475569", marginBottom: 4 }}>Heap Node.js</div>
                <div style={{ background: "#e2e8f0", borderRadius: 6, height: 10, overflow: "hidden", marginBottom: 4 }}>
                  {(() => {
                    const pct = serverHealth.process?.heapTotalMb > 0
                      ? Math.round((serverHealth.process.heapUsedMb / serverHealth.process.heapTotalMb) * 100)
                      : 0;
                    return <div style={{ width: `${pct}%`, background: pct > 85 ? "#ef4444" : "#8b5cf6", height: 10, borderRadius: 6, transition: "width 0.4s" }} />;
                  })()}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "#64748b" }}>
                  <span>Heap: {serverHealth.process?.heapUsedMb ?? "?"} / {serverHealth.process?.heapTotalMb ?? "?"} MB</span>
                  <span>RSS: {serverHealth.process?.rssMemMb ?? "?"} MB</span>
                </div>
              </div>

              <div className="detail-card-grid" style={{ border: "none", padding: 0, gap: 6 }}>
                <div className="cinfo-row"><span>CPU</span><span>{serverHealth.os?.cpuCount ?? "?"} nhân</span></div>
                <div className="cinfo-row"><span>Load avg (1m)</span><span>{serverHealth.os?.loadAvg1m ?? "?"}</span></div>
                <div className="cinfo-row"><span>Load avg (5m)</span><span>{serverHealth.os?.loadAvg5m ?? "?"}</span></div>
                <div className="cinfo-row"><span>Uptime OS</span><span>{serverHealth.os?.uptime != null ? `${Math.floor(serverHealth.os.uptime / 3600)}h ${Math.floor((serverHealth.os.uptime % 3600) / 60)}m` : "?"}</span></div>
                <div className="cinfo-row"><span>Uptime API</span><span>{serverHealth.process?.uptimeSec != null ? `${Math.floor(serverHealth.process.uptimeSec / 3600)}h ${Math.floor((serverHealth.process.uptimeSec % 3600) / 60)}m` : "?"}</span></div>
                <div className="cinfo-row"><span>Node.js</span><span>{serverHealth.process?.nodeVersion ?? "?"}</span></div>
                <div className="cinfo-row"><span>DB trạng thái</span><span style={{ color: serverHealth.database?.status === "ok" ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{serverHealth.database?.status === "ok" ? "Kết nối tốt" : "Lỗi"}</span></div>
                <div className="cinfo-row"><span>DB ping</span><span>{serverHealth.database?.pingMs != null ? `${serverHealth.database.pingMs} ms` : "?"}</span></div>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.82rem" }}>Đang tải thông tin hệ thống...</p>
          )}
        </section>
      ) : null}

      <button type="button" className="logout-btn-more" onClick={onLogout}>
        Đăng xuất
      </button>

      {showStaffKpiDialog ? (
        <div className="dialog-overlay" onClick={() => setShowStaffKpiDialog(false)}>
          <div className="dialog-panel mobile-customer-detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>KPI nhân viên</h2>
                <p className="product-create-subtitle">Lọc theo vị trí cửa hàng và thời gian để theo dõi hiệu quả.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowStaffKpiDialog(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body" style={{ display: "grid", gap: 8 }}>
              <section className="detail-card" style={{ display: "grid", gap: 8 }}>
                <div className="kpi-filter-grid">
                  <label>
                    Khoảng thời gian
                    <select
                      value={staffKpiTimePeriod}
                      onChange={(event) => setStaffKpiTimePeriod(event.target.value)}
                    >
                      <option value="this-month">Tháng này</option>
                      <option value="this-quarter">Quý này</option>
                      <option value="this-year">Năm này</option>
                      <option value="last-year">Năm trước</option>
                    </select>
                  </label>
                  <label>
                    Vị trí cửa hàng
                    <select
                      value={staffKpiPositionId}
                      onChange={(event) => setStaffKpiPositionId(event.target.value)}
                      disabled={!selectedStoreId || staffKpiPositionsLoading}
                    >
                      {!selectedStoreId ? <option value="">Chọn cửa hàng trước</option> : null}
                      {selectedStoreId && !staffKpiPositions.length ? <option value="">Không có vị trí</option> : null}
                      {staffKpiPositions.map((position) => (
                        <option key={position.id} value={position.id}>
                          {formatStorePositionLabel(position)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              <section className="list-card">
                <header>
                  <h3>Danh sách KPI</h3>
                  <span>{staffKpiLoading ? "..." : `${number.format(staffKpiRows.length)} bản ghi`}</span>
                </header>
                {staffKpiError ? <p className="form-error in-page">{staffKpiError}</p> : null}
                <ul>
                  {staffKpiLoading ? <li className="empty-row">Đang tải dữ liệu KPI...</li> : null}
                  {!staffKpiLoading && staffKpiRows.map((row, index) => (
                    <li key={row.positionId || row.userId || `${row.fullName || "kpi"}-${index}`} className="kpi-row-item">
                      <div>
                        <strong>{row.positionName || row.positionCode || row.fullName || "Chưa có tên"}</strong>
                        <p>
                          Doanh thu: {money.format(Number(row.revenue || 0))}
                          {` · Lợi nhuận: ${money.format(Number(row.profit || 0))}`}
                        </p>
                        <p>
                          {`Khách hoạt động: ${number.format(Number(row.customersActive || 0))}`}
                          {` · Đơn hàng: ${number.format(Number(row.ordersCount || 0))}`}
                        </p>
                      </div>
                      <button type="button" className="view-btn" onClick={() => setSelectedStaffKpiRow(row)}>
                        Xem
                      </button>
                    </li>
                  ))}
                  {!staffKpiLoading && !staffKpiRows.length && !staffKpiError ? (
                    <li className="empty-row">Không có dữ liệu trong bộ lọc đã chọn.</li>
                  ) : null}
                </ul>
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-primary" onClick={() => setShowStaffKpiDialog(false)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedStaffKpiRow ? (
        <div className="dialog-overlay" onClick={() => setSelectedStaffKpiRow(null)}>
          <div className="dialog-panel mobile-customer-detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Chi tiết KPI nhân viên</h2>
                <p className="product-create-subtitle">{selectedStaffKpiRow.positionName || selectedStaffKpiRow.positionCode || selectedStaffKpiRow.fullName || "-"}</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setSelectedStaffKpiRow(null)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body" style={{ display: "grid", gap: 8 }}>
              <section className="detail-card detail-card-grid">
                <div className="cinfo-row"><span>Doanh thu</span><span>{money.format(Number(selectedStaffKpiRow.revenue || 0))}</span></div>
                <div className="cinfo-row"><span>Giá vốn</span><span>{money.format(Number(selectedStaffKpiRow.cogs || 0))}</span></div>
                <div className="cinfo-row"><span>Lợi nhuận</span><span>{money.format(Number(selectedStaffKpiRow.profit || 0))}</span></div>
                <div className="cinfo-row"><span>Khách hoạt động</span><span>{number.format(Number(selectedStaffKpiRow.customersActive || 0))}</span></div>
                <div className="cinfo-row"><span>Số đơn</span><span>{number.format(Number(selectedStaffKpiRow.ordersCount || 0))}</span></div>
              </section>

              {Array.isArray(selectedStaffKpiRow.usersInvolved) && selectedStaffKpiRow.usersInvolved.length ? (
                <section className="list-card">
                  <header>
                    <h3>Nhân viên liên quan</h3>
                    <span>{number.format(selectedStaffKpiRow.usersInvolved.length)} người</span>
                  </header>
                  <ul>
                    {selectedStaffKpiRow.usersInvolved.map((user) => (
                      <li key={user.id || user.fullName}>
                        <div>
                          <strong>{user.fullName || user.id || "-"}</strong>
                          <p>{user.id || ""}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="list-card">
                <header>
                  <h3>Khách hàng đang nắm giữ</h3>
                  <span>{number.format(heldCustomers.length)} khách</span>
                </header>
                <ul>
                  {heldCustomers.map((customer) => (
                    <li key={customer.id || customer.code || customer.name}>
                      <div>
                        <strong>{customer.name || customer.code || customer.id || "-"}</strong>
                        <p>
                          {customer.phone || "Không có SĐT"}
                          {Number(customer.netBalance || 0) > 0 ? ` · Công nợ: ${money.format(Number(customer.netBalance || 0))}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                  {!heldCustomers.length ? (
                    <li className="empty-row">Chưa có khách hàng đang được vị trí này nắm giữ.</li>
                  ) : null}
                </ul>
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-primary" onClick={() => setSelectedStaffKpiRow(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showOrdersDialog ? (
        <div className="dialog-overlay" onClick={() => setShowOrdersDialog(false)}>
          <div className="dialog-panel mobile-customer-detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Danh sách đơn hàng</h2>
                <p className="product-create-subtitle">Hiển thị 20 đơn đầu, bấm xem thêm để tải dần trên màn hình.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowOrdersDialog(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body">
              <section className="list-card">
                <header>
                  <h3>Đơn hàng</h3>
                  <span>{number.format(filteredOrderRows.length)} bản ghi</span>
                </header>
                <div className="toolbar-grid" style={{ marginBottom: 8 }}>
                  <input
                    value={orderSearch}
                    onChange={(event) => setOrderSearch(event.target.value)}
                    placeholder="Tìm mã đơn, khách hàng, trạng thái..."
                  />
                </div>
                {ordersDialogError ? <p className="form-error in-page">{ordersDialogError}</p> : null}
                <ul>
                  {ordersDialogLoading ? <li className="empty-row">Đang tải đơn hàng...</li> : null}
                  {visibleOrderRows.map((order) => (
                    <li key={order.id}>
                      <div>
                        <strong>{order.orderNo || order.id}</strong>
                        <p>{order.customer?.name || "Khách lẻ"} · {order.status || "-"} · {formatDateTimeVN(order.createdAt)}</p>
                      </div>
                      <span>{money.format(Number(order.totalAmount || 0))}</span>
                    </li>
                  ))}
                  {!ordersDialogLoading && !filteredOrderRows.length ? <li className="empty-row">Không có đơn hàng phù hợp.</li> : null}
                </ul>
                {visibleOrderCount < filteredOrderRows.length ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setVisibleOrderCount((count) => count + 20)}
                  >
                    Xem thêm 20 đơn
                  </button>
                ) : null}
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-primary" onClick={() => setShowOrdersDialog(false)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showReceiptsDialog ? (
        <div className="dialog-overlay" onClick={() => setShowReceiptsDialog(false)}>
          <div className="dialog-panel mobile-customer-detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Danh sách phiếu thu</h2>
                <p className="product-create-subtitle">Hiển thị 20 phiếu đầu, bấm xem thêm để tải dần trên màn hình.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowReceiptsDialog(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body">
              <section className="list-card">
                <header>
                  <h3>Phiếu thu</h3>
                  <span>{number.format(filteredReceiptRows.length)} bản ghi</span>
                </header>
                <div className="toolbar-grid" style={{ marginBottom: 8 }}>
                  <input
                    value={receiptSearch}
                    onChange={(event) => setReceiptSearch(event.target.value)}
                    placeholder="Tìm mã phiếu, khách hàng, trạng thái..."
                  />
                </div>
                {receiptsDialogError ? <p className="form-error in-page">{receiptsDialogError}</p> : null}
                <ul>
                  {receiptsDialogLoading ? <li className="empty-row">Đang tải phiếu thu...</li> : null}
                  {visibleReceiptRows.map((receipt) => (
                    <li key={receipt.id}>
                      <div>
                        <strong>{receipt.receiptNo || receipt.id}</strong>
                        <p>
                          {receipt.customer?.name || "Khách lẻ"}
                          {` · ${receipt.type || "PAYMENT"}`}
                          {` · ${receipt.status || "ACTIVE"}`}
                          {` · ${formatDateTimeVN(receipt.createdAt || receipt.receiptDate)}`}
                        </p>
                      </div>
                      <span>{money.format(Number(receipt.amount || 0) + Number(receipt.discountAmount || 0))}</span>
                    </li>
                  ))}
                  {!receiptsDialogLoading && !filteredReceiptRows.length ? <li className="empty-row">Không có phiếu thu phù hợp.</li> : null}
                </ul>
                {visibleReceiptCount < filteredReceiptRows.length ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setVisibleReceiptCount((count) => count + 20)}
                  >
                    Xem thêm 20 phiếu
                  </button>
                ) : null}
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-primary" onClick={() => setShowReceiptsDialog(false)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function StaffKpiScreen({ token, selectedStoreId, payload }) {
  const [kpiRows, setKpiRows] = useState([]);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiError, setKpiError] = useState("");
  const [timePeriod, setTimePeriod] = useState("this-month");
  const [positionId, setPositionId] = useState("");
  const [positions, setPositions] = useState([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);

  const heldCustomers = useMemo(() => {
    if (!selectedRow?.positionId) return [];
    return (payload.customers || [])
      .filter((c) => String(c?.accountOwnerPositionId || "") === String(selectedRow.positionId))
      .sort((a, b) => Number(b?.netBalance || 0) - Number(a?.netBalance || 0));
  }, [payload.customers, selectedRow]);

  useEffect(() => {
    if (!token || !selectedStoreId) { setPositions([]); setPositionId(""); return; }
    let cancelled = false;
    const load = async () => {
      try {
        setPositionsLoading(true);
        const rows = await getStorePositions(token, selectedStoreId);
        if (cancelled) return;
        setPositions(rows);
        setPositionId((cur) => (cur && rows.some((r) => r.id === cur)) ? cur : (rows[0]?.id || ""));
      } catch (_e) {
        if (!cancelled) { setPositions([]); setPositionId(""); }
      } finally {
        if (!cancelled) setPositionsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token, selectedStoreId]);

  useEffect(() => {
    if (!token || !selectedStoreId) {
      setKpiRows([]);
      setKpiError("Vui lòng chọn cửa hàng để xem KPI nhân viên.");
      return;
    }
    if (!positionId) { setKpiRows([]); setKpiError(""); return; }
    let cancelled = false;
    const load = async () => {
      try {
        setKpiLoading(true);
        setKpiError("");
        setSelectedRow(null);
        const rows = await getStaffKpiByPosition(token, { timePeriod, positionId });
        if (!cancelled) setKpiRows(rows);
      } catch (err) {
        if (!cancelled) { setKpiRows([]); setKpiError(err instanceof Error ? err.message : "Không tải được KPI"); }
      } finally {
        if (!cancelled) setKpiLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token, selectedStoreId, positionId, timePeriod]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <section className="detail-card" style={{ display: "grid", gap: 8 }}>
        <div className="kpi-filter-grid">
          <label>
            Khoảng thời gian
            <select value={timePeriod} onChange={(e) => setTimePeriod(e.target.value)}>
              <option value="this-month">Tháng này</option>
              <option value="this-quarter">Quý này</option>
              <option value="this-year">Năm này</option>
              <option value="last-year">Năm trước</option>
            </select>
          </label>
          <label>
            Vị trí cửa hàng
            <select value={positionId} onChange={(e) => setPositionId(e.target.value)} disabled={!selectedStoreId || positionsLoading}>
              {!selectedStoreId ? <option value="">Chọn cửa hàng trước</option> : null}
              {selectedStoreId && !positions.length ? <option value="">Không có vị trí</option> : null}
              {positions.map((p) => <option key={p.id} value={p.id}>{formatStorePositionLabel(p)}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="list-card">
        <header>
          <h3>Danh sách KPI</h3>
          <span>{kpiLoading ? "..." : `${number.format(kpiRows.length)} bản ghi`}</span>
        </header>
        {kpiError ? <p className="form-error in-page">{kpiError}</p> : null}
        <ul>
          {kpiLoading ? <li className="empty-row">Đang tải dữ liệu KPI...</li> : null}
          {!kpiLoading && kpiRows.map((row, i) => (
            <li key={row.positionId || row.userId || `kpi-${i}`} className="kpi-row-item">
              <div>
                <strong>{row.positionName || row.positionCode || row.fullName || "Chưa có tên"}</strong>
                <p>Doanh thu: {money.format(Number(row.revenue || 0))} · Lợi nhuận: {money.format(Number(row.profit || 0))}</p>
                <p>Khách hoạt động: {number.format(Number(row.customersActive || 0))} · Đơn hàng: {number.format(Number(row.ordersCount || 0))}</p>
              </div>
              <button type="button" className="view-btn" onClick={() => setSelectedRow(row)}>Xem</button>
            </li>
          ))}
          {!kpiLoading && !kpiRows.length && !kpiError ? <li className="empty-row">Không có dữ liệu trong bộ lọc đã chọn.</li> : null}
        </ul>
      </section>

      {selectedRow ? (
        <div className="dialog-overlay" onClick={() => setSelectedRow(null)}>
          <div className="dialog-panel mobile-customer-detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Chi tiết KPI</h2>
                <p className="product-create-subtitle">{selectedRow.positionName || selectedRow.positionCode || selectedRow.fullName || "-"}</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setSelectedRow(null)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 8 }}>
              <section className="detail-card detail-card-grid">
                <div className="cinfo-row"><span>Doanh thu</span><span>{money.format(Number(selectedRow.revenue || 0))}</span></div>
                <div className="cinfo-row"><span>Giá vốn</span><span>{money.format(Number(selectedRow.cogs || 0))}</span></div>
                <div className="cinfo-row"><span>Lợi nhuận</span><span>{money.format(Number(selectedRow.profit || 0))}</span></div>
                <div className="cinfo-row"><span>Khách hoạt động</span><span>{number.format(Number(selectedRow.customersActive || 0))}</span></div>
                <div className="cinfo-row"><span>Số đơn</span><span>{number.format(Number(selectedRow.ordersCount || 0))}</span></div>
              </section>
              {Array.isArray(selectedRow.usersInvolved) && selectedRow.usersInvolved.length ? (
                <section className="list-card">
                  <header><h3>Nhân viên liên quan</h3><span>{number.format(selectedRow.usersInvolved.length)} người</span></header>
                  <ul>
                    {selectedRow.usersInvolved.map((u) => (
                      <li key={u.id || u.fullName}><div><strong>{u.fullName || u.id || "-"}</strong><p>{u.id || ""}</p></div></li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section className="list-card">
                <header><h3>Khách hàng đang nắm giữ</h3><span>{number.format(heldCustomers.length)} khách</span></header>
                <ul>
                  {heldCustomers.map((c) => (
                    <li key={c.id || c.code || c.name}>
                      <div>
                        <strong>{c.name || c.code || c.id || "-"}</strong>
                        <p>{c.phone || "Không có SĐT"}{Number(c.netBalance || 0) > 0 ? ` · Công nợ: ${money.format(Number(c.netBalance || 0))}` : ""}</p>
                      </div>
                    </li>
                  ))}
                  {!heldCustomers.length ? <li className="empty-row">Chưa có khách hàng đang được vị trí này nắm giữ.</li> : null}
                </ul>
              </section>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-primary" onClick={() => setSelectedRow(null)}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OrdersScreen({ token, selectedStoreId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await getMobileOrders(token, selectedStoreId);
        if (!cancelled) setRows(data.slice().sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime()));
      } catch (err) {
        if (!cancelled) { setRows([]); setError(err instanceof Error ? err.message : "Không tải được đơn hàng"); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token, selectedStoreId]);

  useEffect(() => { setVisibleCount(20); }, [search]);

  const normalized = search.trim().toLowerCase();
  const filtered = normalized
    ? rows.filter((o) => `${o.orderNo || o.id} ${o.customer?.name || ""} ${o.status || ""}`.toLowerCase().includes(normalized))
    : rows;
  const visible = filtered.slice(0, visibleCount);

  return (
    <section className="list-card">
      <header>
        <h3>Đơn hàng</h3>
        <span>{loading ? "..." : `${number.format(filtered.length)} bản ghi`}</span>
      </header>
      <div className="toolbar-grid" style={{ padding: "0 0 8px" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm mã đơn, khách hàng, trạng thái..." />
      </div>
      {error ? <p className="form-error in-page">{error}</p> : null}
      <ul>
        {loading ? <li className="empty-row">Đang tải đơn hàng...</li> : null}
        {!loading && visible.map((o) => (
          <li key={o.id}>
            <div>
              <strong>{o.orderNo || o.id}</strong>
              <p>{o.customer?.name || "Khách lẻ"} · {o.status || "-"} · {formatDateTimeVN(o.createdAt)}</p>
            </div>
            <span>{money.format(Number(o.totalAmount || 0))}</span>
          </li>
        ))}
        {!loading && !filtered.length ? <li className="empty-row">Không có đơn hàng phù hợp.</li> : null}
      </ul>
      {visibleCount < filtered.length ? (
        <button type="button" className="btn-secondary" onClick={() => setVisibleCount((c) => c + 20)}>Xem thêm 20 đơn</button>
      ) : null}
    </section>
  );
}

function ReceiptsScreen({ token, selectedStoreId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await getMobileReceipts(token, selectedStoreId);
        if (!cancelled) setRows(data.slice().sort((a, b) => new Date(b?.createdAt || b?.receiptDate || 0).getTime() - new Date(a?.createdAt || a?.receiptDate || 0).getTime()));
      } catch (err) {
        if (!cancelled) { setRows([]); setError(err instanceof Error ? err.message : "Không tải được phiếu thu"); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token, selectedStoreId]);

  useEffect(() => { setVisibleCount(20); }, [search]);

  const normalized = search.trim().toLowerCase();
  const filtered = normalized
    ? rows.filter((r) => `${r.receiptNo || r.id} ${r.customer?.name || ""} ${r.type || ""} ${r.status || ""}`.toLowerCase().includes(normalized))
    : rows;
  const visible = filtered.slice(0, visibleCount);

  return (
    <section className="list-card">
      <header>
        <h3>Phiếu thu</h3>
        <span>{loading ? "..." : `${number.format(filtered.length)} bản ghi`}</span>
      </header>
      <div className="toolbar-grid" style={{ padding: "0 0 8px" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm mã phiếu, khách hàng, trạng thái..." />
      </div>
      {error ? <p className="form-error in-page">{error}</p> : null}
      <ul>
        {loading ? <li className="empty-row">Đang tải phiếu thu...</li> : null}
        {!loading && visible.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.receiptNo || r.id}</strong>
              <p>{r.customer?.name || "Khách lẻ"} · {r.type || "PAYMENT"} · {r.status || "ACTIVE"} · {formatDateTimeVN(r.createdAt || r.receiptDate)}</p>
            </div>
            <span>{money.format(Number(r.amount || 0) + Number(r.discountAmount || 0))}</span>
          </li>
        ))}
        {!loading && !filtered.length ? <li className="empty-row">Không có phiếu thu phù hợp.</li> : null}
      </ul>
      {visibleCount < filtered.length ? (
        <button type="button" className="btn-secondary" onClick={() => setVisibleCount((c) => c + 20)}>Xem thêm 20 phiếu</button>
      ) : null}
    </section>
  );
}

function WatchlistScreen({ token, selectedStoreId, payload }) {
  const [watchlistRows, setWatchlistRows] = useState([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState("");
  const pendingOrders = (payload.orders || [])
    .filter((o) => ["DRAFT", "CONFIRMED", "PROCESSING"].includes(String(o?.status)))
    .slice(0, 12);

  useEffect(() => {
    if (!token || !selectedStoreId) { setWatchlistRows([]); return; }
    let cancelled = false;
    const load = async () => {
      try {
        setWatchlistLoading(true);
        setWatchlistError("");
        const rows = await getStoreWatchlist(token, selectedStoreId);
        if (!cancelled) setWatchlistRows(rows);
      } catch (err) {
        if (!cancelled) { setWatchlistRows([]); setWatchlistError(err instanceof Error ? err.message : "Không tải được danh sách theo dõi"); }
      } finally {
        if (!cancelled) setWatchlistLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token, selectedStoreId]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <section className="list-card">
        <header>
          <h3>Đơn cần xử lý</h3>
          <span>{number.format(pendingOrders.length)} bản ghi</span>
        </header>
        <ul>
          {pendingOrders.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.orderNo || item.id}</strong>
                <p>{item.customer?.name || "Khách lẻ"}</p>
              </div>
              <span>{item.status || "-"}</span>
            </li>
          ))}
          {!pendingOrders.length ? <li className="empty-row">Không có đơn cần xử lý.</li> : null}
        </ul>
      </section>

      <section className="list-card">
        <header>
          <h3>Khách hàng đang theo dõi</h3>
          <span>{!watchlistLoading ? `${watchlistRows.length} khách` : "..."}</span>
        </header>
        {watchlistError ? <p className="form-error in-page">{watchlistError}</p> : null}
        {!selectedStoreId ? (
          <p className="empty-row">Chọn cửa hàng để xem danh sách theo dõi.</p>
        ) : (
          <ul>
            {watchlistLoading ? <li className="empty-row">Đang tải...</li> : null}
            {!watchlistLoading && watchlistRows.map((item) => (
              <li key={`${item.watchedByUserId}_${item.id}`}>
                <div>
                  <strong>{item.name}</strong>
                  <p>
                    {item.phone !== "-" ? item.phone : ""}
                    {item.phone !== "-" && item.netBalance !== 0 ? " · " : ""}
                    {item.netBalance !== 0 ? `Công nợ: ${money.format(item.netBalance)}` : ""}
                  </p>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted, #888)" }}>Theo dõi bởi: {item.watchedByName}</p>
                </div>
                <span style={{ fontSize: "0.75rem", color: item.source === "debt" ? "var(--danger, #e53)" : "var(--accent, #0a7)" }}>
                  {item.source === "debt" ? "Công nợ" : "Doanh số"}
                </span>
              </li>
            ))}
            {!watchlistLoading && !watchlistRows.length && selectedStoreId ? (
              <li className="empty-row">Chưa có khách hàng nào được theo dõi.</li>
            ) : null}
          </ul>
        )}
      </section>
    </div>
  );
}

function getSupplierPeriodRanges(timePeriod) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  let curFrom, curTo, prevFrom, prevTo, label;
  if (timePeriod === "this-month") {
    curFrom = new Date(y, m, 1);
    curTo = new Date(y, m + 1, 0);
    prevFrom = new Date(y, m - 1, 1);
    prevTo = new Date(y, m, 0);
    label = "Tháng này vs tháng trước";
  } else if (timePeriod === "last-month") {
    curFrom = new Date(y, m - 1, 1);
    curTo = new Date(y, m, 0);
    prevFrom = new Date(y, m - 2, 1);
    prevTo = new Date(y, m - 1, 0);
    label = "Tháng trước vs 2 tháng trước";
  } else if (timePeriod === "this-quarter") {
    const q = Math.floor(m / 3);
    curFrom = new Date(y, q * 3, 1);
    curTo = new Date(y, q * 3 + 3, 0);
    prevFrom = new Date(y, (q - 1) * 3, 1);
    prevTo = new Date(y, q * 3, 0);
    label = "Quý này vs quý trước";
  } else {
    curFrom = new Date(y, 0, 1);
    curTo = new Date(y, 11, 31);
    prevFrom = new Date(y - 1, 0, 1);
    prevTo = new Date(y - 1, 11, 31);
    label = "Năm này vs năm trước";
  }
  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    current: { from: fmt(curFrom), to: fmt(curTo) },
    prev: { from: fmt(prevFrom), to: fmt(prevTo) },
    label
  };
}

function SupplierMiniBarChart({ curAmount, prevAmount }) {
  const maxVal = Math.max(curAmount, prevAmount, 1);
  const H = 80;
  const barW = 44;
  const gap = 18;
  const totalW = barW * 2 + gap + 32;
  const curH = Math.round((curAmount / maxVal) * H);
  const prevH = Math.round((prevAmount / maxVal) * H);
  const x1 = 16;
  const x2 = x1 + barW + gap;
  return (
    <div className="supplier-chart-wrap">
      <svg width={totalW} height={H + 36} style={{ overflow: "visible" }}>
        {/* bars */}
        <rect x={x1} y={H - curH} width={barW} height={curH} rx="4" fill="#2f4f86" opacity="0.85" />
        <rect x={x2} y={H - prevH} width={barW} height={prevH} rx="4" fill="#94a3b8" opacity="0.7" />
        {/* value labels */}
        <text x={x1 + barW / 2} y={H - curH - 4} textAnchor="middle" fontSize="9" fill="#2f4f86" fontWeight="700">
          {curAmount >= 1e9 ? `${(curAmount / 1e9).toFixed(1)}B` : curAmount >= 1e6 ? `${(curAmount / 1e6).toFixed(0)}M` : `${Math.round(curAmount / 1000)}K`}
        </text>
        <text x={x2 + barW / 2} y={H - prevH - 4} textAnchor="middle" fontSize="9" fill="#64748b">
          {prevAmount >= 1e9 ? `${(prevAmount / 1e9).toFixed(1)}B` : prevAmount >= 1e6 ? `${(prevAmount / 1e6).toFixed(0)}M` : `${Math.round(prevAmount / 1000)}K`}
        </text>
        {/* x labels */}
        <text x={x1 + barW / 2} y={H + 16} textAnchor="middle" fontSize="9" fill="#2f4f86" fontWeight="600">Kỳ này</text>
        <text x={x2 + barW / 2} y={H + 16} textAnchor="middle" fontSize="9" fill="#64748b">Kỳ trước</text>
      </svg>
    </div>
  );
}

function SuppliersScreen({ token, selectedStoreId }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  // Dialog state
  const [timePeriod, setTimePeriod] = useState("this-month");
  const [curPurchases, setCurPurchases] = useState([]);
  const [prevPurchases, setPrevPurchases] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await getSuppliersWithApi(token, { search: debouncedSearch, selectedStoreId });
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) { setRows([]); setError(err instanceof Error ? err.message : "Không tải được nhà cung cấp"); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token, selectedStoreId, debouncedSearch]);

  useEffect(() => {
    if (!selectedSupplier || !token) return;
    let cancelled = false;
    const load = async () => {
      try {
        setDetailLoading(true);
        setDetailError("");
        const ranges = getSupplierPeriodRanges(timePeriod);
        const [cur, prev] = await Promise.all([
          getSupplierPurchasesWithApi(token, selectedSupplier.id, { fromDate: ranges.current.from, toDate: ranges.current.to, storeId: selectedStoreId }),
          getSupplierPurchasesWithApi(token, selectedSupplier.id, { fromDate: ranges.prev.from, toDate: ranges.prev.to, storeId: selectedStoreId })
        ]);
        if (!cancelled) { setCurPurchases(cur); setPrevPurchases(prev); }
      } catch (err) {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "Không tải được dữ liệu");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [selectedSupplier, timePeriod, token, selectedStoreId]);

  const debtCount = rows.filter((r) => Number(r.netBalance || 0) > 0).length;
  const totalDebt = rows.reduce((sum, r) => sum + Number(r.netBalance || 0), 0);

  // Compute dialog metrics
  const curAmount = curPurchases.reduce((s, p) => s + Number(p.amount || 0), 0);
  const curPaid = curPurchases.reduce((s, p) => s + Number(p.paidAmount || 0), 0);
  const curDebt = curPurchases.reduce((s, p) => s + Number(p.debtAmount || 0), 0);
  const prevAmount = prevPurchases.reduce((s, p) => s + Number(p.amount || 0), 0);
  const changeRate = prevAmount > 0 ? ((curAmount - prevAmount) / prevAmount * 100).toFixed(1) : null;
  const last5 = curPurchases.slice(0, 5);
  const ranges = selectedSupplier ? getSupplierPeriodRanges(timePeriod) : null;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <section className="more-menu-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <article className="more-menu-card" style={{ minHeight: "auto", padding: "14px 8px" }}>
          <span className="more-menu-label" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Tổng NCC</span>
          <strong style={{ fontSize: "1.2rem", color: "var(--ink)" }}>{loading ? "..." : number.format(rows.length)}</strong>
        </article>
        <article className="more-menu-card" style={{ minHeight: "auto", padding: "14px 8px" }}>
          <span className="more-menu-label" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Có công nợ</span>
          <strong style={{ fontSize: "1.2rem", color: "var(--ink)" }}>{loading ? "..." : number.format(debtCount)}</strong>
        </article>
        <article className="more-menu-card" style={{ minHeight: "auto", padding: "14px 8px" }}>
          <span className="more-menu-label" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Tổng công nợ</span>
          <strong style={{ fontSize: "1.0rem", color: totalDebt > 0 ? "#e53" : "var(--ink)" }}>{loading ? "..." : money.format(totalDebt)}</strong>
        </article>
      </section>

      <section className="list-card">
        <header>
          <h3>Danh sách nhà cung cấp</h3>
          <span>{loading ? "..." : `${number.format(rows.length)} NCC`}</span>
        </header>
        <div className="toolbar-grid" style={{ padding: "0 0 8px" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên, mã, số điện thoại..." />
        </div>
        {error ? <p className="form-error in-page">{error}</p> : null}
        <ul>
          {loading ? <li className="empty-row">Đang tải...</li> : null}
          {!loading && rows.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{s.name}</strong>
                <p>{s.code || ""}{s.phone ? ` · ${s.phone}` : ""}{s.address ? ` · ${s.address}` : ""}</p>
                {Number(s.netBalance || 0) !== 0 ? (
                  <p style={{ fontSize: "0.78rem", color: Number(s.netBalance) > 0 ? "#e53" : "var(--accent, #0a7)" }}>Công nợ: {money.format(Number(s.netBalance))}</p>
                ) : null}
              </div>
              <button type="button" className="view-btn" onClick={() => setSelectedSupplier(s)}>Xem</button>
            </li>
          ))}
          {!loading && !rows.length && !error ? <li className="empty-row">Không có nhà cung cấp nào.</li> : null}
        </ul>
      </section>

      {selectedSupplier ? (
        <div className="dialog-overlay" onClick={() => setSelectedSupplier(null)}>
          <div className="dialog-panel mobile-customer-detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>{selectedSupplier.name}</h2>
                <p className="product-create-subtitle">{selectedSupplier.code || ""}{selectedSupplier.phone ? ` · ${selectedSupplier.phone}` : ""}</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setSelectedSupplier(null)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body" style={{ display: "grid", gap: 10 }}>
              {/* Thông tin liên hệ */}
              <section className="detail-card detail-card-grid">
                {selectedSupplier.phone ? <div className="cinfo-row"><span>SĐT chính</span><span>{selectedSupplier.phone}</span></div> : null}
                {selectedSupplier.phone2 ? <div className="cinfo-row"><span>SĐT phụ</span><span>{selectedSupplier.phone2}</span></div> : null}
                {selectedSupplier.email ? <div className="cinfo-row"><span>Email</span><span>{selectedSupplier.email}</span></div> : null}
                {selectedSupplier.address ? <div className="cinfo-row"><span>Địa chỉ</span><span>{selectedSupplier.address}</span></div> : null}
                <div className="cinfo-row">
                  <span>Công nợ hiện tại</span>
                  <span style={{ color: Number(selectedSupplier.netBalance || 0) > 0 ? "#e53" : "inherit" }}>{money.format(Number(selectedSupplier.netBalance || 0))}</span>
                </div>
              </section>

              {/* Bộ lọc kỳ */}
              <section className="detail-card">
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem", fontWeight: 600 }}>
                  Chọn kỳ phân tích
                  <select value={timePeriod} onChange={(e) => setTimePeriod(e.target.value)} style={{ marginTop: 2 }}>
                    <option value="this-month">Tháng này</option>
                    <option value="last-month">Tháng trước</option>
                    <option value="this-quarter">Quý này</option>
                    <option value="this-year">Năm này</option>
                  </select>
                </label>
              </section>

              {detailError ? <p className="form-error in-page">{detailError}</p> : null}

              {/* Chỉ số kỳ */}
              <section className="detail-card detail-card-grid">
                <div className="cinfo-row"><span>Tổng mua hàng</span><span style={{ fontWeight: 700 }}>{detailLoading ? "..." : money.format(curAmount)}</span></div>
                <div className="cinfo-row"><span>Đã thanh toán</span><span style={{ color: "var(--accent, #0a7)" }}>{detailLoading ? "..." : money.format(curPaid)}</span></div>
                <div className="cinfo-row"><span>Còn nợ kỳ này</span><span style={{ color: curDebt > 0 ? "#e53" : "inherit" }}>{detailLoading ? "..." : money.format(curDebt)}</span></div>
                <div className="cinfo-row"><span>Số đơn kỳ này</span><span>{detailLoading ? "..." : number.format(curPurchases.length)}</span></div>
                {changeRate !== null ? (
                  <div className="cinfo-row">
                    <span>So kỳ trước</span>
                    <span style={{ color: Number(changeRate) >= 0 ? "var(--accent, #0a7)" : "#e53", fontWeight: 700 }}>
                      {Number(changeRate) >= 0 ? `+${changeRate}%` : `${changeRate}%`}
                    </span>
                  </div>
                ) : null}
              </section>

              {/* Biểu đồ so sánh */}
              {!detailLoading && ranges ? (
                <section className="detail-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "var(--muted)" }}>{ranges.label}</p>
                  <SupplierMiniBarChart curAmount={curAmount} prevAmount={prevAmount} />
                </section>
              ) : null}

              {/* 5 đơn hàng gần nhất */}
              <section className="list-card">
                <header>
                  <h3>5 đơn mua gần nhất kỳ này</h3>
                  <span>{detailLoading ? "..." : `${curPurchases.length} đơn`}</span>
                </header>
                <ul>
                  {detailLoading ? <li className="empty-row">Đang tải...</li> : null}
                  {!detailLoading && last5.map((p) => (
                    <li key={p.id}>
                      <div>
                        <strong>{p.referenceId || p.id}</strong>
                        <p>{formatDateTimeVN(p.createdAt)} · {p.status || "-"}</p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <strong style={{ fontSize: "0.88rem" }}>{money.format(Number(p.amount || 0))}</strong>
                        {Number(p.debtAmount || 0) > 0 ? (
                          <p style={{ fontSize: "0.75rem", color: "#e53", margin: 0 }}>Nợ: {money.format(Number(p.debtAmount))}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                  {!detailLoading && !last5.length ? <li className="empty-row">Không có đơn nào trong kỳ đã chọn.</li> : null}
                </ul>
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-primary" onClick={() => setSelectedSupplier(null)}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MaintenanceScreen({ token }) {
  const [active, setActive] = useState(null);
  const [mLoading, setMLoading] = useState(false);
  const [mError, setMError] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getMaintenanceStatus(token)
      .then((status) => { if (!cancelled) setActive(status.active); })
      .catch(() => { if (!cancelled) setActive(false); });
    return () => { cancelled = true; };
  }, [token]);

  const handleToggle = async () => {
    if (!token) return;
    setMLoading(true);
    setMError("");
    try {
      const result = await setMaintenanceMode(token, !active);
      setActive(result.active);
    } catch (err) {
      setMError(err instanceof Error ? err.message : "Thao tác thất bại");
    } finally {
      setMLoading(false);
    }
  };

  return (
    <section className="list-card">
      <header>
        <h3>Website công ty</h3>
        <span style={{ fontSize: "0.75rem", color: active ? "#e53" : "var(--accent, #0a7)" }}>
          {active === null ? "Đang kiểm tra..." : active ? "Đang bảo trì" : "Đang hoạt động"}
        </span>
      </header>
      {mError ? <p className="form-error in-page">{mError}</p> : null}
      <div style={{ padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #888)", marginBottom: "0.75rem" }}>
          Khi bật bảo trì, website corporate sẽ hiển thị trang thông báo và không nhận thêm yêu cầu báo giá.
        </p>
        <button
          type="button"
          disabled={mLoading || active === null}
          onClick={handleToggle}
          style={{
            width: "100%", padding: "0.7rem 1rem", borderRadius: 8, border: "none",
            background: active ? "var(--accent, #0a7)" : "#e53",
            color: "#fff", fontWeight: 600, fontSize: "0.95rem", cursor: "pointer",
            opacity: (mLoading || active === null) ? 0.6 : 1
          }}
        >
          {mLoading ? "Đang xử lý..." : active ? "Tắt bảo trì — Mở lại website" : "Bật bảo trì — Khóa website"}
        </button>
      </div>
    </section>
  );
}

function StatCard({ title, value, hint }) {
  return (
    <article className="stat-card">
      <p>{title}</p>
      <strong>{value}</strong>
      <span>{hint}</span>
    </article>
  );
}

function toNumberText(value, loading) {
  if (loading) return "...";
  return number.format(Number(value || 0));
}

function formatStorePositionLabel(position) {
  if (!position) return "-";
  const role = formatRoleType(position.roleType);
  const owner = position?.assignments?.[0]?.user?.fullName;
  const name = position.name || position.code || position.id;
  if (owner) {
    return `${name} (${role}) - ${owner}`;
  }
  return `${name} (${role})`;
}

function formatRoleType(roleType) {
  const map = {
    STORE_MANAGER: "Quản lý cửa hàng",
    STORE_SUPERVISOR: "Giám sát cửa hàng",
    DEPUTY_MANAGER: "Phó quản lý",
    CASHIER: "Thu ngân",
    WAREHOUSE_STAFF: "Kho",
    PURCHASER: "Mua hàng",
    CUSTOMER_SERVICE: "CSKH",
    CEO: "CEO",
    CHIEF_ACCOUNTANT: "Kế toán trưởng"
  };
  return map[roleType] || roleType || "Khác";
}

function formatMoneyInput(value) {
  const raw = String(value ?? "").replace(/[^\d]/g, "");
  if (!raw) return "";
  return number.format(Number(raw));
}

function flattenCategories(nodes = [], prefix = "") {
  const rows = [];
  for (const node of nodes) {
    if (!node?.id) continue;
    const label = prefix ? `${prefix} / ${node.name || "Danh mục"}` : (node.name || "Danh mục");
    rows.push({ id: node.id, name: label });
    if (Array.isArray(node.children) && node.children.length) {
      rows.push(...flattenCategories(node.children, label));
    }
  }
  return rows;
}

function dateInputValueDaysAgo(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - Number(daysAgo || 0));
  return date.toISOString().slice(0, 10);
}

function getOverviewPresetRange(preset = "THIS_MONTH") {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (preset === "TODAY") {
    return { startAt: todayStart.getTime(), endAt: todayEnd.getTime() };
  }

  if (preset === "THIS_WEEK") {
    const day = now.getDay();
    const mondayDiff = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayDiff, 0, 0, 0, 0);
    return { startAt: weekStart.getTime(), endAt: todayEnd.getTime() };
  }

  if (preset === "THIS_MONTH") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { startAt: monthStart.getTime(), endAt: todayEnd.getTime() };
  }

  if (preset === "THIS_QUARTER") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const quarterStart = new Date(now.getFullYear(), quarterStartMonth, 1, 0, 0, 0, 0);
    return { startAt: quarterStart.getTime(), endAt: todayEnd.getTime() };
  }

  if (preset === "THIS_YEAR") {
    const yearStart = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    return { startAt: yearStart.getTime(), endAt: todayEnd.getTime() };
  }

  if (preset === "LAST_YEAR") {
    const lastYearStart = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
    const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
    return { startAt: lastYearStart.getTime(), endAt: lastYearEnd.getTime() };
  }

  return { startAt: todayStart.getTime(), endAt: todayEnd.getTime() };
}

function formatDateTimeVN(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function SearchMonoIcon() {
  return (
    <svg className="toolbar-search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 7.5 12 12l8-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 12v9" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 18a5.5 5.5 0 0 1 11 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14.5 18a4.5 4.5 0 0 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19.5h16" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="6" y="11" width="3" height="6" rx="1" fill="currentColor" />
      <rect x="11" y="8" width="3" height="9" rx="1" fill="currentColor" opacity="0.85" />
      <rect x="16" y="5" width="3" height="12" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="4" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="13" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function OrderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 9h8M8 13h8M8 17h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function KpiIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19a7 7 0 1 1 14 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m12 12 4-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 3h14v16l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 8h8M8 12h8M8 16h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M1 3h14v13H1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M15 8h4l3 4v5h-7V8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="5.5" cy="18.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18.5" cy="18.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ArticleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h16v3H4zm0 5h10v2H4zm0 4h16v2H4zm0 4h8v2H4z" fill="currentColor" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default App;

const MOBILE_API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const ARTICLE_CATEGORY_LABELS_MOBILE = {
  news: "Tin tức", knowledge: "Kiến thức", promotion: "Khuyến mại", guide: "Hướng dẫn"
};

async function fetchMobilePublicArticleBySlug(slug) {
  const response = await fetch(`${MOBILE_API_BASE}/api/public/articles/${encodeURIComponent(slug)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || "Không tải được bài viết");
  return payload?.data || null;
}

function ArticlesScreen() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selected, setSelected] = useState(null);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    if (selected) return;
    setLoading(true);
    setError("");
    const url = new URL(`${MOBILE_API_BASE}/api/public/articles`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", "20");
    fetch(url)
      .then((r) => r.json())
      .then((payload) => {
        const d = payload?.data || {};
        setArticles(Array.isArray(d?.data) ? d.data : []);
        setTotalPages(Number(d?.totalPages || 1));
      })
      .catch(() => setError("Không tải được bài viết"))
      .finally(() => setLoading(false));
  }, [page, selected]);

  useEffect(() => {
    if (!selected?.slug) {
      setSelectedArticle(null);
      setDetailError("");
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");
    fetchMobilePublicArticleBySlug(selected.slug)
      .then((data) => {
        if (!cancelled) setSelectedArticle(data);
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "Không tải được bài viết");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (selected) {
    const activeArticle = selectedArticle || selected;
    return (
      <div className="screen-wrap">
        <button type="button" className="back-btn" onClick={() => { setSelected(null); setSelectedArticle(null); }}>← Quay lại</button>
        <article style={{ padding: "12px 0" }}>
          {activeArticle.coverImage && (
            <img src={activeArticle.coverImage} alt={activeArticle.title} style={{ width: "100%", borderRadius: 8, marginBottom: 12 }} />
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span style={{ background: "#e6f4ed", color: "#1a7a50", fontSize: "0.72rem", padding: "2px 8px", borderRadius: 12, fontWeight: 600 }}>
              {ARTICLE_CATEGORY_LABELS_MOBILE[activeArticle.category] || activeArticle.category}
            </span>
            {activeArticle.publishedAt && <span style={{ fontSize: "0.78rem", color: "#666" }}>{new Date(activeArticle.publishedAt).toLocaleDateString("vi-VN")}</span>}
          </div>
          <h2 style={{ fontSize: "1.15rem", margin: "0 0 10px" }}>{activeArticle.title}</h2>
          {activeArticle.seoDesc && <p style={{ color: "#555", fontSize: "0.88rem", margin: "0 0 14px" }}>{activeArticle.seoDesc}</p>}
          {detailError ? <p style={{ color: "#dc2626", fontSize: "0.85rem" }}>{detailError}</p> : null}
          {detailLoading ? <p style={{ color: "#888" }}>Đang tải nội dung...</p> : (
            <div style={{ fontSize: "0.92rem", lineHeight: 1.75, color: "#222" }}>
              {(activeArticle.content || "").split(/\n\n+/).map((p, i) => (
                <p key={i} style={{ margin: "0 0 1em" }}>{p}</p>
              ))}
            </div>
          )}
        </article>
      </div>
    );
  }

  return (
    <div className="screen-wrap">
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 16px" }}>Bài viết &amp; Tin tức</h2>
      {error && <p style={{ color: "red", fontSize: "0.85rem" }}>{error}</p>}
      {loading ? <p style={{ color: "#888" }}>Đang tải...</p> : (
        articles.length === 0 ? <p style={{ color: "#888" }}>Chưa có bài viết nào.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {articles.map((article) => (
              <button
                key={article.id}
                type="button"
                className="detail-card"
                style={{ textAlign: "left", cursor: "pointer", padding: "14px 16px" }}
                onClick={() => setSelected(article)}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <span style={{ background: "#e6f4ed", color: "#1a7a50", fontSize: "0.7rem", padding: "2px 7px", borderRadius: 10, fontWeight: 600 }}>
                    {ARTICLE_CATEGORY_LABELS_MOBILE[article.category] || article.category}
                  </span>
                  {article.publishedAt && <span style={{ fontSize: "0.74rem", color: "#888" }}>{new Date(article.publishedAt).toLocaleDateString("vi-VN")}</span>}
                </div>
                <div style={{ fontWeight: 600, fontSize: "0.93rem", marginBottom: 4, lineHeight: 1.4 }}>{article.title}</div>
                {article.seoDesc && <div style={{ fontSize: "0.8rem", color: "#666" }}>{article.seoDesc}</div>}
              </button>
            ))}
          </div>
        )
      )}
      {totalPages > 1 && !loading && (
        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 20 }}>
          <button type="button" className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Trang trước</button>
          <span style={{ alignSelf: "center", fontSize: "0.85rem" }}>{page} / {totalPages}</span>
          <button type="button" className="btn-secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Trang sau</button>
        </div>
      )}
    </div>
  );
}
