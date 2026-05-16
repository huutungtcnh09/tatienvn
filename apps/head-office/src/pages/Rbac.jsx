import { useEffect, useMemo, useState } from "react";
import {
  getRbacAudit,
  getRbacCatalog,
  getRoleKeys,
  getUsers,
  patchUserRoles
} from "../api";
import "../styles/pages.css";
import "../styles/rbac.css";
import { formatDateTimeVN } from "../utils/datetime";
import { getSystemRoleLabel, getSystemRolesLabel } from "../utils/roles";

function parseRoles(value) {
  return String(value ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

const COMMON_AUDIT_ACTIONS = [
  "",
  "users.create",
  "users.update",
  "users.deactivate",
  "users.roles.manage"
];

function toLocalDateTimeInput(date) {
  const tz = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tz).toISOString().slice(0, 16);
}

export default function Rbac({ token }) {
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [auditMeta, setAuditMeta] = useState({ total: 0, page: 1, pageSize: 20, totalPages: 1 });
  const [auditForm, setAuditForm] = useState({ actor: "", action: "", from: "", to: "" });
  const [auditQuery, setAuditQuery] = useState({ actor: "", action: "", from: "", to: "", page: 1, pageSize: 20 });
  const [users, setUsers] = useState([]);
  const [roleKeys, setRoleKeys] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoles, setSelectedRoles] = useState([]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  const actionOptions = useMemo(() => {
    const found = new Set(COMMON_AUDIT_ACTIONS);
    auditRows.forEach((row) => {
      if (row?.action) found.add(row.action);
    });
    return Array.from(found);
  }, [auditRows]);

  useEffect(() => {
    loadCore();
  }, [token]);

  useEffect(() => {
    loadAudit(auditQuery);
  }, [token, auditQuery]);

  useEffect(() => {
    if (!selectedUser) return;
    setSelectedRoles(parseRoles(selectedUser.roles));
  }, [selectedUserId, selectedUser?.roles]);

  const loadCore = async () => {
    try {
      setLoading(true);
      const [catalogRes, usersRes, rolesRes] = await Promise.all([
        getRbacCatalog(token),
        getUsers(token),
        getRoleKeys(token)
      ]);

      setCatalog(catalogRes.data || null);
      setUsers(usersRes.data || []);
      setRoleKeys(rolesRes.data || []);

      if (!selectedUserId && usersRes.data?.length) {
        setSelectedUserId(usersRes.data[0].id);
      }
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadAudit = async (query = auditQuery) => {
    try {
      setAuditLoading(true);
      const auditRes = await getRbacAudit(token, query);
      const payload = auditRes.data || {};
      setAuditRows(payload.items || []);
      setAuditMeta({
        total: payload.total || 0,
        page: payload.page || query.page || 1,
        pageSize: payload.pageSize || query.pageSize || 20,
        totalPages: payload.totalPages || 1
      });
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setAuditLoading(false);
    }
  };

  const applyAuditFilters = () => {
    setAuditQuery((prev) => ({
      ...prev,
      ...auditForm,
      page: 1
    }));
  };

  const resetAuditFilters = () => {
    const empty = { actor: "", action: "", from: "", to: "" };
    setAuditForm(empty);
    setAuditQuery((prev) => ({ ...prev, ...empty, page: 1 }));
  };

  const applyQuickTimeRange = (days) => {
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    setAuditForm((prev) => ({
      ...prev,
      from: toLocalDateTimeInput(from),
      to: toLocalDateTimeInput(now)
    }));
  };

  const toggleRole = (role) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const submitUserRoles = async () => {
    if (!selectedUserId || !selectedRoles.length) {
      alert("Cần chọn người dùng với ít nhất một vai trò");
      return;
    }

    try {
      await patchUserRoles(token, selectedUserId, selectedRoles);
      alert("Cập nhật vai trò thành công");
      await loadCore();
      await loadAudit();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Phân quyền và vai trò</h1>
          <p className="stat-text">Quản trị RBAC chuyên nghiệp theo vai trò và quyền chi tiết</p>
        </div>
        <button className="btn-primary" onClick={loadCore}>Làm Mới</button>
      </div>

      {loading ? (
        <p>Đang tải dữ liệu phân quyền...</p>
      ) : (
        <>
          <div className="rbac-grid">
            <section className="rbac-card">
              <h3>Gán vai trò người dùng</h3>

              <div className="form-group">
                <label>Người dùng</label>
                <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
                  <option value="">Chọn người dùng</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="role-check-grid">
                {roleKeys.map((role) => (
                  <label key={role} className="role-check">
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(role)}
                      onChange={() => toggleRole(role)}
                    />
                    <span>{getSystemRoleLabel(role)}</span>
                  </label>
                ))}
              </div>

              <div className="rbac-action-row">
                <button className="btn-primary" onClick={submitUserRoles}>Lưu vai trò</button>
                <span className="stat-text">
                  Hiện tại: {selectedUser ? getSystemRolesLabel(selectedUser.roles) : "-"}
                </span>
              </div>
            </section>

            <section className="rbac-card">
              <h3>Cây quyền</h3>
              <div className="tree-list">
                {(catalog?.permissions || []).map((item) => (
                  <div key={item.module} className="tree-item">
                    <strong>{item.module}</strong>
                    <ul>
                      {item.permissions.map((p) => (
                        <li key={p} className="font-mono">{p}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="table-container" style={{ marginBottom: 20 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vai trò</th>
                  <th>Mô tả</th>
                  <th>Số quyền</th>
                </tr>
              </thead>
              <tbody>
                {(catalog?.roles || []).map((role) => {
                  const count = role.permissions.includes("*") ? "Toàn quyền" : role.permissions.length;
                  return (
                    <tr key={role.role}>
                      <td><span className="badge">{getSystemRoleLabel(role.role)}</span></td>
                      <td>{role.description}</td>
                      <td>{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="table-container">
            <div className="audit-toolbar">
              <div className="audit-filter-grid">
                <input
                  value={auditForm.actor}
                  onChange={(e) => setAuditForm((prev) => ({ ...prev, actor: e.target.value }))}
                  placeholder="Lọc theo actor (email/id)"
                />
                <select
                  value={auditForm.action}
                  onChange={(e) => setAuditForm((prev) => ({ ...prev, action: e.target.value }))}
                >
                  {actionOptions.map((act) => (
                    <option key={act || "__all__"} value={act}>
                      {act || "Tất cả hành động"}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={auditForm.from}
                  onChange={(e) => setAuditForm((prev) => ({ ...prev, from: e.target.value }))}
                />
                <input
                  type="datetime-local"
                  value={auditForm.to}
                  onChange={(e) => setAuditForm((prev) => ({ ...prev, to: e.target.value }))}
                />
              </div>

              <div className="audit-range-presets">
                <button className="btn-secondary" onClick={() => applyQuickTimeRange(1)}>24h</button>
                <button className="btn-secondary" onClick={() => applyQuickTimeRange(7)}>7 ngày</button>
                <button className="btn-secondary" onClick={() => applyQuickTimeRange(30)}>30 ngày</button>
              </div>

              <div className="audit-actions">
                <select
                  value={auditQuery.pageSize}
                  onChange={(e) => {
                    const size = Number(e.target.value);
                    setAuditQuery((prev) => ({ ...prev, pageSize: size, page: 1 }));
                  }}
                >
                  <option value={10}>10 / trang</option>
                  <option value={20}>20 / trang</option>
                  <option value={50}>50 / trang</option>
                  <option value={100}>100 / trang</option>
                </select>
                <button className="btn-secondary" onClick={applyAuditFilters}>Áp Dụng Lọc</button>
                <button className="btn-secondary" onClick={resetAuditFilters}>Xóa Lọc</button>
                <button className="btn-primary" onClick={() => loadAudit()}>Refresh Audit</button>
              </div>
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Thời Gian</th>
                  <th>Người Thực Hiện</th>
                  <th>Hành Động</th>
                  <th>Đối Tượng</th>
                  <th>Trước</th>
                  <th>Sau</th>
                </tr>
              </thead>
              <tbody>
                {auditLoading ? (
                  <tr>
                    <td colSpan="6" className="text-center">Đang tải nhật ký...</td>
                  </tr>
                ) : auditRows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center">Chưa có nhật ký phân quyền</td>
                  </tr>
                ) : (
                  auditRows.map((row, idx) => (
                    <tr key={`${row.timestamp}-${idx}`}>
                      <td>{formatDateTimeVN(row.timestamp)}</td>
                      <td>{row.actorEmail || row.actorUserId}</td>
                      <td><span className="badge">{row.action}</span></td>
                      <td>{row.targetDisplay || row.targetId || "-"}</td>
                      <td className="font-mono small-json">{row.before ? JSON.stringify(row.before) : "-"}</td>
                      <td className="font-mono small-json">{row.after ? JSON.stringify(row.after) : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="pagination-row">
              <span className="stat-text">
                Tổng: {auditMeta.total} bản ghi | Trang {auditMeta.page}/{auditMeta.totalPages}
              </span>
              <div className="pagination-actions">
                <button
                  className="btn-secondary"
                  disabled={auditMeta.page <= 1 || auditLoading}
                  onClick={() => setAuditQuery((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                >
                  Trang Trước
                </button>
                <button
                  className="btn-secondary"
                  disabled={auditMeta.page >= auditMeta.totalPages || auditLoading}
                  onClick={() => setAuditQuery((prev) => ({ ...prev, page: prev.page + 1 }))}
                >
                  Trang Sau
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}


