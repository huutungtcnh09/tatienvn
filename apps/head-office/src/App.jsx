import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import Stores from "./pages/Stores";
import Customers from "./pages/Customers";
import Products from "./pages/Products";
import Revenue from "./pages/Revenue";
import Orders from "./pages/Orders";
import Purchases from "./pages/Purchases";
import PurchaseCashFlow from "./pages/PurchaseCashFlow";
import PurchaseReconciliation from "./pages/PurchaseReconciliation";
import Rbac from "./pages/Rbac";
import MarketingFacebook from "./pages/MarketingFacebook";
import Articles from "./pages/Articles";
import Promotions from "./pages/Promotions";
import Consultations from "./pages/Consultations";
import OrgAssignments from "./pages/OrgAssignments";
import OrgPositions from "./pages/OrgPositions";
import BusinessAreas from "./pages/BusinessAreas";
import { getOverview, login } from "./api";

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

const HEAD_OFFICE_ALLOWED_ROLES = ["SUPER_ADMIN", "HEAD_MANAGER", "ACCOUNTANT", "MARKETING"];

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

function isTokenExpired(rawToken) {
  try {
    const rawPayload = rawToken.split(".")[1];
    const json = decodeURIComponent(atob(rawPayload.replace(/-/g, "+").replace(/_/g, "/")).split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
    const data = JSON.parse(json);
    const exp = Number(data?.exp || 0);
    if (!exp) return false;
    return Math.floor(Date.now() / 1000) >= exp;
  } catch (_e) {
    return false;
  }
}

function isAuthErrorMessage(message) {
  const text = String(message || "").toLowerCase();
  return ["unauthorized", "jwt", "token", "đăng nhập", "phiên đăng nhập", "hết hạn"].some((keyword) => text.includes(keyword));
}

export default function App() {
  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem("head_token") || "";
    if (saved && (!getTokenRoles(saved).some((r) => HEAD_OFFICE_ALLOWED_ROLES.includes(r)) || isTokenExpired(saved))) {
      localStorage.removeItem("head_token");
      return "";
    }
    return saved;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState(null);
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [overviewFilters, setOverviewFilters] = useState({
    timePeriod: "this-year",
    productType: "all",
    categoryId: "",
    storeId: "",
    overviewTracking: "tracked"
  });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);
  const currentUserName = parseUserNameFromToken(token);
  const avatarLetter = String(currentUserName || "T").trim().charAt(0).toUpperCase() || "T";

  const clearSession = (message = "") => {
    localStorage.removeItem("head_token");
    setToken("");
    setCurrentPage("dashboard");
    if (message) setError(message);
  };

  const handleLogin = async (email, password) => {
    setLoading(true);
    setError("");
    try {
      const result = await login(email, password);
      const roles = getTokenRoles(result.data.accessToken);
      const hasAccess = roles.some((r) => HEAD_OFFICE_ALLOWED_ROLES.includes(r));
      if (!hasAccess) {
        setError("Tài khoản không có quyền truy cập ứng dụng Head Office. Vui lòng sử dụng đúng ứng dụng theo vai trò của bạn.");
        return;
      }
      localStorage.setItem("head_token", result.data.accessToken);
      setToken(result.data.accessToken);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    getOverview(token, overviewFilters)
      .then((res) => setOverview(res.data || res))
      .catch((e) => {
        const message = e instanceof Error ? e.message : "";
        if (isAuthErrorMessage(message)) {
          clearSession("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
          return;
        }
        setOverview(null);
      });
  }, [token, overviewFilters]);

  useEffect(() => {
    if (typeof window === "undefined" || !token) return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const input = args[0];
      const requestUrl = typeof input === "string" ? input : input?.url || "";
      const isLoginRequest = requestUrl.includes("/api/auth/login");

      if (response.status === 401 && !isLoginRequest) {
        clearSession("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
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
    if (typeof window === "undefined") return;
    const hasExtraUrlParts = window.location.pathname !== "/" || window.location.search || window.location.hash;
    if (hasExtraUrlParts) {
      window.history.replaceState({}, "", "/");
    }
  }, []);

  if (!token) {
    return (
      <>
        <Login onLogin={handleLogin} loading={loading} />
        {error ? <p className="error">{error}</p> : null}
      </>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case "users":
        return <Users token={token} />;
      case "stores":
        return <Stores token={token} />;
      case "customers":
        return <Customers token={token} />;
      case "products":
        return <Products token={token} />;
      case "revenue":
        return <Revenue token={token} />;
      case "staff-kpi":
        return <Revenue token={token} initialSection="staff-kpi" />;
      case "org-positions":
        return <OrgPositions token={token} />;
      case "org-assignments":
        return <OrgAssignments token={token} />;
      case "business-areas":
        return <BusinessAreas token={token} />;
      case "orders":
        return <Orders token={token} />;
      case "purchases":
        return <Purchases token={token} onNavigate={setCurrentPage} />;
      case "purchase-cash-flow":
        return <PurchaseCashFlow token={token} />;
      case "purchase-reconciliation":
        return <PurchaseReconciliation token={token} />;
      case "rbac":
        return <Rbac token={token} />;
      case "marketing":
        return <MarketingFacebook token={token} />;
      case "articles":
        return <Articles token={token} />;
      case "promotions":
        return <Promotions token={token} />;
      case "consultations":
        return <Consultations token={token} />;
      case "settings":
        return (
          <section className="content">
            <div className="panel">
              <h2>Thiết đặt tài khoản</h2>
              <p>Quản lý thông tin tài khoản và tùy chọn ứng dụng tại đây.</p>
            </div>
          </section>
        );
      default:
        return <Dashboard overview={overview} filters={overviewFilters} onFiltersChange={setOverviewFilters} token={token} />;
    }
  };

  return (
    <div className="app-shell">
      <header className="top-header">
        <h1>Ứng dụng Trụ sở Chính</h1>
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
                  setShowUserMenu(false);
                  clearSession();
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
      </header>
      <main className="layout">
        <Sidebar
          currentPage={currentPage}
          onPageChange={setCurrentPage}
        />
        {renderPage()}
      </main>
    </div>
  );
}
