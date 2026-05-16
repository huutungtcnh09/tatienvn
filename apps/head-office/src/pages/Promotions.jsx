import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import "../styles/pages.css";

const DEFAULT_FORM = {
  name: "",
  type: "BUY_X_GET_Y",
  customerTier: "ALL",
  triggerProductId: "",
  triggerQty: 1,
  rewardProductId: "",
  rewardQty: 1,
  startDate: "",
  endDate: "",
  isActive: true
};

function getRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function formatDate(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleDateString("vi-VN");
}

function toDateInput(value) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

function parseType(type) {
  const raw = String(type || "").toUpperCase();
  if (!raw) return "-";
  if (raw === "BUY_X_GET_Y") return "Mua X tặng Y";
  if (raw === "DISCOUNT") return "Giảm giá";
  return raw;
}

function parseCustomerTier(value) {
  const raw = String(value || "ALL").toUpperCase();
  if (raw === "ALL") return "Tất cả khách hàng";
  if (raw === "RETAIL") return "Khách lẻ";
  if (raw === "LEVEL_2") return "Khách cấp 2";
  if (raw === "LEVEL_2_SPECIAL") return "Khách cấp 2 đặc biệt";
  return raw;
}

function formatPromotionAmount(value) {
  const amount = Number(value || 0);
  return amount > 0 ? `${amount.toLocaleString("vi-VN")} đ` : "-";
}

function getPayload(form) {
  const normalizedType = String(form.type || "BUY_X_GET_Y").toUpperCase();
  const isDiscountType = normalizedType === "DISCOUNT";
  return {
    name: form.name.trim(),
    type: normalizedType,
    customerTier: String(form.customerTier || "ALL").toUpperCase(),
    triggerProductId: form.triggerProductId,
    triggerQty: Number(form.triggerQty || 1),
    rewardProductId: isDiscountType ? null : (form.rewardProductId || null),
    rewardQty: isDiscountType ? null : (form.rewardProductId ? Number(form.rewardQty || 0) : null),
    startDate: `${form.startDate}T00:00:00.000Z`,
    endDate: `${form.endDate}T23:59:59.999Z`,
    isActive: Boolean(form.isActive)
  };
}

