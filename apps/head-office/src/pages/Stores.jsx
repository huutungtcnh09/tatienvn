import { useState, useEffect } from "react";
import * as api from "../api";
import "../styles/pages.css";
import { getOrgRoleLabel, getSystemRolesLabel } from "../utils/roles";

function safeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function Stores({ token }) {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  const [editingStore, setEditingStore] = useState(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedStoreDetail, setSelectedStoreDetail] = useState(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    isWarehouse: false
  });

  useEffect(() => {
    loadData();
  }, [token]);

  const loadData = async () => {
    try {
      setLoading(true);
      const storesData = await api.getStores(token);
      setStores(storesData.data || storesData);
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (store = null) => {
    if (store) {
      setEditingStore(store);
      setFormData({
        code: store.code,
        name: store.name,
        isWarehouse: store.isWarehouse
      });
    } else {
      setEditingStore(null);
      setFormData({
        code: "",
        name: "",
        isWarehouse: false
      });
    }
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingStore(null);
  };

  const handleOpenDetail = async (store) => {
    setShowDetailDialog(true);
    setDetailLoading(true);
    try {
      const response = await api.getStoreById(token, store.id);
      setSelectedStoreDetail(response.data || response);
    } catch (error) {
      alert(`Lỗi tải chi tiết: ${error.message}`);
      setSelectedStoreDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCloseDetail = () => {
    setShowDetailDialog(false);
    setDetailLoading(false);
    setSelectedStoreDetail(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingStore) {
        const updatePayload = {
          code: formData.code,
          name: formData.name,
          isWarehouse: formData.isWarehouse
        };
        await api.updateStore(token, editingStore.id, updatePayload);
        alert("Cập nhật thành công");
      } else {
        await api.createStore(token, formData);
        alert("Tạo cửa hàng thành công");
      }
      handleCloseDialog();
      loadData();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  const totalStores = stores.filter(s => !s.isWarehouse).length;
  const totalWarehouses = stores.filter(s => s.isWarehouse).length;

  const filteredStores = stores.filter(s => {
    const matchesSearch =
      s.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType =
      filterType === "all" ||
      (filterType === "store" && !s.isWarehouse) ||
      (filterType === "warehouse" && s.isWarehouse);
    return matchesSearch && matchesType;
  });

  const inventoryRows = selectedStoreDetail?.inventory || [];
  const inventoryProductCount = inventoryRows.length;
  const totalQuantity = inventoryRows.reduce((sum, row) => sum + safeNumber(row.quantity), 0);
  const totalReserved = inventoryRows.reduce((sum, row) => sum + safeNumber(row.reservedQuantity), 0);
  const totalAvailable = inventoryRows.reduce((sum, row) => {
    const available = row.availableQuantity != null
      ? safeNumber(row.availableQuantity)
      : safeNumber(row.quantity) - safeNumber(row.reservedQuantity);
    return sum + available;
  }, 0);
  const lowStockCount = inventoryRows.filter((row) => {
    const available = row.availableQuantity != null
      ? safeNumber(row.availableQuantity)
      : safeNumber(row.quantity) - safeNumber(row.reservedQuantity);
    return available <= 10;
  }).length;

  const assignedStaff = selectedStoreDetail?.staffAssignments || [];

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Quản lý cửa hàng và kho</h1>
        <button className="btn-primary" onClick={() => handleOpenDialog()}>
          + Thêm cửa hàng
        </button>
      </div>

      <div className="summary-grid" style={{ marginBottom: 20 }}>
        <div className="summary-item">
          <div className="summary-label">Tổng cửa hàng</div>
          <div className="summary-value" style={{ color: "#1971c2" }}>{totalStores}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Tổng kho hàng</div>
          <div className="summary-value" style={{ color: "#9c6b00" }}>{totalWarehouses}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Tổng địa điểm</div>
          <div className="summary-value">{stores.length}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Kết quả lọc</div>
          <div className="summary-value">{filteredStores.length}</div>
        </div>
      </div>

      <div className="search-section">
        <input
          type="text"
          placeholder="Tìm kiếm mã hoặc tên..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <select
          className="filter-select"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="all">Tất cả loại</option>
          <option value="store">Cửa hàng</option>
          <option value="warehouse">Kho hàng</option>
        </select>
      </div>

      {loading ? (
        <p>Đang tải...</p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên</th>
                <th>Loại</th>
                <th>Quản lý</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredStores.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center">Không có dữ liệu</td>
                </tr>
              ) : (
                filteredStores.map(store => (
                  (() => {
                    const activeManagerAssignment = (store.staffAssignments || []).find((assignment) => assignment.roleType === "STORE_MANAGER");
                    const managerName = activeManagerAssignment?.user?.fullName || "-";
                    return (
                  <tr key={store.id}>
                    <td>{store.code}</td>
                    <td>{store.name}</td>
                    <td>
                      <span className="badge">
                        {store.isWarehouse ? "Kho" : "Cửa hàng"}
                      </span>
                    </td>
                    <td>{managerName}</td>
                    <td>
                      <button
                        className="btn-small"
                        onClick={() => handleOpenDetail(store)}
                      >
                        Chi tiết
                      </button>
                      <button
                        className="btn-small btn-blue"
                        onClick={() => handleOpenDialog(store)}
                      >
                        Sửa
                      </button>
                    </td>
                  </tr>
                    );
                  })()
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showDetailDialog && (
        <div className="dialog-overlay" onClick={handleCloseDetail}>
          <div className="dialog-panel dialog-panel--lg" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Tổng quan cửa hàng / kho</h2>
              <button type="button" className="close-btn" onClick={handleCloseDetail} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body">
              {detailLoading || !selectedStoreDetail ? (
                <p>Đang tải dữ liệu chi tiết...</p>
              ) : (
                (() => {
                  const detailManagerAssignment = assignedStaff.find((assignment) => assignment.roleType === "STORE_MANAGER");
                  const detailManagerName = detailManagerAssignment?.user?.fullName || "-";
                  return (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Mã</label>
                      <div className="info-box font-mono">{selectedStoreDetail.code || "-"}</div>
                    </div>
                    <div className="form-group">
                      <label>Tên</label>
                      <div className="info-box">{selectedStoreDetail.name || "-"}</div>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Loại</label>
                      <div className="info-box">
                        <span className="badge">{selectedStoreDetail.isWarehouse ? "Kho" : "Cửa hàng"}</span>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Quản lý hiện hành</label>
                      <div className="info-box">{detailManagerName}</div>
                    </div>
                  </div>

                  <div className="summary-grid" style={{ marginBottom: 14 }}>
                    <div className="summary-item">
                      <div className="summary-label">Số mã hàng tồn</div>
                      <div className="summary-value">{inventoryProductCount}</div>
                    </div>
                    <div className="summary-item">
                      <div className="summary-label">Tổng tồn kho</div>
                      <div className="summary-value" style={{ color: "#1971c2" }}>{totalQuantity}</div>
                    </div>
                    <div className="summary-item">
                      <div className="summary-label">Khả dụng</div>
                      <div className="summary-value" style={{ color: "#2b8a3e" }}>{totalAvailable}</div>
                    </div>
                    <div className="summary-item">
                      <div className="summary-label">Đặt trước</div>
                      <div className="summary-value" style={{ color: "#9c6b00" }}>{totalReserved}</div>
                    </div>
                    <div className="summary-item">
                      <div className="summary-label">Đơn bán</div>
                      <div className="summary-value">{safeNumber(selectedStoreDetail?._count?.salesOrders)}</div>
                    </div>
                    <div className="summary-item">
                      <div className="summary-label">Phiếu thu</div>
                      <div className="summary-value">{safeNumber(selectedStoreDetail?._count?.receipts)}</div>
                    </div>
                    <div className="summary-item">
                      <div className="summary-label">Mã hàng tồn thấp (&lt;=10)</div>
                      <div className="summary-value" style={{ color: lowStockCount > 0 ? "#c92a2a" : "#2b8a3e" }}>{lowStockCount}</div>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Danh sách đã được bổ nhiệm thuộc cửa hàng / kho</label>

                    <div className="table-container" style={{ marginTop: 10 }}>
                      <table className="data-table" style={{ margin: 0 }}>
                        <thead>
                          <tr>
                            <th>Họ tên</th>
                            <th>Email</th>
                            <th>Vị trí</th>
                            <th>Vai trò</th>
                            <th>Ngày gán</th>
                            <th>Đến ngày</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assignedStaff.length === 0 ? (
                            <tr>
                              <td colSpan="6" className="text-center">Chưa có nhân viên nào được bổ nhiệm</td>
                            </tr>
                          ) : (
                            assignedStaff.map((assignment) => (
                              <tr key={assignment.id}>
                                <td>{assignment.user?.fullName || "-"}</td>
                                <td>{assignment.user?.email || "-"}</td>
                                <td><span className="badge">{getOrgRoleLabel(assignment.roleType)}</span></td>
                                <td><span className="badge">{getSystemRolesLabel(assignment.user?.roles)}</span></td>
                                <td>{new Date(assignment.assignedAt).toLocaleDateString("vi-VN")}</td>
                                <td>{assignment.effectiveTo ? new Date(assignment.effectiveTo).toLocaleDateString("vi-VN") : "Đang hiệu lực"}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Top tồn kho theo sản phẩm</label>
                    <div className="table-container">
                      <table className="data-table" style={{ margin: 0 }}>
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>Tên sản phẩm</th>
                            <th className="text-right">Tồn kho</th>
                            <th className="text-right">Đặt trước</th>
                            <th className="text-right">Khả dụng</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inventoryRows.length === 0 ? (
                            <tr>
                              <td colSpan="5" className="text-center">Chưa có dữ liệu tồn kho</td>
                            </tr>
                          ) : (
                            [...inventoryRows]
                              .sort((a, b) => safeNumber(b.quantity) - safeNumber(a.quantity))
                              .slice(0, 10)
                              .map((row) => {
                                const available = row.availableQuantity != null
                                  ? safeNumber(row.availableQuantity)
                                  : safeNumber(row.quantity) - safeNumber(row.reservedQuantity);
                                return (
                                  <tr key={row.id}>
                                    <td className="font-mono">{row.product?.sku || "-"}</td>
                                    <td>{row.product?.name || "-"}</td>
                                    <td className="text-right">{safeNumber(row.quantity)}</td>
                                    <td className="text-right">{safeNumber(row.reservedQuantity)}</td>
                                    <td className="text-right" style={{ color: available <= 10 ? "#c92a2a" : "#2b8a3e" }}>{available}</td>
                                  </tr>
                                );
                              })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
                  );
                })()
              )}
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={handleCloseDetail}>Đóng</button>
            </div>
          </div>
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
              <h2>{editingStore ? "Chỉnh sửa cửa hàng" : "Tạo cửa hàng mới"}</h2>
              <button type="button" className="close-btn" onClick={handleCloseDialog} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body">
              <div className="form-group">
                <label>Mã cửa hàng *</label>
                <input
                  type="text"
                  required
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="VD: CH001"
                />
              </div>

              <div className="form-group">
                <label>Tên cửa hàng *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Nhập tên cửa hàng"
                />
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.isWarehouse}
                    onChange={(e) => setFormData({ ...formData, isWarehouse: e.target.checked })}
                  />
                  Đây là kho hàng
                </label>
              </div>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={handleCloseDialog}>
                Hủy
              </button>
              <button type="submit" className="btn-primary">
                {editingStore ? "Cập nhật" : "Tạo"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}


