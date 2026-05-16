import { useState, useEffect, useMemo } from "react";
import { formatCurrency } from "../utils/currency";
import * as api from "../api";
import "../styles/pages.css";

export default function Dashboard({ overview, filters = {}, onFiltersChange, token }) {
  const [categories, setCategories] = useState([]);
  const [stores, setStores] = useState([]);
  const [cashFlowTrend, setCashFlowTrend] = useState([]);
  const [cashFlowLoading, setCashFlowLoading] = useState(false);
  const [monthlyRevenueCompare, setMonthlyRevenueCompare] = useState(null);
  const [monthlyRevenueLoading, setMonthlyRevenueLoading] = useState(false);
  const [hoveredRevenueIdx, setHoveredRevenueIdx] = useState(null);

  useEffect(() => {
    if (!token) return;
    Promise.all([api.getCategories(token), api.getStores(token)])
      .then(([catsRes, storesRes]) => {
        setCategories(catsRes.data || catsRes || []);
        setStores(storesRes.data || storesRes || []);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const periodByTime = {
      "this-month": "day",
      "this-quarter": "month",
      "this-year": "month",
      "last-year": "month"
    };
    const trendPeriod = periodByTime[filters.timePeriod] || "month";

    setCashFlowLoading(true);
    api.getCashFlowByPeriod(token, trendPeriod, filters.storeId || undefined, filters.overviewTracking || "tracked")
      .then((res) => {
        const rows = res.data || res || [];
        setCashFlowTrend(Array.isArray(rows) ? rows : []);
      })
      .catch(() => setCashFlowTrend([]))
      .finally(() => setCashFlowLoading(false));
  }, [token, filters.timePeriod, filters.storeId, filters.overviewTracking]);

  useEffect(() => {
    if (!token) return;
    setMonthlyRevenueLoading(true);
    api.getRevenueCompareMonthly(token, {
      timePeriod: filters.timePeriod,
      storeId: filters.storeId || undefined,
      productType: filters.productType || "all",
      categoryId: filters.categoryId || undefined,
      overviewTracking: filters.overviewTracking || "tracked"
    })
      .then((res) => setMonthlyRevenueCompare(res.data || res || null))
      .catch(() => setMonthlyRevenueCompare(null))
      .finally(() => setMonthlyRevenueLoading(false));
  }, [token, filters.timePeriod, filters.storeId, filters.productType, filters.categoryId]);

  const chartSeries = useMemo(() => {
    const rows = (cashFlowTrend || []).slice(-12);
    const inventoryValue = Number(overview?.inventoryValue || 0);
    const points = rows.map((row) => ({
      label: String(row.period || ""),
      cashIn: Number(row.cashIn || 0),
      cashOut: Number(row.cashOut || 0),
      inventory: inventoryValue
    }));

    if (points.length === 0) return { points: [], maxValue: 0 };

    const maxValue = Math.max(
      1,
      ...points.map((p) => p.cashIn),
      ...points.map((p) => p.cashOut),
      ...points.map((p) => p.inventory)
    );

    return { points, maxValue };
  }, [cashFlowTrend, overview?.inventoryValue]);

  const chartGeometry = useMemo(() => {
    const width = 980;
    const height = 280;
    const padLeft = 44;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 44;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;
    const count = chartSeries.points.length;

    const toX = (idx) => {
      if (count <= 1) return padLeft + plotWidth / 2;
      return padLeft + (idx * plotWidth) / (count - 1);
    };

    const toY = (value) => padTop + plotHeight - (value / chartSeries.maxValue) * plotHeight;

    const makePath = (key) => chartSeries.points
      .map((point, idx) => `${idx === 0 ? "M" : "L"} ${toX(idx)} ${toY(point[key])}`)
      .join(" ");

    return {
      width,
      height,
      padLeft,
      padBottom,
      plotHeight,
      toX,
      toY,
      cashInPath: makePath("cashIn"),
      cashOutPath: makePath("cashOut"),
      inventoryPath: makePath("inventory")
    };
  }, [chartSeries]);

  const monthlyRevenueSeries = useMemo(() => {
    const labels = monthlyRevenueCompare?.labels || [];
    const current = monthlyRevenueCompare?.currentYearSeries || [];
    const previous = monthlyRevenueCompare?.previousYearSeries || [];
    const points = labels.map((label, idx) => ({
      label,
      current: Number(current[idx] || 0),
      previous: Number(previous[idx] || 0)
    }));
    const maxValue = Math.max(
      1,
      ...points.map((p) => p.current),
      ...points.map((p) => p.previous)
    );
    return { points, maxValue };
  }, [monthlyRevenueCompare]);

  const monthlyRevenueGeometry = useMemo(() => {
    const width = 980;
    const height = 300;
    const padLeft = 44;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 44;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;
    const count = monthlyRevenueSeries.points.length;

    const toX = (idx) => {
      if (count <= 1) return padLeft + plotWidth / 2;
      return padLeft + (idx * plotWidth) / (count - 1);
    };

    const toY = (value) => padTop + plotHeight - (value / monthlyRevenueSeries.maxValue) * plotHeight;

    const makePath = (key) => monthlyRevenueSeries.points
      .map((point, idx) => `${idx === 0 ? "M" : "L"} ${toX(idx)} ${toY(point[key])}`)
      .join(" ");

    return {
      width,
      height,
      padLeft,
      padBottom,
      toX,
      toY,
      currentPath: makePath("current"),
      previousPath: makePath("previous")
    };
  }, [monthlyRevenueSeries]);

  const hoveredRevenuePoint = hoveredRevenueIdx == null
    ? null
    : monthlyRevenueSeries.points[hoveredRevenueIdx] || null;

  const getNearestRevenueIndex = (clientX, svgElement) => {
    if (!svgElement || monthlyRevenueSeries.points.length === 0) return null;
    const rect = svgElement.getBoundingClientRect();
    if (!rect.width) return null;

    const xInViewBox = ((clientX - rect.left) / rect.width) * monthlyRevenueGeometry.width;
    const clampedX = Math.max(monthlyRevenueGeometry.padLeft, Math.min(monthlyRevenueGeometry.width - 20, xInViewBox));

    let nearestIdx = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    monthlyRevenueSeries.points.forEach((_, idx) => {
      const distance = Math.abs(monthlyRevenueGeometry.toX(idx) - clampedX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIdx = idx;
      }
    });
    return nearestIdx;
  };

  const handleRevenueChartPointer = (clientX, svgElement) => {
    const nextIdx = getNearestRevenueIndex(clientX, svgElement);
    if (nextIdx == null) return;
    setHoveredRevenueIdx(nextIdx);
  };

  const handleFilterChange = (key, value) => {
    onFiltersChange?.({ ...filters, [key]: value });
  };

  const overviewTrackingLabel = {
    tracked: "Che do: Chi san pham dang theo doi",
    untracked: "Che do: Chi san pham khong theo doi",
    all: "Che do: Tat ca san pham"
  }[filters.overviewTracking || "tracked"];

  const kpis = [
    { label: "Doanh thu", value: formatCurrency(overview?.revenue), color: "#1971c2" },
    { label: "Lợi nhuận", value: formatCurrency(overview?.profit), color: "#2b8a3e" },
    { label: "Dòng tiền vào", value: formatCurrency(overview?.cashIn), color: "#0b7285" },
    { label: "Dòng tiền ra", value: formatCurrency(overview?.cashOut), color: "#c92a2a" },
    { label: "Chi NCC (tiền trả)", value: formatCurrency(overview?.cashOutSupplier), color: "#e67700" },
    { label: "Dòng tiền thuần", value: formatCurrency(overview?.netCashFlow), color: "#5f3dc4" },
    { label: "Công nợ khách hàng", value: formatCurrency(overview?.customerDebt), color: "#c92a2a" },
    { label: "Giá trị tồn kho", value: formatCurrency(overview?.inventoryValue), color: "#9c6b00" }
  ];

  return (
    <section className="page-container">
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: "1.4rem" }}>Tổng quan</h2>
        <p style={{ margin: 0, color: "#6b7280", fontSize: "0.9rem" }}>
          Thống kê tổng hợp toàn hệ thống
        </p>
        <div style={{ marginTop: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "5px 10px",
              borderRadius: 999,
              fontSize: "0.78rem",
              fontWeight: 600,
              color: "#0c4a6e",
              background: "#e0f2fe",
              border: "1px solid #bae6fd"
            }}
          >
            {overviewTrackingLabel}
          </span>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{
        display: "flex",
        gap: 12,
        marginBottom: 24,
        padding: 16,
        background: "#f8f9fa",
        borderRadius: 8,
        flexWrap: "wrap"
      }}>
        <div>
          <label style={{ fontSize: "0.85rem", color: "#666", display: "block", marginBottom: 4 }}>Thời gian</label>
          <select
            value={filters.timePeriod}
            onChange={(e) => handleFilterChange("timePeriod", e.target.value)}
            style={{
              padding: "8px 12px",
              border: "1px solid #dee2e6",
              borderRadius: 6,
              fontSize: "0.9rem",
              cursor: "pointer"
            }}
          >
            <option value="this-year">Năm nay</option>
            <option value="last-year">Năm trước</option>
            <option value="this-month">Tháng này</option>
            <option value="this-quarter">Quý này</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: "0.85rem", color: "#666", display: "block", marginBottom: 4 }}>Loại hàng</label>
          <select
            value={filters.productType}
            onChange={(e) => handleFilterChange("productType", e.target.value)}
            style={{
              padding: "8px 12px",
              border: "1px solid #dee2e6",
              borderRadius: 6,
              fontSize: "0.9rem",
              cursor: "pointer"
            }}
          >
            <option value="all">Tất cả</option>
            <option value="goods">Hàng hóa</option>
            <option value="service">Dịch vụ</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: "0.85rem", color: "#666", display: "block", marginBottom: 4 }}>Ngành hàng</label>
          <select
            value={filters.categoryId}
            onChange={(e) => handleFilterChange("categoryId", e.target.value)}
            style={{
              padding: "8px 12px",
              border: "1px solid #dee2e6",
              borderRadius: 6,
              fontSize: "0.9rem",
              cursor: "pointer"
            }}
          >
            <option value="">Tất cả</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: "0.85rem", color: "#666", display: "block", marginBottom: 4 }}>Cửa hàng/Kho</label>
          <select
            value={filters.storeId}
            onChange={(e) => handleFilterChange("storeId", e.target.value)}
            style={{
              padding: "8px 12px",
              border: "1px solid #dee2e6",
              borderRadius: 6,
              fontSize: "0.9rem",
              cursor: "pointer"
            }}
          >
            <option value="">Tất cả</option>
            {stores.map(store => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: "0.85rem", color: "#666", display: "block", marginBottom: 4 }}>Theo dõi tổng quan</label>
          <select
            value={filters.overviewTracking || "tracked"}
            onChange={(e) => handleFilterChange("overviewTracking", e.target.value)}
            style={{
              padding: "8px 12px",
              border: "1px solid #dee2e6",
              borderRadius: 6,
              fontSize: "0.9rem",
              cursor: "pointer"
            }}
          >
            <option value="tracked">Chỉ sản phẩm đang theo dõi</option>
            <option value="untracked">Chỉ sản phẩm không theo dõi</option>
            <option value="all">Tất cả sản phẩm</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
        {kpis.map(({ label, value, color }) => (
          <div key={label} style={{
            background: "#fff",
            border: "1px solid #dee2e6",
            borderRadius: 10,
            padding: "16px 20px",
            borderTop: `3px solid ${color}`
          }}>
            <div style={{ fontSize: "0.78rem", color: "#6b7280", marginBottom: 6, fontWeight: 500 }}>
              {label}
            </div>
            <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "#1a1a2e" }}>
              {overview ? value : "-"}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fff", border: "1px solid #dee2e6", borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, color: "#374151" }}>Biểu đồ dòng tiền</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.82rem", color: "#4b5563" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: "#0b7285", display: "inline-block" }} /> Tiền vào
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: "#c92a2a", display: "inline-block" }} /> Tiền ra
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: "#9c6b00", display: "inline-block" }} /> Tồn kho
            </span>
          </div>
        </div>

        {cashFlowLoading ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Đang tải dữ liệu biểu đồ...</p>
        ) : chartSeries.points.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Chưa có dữ liệu để hiển thị biểu đồ.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <svg viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`} style={{ width: "100%", minWidth: 760, height: 320 }}>
              {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                const y = chartGeometry.toY(chartSeries.maxValue * tick);
                return (
                  <g key={tick}>
                    <line x1={chartGeometry.padLeft} y1={y} x2={chartGeometry.width - 20} y2={y} stroke="#edf2f7" strokeWidth="1" />
                    <text x={8} y={y + 4} fontSize="11" fill="#6b7280">
                      {formatCurrency(Math.round(chartSeries.maxValue * tick))}
                    </text>
                  </g>
                );
              })}

              <path d={chartGeometry.cashInPath} fill="none" stroke="#0b7285" strokeWidth="2.5" />
              <path d={chartGeometry.cashOutPath} fill="none" stroke="#c92a2a" strokeWidth="2.5" />
              <path d={chartGeometry.inventoryPath} fill="none" stroke="#9c6b00" strokeWidth="2.5" strokeDasharray="6 4" />

              {chartSeries.points.map((point, idx) => (
                <g key={point.label + idx}>
                  <circle cx={chartGeometry.toX(idx)} cy={chartGeometry.toY(point.cashIn)} r="3.5" fill="#0b7285" />
                  <circle cx={chartGeometry.toX(idx)} cy={chartGeometry.toY(point.cashOut)} r="3.5" fill="#c92a2a" />
                  <circle cx={chartGeometry.toX(idx)} cy={chartGeometry.toY(point.inventory)} r="3.5" fill="#9c6b00" />
                  <text x={chartGeometry.toX(idx)} y={chartGeometry.height - 14} textAnchor="middle" fontSize="11" fill="#6b7280">
                    {point.label}
                  </text>
                </g>
              ))}

              <line
                x1={chartGeometry.padLeft}
                y1={chartGeometry.height - chartGeometry.padBottom}
                x2={chartGeometry.width - 20}
                y2={chartGeometry.height - chartGeometry.padBottom}
                stroke="#cbd5e1"
                strokeWidth="1"
              />
            </svg>
          </div>
        )}
      </div>

      <div style={{ background: "#fff", border: "1px solid #dee2e6", borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, color: "#374151" }}>Doanh thu theo tháng (so sanh nam truoc)</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.82rem", color: "#4b5563" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: "#1971c2", display: "inline-block" }} />
              {monthlyRevenueCompare?.anchorYear ?? "Nam hien tai"}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: "#adb5bd", display: "inline-block" }} />
              {monthlyRevenueCompare?.previousYear ?? "Nam truoc"}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap", fontSize: "0.85rem", color: "#4b5563" }}>
          <span>Tong {monthlyRevenueCompare?.anchorYear ?? "Nam hien tai"}: <strong>{formatCurrency(monthlyRevenueCompare?.totalCurrentYear || 0)}</strong></span>
          <span>Tong {monthlyRevenueCompare?.previousYear ?? "Nam truoc"}: <strong>{formatCurrency(monthlyRevenueCompare?.totalPreviousYear || 0)}</strong></span>
          <span>
            Tang truong: <strong style={{ color: Number(monthlyRevenueCompare?.deltaPercent || 0) >= 0 ? "#2b8a3e" : "#c92a2a" }}>
              {monthlyRevenueCompare?.deltaPercent == null ? "-" : `${monthlyRevenueCompare.deltaPercent > 0 ? "+" : ""}${monthlyRevenueCompare.deltaPercent}%`}
            </strong>
          </span>
        </div>

        {monthlyRevenueLoading ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Dang tai doanh thu theo thang...</p>
        ) : monthlyRevenueSeries.points.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280" }}>Chua co du lieu doanh thu theo thang.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <svg
              viewBox={`0 0 ${monthlyRevenueGeometry.width} ${monthlyRevenueGeometry.height}`}
              style={{ width: "100%", minWidth: 760, height: 320 }}
              onMouseMove={(e) => handleRevenueChartPointer(e.clientX, e.currentTarget)}
              onMouseLeave={() => setHoveredRevenueIdx(null)}
              onTouchStart={(e) => {
                const touch = e.touches?.[0];
                if (touch) handleRevenueChartPointer(touch.clientX, e.currentTarget);
              }}
              onTouchMove={(e) => {
                const touch = e.touches?.[0];
                if (touch) handleRevenueChartPointer(touch.clientX, e.currentTarget);
              }}
              onTouchEnd={() => setHoveredRevenueIdx(null)}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                const y = monthlyRevenueGeometry.toY(monthlyRevenueSeries.maxValue * tick);
                return (
                  <g key={tick}>
                    <line x1={monthlyRevenueGeometry.padLeft} y1={y} x2={monthlyRevenueGeometry.width - 20} y2={y} stroke="#edf2f7" strokeWidth="1" />
                    <text x={8} y={y + 4} fontSize="11" fill="#6b7280">
                      {formatCurrency(Math.round(monthlyRevenueSeries.maxValue * tick))}
                    </text>
                  </g>
                );
              })}

              <path d={monthlyRevenueGeometry.currentPath} fill="none" stroke="#1971c2" strokeWidth="2.5" />
              <path d={monthlyRevenueGeometry.previousPath} fill="none" stroke="#adb5bd" strokeWidth="2.5" strokeDasharray="6 4" />

              {hoveredRevenuePoint && (
                <g>
                  <line
                    x1={monthlyRevenueGeometry.toX(hoveredRevenueIdx)}
                    y1={20}
                    x2={monthlyRevenueGeometry.toX(hoveredRevenueIdx)}
                    y2={monthlyRevenueGeometry.height - monthlyRevenueGeometry.padBottom}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <rect
                    x={Math.max(160, Math.min(monthlyRevenueGeometry.toX(hoveredRevenueIdx) - 130, monthlyRevenueGeometry.width - 260))}
                    y={24}
                    width="230"
                    height="76"
                    rx="8"
                    fill="#111827"
                    fillOpacity="0.92"
                  />
                  <text
                    x={Math.max(172, Math.min(monthlyRevenueGeometry.toX(hoveredRevenueIdx) - 118, monthlyRevenueGeometry.width - 248))}
                    y={44}
                    fontSize="12"
                    fill="#f9fafb"
                    fontWeight="700"
                  >
                    {hoveredRevenuePoint.label}
                  </text>
                  <text
                    x={Math.max(172, Math.min(monthlyRevenueGeometry.toX(hoveredRevenueIdx) - 118, monthlyRevenueGeometry.width - 248))}
                    y={63}
                    fontSize="11"
                    fill="#dbeafe"
                  >
                    {`${monthlyRevenueCompare?.anchorYear ?? "Nam hien tai"}: ${formatCurrency(hoveredRevenuePoint.current)}`}
                  </text>
                  <text
                    x={Math.max(172, Math.min(monthlyRevenueGeometry.toX(hoveredRevenueIdx) - 118, monthlyRevenueGeometry.width - 248))}
                    y={80}
                    fontSize="11"
                    fill="#e5e7eb"
                  >
                    {`${monthlyRevenueCompare?.previousYear ?? "Nam truoc"}: ${formatCurrency(hoveredRevenuePoint.previous)}`}
                  </text>
                </g>
              )}

              {monthlyRevenueSeries.points.map((point, idx) => (
                <g key={point.label + idx}>
                  <circle cx={monthlyRevenueGeometry.toX(idx)} cy={monthlyRevenueGeometry.toY(point.current)} r="3.5" fill="#1971c2" />
                  <circle cx={monthlyRevenueGeometry.toX(idx)} cy={monthlyRevenueGeometry.toY(point.previous)} r="3.5" fill="#adb5bd" />
                  <text x={monthlyRevenueGeometry.toX(idx)} y={monthlyRevenueGeometry.height - 14} textAnchor="middle" fontSize="11" fill="#6b7280">
                    {point.label}
                  </text>
                </g>
              ))}

              <line
                x1={monthlyRevenueGeometry.padLeft}
                y1={monthlyRevenueGeometry.height - monthlyRevenueGeometry.padBottom}
                x2={monthlyRevenueGeometry.width - 20}
                y2={monthlyRevenueGeometry.height - monthlyRevenueGeometry.padBottom}
                stroke="#cbd5e1"
                strokeWidth="1"
              />
            </svg>
          </div>
        )}
      </div>

      <div style={{ background: "#fff", border: "1px solid #dee2e6", borderRadius: 10, padding: 24 }}>
        <h3 style={{ margin: "0 0 12px", color: "#374151" }}>Phân tích nhanh</h3>
        <p style={{ color: "#6b7280", margin: 0 }}>
          Chuyển sang mục <strong>Doanh thu &amp; Lợi nhuận</strong> để xem xu hướng doanh thu theo thời kỳ,
          hiệu suất từng cửa hàng và KPI nhân viên phụ trách khách hàng.
        </p>
      </div>
    </section>
  );
}



