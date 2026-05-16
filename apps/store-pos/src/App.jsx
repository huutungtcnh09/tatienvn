import { useEffect, useMemo, useRef, useState } from "react";
import { api, login } from "./api";
import Login from "./pages/Login";
import Menu from "./components/Menu";
import PosScreen from "./pages/PosScreen";
import OrdersPage from "./pages/Orders";
import ReceiptsPage from "./pages/Receipts";
import CustomersPage from "./pages/Customers";
import PurchasesPage from "./pages/Purchases";
import SettingsPage from "./pages/Settings";
import ProductsPage from "./pages/Products";
import BusinessAreasPage from "./pages/BusinessAreas";
import { formatMoneyInput, formatNumber } from "./utils/currency";

function getErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Lỗi không xác định";
}

function isPermissionDeniedMessage(message) {
  const text = String(message || "").toLowerCase();
  return [
    "forbidden",
    "missing permission",
    "no store assignment",
    "user has no active store assignment"
  ].some((keyword) => text.includes(keyword));
}

function isAuthErrorMessage(message) {
  const text = String(message || "").toLowerCase();
  return ["unauthorized", "jwt", "token", "đăng nhập", "phiên đăng nhập", "hết hạn"].some((keyword) => text.includes(keyword));
}

function parseMoneyInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? String(Number(digits)) : "";
}

function toDateValue(input) {
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateLabel(input) {
  const date = toDateValue(input);
  return date ? date.toLocaleDateString("vi-VN") : "-";
}

const CUSTOMER_SUGGESTION_WATCHLIST_KEY = "store_customer_suggestion_watchlist";

function parseRolesFromToken(token) {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    const data = JSON.parse(json);
    const rawRoles = data?.roles;
    if (Array.isArray(rawRoles)) return rawRoles.map((r) => String(r).toUpperCase());
    if (typeof rawRoles === "string") return rawRoles.split(",").map((r) => r.trim().toUpperCase()).filter(Boolean);
    return [];
  } catch (_error) {
    return [];
  }
}

function isTokenExpired(token) {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    const data = JSON.parse(json);
    const exp = Number(data?.exp || 0);
    if (!exp) return false;
    return Math.floor(Date.now() / 1000) >= exp;
  } catch (_error) {
    return false;
  }
}

function parseUserNameFromToken(token) {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    const data = JSON.parse(json);
    const fullName = String(data?.fullName || data?.name || "").trim();
    if (fullName) return fullName;
    const email = String(data?.email || data?.username || data?.sub || "").trim();
    if (email) return email;
    return "Tài khoản";
  } catch (_error) {
    return "Tài khoản";
  }
}

function flattenCategories(nodes = [], parentPath = "") {
  const result = [];
  for (const node of nodes) {
    const currentPath = parentPath ? `${parentPath} / ${node.name}` : node.name;
    if (node?.id) {
      result.push({ id: node.id, name: currentPath });
    }
    if (Array.isArray(node?.children) && node.children.length) {
      result.push(...flattenCategories(node.children, currentPath));
    }
  }
  return result;
}

