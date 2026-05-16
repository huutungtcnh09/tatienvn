import { useEffect, useMemo, useState } from "react";
import DesktopPageFrame from "../components/DesktopPageFrame";
import { api } from "../api";

function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value || 0));
}

const TIME_PRESET_OPTIONS = [
  { value: "today", label: "Hôm nay" },
  { value: "this-month", label: "Tháng này" },
  { value: "this-quarter", label: "Quý này" },
  { value: "this-year", label: "Năm nay" },
  { value: "last-year", label: "Năm trước" }
];

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

export default function BusinessAreas({ token }) {
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [timePreset, setTimePreset] = useState("this-month");
  const [areaLevel, setAreaLevel] = useState("child");
  const [dashboard, setDashboard] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    parentId: "",
    isActive: true
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Load data từ API
  useEffect(() => {
    if (!token) return;
    loadAreas();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadDashboard();
  }, [token, timePreset]);

  const loadAreas = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await api.businessAreas(token);
      const areaList = Array.isArray(data) ? data : (data?.data || []);
      setAreas(areaList);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi khi tải dữ liệu";
      setError(message);
      console.error("Load areas error:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadDashboard = async () => {
    try {
      setDashboardLoading(true);
      setDashboardError("");
      const data = await api.businessAreasDashboard(token, { timePreset });
      setDashboard(data?.data || data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi khi tải dashboard";
      setDashboardError(message);
      console.error("Load business area dashboard error:", err);
    } finally {
      setDashboardLoading(false);
    }
  };

  const openPanelForCreate = () => {
    setEditingId("");
    setForm({ code: "", name: "", description: "", parentId: "", isActive: true });
    setError("");
    setShowPanel(true);
  };

  const openPanelForEdit = (area) => {
    setEditingId(area.id);
    setForm({
      code: area.code || "",
      name: area.name || "",
      description: area.description || "",
      parentId: area.parentId || "",
      isActive: area.isActive !== false
    });
    setError("");
    setShowPanel(true);
  };

  const childAreas = useMemo(
    () => areas.flatMap((parentArea) =>
      (parentArea.children || []).map((childArea) => ({
        ...childArea,
        parentName: parentArea.name,
        parentCode: parentArea.code
      }))
    ),
    [areas]
  );

  const dashboardAreas = useMemo(() => {
    const list = Array.isArray(dashboard?.areas) ? dashboard.areas : [];
    if (!list.length) return [];

    const childrenByParentId = new Map();
    list.forEach((area) => {
      if (!area.parentId) return;
      const current = childrenByParentId.get(area.parentId) || [];
      current.push(area);
      childrenByParentId.set(area.parentId, current);
    });

    const ownSalesById = new Map(
      list.map((area) => [
        area.id,
        {
          amount: Number(area.periodSalesAmount || 0),
          orders: Number(area.periodSalesOrders || 0)
        }
      ])
    );
    const memo = new Map();

    const getRollupSales = (areaId) => {
      if (memo.has(areaId)) return memo.get(areaId);
      const own = ownSalesById.get(areaId) || { amount: 0, orders: 0 };
      const children = childrenByParentId.get(areaId) || [];
      const next = { amount: own.amount, orders: own.orders };
      children.forEach((child) => {
        const childRollup = getRollupSales(child.id);
        next.amount += childRollup.amount;
        next.orders += childRollup.orders;
      });
      memo.set(areaId, next);
      return next;
    };

    if (areaLevel === "parent") {
      return list
        .filter((area) => !area.parentId)
        .map((area) => {
          const rollup = getRollupSales(area.id);
          return {
            ...area,
            chartSalesAmount: rollup.amount,
            chartSalesOrders: rollup.orders
          };
        })
        .sort((a, b) => Number(b.chartSalesAmount || 0) - Number(a.chartSalesAmount || 0))
        .slice(0, 10);
    }

    return list
      .filter((area) => Boolean(area.parentId))
      .map((area) => ({
        ...area,
        chartSalesAmount: Number(area.periodSalesAmount || 0),
        chartSalesOrders: Number(area.periodSalesOrders || 0)
      }))
      .sort((a, b) => Number(b.chartSalesAmount || 0) - Number(a.chartSalesAmount || 0))
      .slice(0, 10);
  }, [dashboard, areaLevel]);

  const maxSalesAmount = useMemo(() => {
    const max = dashboardAreas.reduce((acc, area) => Math.max(acc, Number(area.chartSalesAmount || 0)), 0);
    return max || 1;
  }, [dashboardAreas]);

  const handleSaveArea = async () => {
    const name = form.name.trim();
    const code = form.code.trim().toUpperCase();
    
    if (!name || !code) {
      setError("Vui lòng nhập tên và mã khu vực.");
      return;
    }

    const payload = {
      code,
      name,
      description: form.description.trim() || undefined,
      parentId: form.parentId || undefined,
      isActive: form.isActive
    };

    try {
      setSaving(true);
      setError("");
      
      if (editingId) {
        await api.updateBusinessArea(token, editingId, payload);
      } else {
        await api.createBusinessArea(token, payload);
      }
      
      await loadAreas();
      await loadDashboard();
      setShowPanel(false);
      setEditingId("");
      setForm({ code: "", name: "", description: "", parentId: "", isActive: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi khi lưu";
      setError(message);
      console.error("Save area error:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DesktopPageFrame
        title="Khu vực kinh doanh"
        description="Quản lý danh sách khu vực kinh doanh"
        actions={(
          <button type="button" className="btn-primary" onClick={openPanelForCreate} disabled={!token || loading}>Thêm khu vực kinh doanh</button>
        )}
      >
        {loading && <p style={{ color: "var(--text-secondary)" }}>Đang tải...</p>}
        {error && <p style={{ color: "red" }}>{error}</p>}

        <div className="business-area-dashboard-wrap">
          <div className="business-area-dashboard-top">
            <div className="business-area-time-filter">
              {TIME_PRESET_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`business-area-time-chip ${timePreset === option.value ? "active" : ""}`}
                  onClick={() => setTimePreset(option.value)}
                  disabled={dashboardLoading}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="business-area-level-filter">
              <button
                type="button"
                className={`business-area-time-chip ${areaLevel === "parent" ? "active" : ""}`}
                onClick={() => setAreaLevel("parent")}
                disabled={dashboardLoading}
              >
                Cấp cha
              </button>
              <button
                type="button"
                className={`business-area-time-chip ${areaLevel === "child" ? "active" : ""}`}
                onClick={() => setAreaLevel("child")}
                disabled={dashboardLoading}
              >
                Cấp con
              </button>
            </div>
          </div>

          {dashboardError ? <p style={{ color: "red" }}>{dashboardError}</p> : null}

          <div className="business-area-overview-grid">
            <article className="business-area-overview-card">
              <span>Tổng khu vực</span>
              <strong>{formatNumber(dashboard?.overview?.totalAreas || 0)}</strong>
              <small>Cha: {formatNumber(dashboard?.overview?.parentAreas || 0)} | Con: {formatNumber(dashboard?.overview?.childAreas || 0)}</small>
            </article>
            <article className="business-area-overview-card">
              <span>Đang hoạt động</span>
              <strong>{formatNumber(dashboard?.overview?.activeAreas || 0)}</strong>
              <small>Toàn hệ thống</small>
            </article>
            <article className="business-area-overview-card">
              <span>Doanh số trong kỳ</span>
              <strong>{formatCurrency(dashboard?.overview?.periodSalesAmount || 0)}</strong>
              <small>{formatDate(dashboard?.dateFrom)} - {formatDate(dashboard?.dateTo)}</small>
            </article>
            <article className="business-area-overview-card">
              <span>Tổng đối tác</span>
              <strong>{formatNumber(dashboard?.overview?.totalPartners || 0)}</strong>
              <small>KH: {formatNumber(dashboard?.overview?.totalCustomers || 0)} | NCC: {formatNumber(dashboard?.overview?.totalSuppliers || 0)}</small>
            </article>
          </div>

          <div className="business-area-chart-card">
            <div className="business-area-chart-header">
              <h3>Biểu đồ doanh số theo khu vực kinh doanh ({areaLevel === "parent" ? "cấp cha" : "cấp con"})</h3>
              <p>Kỳ: {formatDate(dashboard?.dateFrom)} - {formatDate(dashboard?.dateTo)}</p>
            </div>

            {dashboardLoading ? (
              <p style={{ color: "var(--text-secondary)" }}>Đang tải thống kê...</p>
            ) : dashboardAreas.length === 0 ? (
              <p style={{ color: "var(--text-secondary)" }}>Chưa có dữ liệu doanh số theo khu vực trong kỳ đã chọn.</p>
            ) : (
              <div className="business-area-chart-grid">
                {dashboardAreas.map((area) => {
                  const width = Math.max(8, Math.round((Number(area.chartSalesAmount || 0) / maxSalesAmount) * 100));
                  return (
                    <div key={area.id} className="business-area-chart-row">
                      <div className="business-area-chart-label">
                        <strong>{area.code}</strong>
                        <span>{area.name}</span>
                      </div>
                      <div className="business-area-chart-bar-wrap">
                        <div className="business-area-chart-bar" style={{ width: `${width}%` }} />
                      </div>
                      <div className="business-area-chart-value">
                        <strong>{formatCurrency(area.chartSalesAmount || 0)}</strong>
                        <span>{formatNumber(area.chartSalesOrders || 0)} đơn</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        
        <div className="table-container business-area-report-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên khu vực</th>
                <th>Mô tả</th>
                <th className="text-center">Trạng thái</th>
                <th className="text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {areas.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center" style={{ padding: "20px" }}>
                    {loading ? "Đang tải..." : "Chưa có khu vực kinh doanh nào"}
                  </td>
                </tr>
              ) : (
                areas.map((area) => (
                  <tr key={area.id}>
                    <td>{area.code}</td>
                    <td><strong>{area.name}</strong></td>
                    <td>{area.description || "-"}</td>
                    <td className="text-center">
                      <span className={`status ${area.isActive ? "active" : "inactive"}`}>
                        {area.isActive ? "Hoạt động" : "Tạm dừng"}
                      </span>
                    </td>
                    <td className="text-center business-area-actions">
                      <button type="button" className="btn-cancel btn-small" onClick={() => openPanelForEdit(area)} disabled={!token || saving}>Sửa</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DesktopPageFrame>

      {showPanel ? (
        <div className="dialog-overlay" onClick={() => setShowPanel(false)}>
          <div className="dialog-panel business-area-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Danh sách khu vực kinh doanh</h2>
              <button type="button" className="close-btn" onClick={() => setShowPanel(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body">
              {error && <p style={{ color: "red", marginBottom: "10px" }}>{error}</p>}
              
              <div className="business-area-form-grid">
                <div className="form-group">
                  <label>Mã khu vực *</label>
                  <input 
                    value={form.code} 
                    onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} 
                    placeholder="VD: KV-HCM"
                    disabled={saving}
                  />
                </div>
                <div className="form-group">
                  <label>Tên khu vực *</label>
                  <input 
                    value={form.name} 
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} 
                    placeholder="VD: Hồ Chí Minh"
                    disabled={saving}
                  />
                </div>
                <div className="form-group business-area-form-span-2">
                  <label>Mô tả</label>
                  <textarea 
                    value={form.description} 
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} 
                    placeholder="Nhập mô tả khu vực"
                    rows="3"
                    disabled={saving}
                  />
                </div>
                <div className="form-group">
                  <label>Khu vực cha</label>
                  <select
                    value={form.parentId}
                    onChange={(e) => setForm((prev) => ({ ...prev, parentId: e.target.value }))}
                    disabled={saving}
                  >
                    <option value="">Không có (khu vực cấp cha)</option>
                    {areas.map((area) => (
                      <option key={area.id} value={area.id}>{area.code} - {area.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Trạng thái</label>
                  <select 
                    value={form.isActive ? "active" : "inactive"} 
                    onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.value === "active" }))}
                    disabled={saving}
                  >
                    <option value="active">Hoạt động</option>
                    <option value="inactive">Tạm dừng</option>
                  </select>
                </div>
              </div>

              <div className="dialog-footer dialog-footer--inner">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => {
                    setEditingId("");
                    setForm({ code: "", name: "", description: "", parentId: "", isActive: true });
                    setError("");
                  }}
                  disabled={saving}
                >
                  Làm mới
                </button>
                <button 
                  type="button" 
                  className="btn-primary" 
                  onClick={handleSaveArea}
                  disabled={saving || !token}
                >
                  {saving ? "Đang lưu..." : (editingId ? "Cập nhật khu vực" : "Thêm khu vực kinh doanh")}
                </button>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Khu vực cha</th>
                      <th>Mã</th>
                      <th>Tên khu vực con</th>
                      <th>Mô tả</th>
                      <th className="text-center">Trạng thái</th>
                      <th className="text-center">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {childAreas.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center" style={{ padding: "10px" }}>Chưa có khu vực con</td>
                      </tr>
                    ) : (
                      childAreas.map((area) => (
                        <tr key={area.id}>
                          <td>{area.parentCode} - {area.parentName}</td>
                          <td>{area.code}</td>
                          <td>{area.name}</td>
                          <td>{area.description || "-"}</td>
                          <td className="text-center">{area.isActive ? "Hoạt động" : "Tạm dừng"}</td>
                          <td className="text-center business-area-actions">
                            <button type="button" className="btn-cancel btn-small" onClick={() => openPanelForEdit(area)} disabled={saving}>Sửa</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
