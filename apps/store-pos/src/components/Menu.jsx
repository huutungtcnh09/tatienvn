const menus = [
  { id: "pos", label: "Tạo đơn bán hàng", icon: "pos" },
  { id: "orders", label: "Quản lý đơn hàng", icon: "orders" },
  { id: "receipts", label: "Phiếu thu", icon: "receipts" },
  { id: "customers", label: "Khách hàng", icon: "customers" },
  { id: "products", label: "Sản phẩm", icon: "products" },
  { id: "business-areas", label: "Khu vực kinh doanh", icon: "business-areas" },
  { id: "purchases", label: "Mua hàng", icon: "purchases" },
  { id: "settings", label: "Thiết lập", icon: "settings" }
];

function MenuIcon({ name }) {
  switch (name) {
    case "pos":
      return <path d="M4 6h16v12H4zM8 18v2m8-2v2M7 10h3m4 0h3" />;
    case "orders":
      return <path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" />;
    case "receipts":
      return <path d="M7 4h10v16l-2-1-2 1-2-1-2 1-2-1V4zM9 8h6M9 12h6" />;
    case "customers":
      return <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />;
    case "products":
      return <path d="M4 7l8-4 8 4-8 4-8-4Zm0 5 8 4 8-4M4 17l8 4 8-4" />;
    case "business-areas":
      return <path d="M4 6h7v6H4zm9 0h7v4h-7zM4 14h7v4H4zm9-1h7v7h-7z" />;
    case "purchases":
      return <path d="M4 7h16l-2 12H6L4 7Zm3-3h10" />;
    default:
      return <path d="M12 3v3m0 12v3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M3 12h3m12 0h3M4.9 19.1 7 17m10-10 2.1-2.1" />;
  }
}

function ToggleIcon() {
  return (
    <svg className="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

export default function Menu({ currentPage, onPageChange, collapsed, onToggle }) {
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <button type="button" className="toggle" onClick={onToggle} title={collapsed ? "Mở rộng menu" : "Thu gọn menu"}>
        <ToggleIcon />
      </button>
      {!collapsed ? <div className="brand">Cửa hàng</div> : null}
      <nav>
        {menus.map((item) => (
          <div
            key={item.id}
            className={`menu-item ${currentPage === item.id ? "active" : ""}`}
            onClick={() => onPageChange(item.id)}
            title={item.label}
            data-label={item.label}
          >
            <span className="menu-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <MenuIcon name={item.icon} />
              </svg>
            </span>
            {!collapsed ? <span className="menu-label">{item.label}</span> : null}
          </div>
        ))}
      </nav>
    </aside>
  );
}
