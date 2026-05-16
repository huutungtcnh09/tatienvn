import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import "../styles/pages.css";
import {
  ORG_ROLE_OPTIONS,
  getMappedSystemRoleFromOrgRole,
  getOrgRoleLabel,
  getSystemRoleLabel
} from "../utils/roles";

const roleOptions = ORG_ROLE_OPTIONS;

function toLocalDateInput(dateLike) {
  if (!dateLike) return "";
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDate(dateLike) {
  if (!dateLike) return "--";
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

export default function OrgAssignments({ token }) {
  const [assignments, setAssignments] = useState([]);
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterRoleType, setFilterRoleType] = useState("");
  const [filterStoreId, setFilterStoreId] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const [showDialog, setShowDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    userId: "",
    roleType: "STORE_MANAGER",
    storeId: "",
    effectiveFrom: toLocalDateInput(new Date()),
    effectiveTo: "",
    decisionNo: "",
    note: ""
  });

  useEffect(() => {
    if (!token) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [assignmentRes, usersRes, storesRes] = await Promise.all([
        api.getOrgAssignments(token),
        api.getUsers(token),
        api.getStores(token)
      ]);
      setAssignments(assignmentRes?.data || assignmentRes || []);
      setUsers(usersRes?.data || usersRes || []);
      setStores(storesRes?.data || storesRes || []);
    } catch (error) {
      alert(`Lỗi tải dữ liệu phân công: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = () => {
    setFormData({
      userId: "",
      roleType: "STORE_MANAGER",
      storeId: "",
      effectiveFrom: toLocalDateInput(new Date()),
      effectiveTo: "",
      decisionNo: "",
      note: ""
    });
    setShowDialog(true);
  };

  const handleCreate = async (event) => {
    event.preventDefault();

    if (!formData.userId || !formData.storeId || !formData.effectiveFrom) {
      alert("Vui lòng nhập đủ nhân sự, cửa hàng và ngày bắt đầu hiệu lực");
      return;
    }

    if (formData.effectiveTo && formData.effectiveTo <= formData.effectiveFrom) {
      alert("Ngày kết thúc phải lớn hơn ngày bắt đầu");
      return;
    }

    try {
      setSaving(true);
      await api.createOrgAssignment(token, {
        userId: formData.userId,
        roleType: formData.roleType,
        storeId: formData.storeId,
        effectiveFrom: formData.effectiveFrom,
        effectiveTo: formData.effectiveTo || null,
        decisionNo: formData.decisionNo.trim() || undefined,
        note: formData.note.trim() || undefined
      });
      alert("Tạo quyết định phân công thành công");
      setShowDialog(false);
      await loadData();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCloseAssignment = async (assignment) => {
    if (!assignment?.id) return;
    const currentTo = assignment.effectiveTo ? toLocalDateInput(assignment.effectiveTo) : toLocalDateInput(new Date());
    const promptValue = window.prompt("Nhập ngày kết thúc hiệu lực (YYYY-MM-DD)", currentTo);
    if (!promptValue) return;

    if (promptValue <= toLocalDateInput(assignment.effectiveFrom)) {
      alert("Ngày kết thúc phải lớn hơn ngày bắt đầu");
      return;
    }

    try {
      await api.closeOrgAssignment(token, assignment.id, promptValue);
      alert("Đã đóng hiệu lực phân công");
      await loadData();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  const filteredAssignments = useMemo(() => {
    return assignments.filter((item) => {
      const roleMatch = !filterRoleType || item.roleType === filterRoleType;
      const storeMatch = !filterStoreId || item.storeId === filterStoreId;
      const searchText = `${item?.user?.fullName || ""} ${item?.user?.email || ""} ${item?.store?.name || ""} ${item?.store?.code || ""}`.toLowerCase();
      const searchMatch = !searchTerm || searchText.includes(searchTerm.toLowerCase());

      const now = Date.now();
      const fromTime = new Date(item.effectiveFrom).getTime();
      const toTime = item.effectiveTo ? new Date(item.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      const active = Number.isFinite(fromTime) && fromTime <= now && now < toTime;
      const future = Number.isFinite(fromTime) && fromTime > now;
      const closed = item.effectiveTo ? new Date(item.effectiveTo).getTime() <= now : false;

      let statusMatch = true;
      if (filterStatus === "active") statusMatch = active;
      if (filterStatus === "future") statusMatch = future;
      if (filterStatus === "closed") statusMatch = closed;

      return roleMatch && storeMatch && searchMatch && statusMatch;
    });
  }, [assignments, filterRoleType, filterStoreId, searchTerm, filterStatus]);

  const activeCount = filteredAssignments.filter((item) => {
    const now = Date.now();
    const fromTime = new Date(item.effectiveFrom).getTime();
    const toTime = item.effectiveTo ? new Date(item.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
    return Number.isFinite(fromTime) && fromTime <= now && now < toTime;
  }).length;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Cơ cấu tổ chức theo thời điểm</h1>
          <p className="stat-text">Quản lý quyết định bổ nhiệm và điều chuyển để cố định KPI theo thời điểm phát sinh đơn.</p>
        </div>
        <button type="button" className="btn-primary" onClick={handleOpenDialog}>
          + Thêm quyết định
        </button>
      </div>

      <div className="summary-grid" style={{ marginBottom: 20 }}>
        <div className="summary-item">
          <div className="summary-label">Tổng bản ghi</div>
          <div className="summary-value">{assignments.length}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Đang hiệu lực</div>
          <div className="summary-value" style={{ color: "#2b8a3e" }}>{activeCount}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Kết quả lọc</div>
          <div className="summary-value">{filteredAssignments.length}</div>
        </div>
      </div>

      <div className="search-section">
        <input
          type="text"
          className="search-input"
          placeholder="Tìm tên nhân sự, email, mã/tên cửa hàng..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
        <select className="filter-select" value={filterRoleType} onChange={(event) => setFilterRoleType(event.target.value)}>
          <option value="">Tất cả chức danh</option>
          {roleOptions.map((role) => (
            <option key={role.value} value={role.value}>{role.label}</option>
          ))}
        </select>
        <select className="filter-select" value={filterStoreId} onChange={(event) => setFilterStoreId(event.target.value)}>
          <option value="">Tất cả cửa hàng</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>{store.code} - {store.name}</option>
          ))}
        </select>
        <select className="filter-select" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
          <option value="all">Tất cả trạng thái</option>
          <option value="active">Đang hiệu lực</option>
          <option value="future">Sắp hiệu lực</option>
          <option value="closed">Đã kết thúc</option>
        </select>
      </div>

      {loading ? (
        <p>Đang tải...</p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nhân sự</th>
                <th>Chức danh</th>
                <th>Vai trò phân quyền</th>
                <th>Cửa hàng</th>
                <th>Hiệu lực từ</th>
                <th>Hiệu lực đến</th>
                <th>Số quyết định</th>
                <th>Ghi chú</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssignments.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center">Không có dữ liệu</td>
                </tr>
              ) : (
                filteredAssignments.map((item) => {
                  const now = Date.now();
                  const fromTime = new Date(item.effectiveFrom).getTime();
                  const toTime = item.effectiveTo ? new Date(item.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
                  const isActive = Number.isFinite(fromTime) && fromTime <= now && now < toTime;

                  return (
                    <tr key={item.id}>
                      <td>
                        <div>{item?.user?.fullName || "--"}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{item?.user?.email || ""}</div>
                      </td>
                      <td>{getOrgRoleLabel(item.roleType)}</td>
                      <td>{getSystemRoleLabel(getMappedSystemRoleFromOrgRole(item.roleType))}</td>
                      <td>{item?.store?.code} - {item?.store?.name}</td>
                      <td>{formatDate(item.effectiveFrom)}</td>
                      <td>{formatDate(item.effectiveTo)}</td>
                      <td>{item.decisionNo || "--"}</td>
                      <td>{item.note || "--"}</td>
                      <td>
                        <span className={`status ${isActive ? "active" : "inactive"}`} style={{ marginRight: 8 }}>
                          {isActive ? "Hiệu lực" : "Không hiệu lực"}
                        </span>
                        {isActive ? (
                          <button type="button" className="btn-red btn-small" onClick={() => handleCloseAssignment(item)}>
                            Kết thúc
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {showDialog ? (
        <div className="dialog-overlay" onClick={() => setShowDialog(false)}>
          <div className="dialog-panel dialog-panel--md" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <h2>Tạo quyết định phân công</h2>
              <button type="button" className="close-btn" onClick={() => setShowDialog(false)} aria-label="Đóng">✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="dialog-body">
                <div className="form-group">
                  <label>Nhân sự</label>
                  <select value={formData.userId} onChange={(event) => setFormData((prev) => ({ ...prev, userId: event.target.value }))}>
                    <option value="">Chọn nhân sự</option>
                    {users
                      .filter((user) => user.isActive)
                      .map((user) => (
                        <option key={user.id} value={user.id}>{user.fullName} - {user.email}</option>
                      ))}
                  </select>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Chức danh</label>
                    <select value={formData.roleType} onChange={(event) => setFormData((prev) => ({ ...prev, roleType: event.target.value }))}>
                      {roleOptions.map((role) => (
                        <option key={role.value} value={role.value}>{role.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Cửa hàng</label>
                    <select value={formData.storeId} onChange={(event) => setFormData((prev) => ({ ...prev, storeId: event.target.value }))}>
                      <option value="">Chọn cửa hàng</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>{store.code} - {store.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Hiệu lực từ</label>
                    <input
                      type="date"
                      value={formData.effectiveFrom}
                      onChange={(event) => setFormData((prev) => ({ ...prev, effectiveFrom: event.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Hiệu lực đến (tùy chọn)</label>
                    <input
                      type="date"
                      value={formData.effectiveTo}
                      onChange={(event) => setFormData((prev) => ({ ...prev, effectiveTo: event.target.value }))}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Số quyết định (tùy chọn)</label>
                  <input
                    type="text"
                    placeholder="VD: QD-2026-04-15"
                    value={formData.decisionNo}
                    onChange={(event) => setFormData((prev) => ({ ...prev, decisionNo: event.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>Ghi chú</label>
                  <textarea
                    rows="3"
                    placeholder="Thông tin bổ sung về điều chuyển hoặc bổ nhiệm"
                    value={formData.note}
                    onChange={(event) => setFormData((prev) => ({ ...prev, note: event.target.value }))}
                  />
                </div>
              </div>

              <div className="dialog-footer">
                <button type="button" className="btn-cancel" onClick={() => setShowDialog(false)}>
                  Hủy
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? "Đang lưu..." : "Lưu quyết định"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
