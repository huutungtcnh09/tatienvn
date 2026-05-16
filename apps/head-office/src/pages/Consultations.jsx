import { useEffect, useState } from "react";
import { getConsultations, updateConsultation, createPartner, getStores } from "../api";

const STATUS_LABELS = {
  NEW: "Mới",
  CONTACTED: "Đã liên hệ",
  QUOTED: "Đã báo giá",
  CLOSED: "Hoàn tất",
  SPAM: "Spam"
};

const STATUS_COLORS = {
  NEW: "#1a7a50",
  CONTACTED: "#1565c0",
  QUOTED: "#6a1faf",
  CLOSED: "#37474f",
  SPAM: "#b71c1c"
};

export default function Consultations({ token }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const PAGE_SIZE = 20;

  const [editing, setEditing] = useState(null); // { id, status, staffNote }
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Tạo khách hàng từ yêu cầu tư vấn
  const [createCustFrom, setCreateCustFrom] = useState(null); // item tư vấn
  const [custForm, setCustForm] = useState({});
  const [custSaving, setCustSaving] = useState(false);
  const [custMsg, setCustMsg] = useState("");
  const [stores, setStores] = useState([]);

  useEffect(() => {
    getStores(token).then((list) => setStores(Array.isArray(list) ? list : (list?.data ?? []))).catch(() => {});
  }, [token]); // eslint-disable-line

  // Khi stores load xong mà ownerStoreId chưa có thì tự điền store đầu tiên
  useEffect(() => {
    if (createCustFrom && !custForm.ownerStoreId && stores.length > 0) {
      setCustForm((p) => ({ ...p, ownerStoreId: stores[0].id }));
    }
  }, [stores, createCustFrom]); // eslint-disable-line

  const openCreateCustomer = (item) => {
    const suggestedCode = `KH${(item.phone || "").replace(/\D/g, "").slice(-8)}`;
    setCustForm({
      code: suggestedCode,
      name: item.fullName || "",
      phone: item.phone || "",
      email: item.email || "",
      address: item.address || "",
      ownerStoreId: stores[0]?.id || "",
      isCustomer: true,
      isSupplier: false,
      openingBalance: 0
    });
    setCustMsg("");
    setCreateCustFrom(item);
  };

  const handleCreateCustomer = async () => {
    if (!createCustFrom) return;
    setCustSaving(true);
    setCustMsg("");
    try {
      await createPartner(token, {
        ...custForm,
        isCustomer: true,
        isSupplier: false,
        openingBalance: Number(custForm.openingBalance) || 0
      });
      setCustMsg("ok");
    } catch (err) {
      setCustMsg(err.message || "Lỗi tạo khách hàng");
    } finally {
      setCustSaving(false);
    }
  };

  const load = () => {
    setLoading(true);
    setError("");
    getConsultations(token, { status: filterStatus || undefined, search: search || undefined, page, pageSize: PAGE_SIZE })
      .then((result) => {
        // getConsultations trả về body?.data ?? body
        // API trả về { data: [...], total, page, pageSize, totalPages }
        if (result && Array.isArray(result.data)) {
          setItems(result.data);
          setTotal(result.total ?? result.data.length);
          setTotalPages(result.totalPages ?? 1);
        } else if (Array.isArray(result)) {
          setItems(result);
          setTotal(result.length);
          setTotalPages(1);
        } else {
          setItems([]);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { setPage(1); }, [filterStatus, search]);
  useEffect(() => { load(); }, [filterStatus, search, page]); // eslint-disable-line

  const openEdit = (item) => {
    setEditing({ id: item.id, status: item.status, staffNote: item.staffNote || "", assignedTo: item.assignedTo || "" });
    setSaveMsg("");
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setSaveMsg("");
    try {
      await updateConsultation(token, editing.id, {
        status: editing.status,
        staffNote: editing.staffNote,
        assignedTo: editing.assignedTo || null
      });
      setSaveMsg("Đã lưu");
      setEditing(null);
      load();
    } catch (err) {
      setSaveMsg(err.message || "Lỗi lưu");
    } finally {
      setSaving(false);
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getFullYear()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <section className="content">
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Yêu cầu tư vấn / Báo giá</h2>
          <span style={{ color: "#666", fontSize: 14 }}>{total} yêu cầu</span>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <input
            style={{ padding: "7px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, width: 240 }}
            placeholder="Tìm tên, SĐT, công ty, sản phẩm..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={{ padding: "7px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {error && <p style={{ color: "red" }}>{error}</p>}
        {loading && <p style={{ color: "#888" }}>Đang tải...</p>}

        {!loading && items.length === 0 && <p style={{ color: "#888" }}>Không có yêu cầu nào.</p>}

        {!loading && items.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  {["Thời gian", "Sản phẩm", "Họ tên", "SĐT", "Địa chỉ", "Ghi chú KH", "Trạng thái", "Nhân viên", "Ghi chú NV", ""].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e0e0e0", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "#666" }}>{fmtDate(item.submittedAt)}</td>
                    <td style={{ padding: "8px 10px" }}>{item.productName}</td>
                    <td style={{ padding: "8px 10px", fontWeight: 500 }}>{item.fullName}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{item.phone}</td>
                    <td style={{ padding: "8px 10px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.address || ""}>{item.address || "-"}</td>
                    <td style={{ padding: "8px 10px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.note || ""}>{item.note || "-"}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 10px",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#fff",
                        background: STATUS_COLORS[item.status] || "#999"
                      }}>{STATUS_LABELS[item.status] || item.status}</span>
                    </td>
                    <td style={{ padding: "8px 10px", color: "#666" }}>{item.assignedTo || "-"}</td>
                    <td style={{ padding: "8px 10px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#666" }} title={item.staffNote || ""}>{item.staffNote || "-"}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          onClick={() => openEdit(item)}
                          style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #bbb", background: "#fff", color: "#333", cursor: "pointer", fontSize: 13 }}
                        >Cập nhật</button>
                        <button
                          onClick={() => openCreateCustomer(item)}
                          style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #1a7a50", background: "#f0faf5", color: "#1a7a50", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                        >+ Tạo KH</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, justifyContent: "center" }}>
            <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Trước</button>
            <span style={{ fontSize: 14, color: "#666" }}>Trang {page} / {totalPages}</span>
            <button className="btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Sau</button>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      {editing && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}
        >
          <div style={{ background: "#fff", borderRadius: 10, padding: 24, width: "100%", maxWidth: 460 }}>
            <h3 style={{ margin: "0 0 16px" }}>Cập nhật yêu cầu tư vấn</h3>

            <label style={{ display: "block", marginBottom: 12, fontSize: 14 }}>
              Trạng thái
              <select
                value={editing.status}
                onChange={(e) => setEditing((prev) => ({ ...prev, status: e.target.value }))}
                style={{ display: "block", width: "100%", marginTop: 5, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}
              >
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>

            <label style={{ display: "block", marginBottom: 12, fontSize: 14 }}>
              Phụ trách (nhân viên)
              <input
                value={editing.assignedTo}
                onChange={(e) => setEditing((prev) => ({ ...prev, assignedTo: e.target.value }))}
                placeholder="Tên nhân viên phụ trách..."
                style={{ display: "block", width: "100%", marginTop: 5, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }}
              />
            </label>

            <label style={{ display: "block", marginBottom: 16, fontSize: 14 }}>
              Ghi chú nội bộ
              <textarea
                rows={4}
                value={editing.staffNote}
                onChange={(e) => setEditing((prev) => ({ ...prev, staffNote: e.target.value }))}
                placeholder="Ghi chú nội bộ, kết quả liên hệ..."
                style={{ display: "block", width: "100%", marginTop: 5, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, resize: "vertical", boxSizing: "border-box" }}
              />
            </label>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: "#1a7a50", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}
              >{saving ? "Đang lưu..." : "Lưu"}</button>
              <button
                onClick={() => setEditing(null)}
                style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}
              >Hủy</button>
              {saveMsg && <span style={{ fontSize: 14, color: saveMsg === "Đã lưu" ? "#1a7a50" : "red" }}>{saveMsg}</span>}
            </div>
          </div>
        </div>
      )}
      {/* Create Customer Drawer */}
      {createCustFrom && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 1000 }}
          onClick={(e) => { if (e.target === e.currentTarget && !custSaving) setCreateCustFrom(null); }}
        >
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0,
            width: "min(440px, 100vw)",
            background: "#fff",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
            display: "flex", flexDirection: "column",
            animation: "slideInRight 0.22s ease"
          }}>
            <style>{`@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

            {/* Header */}
            <div style={{ padding: "18px 24px 16px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17 }}>Tạo khách hàng mới</h3>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#888" }}>Từ yêu cầu của <strong>{createCustFrom.fullName}</strong></p>
              </div>
              <button onClick={() => setCreateCustFrom(null)} disabled={custSaving} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1, padding: "4px 8px" }}>×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
              {custMsg === "ok" ? (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <div style={{ fontSize: 48, marginBottom: 14 }}>✅</div>
                  <p style={{ fontWeight: 600, color: "#1a7a50", fontSize: 16, marginBottom: 20 }}>Đã tạo khách hàng thành công!</p>
                  <button onClick={() => setCreateCustFrom(null)} style={{ padding: "9px 28px", borderRadius: 6, border: "none", background: "#1a7a50", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>Đóng</button>
                </div>
              ) : (
                <>
                  {[
                    { label: "Họ tên *", key: "name", required: true },
                    { label: "Số điện thoại", key: "phone" },
                    { label: "Email", key: "email" },
                    { label: "Địa chỉ", key: "address" }
                  ].map(({ label, key, required }) => (
                    <label key={key} style={{ display: "block", marginBottom: 14, fontSize: 14 }}>
                      <span style={{ display: "block", marginBottom: 5, fontWeight: 500, color: "#444" }}>{label}</span>
                      <input
                        value={custForm[key] || ""}
                        onChange={(e) => setCustForm((p) => ({ ...p, [key]: e.target.value }))}
                        required={required}
                        style={{ display: "block", width: "100%", padding: "9px 12px", border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }}
                      />
                    </label>
                  ))}
                  <label style={{ display: "block", marginBottom: 14, fontSize: 14 }}>
                    <span style={{ display: "block", marginBottom: 5, fontWeight: 500, color: "#444" }}>Cửa hàng phụ trách *</span>
                    <select
                      value={custForm.ownerStoreId || ""}
                      onChange={(e) => setCustForm((p) => ({ ...p, ownerStoreId: e.target.value }))}
                      style={{ display: "block", width: "100%", padding: "9px 12px", border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }}
                    >
                      <option value="">-- Chọn cửa hàng --</option>
                      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                  {custMsg && <p style={{ color: "red", fontSize: 13, marginTop: 8 }}>{custMsg}</p>}
                </>
              )}
            </div>

            {/* Footer */}
            {custMsg !== "ok" && (
              <div style={{ padding: "16px 24px", borderTop: "1px solid #eee", display: "flex", gap: 10, flexShrink: 0 }}>
                <button
                  onClick={handleCreateCustomer}
                  disabled={custSaving || !custForm.name || !custForm.ownerStoreId}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 7, border: "none", background: "#1a7a50", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14, opacity: (!custForm.name || !custForm.ownerStoreId) ? 0.5 : 1 }}
                >{custSaving ? "Đang tạo..." : "Tạo khách hàng"}</button>
                <button
                  onClick={() => setCreateCustFrom(null)}
                  disabled={custSaving}
                  style={{ padding: "10px 20px", borderRadius: 7, border: "1px solid #ddd", background: "#fff", color: "#333", cursor: "pointer", fontSize: 14 }}
                >Hủy</button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