export default function Promotions({ token }) {
  const [promotions, setPromotions] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState({
    type: "",
    fromDate: "",
    toDate: "",
    isActive: "all"
  });
  const [error, setError] = useState("");

  const [showDialog, setShowDialog] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [form, setForm] = useState(DEFAULT_FORM);
  const isDiscountType = String(form.type || "").toUpperCase() === "DISCOUNT";

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const promotionQuery = {
        all: true,
        type: filters.type || undefined,
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
        isActive: filters.isActive === "all" ? undefined : filters.isActive === "active"
      };
      const [promotionsRes, productsRes] = await Promise.all([
        api.getPromotions(token, promotionQuery),
        api.getProducts(token)
      ]);
      setPromotions(getRows(promotionsRes));
      setProducts(getRows(productsRes));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Không tải được dữ liệu khuyến mại");
      setPromotions([]);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token, filters.type, filters.fromDate, filters.toDate, filters.isActive]);

  const productNameById = useMemo(
    () => new Map(products.map((item) => [item.id, item.name || item.code || item.id])),
    [products]
  );

  const productById = useMemo(
    () => new Map(products.map((item) => [item.id, item])),
    [products]
  );

  const filteredPromotions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return promotions
      .filter((item) => {
        if (!q) return true;
        const triggerName = productNameById.get(item.triggerProductId) || item.triggerProductId || "";
        const rewardName = productNameById.get(item.rewardProductId) || item.rewardProductId || "";
        const customerTierLabel = parseCustomerTier(item.customerTier || "ALL");
        const text = `${item.name || ""} ${item.type || ""} ${triggerName} ${rewardName} ${customerTierLabel}`.toLowerCase();
        return text.includes(q);
      });
  }, [promotions, productNameById, searchTerm]);

  const openCreateDialog = () => {
    setEditingPromotion(null);
    setForm(DEFAULT_FORM);
    setShowDialog(true);
  };

  const openEditDialog = (item) => {
    setEditingPromotion(item);
    setForm({
      name: item.name || "",
      type: String(item.type || "BUY_X_GET_Y").toUpperCase(),
      customerTier: String(item.customerTier || "ALL").toUpperCase(),
      triggerProductId: item.triggerProductId || "",
      triggerQty: Number(item.triggerQty || 1),
      rewardProductId: item.rewardProductId || "",
      rewardQty: Number(item.rewardQty || 1),
      startDate: toDateInput(item.startDate),
      endDate: toDateInput(item.endDate),
      isActive: Boolean(item.isActive)
    });
    setShowDialog(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setShowDialog(false);
    setEditingPromotion(null);
    setForm(DEFAULT_FORM);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Tên chương trình là bắt buộc");
      return;
    }
    if (!form.triggerProductId) {
      setError("Vui lòng chọn sản phẩm điều kiện");
      return;
    }
    if (!form.startDate || !form.endDate) {
      setError("Vui lòng nhập đủ ngày bắt đầu và ngày kết thúc");
      return;
    }
    if (new Date(form.endDate) < new Date(form.startDate)) {
      setError("Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = getPayload(form);
      if (editingPromotion?.id) {
        await api.updatePromotion(token, editingPromotion.id, payload);
      } else {
        await api.createPromotion(token, payload);
      }
      closeDialog();
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không lưu được chương trình khuyến mại");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Ngưng áp dụng chương trình \"${item.name}\"?`)) return;
    setDeletingId(item.id);
    setError("");
    try {
      await api.deletePromotion(token, item.id);
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Ngưng áp dụng chương trình khuyến mại thất bại");
    } finally {
      setDeletingId("");
    }
  };

  return (
    <section className="page-container">
      <div className="page-header">
        <div>
          <h1>Quản lý chương trình khuyến mại</h1>
          <p className="stat-text">
            Quản lý đầy đủ danh sách, tạo mới, cập nhật và xóa chương trình khuyến mại.
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn-cancel" onClick={loadData} disabled={loading || saving}>
            {loading ? "Đang tải..." : "Làm mới"}
          </button>
          <button type="button" className="btn-primary" onClick={openCreateDialog} disabled={saving || loading}>
            + Tạo chương trình
          </button>
        </div>
      </div>

      <section className="summary-grid" style={{ marginBottom: 16 }}>
        <article className="summary-item">
          <div className="summary-label">Tổng chương trình</div>
          <div className="summary-value">{promotions.length}</div>
        </article>
        <article className="summary-item">
          <div className="summary-label">Đang active</div>
          <div className="summary-value">{promotions.filter((item) => item.isActive).length}</div>
        </article>
        <article className="summary-item">
          <div className="summary-label">Sản phẩm áp dụng</div>
          <div className="summary-value">{new Set(promotions.map((item) => item.triggerProductId)).size}</div>
        </article>
      </section>

      <section className="search-section">
        <input
          className="search-input"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Tìm theo tên, loại, sản phẩm áp dụng..."
        />
        <select
          className="filter-select"
          value={filters.type}
          onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value }))}
        >
          <option value="">Tất cả loại</option>
          <option value="BUY_X_GET_Y">Mua X tặng Y</option>
          <option value="DISCOUNT">Giảm giá</option>
        </select>
        <select
          className="filter-select"
          value={filters.isActive}
          onChange={(event) => setFilters((prev) => ({ ...prev, isActive: event.target.value }))}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="active">Đang active</option>
          <option value="inactive">Đã ngưng áp dụng</option>
        </select>
        <input
          className="filter-select"
          type="date"
          value={filters.fromDate}
          onChange={(event) => setFilters((prev) => ({ ...prev, fromDate: event.target.value }))}
        />
        <input
          className="filter-select"
          type="date"
          value={filters.toDate}
          onChange={(event) => setFilters((prev) => ({ ...prev, toDate: event.target.value }))}
        />
        <button
          type="button"
          className="btn-cancel"
          onClick={() => setFilters({ type: "", fromDate: "", toDate: "", isActive: "all" })}
        >
          Xóa bộ lọc
        </button>
      </section>

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tên chương trình</th>
              <th>Loại</th>
              <th>Loại khách hàng</th>
              <th>Sản phẩm điều kiện</th>
              <th className="text-right">SL điều kiện</th>
              <th>Cách áp dụng</th>
              <th className="text-right">Mức áp dụng</th>
              <th>Hiệu lực</th>
              <th>Trạng thái</th>
              <th className="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filteredPromotions.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center">Không có chương trình khuyến mại phù hợp</td>
              </tr>
            ) : null}
            {filteredPromotions.map((item) => (
              <tr key={item.id}>
                <td>{item.name || "-"}</td>
                <td>{parseType(item.type)}</td>
                <td>{parseCustomerTier(item.customerTier)}</td>
                <td>{productNameById.get(item.triggerProductId) || item.triggerProductId || "-"}</td>
                <td className="text-right">{Number(item.triggerQty || 0)}</td>
                <td>{String(item.type || "").toUpperCase() === "DISCOUNT" ? "Lấy từ cột Khuyến mại của sản phẩm điều kiện" : (productNameById.get(item.rewardProductId) || item.rewardProductId || "-")}</td>
                <td className="text-right">{String(item.type || "").toUpperCase() === "DISCOUNT" ? formatPromotionAmount(productById.get(item.triggerProductId)?.promoPrice) : Number(item.rewardQty || 0)}</td>
                <td>{formatDate(item.startDate)} - {formatDate(item.endDate)}</td>
                <td>
                  <span className={`status ${item.isActive ? "active" : "inactive"}`}>
                    {item.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="text-right">
                  <div style={{ display: "inline-flex", gap: 8 }}>
                    <button type="button" className="btn-small btn-cancel" onClick={() => openEditDialog(item)}>
                      Sửa
                    </button>
                    <button
                      type="button"
                      className="btn-small btn-danger"
                      onClick={() => handleDelete(item)}
                      disabled={deletingId === item.id}
                    >
                      {deletingId === item.id ? "Đang ngưng..." : "Ngưng áp dụng"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showDialog ? (
        <div className="dialog-overlay" onClick={closeDialog}>
          <form className="dialog-panel dialog-panel--xl" onSubmit={handleSubmit} onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <h2>{editingPromotion ? "Cập nhật chương trình" : "Tạo chương trình mới"}</h2>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 12 }}>
              <label>
                Tên chương trình
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>
              <label>
                Loại chương trình
                <select
                  value={form.type}
                  onChange={(event) => setForm((prev) => {
                    const nextType = event.target.value;
                    if (String(nextType || "").toUpperCase() === "DISCOUNT") {
                      return { ...prev, type: nextType, rewardProductId: "", rewardQty: 1 };
                    }
                    return { ...prev, type: nextType };
                  })}
                >
                  <option value="BUY_X_GET_Y">Mua X tặng Y</option>
                  <option value="DISCOUNT">Giảm giá</option>
                </select>
              </label>
              <label>
                Loại khách hàng áp dụng
                <select
                  value={form.customerTier}
                  onChange={(event) => setForm((prev) => ({ ...prev, customerTier: event.target.value }))}
                >
                  <option value="ALL">Tất cả khách hàng</option>
                  <option value="RETAIL">Khách lẻ</option>
                  <option value="LEVEL_2">Khách cấp 2</option>
                  <option value="LEVEL_2_SPECIAL">Khách cấp 2 đặc biệt</option>
                </select>
              </label>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <label>
                  Sản phẩm điều kiện
                  <select
                    required
                    value={form.triggerProductId}
                    onChange={(event) => setForm((prev) => ({ ...prev, triggerProductId: event.target.value }))}
                  >
                    <option value="">-- Chọn sản phẩm --</option>
                    {products.map((item) => (
                      <option key={item.id} value={item.id}>{item.name || item.code || item.id}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Số lượng điều kiện
                  <input
                    type="number"
                    min={1}
                    value={form.triggerQty}
                    onChange={(event) => setForm((prev) => ({ ...prev, triggerQty: event.target.value }))}
                  />
                </label>
              </div>
              {isDiscountType ? (
                <div className="info-box">
                  Loại Giảm giá không dùng sản phẩm thưởng. Khi đủ điều kiện, POS sẽ tự lấy giá từ cột Khuyến mại của chính sản phẩm điều kiện.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  <label>
                    Sản phẩm thưởng
                    <select
                      value={form.rewardProductId}
                      onChange={(event) => setForm((prev) => ({ ...prev, rewardProductId: event.target.value }))}
                    >
                      <option value="">-- Không áp dụng --</option>
                      {products.map((item) => (
                        <option key={item.id} value={item.id}>{item.name || item.code || item.id}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Số lượng thưởng
                    <input
                      type="number"
                      min={0}
                      value={form.rewardQty}
                      onChange={(event) => setForm((prev) => ({ ...prev, rewardQty: event.target.value }))}
                      disabled={!form.rewardProductId}
                    />
                  </label>
                </div>
              )}
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <label>
                  Ngày bắt đầu
                  <input
                    type="date"
                    required
                    value={form.startDate}
                    onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
                  />
                </label>
                <label>
                  Ngày kết thúc
                  <input
                    type="date"
                    required
                    value={form.endDate}
                    onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
                  />
                </label>
              </div>
              <label className="filter-checkbox" style={{ width: "fit-content" }}>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                />
                Kích hoạt chương trình
              </label>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closeDialog} disabled={saving}>Hủy</button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Đang lưu..." : editingPromotion ? "Cập nhật" : "Tạo mới"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
