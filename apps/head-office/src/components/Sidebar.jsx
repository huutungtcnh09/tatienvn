const menuitems = [
  { label: "Tổng quan", id: "dashboard", icon: "dashboard" },
  { label: "Quản lý người dùng", id: "users", icon: "users" },
  { label: "Quản lý cửa hàng và kho", id: "stores", icon: "stores" },
  { label: "Quản lý khách hàng", id: "customers", icon: "customers" },
  { label: "Quản lý sản phẩm", id: "products", icon: "products" },
  { label: "Khu vực kinh doanh", id: "business-areas", icon: "business-areas" },
  { label: "Vị trí & bổ nhiệm", id: "org-positions", icon: "org-positions" },
  { label: "KPI nhân viên", id: "staff-kpi", icon: "staff-kpi" },
  { label: "Quản lý đơn hàng", id: "orders", icon: "orders" },
  { label: "Quản lý mua hàng", id: "purchases", icon: "purchases" },
  { label: "Chương trình khuyến mại", id: "promotions", icon: "promotions" },
  { label: "Quản lý bài viết", id: "articles", icon: "articles" },
  { label: "Yêu cầu tư vấn", id: "consultations", icon: "consultations" },
  { label: "Phân quyền và vai trò", id: "rbac", icon: "rbac" },
  { label: "Marketing Facebook", id: "marketing", icon: "marketing" }
];

function MenuIcon({ name }) {
  switch (name) {
    case "dashboard":
      return <path d="M3 4h7v7H3zm11 0h7v4h-7zm0 8h7v8h-7zM3 15h7v5H3z" />;
    case "users":
      return <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 20a5 5 0 0 1 10 0m1 0a4 4 0 0 1 8 0" />;
    case "stores":
      return <path d="M4 9h16v11H4zM2 9l2-4h16l2 4M8 13h3m5 0h3" />;
    case "customers":
      return <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />;
    case "products":
      return <path d="M4 7l8-4 8 4-8 4-8-4Zm0 5 8 4 8-4M4 17l8 4 8-4" />;
    case "business-areas":
      return <path d="M4 6h7v6H4zm9 0h7v4h-7zM4 14h7v4H4zm9-1h7v7h-7z" />;
    case "org-positions":
      return <path d="M4 5h16v5H4zm0 9h7v5H4zm9 0h7v5h-7" />;
    case "org-assignments":
      return <path d="M7 4h10M7 8h10M5 12h14M6 20h4v-5H6zm8 0h4v-8h-4" />;
    case "staff-kpi":
      return <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0M18 12v7M15 16h6" />;
    case "orders":
      return <path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" />;
    case "purchases":
      return <path d="M4 7h16l-2 12H6L4 7Zm3-3h10" />;
    case "purchase-cash-flow":
      return <path d="M4 19h16M7 16V8m5 8V5m5 11v-6" />;
    case "purchase-reconciliation":
      return <path d="M6 4h12v16H6zM9 9h6M9 13h6M9 17h3" />;
    case "promotions":
      return <path d="M4 9h16v11H4zM8 9V5h8v4M9 14h6M9 18h4" />;
    case "consultations":
      return <path d="M12 3c5 0 9 1.5 9 3v2c0 1.5-4 3-9 3s-9-1.5-9-3V6c0-1.5 4-3 9-3zm-8 7c0 1.5 4 3 8 3s8-1.5 8-3m-7 5c-5 0-9 1.5-9 3v3c0 1.5 4 3 9 3s9-1.5 9-3v-3c0-1.5-4-3-9-3z" />;
    case "articles":
      return <path d="M4 4h16v3H4zm0 5h10v2H4zm0 4h16v2H4zm0 4h8v2H4z" />;
    case "rbac":
      return <path d="M12 3 5 6v6c0 5 3.3 8.3 7 9 3.7-.7 7-4 7-9V6l-7-3Zm0 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-3 8a3 3 0 0 1 6 0" />;
    default:
      return <path d="M4 6h10l6 3-6 3H4zM6 13l-2 7 6-3 6 3" />;
  }
}

export default function Sidebar({ currentPage, onPageChange }) {
  const handleMenuClick = (item) => {
    onPageChange(item.id);
  };

  return (
    <aside className="sidebar">
      <div className="brand">Trụ sở chính</div>
      <nav>
        {menuitems.map((item) => (
          <div
            key={item.id} 
            className={`menu-item ${currentPage === item.id ? "active" : ""}`}
            onClick={() => handleMenuClick(item)}
            title={item.label}
            data-label={item.label}
          >
            <span className="menu-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <MenuIcon name={item.icon} />
              </svg>
            </span>
            <span className="menu-label">{item.label}</span>
          </div>
        ))}
      </nav>
    </aside>
  );
}