function flattenBusinessAreas(nodes = [], parentPath = "") {
  const result = [];
  for (const node of nodes) {
    const currentPath = parentPath ? `${parentPath} / ${node.name}` : node.name;
    if (node?.id) {
      result.push({ id: node.id, name: currentPath });
    }
    if (Array.isArray(node?.children) && node.children.length) {
      result.push(...flattenBusinessAreas(node.children, currentPath));
    }
  }
  return result;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderStockReportA4Html({ storeName, generatedBy, rows }) {
  const generatedAt = new Date();
  const dateLabel = generatedAt.toLocaleString("vi-VN");
  const midpoint = Math.ceil(rows.length / 2);
  const leftRows = rows.slice(0, midpoint);
  const rightRows = rows.slice(midpoint);

  const buildColumnRows = (columnRows, startIndex) => {
    return columnRows.map((row, index) => `
      <tr>
        <td class="center">${startIndex + index + 1}</td>
        <td>${escapeHtml(row.sku || "-")}</td>
        <td>${escapeHtml(row.name || "-")}</td>
        <td class="center">${escapeHtml(row.unit || "-")}</td>
        <td class="right">${escapeHtml(formatNumber(row.stock))}</td>
      </tr>
    `).join("");
  };

  const leftBodyRows = buildColumnRows(leftRows, 0);
  const rightBodyRows = buildColumnRows(rightRows, midpoint);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Báo cáo tồn kho A4</title>
  <style>
    @page { size: A4; margin: 8mm; }
    body { font-family: "Times New Roman", serif; color: #111; font-size: 10px; line-height: 1.25; }
    .company { text-align: center; font-size: 16px; font-weight: 700; margin: 0 0 2px; }
    .title { text-align: center; font-size: 18px; font-weight: 700; margin: 0 0 5px; text-transform: uppercase; }
    .meta { border: 1px solid #222; padding: 5px 7px; margin-bottom: 8px; }
    .meta p { margin: 2px 0; }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; align-items: start; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #222; padding: 2px 3px; vertical-align: top; }
    th { text-align: center; background: #f6f6f6; }
    .center { text-align: center; }
    .right { text-align: right; }
    .name-col { word-break: break-word; }
  </style>
</head>
<body>
  <p class="company">TÁ TIẾN</p>
  <h1 class="title">Báo cáo tồn kho</h1>
  <div class="meta">
    <p><strong>Cửa hàng:</strong> ${escapeHtml(storeName || "-")}</p>
    <p><strong>Người in:</strong> ${escapeHtml(generatedBy || "-")}</p>
    <p><strong>Thời gian in:</strong> ${escapeHtml(dateLabel)}</p>
    <p><strong>Số mặt hàng:</strong> ${escapeHtml(formatNumber(rows.length))}</p>
  </div>
  <div class="columns">
    <table>
      <thead>
        <tr>
          <th style="width: 28px">#</th>
          <th style="width: 72px">Mã</th>
          <th>Tên sản phẩm</th>
          <th style="width: 36px">ĐVT</th>
          <th style="width: 56px">Tồn</th>
        </tr>
      </thead>
      <tbody>
        ${leftBodyRows || `<tr><td colspan="5" class="center">Không có dữ liệu</td></tr>`}
      </tbody>
    </table>

    <table>
      <thead>
        <tr>
          <th style="width: 28px">#</th>
          <th style="width: 72px">Mã</th>
          <th>Tên sản phẩm</th>
          <th style="width: 36px">ĐVT</th>
          <th style="width: 56px">Tồn</th>
        </tr>
      </thead>
      <tbody>
        ${rightBodyRows || `<tr><td colspan="5" class="center">-</td></tr>`}
      </tbody>
    </table>
  </div>
  <script>
    window.onload = function () {
      window.print();
      setTimeout(function () { window.close(); }, 300);
    };
  </script>
</body>
</html>`;
}

function printStockReportA4(payload) {
  const popupWidth = 980;
  const popupHeight = 860;
  const popupLeft = Math.max(Math.round((window.screen.width - popupWidth) / 2), 0);
  const popupTop = Math.max(Math.round((window.screen.height - popupHeight) / 2), 0);
  const popupFeatures = [
    "popup=yes",
    `width=${popupWidth}`,
    `height=${popupHeight}`,
    `left=${popupLeft}`,
    `top=${popupTop}`,
    "resizable=yes",
    "scrollbars=yes",
    "toolbar=no",
    "menubar=no",
    "location=no",
    "status=no"
  ].join(",");

  const printWindow = window.open("", `print_stock_${Date.now()}`, popupFeatures);
  if (!printWindow) {
    throw new Error("Trình duyệt đang chặn cửa sổ in. Vui lòng cho phép popup.");
  }

  printWindow.document.open();
  printWindow.document.write(renderStockReportA4Html(payload));
  printWindow.document.close();
}

const STORE_POS_ALLOWED_ROLES = ["SUPER_ADMIN", "HEAD_MANAGER", "STORE_MANAGER", "SALES_STAFF"];

export default function App() {
  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem("store_token") || "";
    if (saved && (!parseRolesFromToken(saved).some((r) => STORE_POS_ALLOWED_ROLES.includes(r)) || isTokenExpired(saved))) {
      localStorage.removeItem("store_token");
      return "";
    }
    return saved;
  });
  const [accessDeniedMessage, setAccessDeniedMessage] = useState("");
  const [collapsed, setCollapsed] = useState(true);
  const [currentPage, setCurrentPage] = useState("pos");
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [users, setUsers] = useState([]);
  const [orgPositions, setOrgPositions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [orders, setOrders] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [stores, setStores] = useState([]);
  const [assignedStores, setAssignedStores] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [purchasesOverview, setPurchasesOverview] = useState(null);
  const [promotions, setPromotions] = useState([]);
  const [businessAreas, setBusinessAreas] = useState([]);
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [creatingQuickCustomer, setCreatingQuickCustomer] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState({
    name: "",
    phone: "",
    address: "",
    ledgerCode: "",
    businessAreaId: "",
    openingBalance: 0
  });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);
  const [showStockPrintDialog, setShowStockPrintDialog] = useState(false);
  const [showCustomerSuggestionDialog, setShowCustomerSuggestionDialog] = useState(false);
  const [customerSuggestionTab, setCustomerSuggestionTab] = useState("debt");
  const [suggestionDebtKeyword, setSuggestionDebtKeyword] = useState("");
  const [suggestionMinDebt, setSuggestionMinDebt] = useState("");
  const [suggestionMinNoReceiptDays, setSuggestionMinNoReceiptDays] = useState("");
  const [suggestionDebtLimit, setSuggestionDebtLimit] = useState("30");
  const [suggestionSalesKeyword, setSuggestionSalesKeyword] = useState("");
  const [suggestionMaxCycleDays, setSuggestionMaxCycleDays] = useState("45");
  const [suggestionMinOrderValue, setSuggestionMinOrderValue] = useState("");
  const [suggestionMinOrderCount, setSuggestionMinOrderCount] = useState("2");
  const [suggestionPastDueDays, setSuggestionPastDueDays] = useState("30");
  const [suggestionFutureDays, setSuggestionFutureDays] = useState("14");
  const [suggestionSalesLimit, setSuggestionSalesLimit] = useState("30");
  const [watchedCustomers, setWatchedCustomers] = useState([]);
  const watchlistInitialized = useRef(false);
  const [stockPrintSelectedIds, setStockPrintSelectedIds] = useState([]);
  const [stockPrintCategoryIds, setStockPrintCategoryIds] = useState([]);
  const [stockPrintOnlyPositive, setStockPrintOnlyPositive] = useState(false);

  const activeStore = useMemo(() => {
    const pool = assignedStores.length ? assignedStores : stores;
    return pool.find((store) => !store.isWarehouse) || pool[0] || null;
  }, [assignedStores, stores]);

  const currentRoles = useMemo(() => parseRolesFromToken(token), [token]);
  const canReadUsers = useMemo(() => {
    return currentRoles.some((role) => ["SUPER_ADMIN", "HEAD_MANAGER", "STORE_MANAGER"].includes(role));
  }, [currentRoles]);
  const canEditCustomerInfo = useMemo(() => {
    return currentRoles.some((role) => ["SUPER_ADMIN", "HEAD_MANAGER", "STORE_MANAGER"].includes(role));
  }, [currentRoles]);
  const currentUserName = useMemo(() => parseUserNameFromToken(token), [token]);
  const avatarLetter = useMemo(() => {
    const label = String(currentUserName || "T").trim();
    return label.charAt(0).toUpperCase() || "T";
  }, [currentUserName]);

  const quickCustomerAreaOptions = useMemo(() => {
    return flattenBusinessAreas(businessAreas || []);
  }, [businessAreas]);

  const stockRows = useMemo(() => {
    const flatCategories = flattenCategories(categories);
    const categoryNameMap = new Map(flatCategories.map((c) => [c.id, c.name]));
    const inventoryMap = new Map(inventory.map((row) => [row.productId, row]));
    return products
      .map((product) => {
        const inv = inventoryMap.get(product.id);
        const stock = Number(inv?.availableQuantity ?? inv?.quantity ?? 0);
        return {
          id: product.id,
          sku: product.sku || "",
          name: product.name || "",
          unit: product.unit || "",
          stock,
          categoryId: product.categoryId || "",
          categoryName: categoryNameMap.get(product.categoryId) || product.category?.name || "",
          productType: product.productType || "GOODS"
        };
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "vi"));
  }, [products, inventory, categories]);

  const stockCategoryOptions = useMemo(() => {
    const fromCategories = flattenCategories(categories);
    if (fromCategories.length) return fromCategories;

    const fallback = new Map();
    stockRows.forEach((row) => {
      if (row.categoryId && row.categoryName) {
        fallback.set(row.categoryId, row.categoryName);
      }
    });
    return Array.from(fallback.entries()).map(([id, name]) => ({ id, name }));
  }, [categories, stockRows]);

  const filteredStockRows = useMemo(() => {
    return stockRows.filter((row) => {
      const matchedCategory = stockPrintCategoryIds.length === 0 || stockPrintCategoryIds.includes(row.categoryId);
      const matchedStock = !stockPrintOnlyPositive || row.stock > 0;
      return row.productType === "GOODS" && matchedCategory && matchedStock;
    });
  }, [stockRows, stockPrintCategoryIds, stockPrintOnlyPositive]);

  const selectedStockRows = useMemo(() => {
    const selectedSet = new Set(stockPrintSelectedIds);
    return stockRows.filter((row) => selectedSet.has(row.id));
  }, [stockRows, stockPrintSelectedIds]);

  const debtSuggestions = useMemo(() => {
    const today = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const receiptsByCustomerId = new Map();
    for (const receipt of receipts) {
      const customerId = receipt?.customerId;
      if (!customerId) continue;
      const nextDate = toDateValue(receipt?.createdAt || receipt?.receiptDate || receipt?.date);
      if (!nextDate) continue;
      const prevDate = receiptsByCustomerId.get(customerId);
      if (!prevDate || nextDate.getTime() > prevDate.getTime()) {
        receiptsByCustomerId.set(customerId, nextDate);
      }
    }

    return customers
      .filter((customer) => Number(customer?.netBalance || 0) > 0)
      .map((customer) => ({
        id: customer.id,
        name: customer.name || "-",
        phone: customer.phone || "-",
        debtAmount: Number(customer.netBalance || 0),
        lastReceiptAt: receiptsByCustomerId.get(customer.id) || null,
        daysSinceLastReceipt: receiptsByCustomerId.get(customer.id)
          ? Math.floor((today - receiptsByCustomerId.get(customer.id).getTime()) / oneDayMs)
          : null
      }))
      .sort((left, right) => right.debtAmount - left.debtAmount);
  }, [customers, receipts]);

  const salesSuggestions = useMemo(() => {
    const today = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const ordersByCustomerId = new Map();

    for (const order of orders) {
      const customerId = order?.customerId;
      if (!customerId) continue;
      const orderDate = toDateValue(order?.createdAt || order?.orderDate || order?.date);
      const amount = Number(order?.totalAmount || 0);
      const status = String(order?.status || "").toUpperCase();
      if (!orderDate || amount <= 0 || status === "CANCELLED") continue;
      const bucket = ordersByCustomerId.get(customerId) || [];
      bucket.push({ orderDate, amount });
      ordersByCustomerId.set(customerId, bucket);
    }

    const rows = [];
    for (const customer of customers) {
      const customerOrders = (ordersByCustomerId.get(customer.id) || [])
        .sort((left, right) => left.orderDate.getTime() - right.orderDate.getTime());
      if (customerOrders.length < 2) continue;

      const cycleDaysList = [];
      for (let i = 1; i < customerOrders.length; i += 1) {
        const delta = customerOrders[i].orderDate.getTime() - customerOrders[i - 1].orderDate.getTime();
        if (delta > 0) cycleDaysList.push(delta / oneDayMs);
      }
      if (!cycleDaysList.length) continue;

      const avgCycleDays = cycleDaysList.reduce((sum, value) => sum + value, 0) / cycleDaysList.length;
      const lastOrder = customerOrders[customerOrders.length - 1];
      const avgOrderValue = customerOrders.reduce((sum, value) => sum + value.amount, 0) / customerOrders.length;
      const predictedNext = new Date(lastOrder.orderDate.getTime() + avgCycleDays * oneDayMs);
      const daysToNext = Math.round((predictedNext.getTime() - today) / oneDayMs);

      if (daysToNext < -15 || daysToNext > 7) continue;

      rows.push({
        id: customer.id,
        name: customer.name || "-",
        phone: customer.phone || "-",
        orderCount: customerOrders.length,
        avgCycleDays,
        avgOrderValue,
        lastOrderAt: lastOrder.orderDate,
        predictedNextAt: predictedNext,
        daysToNext
      });
    }

    return rows
      .sort((left, right) => {
        const urgencyDiff = Math.abs(left.daysToNext) - Math.abs(right.daysToNext);
        if (urgencyDiff !== 0) return urgencyDiff;
        return right.avgOrderValue - left.avgOrderValue;
      });
  }, [customers, orders]);

  const filteredDebtSuggestions = useMemo(() => {
    const keyword = String(suggestionDebtKeyword || "").trim().toLowerCase();
    const minDebt = Number(String(suggestionMinDebt || "").replace(/[^\d]/g, "") || 0);
    const minNoReceiptDays = String(suggestionMinNoReceiptDays || "").trim()
      ? Number(String(suggestionMinNoReceiptDays || "").replace(/[^\d]/g, ""))
      : null;
    const limit = String(suggestionDebtLimit || "").trim()
      ? Math.max(1, Number(String(suggestionDebtLimit || "").replace(/[^\d]/g, "")))
      : 30;

    return debtSuggestions
      .filter((item) => {
        const matchedDebt = Number(item.debtAmount || 0) >= minDebt;
        const matchedNoReceiptDays = minNoReceiptDays == null
          || item.daysSinceLastReceipt == null
          || Number(item.daysSinceLastReceipt || 0) >= minNoReceiptDays;
        const matchedKeyword = !keyword
          || String(item.name || "").toLowerCase().includes(keyword)
          || String(item.phone || "").toLowerCase().includes(keyword);
        return matchedDebt && matchedNoReceiptDays && matchedKeyword;
      })
      .slice(0, limit);
  }, [debtSuggestions, suggestionDebtKeyword, suggestionMinDebt, suggestionMinNoReceiptDays, suggestionDebtLimit]);

  const filteredSalesSuggestions = useMemo(() => {
    const keyword = String(suggestionSalesKeyword || "").trim().toLowerCase();
    const minOrderValue = Number(String(suggestionMinOrderValue || "").replace(/[^\d]/g, "") || 0);
    const minOrderCount = String(suggestionMinOrderCount || "").trim()
      ? Number(String(suggestionMinOrderCount || "").replace(/[^\d]/g, ""))
      : 2;
    const maxCycle = String(suggestionMaxCycleDays || "").trim()
      ? Number(String(suggestionMaxCycleDays || "").replace(/[^\d]/g, ""))
      : null;
    const maxPastDueDays = String(suggestionPastDueDays || "").trim()
      ? Number(String(suggestionPastDueDays || "").replace(/[^\d]/g, ""))
      : 30;
    const maxFutureDays = String(suggestionFutureDays || "").trim()
      ? Number(String(suggestionFutureDays || "").replace(/[^\d]/g, ""))
      : 14;
    const limit = String(suggestionSalesLimit || "").trim()
      ? Math.max(1, Number(String(suggestionSalesLimit || "").replace(/[^\d]/g, "")))
      : 30;

    return salesSuggestions
      .filter((item) => {
        const matchedValue = Number(item.avgOrderValue || 0) >= minOrderValue;
        const matchedCycle = !maxCycle || Number(item.avgCycleDays || 0) <= maxCycle;
        const matchedOrderCount = Number(item.orderCount || 0) >= minOrderCount;
        const matchedWindow = Number(item.daysToNext || 0) >= -maxPastDueDays
          && Number(item.daysToNext || 0) <= maxFutureDays;
        const matchedKeyword = !keyword
          || String(item.name || "").toLowerCase().includes(keyword)
          || String(item.phone || "").toLowerCase().includes(keyword);
        return matchedValue && matchedCycle && matchedOrderCount && matchedWindow && matchedKeyword;
      })
      .slice(0, limit);
  }, [
    salesSuggestions,
    suggestionSalesKeyword,
    suggestionMinOrderValue,
    suggestionMinOrderCount,
    suggestionMaxCycleDays,
    suggestionPastDueDays,
    suggestionFutureDays,
    suggestionSalesLimit
  ]);

  const watchedSuggestionRows = useMemo(() => {
    const debtById = new Map(debtSuggestions.map((item) => [item.id, item]));
    const salesById = new Map(salesSuggestions.map((item) => [item.id, item]));

    return watchedCustomers.map((item) => {
      const debt = debtById.get(item.id) || null;
      const sales = salesById.get(item.id) || null;
      return {
        ...item,
        debt,
        sales
      };
    });
  }, [watchedCustomers, debtSuggestions, salesSuggestions]);

  const isCustomerWatched = (customerId) => watchedCustomers.some((item) => item.id === customerId);

  const toggleWatchCustomer = (customer, source) => {
    setWatchedCustomers((prev) => {
      const exists = prev.some((item) => item.id === customer.id);
      if (exists) {
        return prev.filter((item) => item.id !== customer.id);
      }
      return [
        {
          id: customer.id,
          name: customer.name || "-",
          phone: customer.phone || "-",
          source,
          addedAt: Date.now()
        },
        ...prev
      ].slice(0, 50);
    });
  };

  const removeWatchedCustomer = (customerId) => {
    setWatchedCustomers((prev) => prev.filter((item) => item.id !== customerId));
  };

  const handleLogin = async (email, password) => {
    const result = await login(email, password);
    const roles = parseRolesFromToken(result.data.accessToken);
    const hasAccess = roles.some((r) => STORE_POS_ALLOWED_ROLES.includes(r));
    if (!hasAccess) {
      throw new Error("Tài khoản không có quyền truy cập ứng dụng cửa hàng. Vui lòng sử dụng đúng ứng dụng theo vai trò của bạn.");
    }
    localStorage.setItem("store_token", result.data.accessToken);
    setToken(result.data.accessToken);
    setAccessDeniedMessage("");
  };

  const handleClearSession = () => {
    localStorage.removeItem("store_token");
    setToken("");
    setAccessDeniedMessage("");
  };

  const handleLogout = () => {
    setShowUserMenu(false);
    localStorage.removeItem("store_token");
    setToken("");
    setAccessDeniedMessage("");
  };

  const openStockPrintDialog = () => {
    setStockPrintCategoryIds([]);
    setStockPrintOnlyPositive(false);
    setStockPrintSelectedIds(stockRows.filter((r) => r.productType === "GOODS").map((row) => row.id));
    setShowStockPrintDialog(true);
  };

  const toggleStockProduct = (productId) => {
    setStockPrintSelectedIds((prev) => (
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    ));
  };

  const selectAllFilteredStocks = () => {
    const filteredIds = filteredStockRows.map((row) => row.id);
    setStockPrintSelectedIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
  };

  const clearAllFilteredStocks = () => {
    const filteredSet = new Set(filteredStockRows.map((row) => row.id));
    setStockPrintSelectedIds((prev) => prev.filter((id) => !filteredSet.has(id)));
  };

  const submitStockPrint = () => {
    if (!selectedStockRows.length) {
      alert("Vui lòng chọn ít nhất một sản phẩm để in tồn kho.");
      return;
    }
    try {
      printStockReportA4({
        storeName: activeStore?.name || "Cửa hàng",
        generatedBy: currentUserName,
        rows: selectedStockRows
      });
      setShowStockPrintDialog(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể mở cửa sổ in";
      alert(message);
    }
  };

  useEffect(() => {
    if (!token) return;
    setAccessDeniedMessage("");
    reloadData().catch((error) => {
      const message = getErrorMessage(error);
      if (isAuthErrorMessage(message)) {
        localStorage.removeItem("store_token");
        setToken("");
        setAccessDeniedMessage("");
        return;
      }
      if (isPermissionDeniedMessage(message)) {
        setAccessDeniedMessage(message);
      }
    });
  }, [token]);

  useEffect(() => {
    if (!showUserMenu) return;
    const handleOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showUserMenu]);

  useEffect(() => {
    if (!token) {
      watchlistInitialized.current = false;
      return;
    }
    watchlistInitialized.current = false;
    api.getWatchlist(token)
      .then((data) => {
        const items = Array.isArray(data) ? data : (data?.data ?? []);
        const normalized = items
          .filter((item) => item && typeof item.id === "string")
          .map((item) => ({
            id: String(item.id),
            name: String(item.name || "-"),
            phone: String(item.phone || "-"),
            source: String(item.source || "debt"),
            addedAt: Number(item.addedAt || Date.now())
          }));
        setWatchedCustomers(normalized);
      })
      .catch(() => {
        // Fallback: đọc từ localStorage nếu server lỗi
        try {
          const raw = localStorage.getItem(CUSTOMER_SUGGESTION_WATCHLIST_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              setWatchedCustomers(
                parsed
                  .filter((item) => item && typeof item.id === "string")
                  .map((item) => ({
                    id: String(item.id),
                    name: String(item.name || "-"),
                    phone: String(item.phone || "-"),
                    source: String(item.source || "debt"),
                    addedAt: Number(item.addedAt || Date.now())
                  }))
              );
            }
          }
        } catch (_error) {
          // ignore
        }
      })
      .finally(() => {
        watchlistInitialized.current = true;
      });
  }, [token]);

  useEffect(() => {
    if (!watchlistInitialized.current || !token) return;
    // Lưu localStorage làm cache offline
    try {
      localStorage.setItem(CUSTOMER_SUGGESTION_WATCHLIST_KEY, JSON.stringify(watchedCustomers));
    } catch (_error) {
      // ignore
    }
    // Đồng bộ lên server
    api.updateWatchlist(token, watchedCustomers).catch(() => {});
  }, [watchedCustomers]);

  const reloadData = async (dateParams = {}) => {
    const today = new Date();
    // Default to load all orders (10 years back) to capture all unpaid orders
    const defaultFromDate = new Date(today.getTime() - 3650 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);
    const fromDate = dateParams.fromDate || defaultFromDate;
    const toDate = dateParams.toDate || todayStr;
    const [p, u, op, c, pr, o, r, s, pu, puo, prom, myS, bas] = await Promise.all([
      api.partners(token, { pageSize: 200 }),
      canReadUsers ? api.users(token).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      canReadUsers ? api.orgPositions(token, { isActive: true }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      api.categories(token),
      api.products(token, { pageSize: 200 }),
      api.orders(token, { fromDate, toDate }),
      api.receipts(token, { fromDate, toDate }),
      api.stores(token),
      api.purchases(token),
      api.purchasesOverview(token),
      api.getPromotions(token).catch(() => ({ data: [] })),
      api.myAssignedStores(token).catch(() => ({ data: [] })),
      api.businessAreas(token).catch(() => ({ data: [] }))
    ]);

    const resolvedAssigned = myS.data || [];
    const resolvedStores = s.data || [];
    const pool = resolvedAssigned.length ? resolvedAssigned : resolvedStores;
    const activeStoreId = pool.find((store) => !store.isWarehouse)?.id || pool[0]?.id;
    const inv = activeStoreId ? await api.inventoryByStore(token, activeStoreId) : { data: [] };

    setCustomers((p.data?.data || p.data || []).filter((i) => i.isCustomer));
    setSuppliers((p.data?.data || p.data || []).filter((i) => i.isSupplier));
    setUsers(u.data || []);
    setOrgPositions(op.data || []);
    setCategories(c.data || []);
    setProducts(pr.data?.data || []);
    setInventory(inv.data || []);
    setOrders(o.data || []);
    setReceipts(r.data || []);
    setStores(s.data || []);
    setAssignedStores(myS.data || []);
    setPurchases(pu.data || []);
    setPurchasesOverview(puo.data || null);
    setPromotions(prom.data || []);
    setBusinessAreas(bas.data || bas || []);
    setAccessDeniedMessage("");
  };

  const loadOrders = async (dateParams = {}) => {
    const today = new Date();
    const defaultFromDate = new Date(today.getTime() - 3650 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);
    const fromDate = dateParams.fromDate || defaultFromDate;
    const toDate = dateParams.toDate || todayStr;
    const res = await api.orders(token, { fromDate, toDate });
    return res?.data || res || [];
  };

  const createOrder = async (payload) => {
    const res = await api.createOrder(token, {
      ...payload,
      ...(activeStore?.id ? { storeId: activeStore.id } : {})
    });
    await reloadData();
    return res?.data || null;
  };

  const updateOrderStatus = async (orderId, payload) => {
    await api.updateOrderStatus(token, orderId, payload);
    await reloadData();
    alert("Đã cập nhật trạng thái đơn hàng");
  };

  const updateOrderItems = async (orderId, payload) => {
    const res = await api.updateOrderItems(token, orderId, payload);
    await reloadData();
    alert("Đã cập nhật chi tiết đơn hàng");
    return res?.data || null;
  };

  const returnRefundOrder = async (orderId, payload) => {
    await api.returnRefundOrder(token, orderId, payload);
    await reloadData();
    alert("Đã xử lý trả hàng/hoàn tiền");
  };

  const createReceipt = async (payload) => {
    const res = await api.createReceipt(token, payload);
    await reloadData();
    return res;
  };

  const voidReceipt = async (receiptId, payload) => {
    const res = await api.voidReceipt(token, receiptId, payload);
    await reloadData();
    return res?.data || res;
  };

  const createCustomerQuick = async (payload) => {
    const code = `KH-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await api.createPartner(token, {
      code,
      name: payload.name,
      phone: payload.phone || undefined,
      address: payload.address || undefined,
      ledgerCode: payload.ledgerCode?.trim() || undefined,
      businessAreaId: payload.businessAreaId || undefined,
      isCustomer: true,
      isSupplier: false,
      isCarrier: false,
      openingBalance: Number(payload.openingBalance || 0)
    });

    // Refresh customers first so UI can reflect new partner even if other modules fail.
    const partners = await api.partners(token);
    const partnerRows = Array.isArray(partners?.data?.data)
      ? partners.data.data
      : Array.isArray(partners?.data)
        ? partners.data
        : Array.isArray(partners)
          ? partners
          : [];
    setCustomers(partnerRows.filter((i) => i.isCustomer));

    // Best effort refresh for other datasets.
    await reloadData().catch(() => null);
    alert("Đã tạo nhanh khách hàng");
  };

  const submitQuickCustomer = async () => {
    const name = quickCustomer.name.trim();
    const phone = quickCustomer.phone.trim();
    const address = quickCustomer.address.trim();
    const openingBalance = Number(quickCustomer.openingBalance || 0);

    if (name.length < 2) {
      alert("Tên khách hàng cần tối thiểu 2 ký tự");
      return;
    }

    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      alert("Dư nợ đầu kỳ không hợp lệ");
      return;
    }

    if (creatingQuickCustomer) return;

    try {
      setCreatingQuickCustomer(true);
      const ledgerCode = quickCustomer.ledgerCode.trim();
      await createCustomerQuick({
        name,
        phone,
        address,
        ledgerCode,
        businessAreaId: quickCustomer.businessAreaId || undefined,
        openingBalance
      });
      setShowQuickCustomer(false);
      setQuickCustomer({ name: "", phone: "", address: "", ledgerCode: "", businessAreaId: "", openingBalance: 0 });
    } catch (error) {
      alert(`Tạo khách hàng thất bại: ${getErrorMessage(error)}`);
    } finally {
      setCreatingQuickCustomer(false);
    }
  };

  const loadCustomerAging = async (customerId) => {
    const res = await api.partnerAging(token, customerId);
    return res.data || res;
  };

  const loadCustomerTransactions = async (customerId) => {
    const res = await api.partnerTransactions(token, customerId);
    return res.data || res || [];
  };

  const loadCustomerAnalytics = async (customerId, period = "month") => {
    const res = await api.partnerAnalytics(token, customerId, period);
    return res.data || res || null;
  };

  const loadCustomerOverview = async (customerId, preset = "this-month") => {
    const res = await api.partnerOverview(token, customerId, preset);
    return res.data || res || null;
  };

  const loadCustomerNotes = async (customerId) => {
    const res = await api.customerNotes(token, customerId);
    return res.data || res || [];
  };

  const createCustomerNote = async (customerId, payload) => {
    const res = await api.createCustomerNote(token, customerId, payload);
    return res.data || res;
  };

  const loadGiftRedemptions = async (customerId) => {
    const res = await api.giftRedemptions(token, customerId);
    return res.data || res || [];
  };

  const createGiftRedemption = async (customerId, payload) => {
    const res = await api.createGiftRedemption(token, customerId, payload);
    return res.data || res;
  };

  const cancelGiftRedemption = async (customerId, redemptionId) => {
    const res = await api.cancelGiftRedemption(token, customerId, redemptionId);
    return res.data || res;
  };

  const loadCustomerPriceList = async (customerId) => {
    const res = await api.customerPriceList(token, customerId, activeStore?.id);
    return res.data || res || [];
  };

  const updateCustomerPriceList = async (customerId, productId, payload) => {
    const res = await api.updateCustomerPriceList(token, customerId, productId, {
      ...payload,
      storeId: activeStore?.id || undefined
    });
    await reloadData();
    return res.data || res;
  };

  const deleteCustomerPriceList = async (customerId, productId) => {
    const res = await api.deleteCustomerPriceList(token, customerId, productId);
    await reloadData();
    return res.data || res;
  };

  const updateCustomerInfo = async (customerId, payload) => {
    const res = await api.updatePartner(token, customerId, payload);
    await reloadData();
    return res.data || res;
  };

    const loadMarketingCustomAudiences = async () => {
      const res = await api.marketingCustomAudiences(token);
      return res.data || res || [];
    };

    const loadMarketingCustomAudienceById = async (audienceId) => {
      const res = await api.marketingCustomAudienceById(token, audienceId);
      return res.data || res || null;
    };

    const addMarketingAudienceCustomer = async (audienceId, customerId) => {
      const res = await api.addMarketingCustomAudienceDetails(token, audienceId, {
        details: [{ customerId }]
      });
      return res.data || res || null;
    };

    const removeMarketingAudienceCustomer = async (audienceId, detailId) => {
      const res = await api.removeMarketingCustomAudienceDetail(token, audienceId, detailId);
      return res.data || res || null;
    };

  const createSupplierQuick = async (payload) => {
    const code = `NCC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await api.createPartner(token, {
      code,
      name: payload.name,
      phone: payload.phone || undefined,
      email: payload.email || undefined,
      address: payload.address || undefined,
      isCustomer: false,
      isSupplier: true,
      isCarrier: false,
      openingBalance: Number(payload.openingBalance || 0)
    });
    const partners = await api.partners(token);
    const partnerRows = Array.isArray(partners?.data?.data)
      ? partners.data.data
      : Array.isArray(partners?.data)
        ? partners.data
        : Array.isArray(partners)
          ? partners
          : [];
    setSuppliers(partnerRows.filter((i) => i.isSupplier));
    await reloadData().catch(() => null);
    alert("Đã tạo nhà cung cấp");
  };

  const createPurchase = async (payload) => {
    await api.createPurchase(token, payload);
    await reloadData();
    alert("Đã tạo chứng từ mua hàng");
  };

  const payPurchase = async (referenceId, payload) => {
    await api.payPurchase(token, referenceId, payload);
    await reloadData();
    alert("Đã ghi nhận thanh toán nhà cung cấp");
  };

  const updatePurchasePayment = async (referenceId, paymentId, payload) => {
    await api.updatePurchasePayment(token, referenceId, paymentId, payload);
    await reloadData();
    alert("Đã cập nhật phiếu thanh toán");
  };

  const deletePurchasePayment = async (referenceId, paymentId, payload) => {
    await api.deletePurchasePayment(token, referenceId, paymentId, payload);
    await reloadData();
    alert("Đã xóa phiếu thanh toán");
  };

  const voidPurchase = async (referenceId, payload) => {
    await api.voidPurchase(token, referenceId, payload);
    await reloadData();
    alert("Đã hủy chứng từ mua hàng");
  };

  const createPurchaseRebate = async (referenceId, payload) => {
    const res = await api.createPurchaseRebate(token, referenceId, payload);
    await reloadData();
    return res?.data || null;
  };

  const updatePurchaseRebate = async (referenceId, rebateIndex, payload) => {
    const res = await api.updatePurchaseRebate(token, referenceId, rebateIndex, payload);
    await reloadData();
    return res?.data || null;
  };

  const deletePurchaseRebate = async (referenceId, rebateIndex, payload) => {
    await api.deletePurchaseRebate(token, referenceId, rebateIndex, payload);
    await reloadData();
  };

  const deletePurchaseRebateBatch = async (batchReferenceId, payload) => {
    await api.deletePurchaseRebateBatch(token, batchReferenceId, payload);
    await reloadData();
  };

  const updateProductQuick = async (productId, payload) => {
    await api.updateProduct(token, productId, payload);
    await reloadData();
    alert("Đã cập nhật sản phẩm");
  };

  const updateProductConsultationQuick = async (productId, payload) => {
    await api.updateProductConsultation(token, productId, payload);
    await reloadData();
    alert("Đã cập nhật thông tin tư vấn sản phẩm");
  };

  const createCategory = async (payload) => {
    await api.createCategory(token, payload);
    await reloadData();
    alert("Đã tạo danh mục");
  };

  const createProduct = async (payload) => {
    await api.createProduct(token, payload);
    await reloadData();
    alert("Đã tạo sản phẩm");
  };

  const loadProductAnalytics = async (productId) => {
    const res = await api.productAnalytics(token, productId);
    return res?.data || res || null;
  };

  const loadProductInventoryHistory = async (productId) => {
    const res = await api.productInventoryHistory(token, productId);
    return res?.data || res || null;
  };

  const renderPage = () => {
    switch (currentPage) {
      case "orders":
        return (
          <OrdersPage
            orders={orders}
            token={token}
            products={products}
            inventory={inventory}
            onUpdateOrderItems={updateOrderItems}
            onUpdateStatus={updateOrderStatus}
            onReturnRefund={returnRefundOrder}
          />
        );
      case "receipts":
        return (
          <ReceiptsPage
            receipts={receipts}
            token={token}
            orders={orders}
            customers={customers}
            activeStoreId={activeStore?.id}
            onCreateReceipt={createReceipt}
            onVoidReceipt={voidReceipt}
          />
        );
      case "customers":
        return (
          <CustomersPage
            customers={customers}
            businessAreas={businessAreas}
            staffUsers={users}
            orgPositions={orgPositions}
            orders={orders}
            receipts={receipts}
            products={products}
            activeStoreId={activeStore?.id}
            onLoadCustomerAging={loadCustomerAging}
            onLoadCustomerTransactions={loadCustomerTransactions}
            onLoadCustomerAnalytics={loadCustomerAnalytics}
            onLoadGiftRedemptions={loadGiftRedemptions}
            onLoadCustomerPriceList={loadCustomerPriceList}
            onUpdateCustomerPriceList={updateCustomerPriceList}
            onDeleteCustomerPriceList={deleteCustomerPriceList}
            onUpdateCustomerInfo={updateCustomerInfo}
            canEditCustomerInfo={canEditCustomerInfo}
          />
        );
      case "purchases":
        return (
          <PurchasesPage
            token={token}
            suppliers={suppliers}
            products={products}
            stores={stores}
            assignedStores={assignedStores}
            activeStoreId={activeStore?.id}
            purchases={purchases}
            overview={purchasesOverview}
            onCreatePurchase={createPurchase}
            onPayPurchase={payPurchase}
            onUpdatePurchasePayment={updatePurchasePayment}
            onDeletePurchasePayment={deletePurchasePayment}
            onVoidPurchase={voidPurchase}
            onCreateSupplier={createSupplierQuick}
            onCreatePurchaseRebate={createPurchaseRebate}
            onUpdatePurchaseRebate={updatePurchaseRebate}
            onDeletePurchaseRebate={deletePurchaseRebate}
            onDeletePurchaseRebateBatch={deletePurchaseRebateBatch}
          />
        );
      case "products":
        return (
          <ProductsPage
            categories={categories}
            products={products}
            inventory={inventory}
            onQuickUpdate={updateProductQuick}
            onQuickUpdateConsultation={updateProductConsultationQuick}
            onCreateCategory={createCategory}
            onCreateProduct={createProduct}
            onLoadProductAnalytics={loadProductAnalytics}
          />
        );
      case "business-areas":
        return <BusinessAreasPage token={token} />;
      case "settings":
        return (
          <SettingsPage
            token={token}
            stores={stores}
            assignedStores={assignedStores}
            activeStore={activeStore}
          />
        );
      default:
        return (
          <PosScreen
            customers={customers}
            businessAreas={businessAreas}
            staffUsers={users}
            products={products}
            inventory={inventory}
            orders={orders}
            onLoadOrders={loadOrders}
            onReloadData={reloadData}
            activeStoreId={activeStore?.id}
            onCreateOrder={createOrder}
            onCreateReceipt={createReceipt}
            onLoadCustomerAging={loadCustomerAging}
            onLoadCustomerOverview={loadCustomerOverview}
            onLoadCustomerPriceList={loadCustomerPriceList}
            onUpdateCustomerPriceList={updateCustomerPriceList}
            onDeleteCustomerPriceList={deleteCustomerPriceList}
            onLoadCustomerNotes={loadCustomerNotes}
            onCreateCustomerNote={createCustomerNote}
            onLoadGiftRedemptions={loadGiftRedemptions}
            onCreateGiftRedemption={createGiftRedemption}
            onCancelGiftRedemption={cancelGiftRedemption}
            onUpdateCustomerInfo={updateCustomerInfo}
              onLoadMarketingCustomAudiences={loadMarketingCustomAudiences}
              onLoadMarketingCustomAudienceById={loadMarketingCustomAudienceById}
              onAddMarketingAudienceCustomer={addMarketingAudienceCustomer}
              onRemoveMarketingAudienceCustomer={removeMarketingAudienceCustomer}
            canEditCustomerInfo={canEditCustomerInfo}
            onLoadProductInventoryHistory={loadProductInventoryHistory}
            promotions={promotions}
            onNavigate={setCurrentPage}
          />
        );
    }
  };

  if (!token) return <div className="login-shell"><Login onLogin={handleLogin} onClearSession={handleClearSession} /></div>;

  if (accessDeniedMessage) {
    return (
      <div className="login-shell">
        <div className="access-denied-card">
          <h2>Bạn chưa có quyền truy cập</h2>
          <p>{accessDeniedMessage}</p>
          <div className="access-denied-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={() => {
                setAccessDeniedMessage("");
                reloadData().catch((error) => {
                  const message = getErrorMessage(error);
                  if (isAuthErrorMessage(message)) {
                    localStorage.removeItem("store_token");
                    setToken("");
                    setAccessDeniedMessage("");
                    return;
                  }
                  if (isPermissionDeniedMessage(message)) {
                    setAccessDeniedMessage(message);
                  }
                });
              }}
            >
              Thử lại
            </button>
            <button type="button" className="btn-primary" onClick={handleLogout}>Đăng xuất</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-header">
        <h1>Ứng dụng Cửa hàng</h1>
        <div className="header-actions">
          {currentPage === "pos" ? (
            <button
              type="button"
              className="header-icon-btn header-icon-btn--advice"
              title="Gợi ý khách hàng"
              aria-label="Gợi ý khách hàng"
              onClick={() => {
                setCustomerSuggestionTab("debt");
                setShowCustomerSuggestionDialog(true);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3a7 7 0 0 0-4 12.75V20l4-2 4 2v-4.25A7 7 0 0 0 12 3Z" />
                <path d="M9 10h6" />
                <path d="M9.5 13.5h5" />
              </svg>
            </button>
          ) : null}

          {currentPage !== "products" ? (
            <button
              type="button"
              className="header-icon-btn header-icon-btn--customer"
              title="Tạo nhanh khách hàng"
              aria-label="Tạo nhanh khách hàng"
              onClick={() => setShowQuickCustomer(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                <path d="M5 20a7 7 0 0 1 14 0" />
                <path d="M19 8v6" />
                <path d="M16 11h6" />
              </svg>
            </button>
          ) : null}

          <button
            type="button"
            className="header-icon-btn header-icon-btn--stock"
            title="In tồn kho"
            aria-label="In tồn kho"
            onClick={openStockPrintDialog}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9V4h12v5" />
              <rect x="6" y="14" width="12" height="6" rx="1" />
              <rect x="4" y="9" width="16" height="6" rx="2" />
              <path d="M17 12h.01" />
            </svg>
          </button>

          <div className="user-menu" ref={userMenuRef}>
            <span className="user-display-name" title={currentUserName}>{currentUserName}</span>
            <button
              type="button"
              className="user-menu-trigger"
              aria-label="Mở menu tài khoản"
              onClick={() => setShowUserMenu((prev) => !prev)}
            >
              <span className="user-avatar-letter" aria-hidden="true">{avatarLetter}</span>
            </button>
            {showUserMenu ? (
              <div className="user-menu-dropdown">
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false);
                    setCurrentPage("settings");
                  }}
                >
                  <span className="user-menu-item-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 4.6h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </span>
                  Thông tin tài khoản
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleLogout();
                  }}
                >
                  <span className="user-menu-item-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <path d="M16 17l5-5-5-5" />
                      <path d="M21 12H9" />
                    </svg>
                  </span>
                  Đăng xuất
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main className="layout">
        <Menu
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
        />
        {renderPage()}
      </main>

      {showQuickCustomer ? (
        <div className="dialog-overlay" onClick={() => setShowQuickCustomer(false)}>
          <div className="dialog-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Tạo nhanh khách hàng</h2>
              <button className="close-btn" type="button" onClick={() => setShowQuickCustomer(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body">
              <div className="form-group">
                <label>Họ tên</label>
                <input
                  value={quickCustomer.name}
                  onChange={(e) => setQuickCustomer((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Nhập họ tên khách hàng"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Số điện thoại</label>
                  <input
                    value={quickCustomer.phone}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="Nhập số điện thoại"
                  />
                </div>
                <div className="form-group">
                  <label>Dư nợ đầu kỳ</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    style={{ textAlign: "right" }}
                    value={formatMoneyInput(quickCustomer.openingBalance)}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, openingBalance: parseMoneyInput(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Mã sổ gốc</label>
                  <input
                    value={quickCustomer.ledgerCode}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, ledgerCode: e.target.value }))}
                    placeholder="Nhập mã sổ gốc"
                  />
                </div>
                <div className="form-group">
                  <label>Địa chỉ</label>
                  <input
                    value={quickCustomer.address}
                    onChange={(e) => setQuickCustomer((prev) => ({ ...prev, address: e.target.value }))}
                    placeholder="Nhập địa chỉ"
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Khu vực kinh doanh</label>
                <select
                  value={quickCustomer.businessAreaId}
                  onChange={(e) => setQuickCustomer((prev) => ({ ...prev, businessAreaId: e.target.value }))}
                >
                  <option value="">-- Không gán khu vực --</option>
                  {quickCustomerAreaOptions.map((area) => (
                    <option key={area.id} value={area.id}>{area.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowQuickCustomer(false)} disabled={creatingQuickCustomer}>Hủy</button>
              <button type="button" className="btn-primary" onClick={submitQuickCustomer} disabled={!quickCustomer.name.trim() || creatingQuickCustomer}>
                {creatingQuickCustomer ? "Đang tạo..." : "Tạo khách hàng"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showStockPrintDialog ? (
        <div className="dialog-overlay" onClick={() => setShowStockPrintDialog(false)}>
          <div className="dialog-panel dialog-panel--stock-print" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>In tồn kho</h2>
                <p className="product-create-subtitle">Chọn sản phẩm cần in trên giấy A4.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowStockPrintDialog(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body product-create-body">
              <section className="detail-card" style={{ display: "grid", gap: 10 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Ngành hàng <span style={{ fontWeight: 400, fontSize: "0.82rem", color: "var(--muted)" }}>(chọn một hoặc nhiều, bỏ chọn = tất cả)</span></label>
                  <div className="stock-category-checkbox-list">
                    {stockCategoryOptions.map((cat) => (
                      <label key={cat.id} className="stock-category-checkbox-item">
                        <input
                          type="checkbox"
                          checked={stockPrintCategoryIds.includes(cat.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setStockPrintCategoryIds((prev) => [...prev, cat.id]);
                            } else {
                              setStockPrintCategoryIds((prev) => prev.filter((id) => id !== cat.id));
                            }
                          }}
                        />
                        {cat.name}
                      </label>
                    ))}
                  </div>
                  {stockPrintCategoryIds.length > 0 ? (
                    <button type="button" className="btn-secondary" style={{ marginTop: 4, fontSize: "0.8rem", padding: "2px 10px" }} onClick={() => setStockPrintCategoryIds([])}>
                      Bỏ chọn tất cả ngành hàng
                    </button>
                  ) : null}
                </div>

                <label className="order-option-toggle">
                  <input
                    type="checkbox"
                    checked={stockPrintOnlyPositive}
                    onChange={(e) => setStockPrintOnlyPositive(e.target.checked)}
                  />
                  Chỉ tồn kho {'>'} 0
                </label>

                <div className="stock-print-actions">
                  <button type="button" className="btn-secondary" onClick={selectAllFilteredStocks}>Chọn tất cả kết quả lọc</button>
                  <button type="button" className="btn-secondary" onClick={clearAllFilteredStocks}>Bỏ chọn kết quả lọc</button>
                </div>

                <div className="cinfo-row"><span>Tổng sản phẩm lọc</span><span>{formatNumber(filteredStockRows.length)}</span></div>
                <div className="cinfo-row cinfo-highlight"><span>Đang chọn để in</span><span>{formatNumber(selectedStockRows.length)}</span></div>
              </section>

              <section className="detail-card">
                <div className="stock-print-list" role="listbox" aria-label="Danh sách sản phẩm in tồn kho">
                  {filteredStockRows.length ? (
                    filteredStockRows.map((row) => {
                      const checked = stockPrintSelectedIds.includes(row.id);
                      return (
                        <label key={row.id} className={`stock-print-item ${checked ? "selected" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleStockProduct(row.id)}
                          />
                          <div>
                            <strong>{row.name || "-"}</strong>
                            <p>Mã: {row.sku || "-"} • ĐVT: {row.unit || "-"} • Tồn: {formatNumber(row.stock)}</p>
                          </div>
                        </label>
                      );
                    })
                  ) : (
                    <div className="customer-empty">Không tìm thấy sản phẩm phù hợp</div>
                  )}
                </div>
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowStockPrintDialog(false)}>Hủy</button>
              <button type="button" className="btn-primary" onClick={submitStockPrint} disabled={!selectedStockRows.length}>
                Mở màn hình in A4
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCustomerSuggestionDialog ? (
        <div className="dialog-overlay" onClick={() => setShowCustomerSuggestionDialog(false)}>
          <div className="dialog-panel dialog-panel--customer-suggestions" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Gợi ý khách hàng</h2>
                <p className="product-create-subtitle">Đề xuất theo công nợ và chu kỳ mua hàng để hỗ trợ tạo đơn nhanh tại POS.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowCustomerSuggestionDialog(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body product-create-body">
              <div className="suggestion-tabs" role="tablist" aria-label="Nhóm đề xuất khách hàng">
                <button
                  type="button"
                  role="tab"
                  aria-selected={customerSuggestionTab === "debt"}
                  className={`suggestion-tab-btn ${customerSuggestionTab === "debt" ? "active" : ""}`}
                  onClick={() => setCustomerSuggestionTab("debt")}
                >
                  Gợi ý thu nợ
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={customerSuggestionTab === "sales"}
                  className={`suggestion-tab-btn ${customerSuggestionTab === "sales" ? "active" : ""}`}
                  onClick={() => setCustomerSuggestionTab("sales")}
                >
                  Gợi ý bán hàng
                </button>
              </div>

              <section className="detail-card">
                <div className="suggestion-title-row">
                  <h3>Đang theo dõi</h3>
                  <span>{formatNumber(watchedSuggestionRows.length)} khách hàng</span>
                </div>
                {watchedSuggestionRows.length ? (
                  <div className="suggestion-card-grid">
                    {watchedSuggestionRows.map((item) => (
                      <article className="suggestion-card suggestion-card--watched" key={`watch-${item.id}`}>
                        <div className="suggestion-card__head-row">
                          <div className="suggestion-card__head">
                            <strong>{item.name}</strong>
                            <span>{item.phone} • {item.source === "sales" ? "Theo dõi bán hàng" : "Theo dõi thu nợ"}</span>
                          </div>
                          <button
                            type="button"
                            className="btn-secondary watched-remove-btn"
                            onClick={() => removeWatchedCustomer(item.id)}
                          >
                            Bỏ theo dõi
                          </button>
                        </div>
                        <div className="suggestion-card__meta">
                          <div>
                            <span>Công nợ hiện tại</span>
                            <strong>{item.debt ? `${formatNumber(item.debt.debtAmount)} đ` : "-"}</strong>
                          </div>
                          <div>
                            <span>Chu kỳ mua TB</span>
                            <strong>{item.sales ? `${Math.round(item.sales.avgCycleDays)} ngày` : "-"}</strong>
                          </div>
                          <div>
                            <span>Giá trị mua TB</span>
                            <strong>{item.sales ? `${formatNumber(item.sales.avgOrderValue)} đ` : "-"}</strong>
                          </div>
                          <div>
                            <span>Lần mua gần nhất</span>
                            <strong>{item.sales?.lastOrderAt ? toDateLabel(item.sales.lastOrderAt) : "-"}</strong>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="customer-empty">Chưa có khách hàng nào trong danh sách theo dõi.</div>
                )}
              </section>

              {customerSuggestionTab === "debt" ? (
                <section className="detail-card" role="tabpanel">
                  <div className="suggestion-filter-grid">
                    <label>
                      Tìm khách hàng
                      <input
                        type="text"
                        value={suggestionDebtKeyword}
                        onChange={(e) => setSuggestionDebtKeyword(e.target.value)}
                        placeholder="Tên hoặc số điện thoại"
                      />
                    </label>
                    <label>
                      Công nợ tối thiểu (đ)
                      <input
                        type="text"
                        inputMode="numeric"
                        value={suggestionMinDebt}
                        onChange={(e) => setSuggestionMinDebt(e.target.value)}
                        placeholder="Ví dụ: 500000"
                      />
                    </label>
                    <label>
                      Chưa thu tối thiểu (ngày)
                      <input
                        type="text"
                        inputMode="numeric"
                        value={suggestionMinNoReceiptDays}
                        onChange={(e) => setSuggestionMinNoReceiptDays(e.target.value)}
                        placeholder="Ví dụ: 15"
                      />
                    </label>
                    <label>
                      Số lượng gợi ý tối đa
                      <input
                        type="text"
                        inputMode="numeric"
                        value={suggestionDebtLimit}
                        onChange={(e) => setSuggestionDebtLimit(e.target.value)}
                        placeholder="Ví dụ: 30"
                      />
                    </label>
                    <div className="suggestion-filter-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setSuggestionDebtKeyword("");
                          setSuggestionMinDebt("");
                          setSuggestionMinNoReceiptDays("");
                          setSuggestionDebtLimit("30");
                        }}
                      >
                        Xóa lọc
                      </button>
                    </div>
                  </div>

                  <div className="suggestion-title-row">
                    <h3>Gợi ý thu nợ</h3>
                    <span>{formatNumber(filteredDebtSuggestions.length)} khách hàng</span>
                  </div>
                  {filteredDebtSuggestions.length ? (
                    <div className="suggestion-card-grid">
                      {filteredDebtSuggestions.map((item) => (
                        <article className="suggestion-card suggestion-card--debt" key={`debt-${item.id}`}>
                          <div className="suggestion-card__head-row">
                            <div className="suggestion-card__head">
                              <strong>{item.name}</strong>
                              <span>{item.phone}</span>
                            </div>
                            <button
                              type="button"
                              className={`btn-secondary suggestion-watch-btn ${isCustomerWatched(item.id) ? "active" : ""}`}
                              onClick={() => toggleWatchCustomer(item, "debt")}
                            >
                              {isCustomerWatched(item.id) ? "Đang theo dõi" : "Theo dõi"}
                            </button>
                          </div>
                          <div className="suggestion-card__meta">
                            <div>
                              <span>Công nợ</span>
                              <strong>{formatNumber(item.debtAmount)} đ</strong>
                            </div>
                            <div>
                              <span>Ngày chưa thu</span>
                              <strong>{item.daysSinceLastReceipt == null ? "Chưa có" : `${formatNumber(item.daysSinceLastReceipt)} ngày`}</strong>
                            </div>
                            <div>
                              <span>Thu gần nhất</span>
                              <strong>{item.lastReceiptAt ? toDateLabel(item.lastReceiptAt) : "Chưa có"}</strong>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="customer-empty">Không có khách hàng phù hợp bộ lọc thu nợ.</div>
                  )}
                </section>
              ) : (
                <section className="detail-card" role="tabpanel">
                  <div className="suggestion-filter-grid">
                    <label>
                      Tìm khách hàng
                      <input
                        type="text"
                        value={suggestionSalesKeyword}
                        onChange={(e) => setSuggestionSalesKeyword(e.target.value)}
                        placeholder="Tên hoặc số điện thoại"
                      />
                    </label>
                    <label>
                      Chu kỳ mua tối đa (ngày)
                      <input
                        type="text"
                        inputMode="numeric"
                        value={suggestionMaxCycleDays}
                        onChange={(e) => setSuggestionMaxCycleDays(e.target.value)}
                        placeholder="Ví dụ: 45"
                      />
                    </label>
                    <label>
                      Giá trị mua TB tối thiểu (đ)
                      <input
                        type="text"
                        inputMode="numeric"
                        value={suggestionMinOrderValue}
                        onChange={(e) => setSuggestionMinOrderValue(e.target.value)}
                        placeholder="Ví dụ: 1000000"
                      />
                    </label>
                    <label>
                      Số đơn tối thiểu
                      <input
                        type="text"
                        inputMode="numeric"
                        value={suggestionMinOrderCount}
                        onChange={(e) => setSuggestionMinOrderCount(e.target.value)}
                        placeholder="Ví dụ: 2"
                      />
                    </label>
                    <label>
                      Quá hạn tối đa (ngày)
                      <input
                        type="text"
                        inputMode="numeric"
                        value={suggestionPastDueDays}
                        onChange={(e) => setSuggestionPastDueDays(e.target.value)}
                        placeholder="Ví dụ: 30"
                      />
                    </label>
                    <label>
                      Còn trong (ngày)
                      <input
                        type="text"
                        inputMode="numeric"
                        value={suggestionFutureDays}
                        onChange={(e) => setSuggestionFutureDays(e.target.value)}
                        placeholder="Ví dụ: 14"
                      />
                    </label>
                    <label>
                      Số lượng gợi ý tối đa
                      <input
                        type="text"
                        inputMode="numeric"
                        value={suggestionSalesLimit}
                        onChange={(e) => setSuggestionSalesLimit(e.target.value)}
                        placeholder="Ví dụ: 30"
                      />
                    </label>
                    <div className="suggestion-filter-actions suggestion-filter-actions--wide">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setSuggestionSalesKeyword("");
                          setSuggestionMaxCycleDays("45");
                          setSuggestionMinOrderValue("");
                          setSuggestionMinOrderCount("2");
                          setSuggestionPastDueDays("30");
                          setSuggestionFutureDays("14");
                          setSuggestionSalesLimit("30");
                        }}
                      >
                        Xóa lọc
                      </button>
                    </div>
                  </div>

                  <div className="suggestion-title-row">
                    <h3>Gợi ý bán hàng theo chu kỳ & giá trị mua</h3>
                    <span>{formatNumber(filteredSalesSuggestions.length)} khách hàng</span>
                  </div>
                  {filteredSalesSuggestions.length ? (
                    <div className="suggestion-card-grid">
                      {filteredSalesSuggestions.map((item) => (
                        <article className="suggestion-card suggestion-card--sales" key={`sales-${item.id}`}>
                          <div className="suggestion-card__head-row">
                            <div className="suggestion-card__head">
                              <strong>{item.name}</strong>
                              <span>{item.phone}</span>
                            </div>
                            <button
                              type="button"
                              className={`btn-secondary suggestion-watch-btn ${isCustomerWatched(item.id) ? "active" : ""}`}
                              onClick={() => toggleWatchCustomer(item, "sales")}
                            >
                              {isCustomerWatched(item.id) ? "Đang theo dõi" : "Theo dõi"}
                            </button>
                          </div>
                          <div className="suggestion-card__meta">
                            <div>
                              <span>Chu kỳ TB</span>
                              <strong>{Math.round(item.avgCycleDays)} ngày</strong>
                            </div>
                            <div>
                              <span>Giá trị mua TB</span>
                              <strong>{formatNumber(item.avgOrderValue)} đ</strong>
                            </div>
                            <div>
                              <span>Số đơn đã ghi nhận</span>
                              <strong>{formatNumber(item.orderCount)}</strong>
                            </div>
                            <div>
                              <span>Lần mua gần nhất</span>
                              <strong>{toDateLabel(item.lastOrderAt)}</strong>
                            </div>
                            <div>
                              <span>Dự kiến mua lại</span>
                              <strong>{toDateLabel(item.predictedNextAt)} {item.daysToNext < 0 ? `(trễ ${Math.abs(item.daysToNext)} ngày)` : `(còn ${item.daysToNext} ngày)`}</strong>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="customer-empty">Không có khách hàng phù hợp bộ lọc bán hàng.</div>
                  )}
                </section>
              )}
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowCustomerSuggestionDialog(false)}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}




