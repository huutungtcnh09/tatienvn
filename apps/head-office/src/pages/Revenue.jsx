import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import "../styles/pages.css";
import "../styles/revenue.css";
import { formatCurrency, formatNumber } from "../utils/currency";

const REVENUE_SECTIONS = [
  { id: "overview", label: "Tổng quan" },
  { id: "revenue-profit", label: "Doanh thu & lợi nhuận" },
  { id: "trend-cashflow", label: "Xu hướng & dòng tiền" }
];

const STAFF_KPI_PREFS_KEY = "head_staff_kpi_filters_v1";

function fmtDelta(value, suffix = "") {
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatNumber(amount)}${suffix}`;
}

function flattenCategories(nodes = [], parentPath = "") {
  const result = [];
  for (const node of nodes) {
    const currentPath = parentPath ? `${parentPath} / ${node.name}` : node.name;
    if (node?.id) result.push({ id: node.id, name: currentPath });
    if (Array.isArray(node?.children) && node.children.length) {
      result.push(...flattenCategories(node.children, currentPath));
    }
  }
  return result;
}

function customerTypeLabel(value) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "RETAIL") return "Khách lẻ";
  if (normalized === "WHOLESALE") return "Khách sỉ";
  if (normalized === "VIP") return "Khách VIP";
  if (normalized === "LEVEL_2") return "KH Level 2";
  if (normalized === "LEVEL_2_SPECIAL") return "KH Level 2 đặc biệt";
  return value || "Không phân loại";
}

export default function Revenue({ token, initialSection = "overview" }) {
  const isStandaloneStaffKpi = initialSection === "staff-kpi";
  const [overview, setOverview] = useState(null);
  const [periodData, setPeriodData] = useState([]);
  const [cashFlowData, setCashFlowData] = useState([]);
  const [storeData, setStoreData] = useState([]);
  const [productData, setProductData] = useState([]);
  const [staffData, setStaffData] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customerTypeOptions, setCustomerTypeOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");
  const [staffSearch, setStaffSearch] = useState("");
  const [staffTimePeriod, setStaffTimePeriod] = useState("this-year");
  const [staffRoleDimension, setStaffRoleDimension] = useState("sales_person");
  const [staffGroupBy, setStaffGroupBy] = useState("user");
  const [staffPositionId, setStaffPositionId] = useState("all");
  const [staffPositions, setStaffPositions] = useState([]);
  const [cashFlowStoreId, setCashFlowStoreId] = useState("all");
  const [filters, setFilters] = useState({
    timePeriod: "this-year",
    categoryId: "all",
    productType: "all",
    customerType: "all"
  });
  const [activeSection, setActiveSection] = useState(initialSection);

  useEffect(() => {
    setActiveSection(initialSection || "overview");
  }, [initialSection]);

  useEffect(() => {
    if (!isStandaloneStaffKpi || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STAFF_KPI_PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);

      if (parsed?.staffTimePeriod) {
        setStaffTimePeriod(String(parsed.staffTimePeriod));
      }
      if (parsed?.staffRoleDimension) {
        setStaffRoleDimension(String(parsed.staffRoleDimension));
      }
      if (parsed?.staffGroupBy === "position" || parsed?.staffGroupBy === "user") {
        setStaffGroupBy(String(parsed.staffGroupBy));
      }
      if (parsed?.staffPositionId) {
        setStaffPositionId(String(parsed.staffPositionId));
      }
      if (parsed?.staffSearch) {
        setStaffSearch(String(parsed.staffSearch));
      }
    } catch (_error) {
      // Ignore corrupted client-side preferences.
    }
  }, [isStandaloneStaffKpi]);

  useEffect(() => {
    if (!isStandaloneStaffKpi || typeof window === "undefined") return;
    window.localStorage.setItem(STAFF_KPI_PREFS_KEY, JSON.stringify({
      staffTimePeriod,
      staffRoleDimension,
      staffGroupBy,
      staffPositionId,
      staffSearch
    }));
  }, [isStandaloneStaffKpi, staffTimePeriod, staffRoleDimension, staffGroupBy, staffPositionId, staffSearch]);

  useEffect(() => {
    loadData();
  }, [token, period, cashFlowStoreId, filters.timePeriod, filters.categoryId, filters.productType, filters.customerType, staffTimePeriod, staffRoleDimension, staffGroupBy, staffPositionId]);

  useEffect(() => {
    if (!isStandaloneStaffKpi) return;
    void loadStaffPositions();
  }, [token, staffRoleDimension, isStandaloneStaffKpi]);

  useEffect(() => {
    if (!isStandaloneStaffKpi) return;
    if (staffPositionId === "all") return;
    const exists = staffPositions.some((position) => position.id === staffPositionId);
    if (!exists) {
      setStaffPositionId("all");
    }
  }, [isStandaloneStaffKpi, staffPositionId, staffPositions]);

  const dashboardFilters = useMemo(() => {
    if (isStandaloneStaffKpi) {
      return {
        timePeriod: staffTimePeriod,
        roleDimension: staffRoleDimension,
        groupBy: staffGroupBy,
        positionId: staffPositionId === "all" ? undefined : staffPositionId
      };
    }
    return {
      timePeriod: filters.timePeriod,
      categoryId: filters.categoryId === "all" ? undefined : filters.categoryId,
      productType: filters.productType === "all" ? undefined : filters.productType,
      customerType: filters.customerType === "all" ? undefined : filters.customerType
    };
  }, [filters, isStandaloneStaffKpi, staffTimePeriod, staffRoleDimension, staffGroupBy, staffPositionId]);

  const categoryOptions = useMemo(() => {
    return flattenCategories(categories);
  }, [categories]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [overviewRes, periodRes, cashFlowRes, storeRes, productRes, staffRes, categoriesRes, partnersRes] = await Promise.all([
        api.getOverview(token, dashboardFilters),
        api.getRevenueByPeriod(token, period, dashboardFilters),
        api.getCashFlowByPeriod(token, period, cashFlowStoreId === "all" ? undefined : cashFlowStoreId, undefined, dashboardFilters),
        api.getRevenueByStore(token, dashboardFilters),
        api.getRevenueByProduct(token, dashboardFilters),
        api.getStaffKpi(token, dashboardFilters),
        api.getCategories(token).catch(() => ({ data: [] })),
        api.getPartners(token).catch(() => ({ data: [] }))
      ]);

      setOverview(overviewRes.data);
      setPeriodData((periodRes.data || []).slice(-12));
      setCashFlowData((cashFlowRes.data || []).slice(-12));
      setStoreData(storeRes.data || []);
      setProductData((productRes.data || []).sort((a, b) => b.revenue - a.revenue).slice(0, 10));
      setStaffData((staffRes.data || []).sort((a, b) => b.revenue - a.revenue));
      setCategories(categoriesRes.data || []);

      const types = new Set();
      (partnersRes.data || []).forEach((partner) => {
        if (!partner?.isCustomer) return;
        const rawType = partner.customerType || partner.customerPriceTier;
        if (rawType) types.add(String(rawType));
      });
      setCustomerTypeOptions(Array.from(types).sort((a, b) => a.localeCompare(b, "vi")));
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadStaffPositions = async () => {
    try {
      const roleType = staffRoleDimension === "store_manager"
        ? "STORE_MANAGER"
        : staffRoleDimension === "store_supervisor"
          ? "STORE_SUPERVISOR"
          : "CUSTOMER_SERVICE";
      const res = await api.getOrgPositions(token, { roleType, isActive: true });
      setStaffPositions(res?.data || res || []);
    } catch (_error) {
      setStaffPositions([]);
    }
  };

  if (loading || !overview) {
    return <div className="page-container"><p>Đang tải...</p></div>;
  }

  const profitMargin = overview.revenue > 0
    ? ((overview.profit / overview.revenue) * 100).toFixed(1)
    : 0;
  const grossRevenue = Number(overview.grossRevenue ?? overview.revenue ?? 0);
  const returnedRevenue = Number(overview.returnedRevenue ?? 0);
  const netRevenue = Number(overview.revenue ?? 0);
  const grossCashIn = Number(overview.cashIn ?? 0);
  const netCashIn = Number(overview.netCashIn ?? (grossCashIn - Number(overview.cashOutRefund || 0)));
  const currentPeriod = periodData[periodData.length - 1] || null;
  const previousPeriod = periodData[periodData.length - 2] || null;
  const revenueDelta = currentPeriod && previousPeriod
    ? Number(currentPeriod.revenue) - Number(previousPeriod.revenue)
    : 0;
  const profitDelta = currentPeriod && previousPeriod
    ? Number(currentPeriod.profit) - Number(previousPeriod.profit)
    : 0;
  const ordersDelta = currentPeriod && previousPeriod
    ? Number(currentPeriod.orders) - Number(previousPeriod.orders)
    : 0;
  const normalizedStaffSearch = staffSearch.trim().toLowerCase();
  const roleDimensionLabel =
    staffRoleDimension === "store_manager"
      ? "quản lý cửa hàng"
      : staffRoleDimension === "store_supervisor"
        ? "giám sát cửa hàng"
        : "nhân viên bán hàng";
  const staffGroupByLabel = staffGroupBy === "position" ? "Theo vị trí" : "Theo nhân sự";
  const staffRows = staffData.filter((staff) => {
    if (!normalizedStaffSearch) return true;
    if (staffGroupBy === "position") {
      const positionCode = String(staff.positionCode || "").toLowerCase();
      const positionName = String(staff.positionName || "").toLowerCase();
      const usersText = Array.isArray(staff.usersInvolved)
        ? staff.usersInvolved.map((item) => String(item?.fullName || "")).join(" ").toLowerCase()
        : "";
      return positionCode.includes(normalizedStaffSearch)
        || positionName.includes(normalizedStaffSearch)
        || usersText.includes(normalizedStaffSearch);
    }

    const fullName = String(staff.fullName || "").toLowerCase();
    const email = String(staff.email || "").toLowerCase();
    return fullName.includes(normalizedStaffSearch) || email.includes(normalizedStaffSearch);
  });
  const cashFlowRows = cashFlowData.map((row) => ({
    period: row.period,
    cashIn: Number(row.cashIn || 0),
    netCashIn: Number(row.netCashIn ?? (Number(row.cashIn || 0) - Number(row.cashOutRefund || 0))),
    cashOut: Number(row.cashOut || 0),
    netCashFlow: Number(row.netCashFlow || 0)
  }));
  const flowBreakdown = overview.cashFlowBreakdown || {
    operating: { netCashFlow: 0 },
    investing: { netCashFlow: 0 },
    financing: { netCashFlow: 0 }
  };
  const inventoryTrendRows = periodData.map((row, idx) => {
    const ratio = periodData.length ? (idx + 1) / periodData.length : 1;
    const estimatedInventory = Math.round(Number(overview.inventoryValue || 0) * (0.75 + ratio * 0.25));
    return {
      period: row.period,
      inventoryValue: estimatedInventory,
      stockPressure: estimatedInventory > Number(overview.inventoryValue || 0) ? "Tăng" : "Ổn định"
    };
  });

  return (
    <div className="page-container revenue-page">
      <div className="page-header">
        <div>
          <h1>{isStandaloneStaffKpi ? "KPI nhân viên" : "Doanh thu & Lợi nhuận"}</h1>
          <p className="stat-text">
            {isStandaloneStaffKpi
              ? "Theo dõi hiệu suất kinh doanh của từng nhân viên phụ trách khách hàng"
              : "So sánh kỳ hiện tại, hiệu quả cửa hàng và KPI nhân viên phụ trách khách hàng"}
          </p>
        </div>
      </div>

      {!isStandaloneStaffKpi ? (
      <div className="revenue-filters">
        <label>
          Thời gian
          <select
            className="filter-select"
            value={filters.timePeriod}
            onChange={(e) => setFilters((prev) => ({ ...prev, timePeriod: e.target.value }))}
          >
            <option value="this-month">Tháng này</option>
            <option value="this-quarter">Quý này</option>
            <option value="this-year">Năm nay</option>
            <option value="last-year">Năm trước</option>
          </select>
        </label>

        <label>
          Ngành hàng
          <select
            className="filter-select"
            value={filters.categoryId}
            onChange={(e) => setFilters((prev) => ({ ...prev, categoryId: e.target.value }))}
          >
            <option value="all">Tất cả ngành hàng</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>

        <label>
          Loại hàng hóa
          <select
            className="filter-select"
            value={filters.productType}
            onChange={(e) => setFilters((prev) => ({ ...prev, productType: e.target.value }))}
          >
            <option value="all">Tất cả loại hàng</option>
            <option value="GOODS">Hàng hóa</option>
            <option value="SERVICE">Dịch vụ</option>
          </select>
        </label>

        <label>
          Loại khách hàng
          <select
            className="filter-select"
            value={filters.customerType}
            onChange={(e) => setFilters((prev) => ({ ...prev, customerType: e.target.value }))}
          >
            <option value="all">Tất cả khách hàng</option>
            {customerTypeOptions.map((type) => (
              <option key={type} value={type}>{customerTypeLabel(type)}</option>
            ))}
          </select>
        </label>
      </div>
      ) : null}

      {!isStandaloneStaffKpi ? (
        <div className="revenue-nav" role="tablist" aria-label="Điều hướng doanh thu">
          {REVENUE_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              className={`revenue-nav-item ${activeSection === section.id ? "active" : ""}`}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </div>
      ) : null}

      {activeSection === "overview" ? (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">Doanh thu thuần</div>
              <div className="kpi-value">{formatCurrency(netRevenue)}</div>
              <div className="kpi-unit"></div>
              <div className="kpi-change neutral">
                Gộp {formatCurrency(grossRevenue)} • Trả hàng {formatCurrency(returnedRevenue)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Lợi nhuận</div>
              <div className="kpi-value">{formatCurrency(overview.profit)}</div>
              <div className="kpi-unit"></div>
              <div className={`kpi-change ${profitDelta > 0 ? "positive" : profitDelta < 0 ? "negative" : "neutral"}`}>
                {currentPeriod && previousPeriod ? `${fmtDelta(profitDelta, " ₫")} so với kỳ trước` : `Biên lợi nhuận ${profitMargin}%`}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Tiền vào ròng</div>
              <div className="kpi-value">{formatCurrency(netCashIn)}</div>
              <div className="kpi-unit"></div>
              <div className="kpi-change neutral">Gộp {formatCurrency(grossCashIn)} • Hoàn tiền {formatCurrency(overview.cashOutRefund)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Dòng tiền thuần</div>
              <div className="kpi-value">{formatCurrency(overview.netCashFlow)}</div>
              <div className="kpi-unit"></div>
              <div className={`kpi-change ${overview.netCashFlow >= 0 ? "positive" : "negative"}`}>
                {overview.netCashFlow >= 0 ? "Dương" : "Âm"} trong toàn kỳ dữ liệu
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Tỷ lệ lợi nhuận</div>
              <div className="kpi-value">{profitMargin}%</div>
              <div className="kpi-unit">margin</div>
              <div className={`kpi-change ${ordersDelta > 0 ? "positive" : ordersDelta < 0 ? "negative" : "neutral"}`}>
                {currentPeriod && previousPeriod ? `${fmtDelta(ordersDelta)} đơn so với kỳ trước` : `${overview.ordersCount} đơn toàn hệ thống`}
              </div>
            </div>
          </div>

          <div className="revenue-summary">
            <div className="summary-card">
              <h3>Tóm tắt kinh doanh</h3>
              <div className="summary-grid">
                <div className="summary-item">
                  <div className="summary-label">Tổng đơn hàng</div>
                  <div className="summary-value">{overview.ordersCount}</div>
                </div>
                <div className="summary-item">
                  <div className="summary-label">Tổng khách hàng</div>
                  <div className="summary-value">{overview.customersCount}</div>
                </div>
                <div className="summary-item">
                  <div className="summary-label">Doanh thu gộp</div>
                  <div className="summary-value">{formatCurrency(grossRevenue)}</div>
                </div>
                <div className="summary-item">
                  <div className="summary-label">Giảm trừ trả hàng</div>
                  <div className="summary-value" style={{ color: "#c92a2a" }}>{formatCurrency(returnedRevenue)}</div>
                </div>
                <div className="summary-item">
                  <div className="summary-label">Công nợ khách</div>
                  <div className="summary-value" style={{ color: "#dc3545" }}>
                    {formatCurrency(overview.customerDebt)}
                  </div>
                </div>
                <div className="summary-item">
                  <div className="summary-label">Giá trị tồn kho</div>
                  <div className="summary-value">{formatCurrency(overview.inventoryValue)}</div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {activeSection === "revenue-profit" ? (
        <>
          <div className="revenue-section">
            <div className="section-header">
              <h2>Xu hướng doanh thu</h2>
              <select
                className="filter-select"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option value="day">Theo ngày</option>
                <option value="week">Theo tuần</option>
                <option value="month">Theo tháng</option>
                <option value="quarter">Theo quý</option>
                <option value="year">Theo năm</option>
              </select>
            </div>

            {currentPeriod ? (
              <div className="trend-highlight">
                <div>
                  <span className="trend-label">Kỳ hiện tại</span>
                  <strong>{currentPeriod.period}</strong>
                </div>
                <div>
                  <span className="trend-label">Doanh thu</span>
                  <strong>{formatCurrency(currentPeriod.revenue)}</strong>
                </div>
                <div>
                  <span className="trend-label">Lợi nhuận</span>
                  <strong>{formatCurrency(currentPeriod.profit)}</strong>
                </div>
                <div>
                  <span className="trend-label">Số đơn</span>
                  <strong>{currentPeriod.orders}</strong>
                </div>
              </div>
            ) : null}

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Thời kỳ</th>
                    <th className="text-right">Doanh thu</th>
                    <th className="text-right">Lợi nhuận</th>
                    <th className="text-right">Số đơn</th>
                  </tr>
                </thead>
                <tbody>
                  {periodData.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="text-center">Không có dữ liệu</td>
                    </tr>
                  ) : (
                    periodData.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.period}</td>
                        <td className="text-right">{formatCurrency(item.revenue)}</td>
                        <td className="text-right text-profit">{formatCurrency(item.profit)}</td>
                        <td className="text-right">{item.orders}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="two-column-section">
            <div className="revenue-section">
              <h2>Doanh thu theo cửa hàng</h2>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Cửa hàng</th>
                      <th className="text-right">Doanh thu</th>
                      <th className="text-right">Lợi nhuận</th>
                      <th className="text-right">Đơn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storeData.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="text-center">Không có dữ liệu</td>
                      </tr>
                    ) : (
                      storeData.map((store) => (
                        <tr key={store.storeId}>
                          <td>{store.storeName}</td>
                          <td className="text-right">{formatCurrency(store.revenue)}</td>
                          <td className="text-right text-profit">{formatCurrency(store.profit)}</td>
                          <td className="text-right">{store.ordersCount}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="revenue-section">
              <h2>Top 10 sản phẩm</h2>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Sản phẩm</th>
                      <th className="text-right">Số lượng</th>
                      <th className="text-right">Doanh thu</th>
                      <th className="text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productData.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="text-center">Không có dữ liệu</td>
                      </tr>
                    ) : (
                      productData.map((product) => (
                        <tr key={product.productId}>
                          <td>{product.productName}</td>
                          <td className="text-right">{product.quantity}</td>
                          <td className="text-right">{formatCurrency(product.revenue)}</td>
                          <td className="text-right">
                            <span className={`margin-badge ${Number(product.margin) > 30 ? "high" : "normal"}`}>
                              {product.margin}%
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {activeSection === "staff-kpi" ? (
        <div className="revenue-section">
          <div className="section-header">
            <h2>KPI nhân viên kinh doanh</h2>
            <div className="staff-kpi-controls">
              <input
                className="filter-select"
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
                placeholder={staffGroupBy === "position" ? "Tìm theo vị trí hoặc nhân sự" : "Tìm theo tên nhân viên"}
              />
              <select
                className="filter-select"
                value={staffTimePeriod}
                onChange={(e) => setStaffTimePeriod(e.target.value)}
              >
                <option value="this-month">Tháng này</option>
                <option value="this-quarter">Quý này</option>
                <option value="this-year">Năm nay</option>
                <option value="last-year">Năm trước</option>
              </select>
              <select
                className="filter-select"
                value={staffGroupBy}
                onChange={(e) => setStaffGroupBy(e.target.value)}
              >
                <option value="user">Tổng hợp theo nhân sự</option>
                <option value="position">Tổng hợp theo vị trí</option>
              </select>
              <select
                className="filter-select"
                value={staffRoleDimension}
                onChange={(e) => {
                  setStaffRoleDimension(e.target.value);
                  setStaffPositionId("all");
                }}
              >
                <option value="sales_person">Nhân viên bán hàng</option>
                <option value="store_manager">Quản lý cửa hàng</option>
                <option value="store_supervisor">Giám sát cửa hàng</option>
              </select>
              <select
                className="filter-select"
                value={staffPositionId}
                onChange={(e) => setStaffPositionId(e.target.value)}
              >
                <option value="all">Tất cả vị trí</option>
                {staffPositions.map((position) => (
                  <option key={position.id} value={position.id}>{position.code} - {position.name}</option>
                ))}
              </select>
            </div>
          </div>
          <span className="staff-kpi-caption">
            Xếp theo doanh thu theo vai trò {roleDimensionLabel}, chế độ {staffGroupBy === "position" ? "theo vị trí" : "theo nhân sự"}
          </span>
          <div className={`kpi-view-badge ${staffGroupBy === "position" ? "position" : "user"}`}>
            {staffGroupByLabel}
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{staffGroupBy === "position" ? "Vị trí" : "Nhân viên"}</th>
                  {staffGroupBy === "position" ? (
                    <th>
                      Nhân sự tham gia
                      <span
                        className="inline-tooltip"
                        title="Danh sách nhân sự có phát sinh đơn trong kỳ cho vị trí này, dựa trên dữ liệu snapshot của đơn hàng."
                        aria-label="Giải thích nhân sự tham gia"
                      >
                        i
                      </span>
                    </th>
                  ) : null}
                  <th className="text-right">Doanh thu</th>
                  <th className="text-right">Lợi nhuận</th>
                  <th className="text-right">Khách hoạt động</th>
                  <th className="text-right">Số đơn</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.length === 0 ? (
                  <tr>
                    <td colSpan={staffGroupBy === "position" ? 6 : 5} className="text-center">Không có dữ liệu KPI nhân viên</td>
                  </tr>
                ) : (
                  staffRows.map((staff) => (
                    <tr key={staffGroupBy === "position" ? staff.positionId : staff.userId}>
                      <td>
                        {staffGroupBy === "position"
                          ? `${staff.positionCode || "--"} - ${staff.positionName || "--"}`
                          : (staff.fullName || "-")}
                      </td>
                      {staffGroupBy === "position" ? (
                        <td>
                          {Array.isArray(staff.usersInvolved) && staff.usersInvolved.length > 0
                            ? staff.usersInvolved.map((item) => item.fullName || item.id).join(", ")
                            : "--"}
                        </td>
                      ) : null}
                      <td className="text-right font-mono">{formatCurrency(staff.revenue)}</td>
                      <td className="text-right text-profit font-mono">{formatCurrency(staff.profit)}</td>
                      <td className="text-right">{staff.customersActive}</td>
                      <td className="text-right">{staff.ordersCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeSection === "trend-cashflow" ? (
        <div className="two-column-section">
          <div className="revenue-section">
            <div className="section-header">
              <h2>Dòng tiền theo kỳ</h2>
              <select
                className="filter-select"
                value={cashFlowStoreId}
                onChange={(e) => setCashFlowStoreId(e.target.value)}
              >
                <option value="all">Toàn hệ thống</option>
                {storeData.map((store) => (
                  <option key={store.storeId} value={store.storeId}>{store.storeName}</option>
                ))}
              </select>
            </div>

            <div className="trend-highlight" style={{ marginBottom: 16 }}>
              <div>
                <span className="trend-label">Operating</span>
                <strong style={{ color: Number(flowBreakdown.operating?.netCashFlow || 0) >= 0 ? "#2b8a3e" : "#c92a2a" }}>
                  {formatCurrency(flowBreakdown.operating?.netCashFlow || 0)}
                </strong>
              </div>
              <div>
                <span className="trend-label">Investing</span>
                <strong>{formatCurrency(flowBreakdown.investing?.netCashFlow || 0)}</strong>
              </div>
              <div>
                <span className="trend-label">Financing</span>
                <strong>{formatCurrency(flowBreakdown.financing?.netCashFlow || 0)}</strong>
              </div>
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kỳ</th>
                    <th className="text-right">Tiền vào gộp</th>
                    <th className="text-right">Tiền vào ròng</th>
                    <th className="text-right">Tiền ra (thực tế)</th>
                    <th className="text-right">Dòng tiền thuần</th>
                  </tr>
                </thead>
                <tbody>
                  {cashFlowRows.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="text-center">Không có dữ liệu</td>
                    </tr>
                  ) : (
                    cashFlowRows.map((row) => (
                      <tr key={row.period}>
                        <td>{row.period}</td>
                        <td className="text-right font-mono">{formatCurrency(row.cashIn)}</td>
                        <td className="text-right font-mono">{formatCurrency(row.netCashIn)}</td>
                        <td className="text-right font-mono" style={{ color: "#c92a2a" }}>{formatCurrency(row.cashOut)}</td>
                        <td className="text-right font-mono" style={{ color: row.netCashFlow >= 0 ? "#2b8a3e" : "#c92a2a" }}>
                          {formatCurrency(row.netCashFlow)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="revenue-section">
            <h2>Tồn kho theo thời gian</h2>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kỳ</th>
                    <th className="text-right">Giá trị tồn kho (ước tính)</th>
                    <th className="text-right">Xu hướng</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryTrendRows.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="text-center">Không có dữ liệu</td>
                    </tr>
                  ) : (
                    inventoryTrendRows.map((row) => (
                      <tr key={row.period}>
                        <td>{row.period}</td>
                        <td className="text-right font-mono">{formatCurrency(row.inventoryValue)}</td>
                        <td className="text-right" style={{ color: row.stockPressure === "Tăng" ? "#9c6b00" : "#2b8a3e" }}>
                          {row.stockPressure}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
