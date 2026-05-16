import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import "../styles/pages.css";
import { ORG_ROLE_OPTIONS, getOrgRoleLabel } from "../utils/roles";

const ROLE_OPTIONS = ORG_ROLE_OPTIONS;

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function fmtDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

export default function OrgPositions({ token }) {
  const [positions, setPositions] = useState([]);
  const [stores, setStores] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [handoverLogs, setHandoverLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterRoleType, setFilterRoleType] = useState("");
  const [filterStoreId, setFilterStoreId] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState("all");
  const [handoverDialogPositionId, setHandoverDialogPositionId] = useState("");
  const [showHandoverFormInDialog, setShowHandoverFormInDialog] = useState(false);

  const [showCreatePositionDialog, setShowCreatePositionDialog] = useState(false);
  const [showCreateAssignmentDialog, setShowCreateAssignmentDialog] = useState(false);
  const [handoverForm, setHandoverForm] = useState({
    fromUserId: "",
    toUserId: "",
    roleType: "STORE_MANAGER",
    storeId: "",
    effectiveFrom: toDateInput(new Date()),
    reason: "",
    onlyIfAssignedFromUser: true
  });
  const [positionForm, setPositionForm] = useState({
    code: "",
    name: "",
    roleType: "STORE_MANAGER",
    storeId: ""
  });
  const [assignmentForm, setAssignmentForm] = useState({
    positionId: "",
    userId: "",
    effectiveFrom: toDateInput(new Date()),
    effectiveTo: "",
    decisionNo: "",
    note: ""
  });

  useEffect(() => {
    if (!token) return;
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !selectedPositionId) {
      setAssignments([]);
      return;
    }
    void loadAssignments(selectedPositionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedPositionId]);

  async function loadData() {
    try {
      setLoading(true);
      const [positionsRes, storesRes, usersRes, handoverRes] = await Promise.all([
        api.getOrgPositions(token),
        api.getStores(token),
        api.getUsers(token),
        api.getOrgPositionHandoverLogs(token)
      ]);
      const positionRows = positionsRes?.data || positionsRes || [];
      setPositions(positionRows);
      setStores(storesRes?.data || storesRes || []);
      setUsers(usersRes?.data || usersRes || []);
      setHandoverLogs(handoverRes?.data || handoverRes || []);
    } catch (error) {
      alert(`Lỗi tải dữ liệu vị trí: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadAssignments(positionId) {
    try {
      const res = await api.getOrgPositionAssignments(token, positionId);
      setAssignments(res?.data || res || []);
    } catch (error) {
      alert(`Lỗi tải lịch sử bổ nhiệm: ${error.message}`);
      setAssignments([]);
    }
  }

  const filteredPositions = useMemo(() => {
    return positions.filter((item) => {
      const roleMatch = !filterRoleType || item.roleType === filterRoleType;
      const storeMatch = !filterStoreId || item.storeId === filterStoreId;
      const text = `${item.code} ${item.name} ${item?.store?.name || ""}`.toLowerCase();
      const searchMatch = !searchTerm || text.includes(searchTerm.toLowerCase());
      return roleMatch && storeMatch && searchMatch;
    });
  }, [positions, filterRoleType, filterStoreId, searchTerm]);

  const selectedPosition = positions.find((item) => item.id === selectedPositionId) || null;
  const handoverDialogPosition = positions.find((item) => item.id === handoverDialogPositionId) || null;
  const filteredAssignmentsByStatus = useMemo(() => {
    const nowMs = Date.now();
    return assignments.filter((row) => {
      if (assignmentStatusFilter === "all") return true;

      const startMs = new Date(row.effectiveFrom).getTime();
      const endMs = row.effectiveTo ? new Date(row.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      const isFuture = startMs > nowMs;
      const isActive = startMs <= nowMs && endMs > nowMs;
      const isEnded = endMs <= nowMs;

      if (assignmentStatusFilter === "active") return isActive;
      if (assignmentStatusFilter === "future") return isFuture;
      if (assignmentStatusFilter === "ended") return isEnded;
      return true;
    });
  }, [assignments, assignmentStatusFilter]);
  const filteredHandoverLogs = useMemo(() => {
    if (!handoverDialogPositionId) return handoverLogs;
    return handoverLogs.filter((row) => row.positionId === handoverDialogPositionId || row?.position?.id === handoverDialogPositionId);
  }, [handoverLogs, handoverDialogPositionId]);

  async function handleCreatePosition(event) {
    event.preventDefault();
    if (!positionForm.code || !positionForm.name || !positionForm.storeId) {
      alert("Vui lòng nhập đủ mã vị trí, tên vị trí và cửa hàng");
      return;
    }

    try {
      await api.createOrgPosition(token, {
        code: positionForm.code.trim(),
        name: positionForm.name.trim(),
        roleType: positionForm.roleType,
        storeId: positionForm.storeId
      });
      alert("Tạo vị trí thành công");
      setShowCreatePositionDialog(false);
      setPositionForm({ code: "", name: "", roleType: "STORE_MANAGER", storeId: "" });
      await loadData();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  }

  async function handleCreateAssignment(event) {
    event.preventDefault();
    if (!assignmentForm.positionId || !assignmentForm.userId || !assignmentForm.effectiveFrom) {
      alert("Vui lòng chọn vị trí, nhân sự và ngày hiệu lực");
      return;
    }

    if (assignmentForm.effectiveTo && assignmentForm.effectiveTo <= assignmentForm.effectiveFrom) {
      alert("Ngày kết thúc phải lớn hơn ngày bắt đầu");
      return;
    }

    try {
      await api.createOrgPositionAssignment(token, assignmentForm.positionId, {
        userId: assignmentForm.userId,
        effectiveFrom: assignmentForm.effectiveFrom,
        effectiveTo: assignmentForm.effectiveTo || null,
        decisionNo: assignmentForm.decisionNo.trim() || undefined,
        note: assignmentForm.note.trim() || undefined
      });
      alert("Bổ nhiệm vị trí thành công");
      setShowCreateAssignmentDialog(false);
      setAssignmentForm({
        positionId: assignmentForm.positionId,
        userId: "",
        effectiveFrom: toDateInput(new Date()),
        effectiveTo: "",
        decisionNo: "",
        note: ""
      });
      await loadAssignments(assignmentForm.positionId);
      await loadData();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  }

  async function handleCloseAssignment(row) {
    const suggested = row.effectiveTo ? toDateInput(row.effectiveTo) : toDateInput(new Date());
    const value = window.prompt("Nhập ngày kết thúc hiệu lực (YYYY-MM-DD)", suggested);
    if (!value) return;
    if (value <= toDateInput(row.effectiveFrom)) {
      alert("Ngày kết thúc phải lớn hơn ngày bắt đầu");
      return;
    }

    try {
      await api.closeOrgPositionAssignment(token, row.id, value);
      alert("Đã kết thúc hiệu lực bổ nhiệm");
      await loadAssignments(row.positionId);
      await loadData();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  }

  async function handleExecuteHandover(event) {
    event.preventDefault();
    if (!handoverForm.fromUserId || !handoverForm.toUserId) {
      alert("Vui lòng chọn nhân sự bàn giao và nhân sự nhận bàn giao");
      return;
    }

    if (handoverForm.fromUserId === handoverForm.toUserId) {
      alert("Nhân sự bàn giao và nhận bàn giao phải khác nhau");
      return;
    }

    try {
      const response = await api.executeOrgPositionHandover(token, {
        fromUserId: handoverForm.fromUserId,
        toUserId: handoverForm.toUserId,
        roleType: handoverForm.roleType,
        storeId: handoverForm.storeId || undefined,
        effectiveFrom: handoverForm.effectiveFrom,
        reason: handoverForm.reason || undefined,
        onlyIfAssignedFromUser: Boolean(handoverForm.onlyIfAssignedFromUser)
      });
      const data = response?.data || response;
      const skipped = Number(data.partnersSkipped || 0);
      const skippedText = skipped > 0 ? `, bỏ qua ${skipped} khách không thuộc người bàn giao` : "";
      alert(`Bàn giao thành công: ${data.positionsReassigned} vị trí, ${data.partnersReassigned} khách hàng${skippedText}`);
      setHandoverForm((prev) => ({
        ...prev,
        fromUserId: "",
        toUserId: "",
        reason: ""
      }));
      await loadData();
      if (selectedPositionId) {
        await loadAssignments(selectedPositionId);
      }
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  }

  function openHandoverDialog(position) {
    setHandoverDialogPositionId(position.id);
    setShowHandoverFormInDialog(false);
    setHandoverForm((prev) => ({
      ...prev,
      roleType: position.roleType || prev.roleType,
      storeId: position.storeId || ""
    }));
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Vị trí nhân sự & bổ nhiệm</h1>
          <p className="stat-text">Quản lý vị trí tổ chức, lịch sử bổ nhiệm và dùng vị trí để gán phụ trách khách hàng.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn-primary" type="button" onClick={() => setShowCreatePositionDialog(true)}>
            + Thêm vị trí
          </button>
        </div>
      </div>

      <div className="search-section">
        <input
          className="search-input"
          placeholder="Tìm theo mã vị trí, tên vị trí, cửa hàng..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
        <select className="filter-select" value={filterRoleType} onChange={(event) => setFilterRoleType(event.target.value)}>
          <option value="">Tất cả vai trò</option>
          {ROLE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <select className="filter-select" value={filterStoreId} onChange={(event) => setFilterStoreId(event.target.value)}>
          <option value="">Tất cả cửa hàng</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>{store.code} - {store.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Đang tải...</p>
      ) : (
        <div className="table-container" style={{ marginBottom: 20 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã vị trí</th>
                <th>Tên vị trí</th>
                <th>Vai trò</th>
                <th>Cửa hàng</th>
                <th>Nhân sự hiện tại</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredPositions.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center">Không có dữ liệu</td>
                </tr>
              ) : (
                filteredPositions.map((item) => {
                  const currentAssignee = item.assignments?.[0]?.user;
                  return (
                    <tr key={item.id}>
                      <td className="font-mono">{item.code}</td>
                      <td>{item.name}</td>
                      <td>{getOrgRoleLabel(item.roleType)}</td>
                      <td>{item?.store?.code} - {item?.store?.name}</td>
                      <td>{currentAssignee ? `${currentAssignee.fullName} (${currentAssignee.email})` : "--"}</td>
                      <td>
                        <span className={`status ${item.isActive ? "active" : "inactive"}`}>
                          {item.isActive ? "Hoạt động" : "Ngưng"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="btn-small btn-blue" type="button" onClick={() => setSelectedPositionId(item.id)}>
                            Chi tiết
                          </button>
                          <button className="btn-small" type="button" onClick={() => openHandoverDialog(item)}>
                            Bàn giao
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedPosition ? (
        <div className="dialog-overlay" onClick={() => setSelectedPositionId("")}>
          <div
            className="dialog-panel dialog-panel--lg"
            style={{ overflowY: "auto" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <h2>Chi tiết vị trí - {selectedPosition.code} ({selectedPosition.name})</h2>
              <button type="button" className="close-btn" onClick={() => setSelectedPositionId("")} aria-label="Đóng">✕</button>
            </div>
            <div className="dialog-meta">
              <div><strong>Vai trò:</strong> {getOrgRoleLabel(selectedPosition.roleType)}</div>
              <div><strong>Cửa hàng:</strong> {selectedPosition?.store?.code} - {selectedPosition?.store?.name}</div>
              <div><strong>Trạng thái:</strong> {selectedPosition.isActive ? "Hoạt động" : "Ngưng"}</div>
            </div>
            <div className="dialog-footer dialog-footer--toolbar">
              <button className="btn-blue" type="button" onClick={() => {
                setAssignmentForm((prev) => ({ ...prev, positionId: selectedPosition.id }));
                setShowCreateAssignmentDialog(true);
              }}>
                + Bổ nhiệm
              </button>
            </div>

          <div className="table-container" style={{ marginTop: 0 }}>
            <div style={{ padding: "14px", borderBottom: "1px solid #e5e7eb", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span>Lịch sử bổ nhiệm</span>
              <select
                value={assignmentStatusFilter}
                onChange={(event) => setAssignmentStatusFilter(event.target.value)}
                style={{ minWidth: 180 }}
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="active">Đang hiệu lực</option>
                <option value="future">Sắp hiệu lực</option>
                <option value="ended">Đã kết thúc</option>
              </select>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nhân sự</th>
                  <th>Hiệu lực từ</th>
                  <th>Hiệu lực đến</th>
                  <th>Số quyết định</th>
                  <th>Ghi chú</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssignmentsByStatus.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center">Không có dữ liệu theo bộ lọc</td>
                  </tr>
                ) : (
                  filteredAssignmentsByStatus.map((row) => {
                    const nowMs = Date.now();
                    const startMs = new Date(row.effectiveFrom).getTime();
                    const endMs = row.effectiveTo ? new Date(row.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
                    const isFuture = startMs > nowMs;
                    const active = startMs <= nowMs && endMs > nowMs;
                    return (
                      <tr key={row.id}>
                        <td>{row?.user?.fullName} ({row?.user?.email})</td>
                        <td>{fmtDate(row.effectiveFrom)}</td>
                        <td>{fmtDate(row.effectiveTo)}</td>
                        <td>{row.decisionNo || "--"}</td>
                        <td>{row.note || "--"}</td>
                        <td>
                          {active ? (
                            <button className="btn-small btn-red" type="button" onClick={() => handleCloseAssignment(row)}>
                              Kết thúc
                            </button>
                          ) : isFuture ? (
                            <span className="status">Sắp hiệu lực</span>
                          ) : (
                            <span className="status inactive">Đã kết thúc</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          </div>
        </div>
      ) : null}

      {handoverDialogPosition ? (
        <div className="dialog-overlay" onClick={() => setHandoverDialogPositionId("")}>
          <div
            className="dialog-panel dialog-panel--lg"
            style={{ overflowY: "auto" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <h2>Lịch sử bàn giao - {handoverDialogPosition.code} ({handoverDialogPosition.name})</h2>
              <div className="dialog-header-actions">
                <button className="btn-blue" type="button" onClick={() => setShowHandoverFormInDialog((prev) => !prev)}>
                  {showHandoverFormInDialog ? "Ẩn thêm bàn giao" : "+ Thêm bàn giao"}
                </button>
                <button type="button" className="close-btn" onClick={() => setHandoverDialogPositionId("")} aria-label="Đóng">✕</button>
              </div>
            </div>

            {showHandoverFormInDialog ? (
              <form style={{ padding: 14, borderBottom: "1px solid #e5e7eb" }} onSubmit={handleExecuteHandover}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Nhân sự bàn giao</label>
                    <select value={handoverForm.fromUserId} onChange={(event) => setHandoverForm((prev) => ({ ...prev, fromUserId: event.target.value }))}>
                      <option value="">Chọn nhân sự</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>{user.fullName} - {user.email}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Nhân sự nhận bàn giao</label>
                    <select value={handoverForm.toUserId} onChange={(event) => setHandoverForm((prev) => ({ ...prev, toUserId: event.target.value }))}>
                      <option value="">Chọn nhân sự</option>
                      {users.filter((user) => user.isActive).map((user) => (
                        <option key={user.id} value={user.id}>{user.fullName} - {user.email}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Vai trò bàn giao</label>
                    <select value={handoverForm.roleType} onChange={(event) => setHandoverForm((prev) => ({ ...prev, roleType: event.target.value }))}>
                      {ROLE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Cửa hàng (tùy chọn)</label>
                    <select value={handoverForm.storeId} onChange={(event) => setHandoverForm((prev) => ({ ...prev, storeId: event.target.value }))}>
                      <option value="">Toàn hệ thống</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>{store.code} - {store.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Ngày hiệu lực</label>
                    <input type="date" value={handoverForm.effectiveFrom} onChange={(event) => setHandoverForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>Lý do</label>
                    <input value={handoverForm.reason} onChange={(event) => setHandoverForm((prev) => ({ ...prev, reason: event.target.value }))} placeholder="VD: Nghỉ việc/thuyên chuyển" />
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: 6 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(handoverForm.onlyIfAssignedFromUser)}
                      onChange={(event) => setHandoverForm((prev) => ({ ...prev, onlyIfAssignedFromUser: event.target.checked }))}
                    />
                    Chỉ chuyển khách đang gán đúng cho nhân sự bàn giao
                  </label>
                </div>
                <div className="dialog-footer dialog-footer--compact">
                  <button type="submit" className="btn-primary">Thực thi bàn giao</button>
                </div>
              </form>
            ) : null}

            <div className="table-container" style={{ marginTop: 0 }}>
              <div style={{ padding: "14px", borderBottom: "1px solid #e5e7eb", fontWeight: 700 }}>
                Lịch sử bàn giao
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Khách hàng</th>
                    <th>Vị trí</th>
                    <th>Từ</th>
                    <th>Sang</th>
                    <th>Lý do</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHandoverLogs.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="text-center">Chưa có lịch sử bàn giao</td>
                    </tr>
                  ) : (
                    filteredHandoverLogs.map((row) => (
                      <tr key={row.id}>
                        <td>{fmtDate(row.createdAt)}</td>
                        <td>{row?.partner?.code} - {row?.partner?.name}</td>
                        <td>{row?.position?.code} - {row?.position?.name}</td>
                        <td>{row?.fromUser?.fullName}</td>
                        <td>{row?.toUser?.fullName}</td>
                        <td>{row.reason || "--"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {showCreatePositionDialog ? (
        <div className="dialog-overlay" onClick={() => setShowCreatePositionDialog(false)}>
          <form className="dialog-panel dialog-panel--md" onClick={(event) => event.stopPropagation()} onSubmit={handleCreatePosition}>
            <div className="dialog-header">
              <h2>Tạo vị trí tổ chức</h2>
              <button type="button" className="close-btn" onClick={() => setShowCreatePositionDialog(false)} aria-label="Đóng">✕</button>
            </div>
            <div className="dialog-body">
              <div className="form-group">
                <label>Mã vị trí *</label>
                <input value={positionForm.code} onChange={(event) => setPositionForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="VD: SALES-CN01" />
              </div>
              <div className="form-group">
                <label>Tên vị trí *</label>
                <input value={positionForm.name} onChange={(event) => setPositionForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="VD: Nhân viên phụ trách CN01" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Vai trò *</label>
                  <select value={positionForm.roleType} onChange={(event) => setPositionForm((prev) => ({ ...prev, roleType: event.target.value }))}>
                    {ROLE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Cửa hàng *</label>
                  <select value={positionForm.storeId} onChange={(event) => setPositionForm((prev) => ({ ...prev, storeId: event.target.value }))}>
                    <option value="">Chọn cửa hàng</option>
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>{store.code} - {store.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowCreatePositionDialog(false)}>Hủy</button>
              <button type="submit" className="btn-primary">Tạo vị trí</button>
            </div>
          </form>
        </div>
      ) : null}

      {showCreateAssignmentDialog ? (
        <div className="dialog-overlay" onClick={() => setShowCreateAssignmentDialog(false)}>
          <form className="dialog-panel dialog-panel--md" onClick={(event) => event.stopPropagation()} onSubmit={handleCreateAssignment}>
            <div className="dialog-header">
              <h2>Bổ nhiệm nhân sự theo vị trí</h2>
              <button type="button" className="close-btn" onClick={() => setShowCreateAssignmentDialog(false)} aria-label="Đóng">✕</button>
            </div>
            <div className="dialog-body">
              <div className="form-group">
                <label>Vị trí *</label>
                <select value={assignmentForm.positionId} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, positionId: event.target.value }))}>
                  <option value="">Chọn vị trí</option>
                  {positions.map((row) => (
                    <option key={row.id} value={row.id}>{row.code} - {row.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Nhân sự *</label>
                <select value={assignmentForm.userId} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, userId: event.target.value }))}>
                  <option value="">Chọn nhân sự</option>
                  {users.filter((row) => row.isActive).map((row) => (
                    <option key={row.id} value={row.id}>{row.fullName} - {row.email}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Hiệu lực từ *</label>
                  <input type="date" value={assignmentForm.effectiveFrom} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Hiệu lực đến</label>
                  <input type="date" value={assignmentForm.effectiveTo} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, effectiveTo: event.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label>Số quyết định</label>
                <input value={assignmentForm.decisionNo} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, decisionNo: event.target.value }))} placeholder="VD: QD-2026-04" />
              </div>
              <div className="form-group">
                <label>Ghi chú</label>
                <textarea rows="3" value={assignmentForm.note} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, note: event.target.value }))} placeholder="Ghi chú bổ nhiệm/điều chuyển" />
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowCreateAssignmentDialog(false)}>Hủy</button>
              <button type="submit" className="btn-primary">Lưu bổ nhiệm</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
