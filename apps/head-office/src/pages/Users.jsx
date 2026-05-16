import { useState, useEffect } from "react";
import * as api from "../api";
import "../styles/pages.css";
import { formatCurrency } from "../utils/currency";
import { SYSTEM_ROLE_OPTIONS, getSystemRolesLabel } from "../utils/roles";

const completedStatuses = new Set(["COMPLETED"]);
const openStatuses = new Set(["DRAFT", "CONFIRMED", "PROCESSING", "DELIVERED"]);
const problematicStatuses = new Set(["CANCELLED", "RETURNED", "REFUNDED"]);

export default function Users({ token }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [userOrders, setUserOrders] = useState([]);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordTargetUser, setPasswordTargetUser] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirmPassword: "" });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [formData, setFormData] = useState({
    email: "",
    fullName: "",
    roles: "SALES_STAFF",
    isActive: true,
    password: "",
    confirmPassword: ""
  });

  useEffect(() => {
    loadUsers();
  }, [token]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await api.getUsers(token);
      setUsers(data.data || data);
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (user = null) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        fullName: user.fullName,
        email: user.email,
        roles: user.roles,
        isActive: user.isActive,
        password: "",
        confirmPassword: ""
      });
    } else {
      setEditingUser(null);
      setFormData({
        email: "",
        fullName: "",
        roles: "SALES_STAFF",
        isActive: true,
        password: "",
        confirmPassword: ""
      });
    }
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingUser(null);
  };

  const handleOpenDetailDialog = async (user) => {
    setSelectedUser(user);
    setShowDetailDialog(true);
    setDetailLoading(true);
    try {
      const ordersRes = await api.getOrders(token);
      const orders = ordersRes?.data || ordersRes || [];
      const ownedOrders = orders.filter((order) => order.createdByUserId === user.id);
      setUserOrders(ownedOrders);
    } catch (error) {
      alert(`Lỗi tải hiệu suất người dùng: ${error.message}`);
      setUserOrders([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCloseDetailDialog = () => {
    setShowDetailDialog(false);
    setSelectedUser(null);
    setUserOrders([]);
    setDetailLoading(false);
  };

  const handleOpenPasswordDialog = (user) => {
    setPasswordTargetUser(user);
    setPasswordForm({ password: "", confirmPassword: "" });
    setShowPasswordDialog(true);
  };

  const handleClosePasswordDialog = () => {
    setShowPasswordDialog(false);
    setPasswordTargetUser(null);
    setPasswordForm({ password: "", confirmPassword: "" });
    setPasswordSaving(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) {
        const updatePayload = {
          fullName: formData.fullName,
          roles: formData.roles,
          isActive: formData.isActive
        };
        await api.updateUser(token, editingUser.id, updatePayload);
        alert("Cập nhật thành công");
      } else {
        if (formData.password.length < 6) {
          alert("Mật khẩu phải có ít nhất 6 ký tự");
          return;
        }
        if (formData.password !== formData.confirmPassword) {
          alert("Mật khẩu xác nhận không khớp");
          return;
        }
        await api.createUser(token, {
          email: formData.email,
          fullName: formData.fullName,
          roles: formData.roles,
          isActive: formData.isActive,
          password: formData.password
        });
        alert("Tạo người dùng thành công");
      }
      handleCloseDialog();
      loadUsers();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!passwordTargetUser) return;

    if (passwordForm.password.length < 6) {
      alert("Mật khẩu mới phải có ít nhất 6 ký tự");
      return;
    }
    if (passwordForm.password !== passwordForm.confirmPassword) {
      alert("Mật khẩu xác nhận không khớp");
      return;
    }

    try {
      setPasswordSaving(true);
      await api.updateUser(token, passwordTargetUser.id, {
        fullName: passwordTargetUser.fullName,
        roles: passwordTargetUser.roles,
        isActive: passwordTargetUser.isActive,
        password: passwordForm.password
      });
      alert("Đổi mật khẩu thành công");
      handleClosePasswordDialog();
      await loadUsers();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Bạn chắc chắn muốn vô hiệu hóa người dùng này?")) return;
    try {
      await api.deleteUser(token, id);
      alert("Người dùng đã bị vô hiệu hóa");
      loadUsers();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.isActive).length;
  const inactiveUsers = users.filter(u => !u.isActive).length;

  const roleOptions = SYSTEM_ROLE_OPTIONS;

  const filteredUsers = users.filter(u => {
    const matchesSearch =
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.fullName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = !filterRole || (u.roles || "").includes(filterRole);
    const matchesStatus =
      filterStatus === "all" ||
      (filterStatus === "active" && u.isActive) ||
      (filterStatus === "inactive" && !u.isActive);
    return matchesSearch && matchesRole && matchesStatus;
  });

  const totalManagedOrders = userOrders.length;
  const completedOrders = userOrders.filter((order) => completedStatuses.has(order.status)).length;
  const openOrders = userOrders.filter((order) => openStatuses.has(order.status)).length;
  const problematicOrders = userOrders.filter((order) => problematicStatuses.has(order.status)).length;
  const totalRevenue = userOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
  const totalDebt = userOrders.reduce((sum, order) => sum + Number(order.debtAmount || 0), 0);
  const averageOrderValue = totalManagedOrders ? totalRevenue / totalManagedOrders : 0;
  const completionRate = totalManagedOrders ? (completedOrders / totalManagedOrders) * 100 : 0;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Quản lý người dùng</h1>
        <button className="btn-primary" onClick={() => handleOpenDialog()}>
          + Thêm người dùng
        </button>
      </div>

      <div className="summary-grid" style={{ marginBottom: 20 }}>
        <div className="summary-item">
          <div className="summary-label">Tổng người dùng</div>
          <div className="summary-value">{totalUsers}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Đang hoạt động</div>
          <div className="summary-value" style={{ color: "#2b8a3e" }}>{activeUsers}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Vô hiệu hóa</div>
          <div className="summary-value" style={{ color: "#c92a2a" }}>{inactiveUsers}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Kết quả lọc</div>
          <div className="summary-value">{filteredUsers.length}</div>
        </div>
      </div>

      <div className="search-section">
        <input
          type="text"
          placeholder="Tìm kiếm email hoặc tên..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <select
          className="filter-select"
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
        >
          <option value="">Tất cả vai trò</option>
          {roleOptions.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="active">Đang hoạt động</option>
          <option value="inactive">Vô hiệu hóa</option>
        </select>
      </div>

      {loading ? (
        <p>Đang tải...</p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Họ và tên</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center">Không có dữ liệu</td>
                </tr>
              ) : (
                filteredUsers.map(user => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{user.fullName}</td>
                    <td>
                      <span className="badge">{getSystemRolesLabel(user.roles)}</span>
                    </td>
                    <td>
                      <span className={`status ${user.isActive ? "active" : "inactive"}`}>
                        {user.isActive ? "Hoạt động" : "Vô hiệu"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn-small btn-blue"
                        onClick={() => handleOpenDetailDialog(user)}
                      >
                        Chi tiết
                      </button>
                      {user.isActive && (
                        <button
                          className="btn-small btn-red"
                          onClick={() => handleDelete(user.id)}
                        >
                          Vô hiệu hóa
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showDetailDialog && selectedUser && (
        <div className="dialog-overlay" onClick={handleCloseDetailDialog}>
          <div className="dialog-panel dialog-panel--lg" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Chi tiết người dùng</h2>
              <div className="dialog-header-actions">
                <button
                  type="button"
                  className="btn-small btn-blue"
                  onClick={() => {
                    handleCloseDetailDialog();
                    handleOpenDialog(selectedUser);
                  }}
                >
                  Sửa
                </button>
                <button
                  type="button"
                  className="btn-small btn-primary"
                  onClick={() => handleOpenPasswordDialog(selectedUser)}
                >
                  Đổi mật khẩu
                </button>
                <button type="button" className="close-btn" onClick={handleCloseDetailDialog} aria-label="Đóng">✕</button>
              </div>
            </div>

            <div className="dialog-body">
              {detailLoading ? (
                <p>Đang tải dữ liệu hiệu suất...</p>
              ) : (
                <>
                  <div className="users-detail-section">
                    <h3>Tổng quan người dùng</h3>
                    <div className="users-detail-grid">
                      <div className="form-group">
                        <label>Họ và tên</label>
                        <div className="info-box">{selectedUser.fullName || "-"}</div>
                      </div>
                      <div className="form-group">
                        <label>Email</label>
                        <div className="info-box">{selectedUser.email || "-"}</div>
                      </div>
                      <div className="form-group">
                        <label>Vai trò</label>
                        <div className="info-box"><span className="badge">{getSystemRolesLabel(selectedUser.roles)}</span></div>
                      </div>
                      <div className="form-group">
                        <label>Trạng thái</label>
                        <div className="info-box">
                          <span className={`status ${selectedUser.isActive ? "active" : "inactive"}`}>
                            {selectedUser.isActive ? "Hoạt động" : "Vô hiệu"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="users-detail-section">
                    <h3>Hiệu suất</h3>
                    <div className="users-kpi-grid">
                      <div className="users-kpi-card">
                        <div className="users-kpi-label">Đơn đã xử lý</div>
                        <div className="users-kpi-value">{totalManagedOrders}</div>
                      </div>
                      <div className="users-kpi-card">
                        <div className="users-kpi-label">Đơn hoàn thành</div>
                        <div className="users-kpi-value" style={{ color: "#2b8a3e" }}>{completedOrders}</div>
                      </div>
                      <div className="users-kpi-card">
                        <div className="users-kpi-label">Đơn đang xử lý</div>
                        <div className="users-kpi-value" style={{ color: "#1971c2" }}>{openOrders}</div>
                      </div>
                      <div className="users-kpi-card">
                        <div className="users-kpi-label">Đơn có vấn đề</div>
                        <div className="users-kpi-value" style={{ color: "#c92a2a" }}>{problematicOrders}</div>
                      </div>
                    </div>
                  </div>

                  <div className="users-detail-section">
                    <h3>KPI</h3>
                    <div className="users-kpi-grid">
                      <div className="users-kpi-card">
                        <div className="users-kpi-label">Doanh số phụ trách</div>
                        <div className="users-kpi-value">{formatCurrency(totalRevenue)}</div>
                      </div>
                      <div className="users-kpi-card">
                        <div className="users-kpi-label">Giá trị đơn trung bình</div>
                        <div className="users-kpi-value">{formatCurrency(averageOrderValue)}</div>
                      </div>
                      <div className="users-kpi-card">
                        <div className="users-kpi-label">Tỷ lệ hoàn thành</div>
                        <div className="users-kpi-value">{completionRate.toFixed(1)}%</div>
                      </div>
                      <div className="users-kpi-card">
                        <div className="users-kpi-label">Công nợ phụ trách</div>
                        <div className="users-kpi-value" style={{ color: totalDebt > 0 ? "#c92a2a" : "#2b8a3e" }}>{formatCurrency(totalDebt)}</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={handleCloseDetailDialog}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {showPasswordDialog && passwordTargetUser && (
        <div className="dialog-overlay dialog-overlay--centered" onClick={handleClosePasswordDialog}>
          <form className="dialog-panel dialog-panel--sm" onClick={(e) => e.stopPropagation()} onSubmit={handlePasswordSubmit}>
            <div className="dialog-header">
              <h2>Đổi mật khẩu</h2>
              <button type="button" className="close-btn" onClick={handleClosePasswordDialog} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body">
              <div className="form-group">
                <label>Người dùng</label>
                <div className="info-box">{passwordTargetUser.fullName} ({passwordTargetUser.email})</div>
              </div>
              <div className="form-group">
                <label>Mật khẩu mới *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={passwordForm.password}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Nhập mật khẩu mới"
                />
              </div>
              <div className="form-group">
                <label>Xác nhận mật khẩu mới *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder="Nhập lại mật khẩu mới"
                />
              </div>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={handleClosePasswordDialog} disabled={passwordSaving}>Hủy</button>
              <button type="submit" className="btn-primary" disabled={passwordSaving}>{passwordSaving ? "Đang cập nhật..." : "Cập nhật mật khẩu"}</button>
            </div>
          </form>
        </div>
      )}

      {showDialog && (
        <div className="dialog-overlay" onClick={handleCloseDialog}>
          <form
            className="dialog-panel dialog-panel--md"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <div className="dialog-header">
              <h2>{editingUser ? "Chỉnh sửa người dùng" : "Tạo người dùng mới"}</h2>
              <button type="button" className="close-btn" onClick={handleCloseDialog} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body">
              {!editingUser && (
                <div className="form-group">
                  <label>Email *</label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="user@example.com"
                  />
                </div>
              )}

              {!editingUser && (
                <>
                  <div className="form-group">
                    <label>Mật khẩu *</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="Nhập mật khẩu (>= 6 ký tự)"
                    />
                  </div>
                  <div className="form-group">
                    <label>Xác nhận mật khẩu *</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      placeholder="Nhập lại mật khẩu"
                    />
                    <p className="form-hint">Người dùng sẽ đăng nhập bằng email và mật khẩu bạn thiết lập ở đây.</p>
                  </div>
                </>
              )}

              {editingUser && (
                <div className="form-group">
                  <p className="form-hint">Đổi mật khẩu thực hiện tại màn hình Chi tiết người dùng.</p>
                </div>
              )}

              <div className="form-group">
                <label>Họ và tên *</label>
                <input
                  type="text"
                  required
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  placeholder="Nhập họ và tên"
                />
              </div>

              <div className="form-group">
                <label>Vai trò *</label>
                <select
                  value={formData.roles}
                  onChange={(e) => setFormData({ ...formData, roles: e.target.value })}
                >
                  {roleOptions.map((role) => (
                    <option key={role.value} value={role.value}>{role.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  />
                  Hoạt động
                </label>
              </div>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={handleCloseDialog}>
                Hủy
              </button>
              <button type="submit" className="btn-primary">
                {editingUser ? "Cập nhật" : "Tạo"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}


