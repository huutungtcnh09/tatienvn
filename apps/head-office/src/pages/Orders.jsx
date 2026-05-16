import { useState, useEffect, useMemo } from "react";
import * as api from "../api";
import "../styles/pages.css";
import { formatCurrency } from "../utils/currency";
import { formatDateVN } from "../utils/datetime";

const statusLabels = {
  DRAFT: "Nháp",
  CONFIRMED: "Xác nhận",
  PROCESSING: "Xử lý",
  DELIVERED: "Giao hàng",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Hủy",
  RETURNED: "Trả lại",
  REFUNDED: "Hoàn tiền"
};

const statusTransitions = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "DELIVERED", "CANCELLED"],
  PROCESSING: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  RETURNED: [],
  REFUNDED: []
};

function getCreatorLabel(order) {
  return order?.createdByUser?.fullName || order?.createdByUser?.email || "-";
}

function getOwnerLabel(order) {
  const byPosition = order?.salesOwnerPosition?.name || order?.salesOwnerPosition?.code;
  if (byPosition) return byPosition;
  return order?.salesPerson?.fullName || order?.salesPerson?.email || "-";
}

function getOwnerKey(order) {
  if (order?.salesOwnerPositionId) return `POS:${order.salesOwnerPositionId}`;
  if (order?.salesPersonId) return `USR:${order.salesPersonId}`;
  return "";
}

export default function Orders({ token }) {
  const [orders, setOrders] = useState([]);
  const [partners, setPartners] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCustomerId, setFilterCustomerId] = useState("");
  const [filterStoreId, setFilterStoreId] = useState("");
  const [filterProcessorId, setFilterProcessorId] = useState("");
  const [filterOwnerKey, setFilterOwnerKey] = useState("");
  const todayStr = new Date().toISOString().slice(0, 10);
  const [filterFromDate, setFilterFromDate] = useState(todayStr);
  const [filterToDate, setFilterToDate] = useState(todayStr);
  const [showDialog, setShowDialog] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [statusNote, setStatusNote] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState("");

  useEffect(() => {
    loadData(filterFromDate, filterToDate);
  }, [token]);

  const loadData = async (fromDate, toDate) => {
    try {
      setLoading(true);
      const [ordersRes, partnersRes, storesRes] = await Promise.all([
        api.getOrders(token, { fromDate, toDate }),
        api.getPartners(token),
        api.getStores(token)
      ]);
      setOrders(ordersRes.data || ordersRes);
      setPartners(partnersRes.data || partnersRes || []);
      setStores(storesRes.data || storesRes);
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (order) => {
    setSelectedOrder(order);
    setStatusNote("");
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setSelectedOrder(null);
    setStatusNote("");
  };

  const processorOptions = Array.from(
    new Map(
      orders
        .filter((order) => order.createdByUserId)
        .map((order) => [
          order.createdByUserId,
          order.createdByUser?.fullName || order.createdByUser?.email || order.createdByUserId
        ])
    ).entries()
  ).map(([id, label]) => ({ id, label }));

  const ownerOptions = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      const ownerKey = getOwnerKey(order);
      if (!ownerKey || map.has(ownerKey)) return;
      map.set(ownerKey, getOwnerLabel(order));
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [orders]);

  const customerOptions = Array.from(
    new Map(
      partners
        .filter((partner) => partner.isCustomer)
        .map((partner) => [partner.id, partner.name || partner.id])
    ).entries()
  ).map(([id, label]) => ({ id, label }));

  const filteredOrders = orders.filter(order => {
    const orderRef = (order.orderNo || order.code || order.id || "").toLowerCase();
    const customerName = (order.customer?.name || "").toLowerCase();
    const processorName = (order.createdByUser?.fullName || order.createdByUser?.email || "").toLowerCase();
    const storeName = (order.store?.name || "").toLowerCase();
    const createdAtTime = new Date(order.createdAt).getTime();

    const matchesSearch = 
      !searchTerm ||
      orderRef.includes(searchTerm.toLowerCase()) ||
      customerName.includes(searchTerm.toLowerCase()) ||
      processorName.includes(searchTerm.toLowerCase()) ||
      storeName.includes(searchTerm.toLowerCase());
    
    const matchesStatus = !filterStatus || order.status === filterStatus;
    const matchesCustomer = !filterCustomerId || order.customerId === filterCustomerId;
    const matchesStore = !filterStoreId || order.storeId === filterStoreId;
    const matchesProcessor = !filterProcessorId || order.createdByUserId === filterProcessorId;
    const matchesOwner = !filterOwnerKey || getOwnerKey(order) === filterOwnerKey;

    
    return matchesSearch && matchesStatus && matchesCustomer && matchesStore && matchesProcessor && matchesOwner;
  });

  const totalOrders = filteredOrders.length;
  const totalRevenue = filteredOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
  const totalDebt = filteredOrders.reduce((sum, order) => sum + Number(order.debtAmount || 0), 0);
  const openOrders = filteredOrders.filter((order) => ["DRAFT", "CONFIRMED", "PROCESSING", "DELIVERED"].includes(order.status)).length;
  const completedOrders = filteredOrders.filter((order) => order.status === "COMPLETED").length;

  const topOwnerKpi = useMemo(() => {
    const byOwner = new Map();
    filteredOrders.forEach((order) => {
      const key = getOwnerKey(order) || "unknown";
      const label = getOwnerLabel(order);
      const bucket = byOwner.get(key) || { label, orders: 0, revenue: 0 };
      bucket.orders += 1;
      bucket.revenue += Number(order.totalAmount || 0);
      byOwner.set(key, bucket);
    });

    const rows = Array.from(byOwner.values());
    if (!rows.length) return null;
    return rows.sort((a, b) => b.revenue - a.revenue)[0];
  }, [filteredOrders]);

  const topCreatorKpi = useMemo(() => {
    const byCreator = new Map();
    filteredOrders.forEach((order) => {
      const key = order.createdByUserId || "unknown";
      const label = getCreatorLabel(order);
      const bucket = byCreator.get(key) || { label, orders: 0, revenue: 0 };
      bucket.orders += 1;
      bucket.revenue += Number(order.totalAmount || 0);
      byCreator.set(key, bucket);
    });

    const rows = Array.from(byCreator.values());
    if (!rows.length) return null;
    return rows.sort((a, b) => b.orders - a.orders || b.revenue - a.revenue)[0];
  }, [filteredOrders]);

  const getStatusColor = (status) => {
    const colors = {
      DRAFT: { backgroundColor: "#eef2f7", color: "#344054", borderColor: "#cfd7e3" },
      CONFIRMED: { backgroundColor: "#fff4cc", color: "#8a5b00", borderColor: "#f2d17a" },
      PROCESSING: { backgroundColor: "#dff3ff", color: "#0b5fa8", borderColor: "#8ccbf4" },
      DELIVERED: { backgroundColor: "#e6efff", color: "#2f5cb8", borderColor: "#b8ccff" },
      COMPLETED: { backgroundColor: "#dff7ea", color: "#0f7a45", borderColor: "#97e1ba" },
      CANCELLED: { backgroundColor: "#ffe3e7", color: "#b4232f", borderColor: "#f2a9b1" },
      RETURNED: { backgroundColor: "#ffe9dc", color: "#b54708", borderColor: "#f6c6a8" },
      REFUNDED: { backgroundColor: "#f2eafe", color: "#6f42c1", borderColor: "#d5c2f7" }
    };
    return colors[status] || { backgroundColor: "#eef2f7", color: "#344054", borderColor: "#cfd7e3" };
  };

  const handleStatusUpdate = async (nextStatus) => {
    if (!selectedOrder) return;

    try {
      setUpdatingStatus(nextStatus);
      const res = await api.updateOrderStatus(token, selectedOrder.id, {
        status: nextStatus,
        note: statusNote || undefined
      });
      const updated = res.data || res;
      setOrders((prev) => prev.map((order) => (order.id === updated.id ? updated : order)));
      setSelectedOrder(updated);
      setStatusNote("");
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setUpdatingStatus("");
    }
  };

  const nextStatuses = selectedOrder ? statusTransitions[selectedOrder.status] || [] : [];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Quản lý đơn hàng</h1>
          <p className="stat-text">Theo dõi tất cả đơn hàng theo cửa hàng, khách hàng, nhân viên và trạng thái xử lý</p>
        </div>
      </div>

      <div className="summary-grid" style={{ marginBottom: 20 }}>
        <div className="summary-item">
          <div className="summary-label">Đơn Hàng</div>
          <div className="summary-value">{totalOrders}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Doanh thu lọc</div>
          <div className="summary-value">{formatCurrency(totalRevenue)}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Công nợ còn lại</div>
          <div className="summary-value" style={{ color: "#dc3545" }}>{formatCurrency(totalDebt)}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Đơn đang xử lý</div>
          <div className="summary-value">{openOrders}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Đơn hoàn thành</div>
          <div className="summary-value">{completedOrders}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Top chủ sở hữu theo doanh thu</div>
          <div className="summary-value" style={{ fontSize: "1rem" }}>
            {topOwnerKpi ? `${topOwnerKpi.label} (${formatCurrency(topOwnerKpi.revenue)})` : "-"}
          </div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Top người tạo theo số đơn</div>
          <div className="summary-value" style={{ fontSize: "1rem" }}>
            {topCreatorKpi ? `${topCreatorKpi.label} (${topCreatorKpi.orders} đơn)` : "-"}
          </div>
        </div>
      </div>

      <div className="search-section">
        <input
          type="text"
          placeholder="Tìm mã đơn, khách hàng, cửa hàng hoặc nhân viên xử lý..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="filter-select"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="DRAFT">Nháp</option>
          <option value="CONFIRMED">Xác nhận</option>
          <option value="PROCESSING">Xử lý</option>
          <option value="DELIVERED">Giao hàng</option>
          <option value="COMPLETED">Hoàn thành</option>
          <option value="CANCELLED">Hủy</option>
          <option value="RETURNED">Trả lại</option>
          <option value="REFUNDED">Hoàn tiền</option>
        </select>
        <select
          value={filterStoreId}
          onChange={(e) => setFilterStoreId(e.target.value)}
          className="filter-select"
        >
          <option value="">Tất cả cửa hàng</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>{store.name}</option>
          ))}
        </select>
        <select
          value={filterCustomerId}
          onChange={(e) => setFilterCustomerId(e.target.value)}
          className="filter-select"
        >
          <option value="">Tất cả khách hàng</option>
          {customerOptions.map((customer) => (
            <option key={customer.id} value={customer.id}>{customer.label}</option>
          ))}
        </select>
        <select
          value={filterProcessorId}
          onChange={(e) => setFilterProcessorId(e.target.value)}
          className="filter-select"
        >
          <option value="">Tất cả nhân viên xử lý</option>
          {processorOptions.map((processor) => (
            <option key={processor.id} value={processor.id}>{processor.label}</option>
          ))}
        </select>
        <select
          value={filterOwnerKey}
          onChange={(e) => setFilterOwnerKey(e.target.value)}
          className="filter-select"
        >
          <option value="">Tất cả chủ sở hữu</option>
          {ownerOptions.map((owner) => (
            <option key={owner.id} value={owner.id}>{owner.label}</option>
          ))}
        </select>
        <input
          type="date"
          value={filterFromDate}
          onChange={(e) => { setFilterFromDate(e.target.value); loadData(e.target.value, filterToDate); }}
          className="filter-select"
        />
        <input
          type="date"
          value={filterToDate}
          onChange={(e) => { setFilterToDate(e.target.value); loadData(filterFromDate, e.target.value); }}
          className="filter-select"
        />
      </div>

      {loading ? (
        <p>Đang tải...</p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Cửa hàng</th>
                <th>Khách hàng</th>
                <th>Chủ sở hữu</th>
                <th>Người tạo</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
                <th>Hạn thanh toán</th>
                <th className="text-right">Tổng tiền</th>
                <th className="text-right">Còn nợ</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan="11" className="text-center">Không có dữ liệu</td>
                </tr>
              ) : (
                filteredOrders.map(order => {
                  const createdDate = new Date(order.createdAt);
                  return (
                    <tr key={order.id}>
                      <td className="font-mono">{order.orderNo || order.code || order.id.slice(0, 8)}</td>
                      <td>{order.store?.name || "-"}</td>
                      <td>{order.customer?.name || "-"}</td>
                      <td>{getOwnerLabel(order)}</td>
                      <td>{getCreatorLabel(order)}</td>
                      <td>
                        <span
                          className="status-badge order-status-badge"
                          style={getStatusColor(order.status)}
                        >
                          {statusLabels[order.status] || order.status}
                        </span>
                      </td>
                      <td>{formatDateVN(createdDate)}</td>
                      <td>{formatDateVN(order.dueDate)}</td>
                      <td className="text-right font-mono">
                        {formatCurrency(order.totalAmount)}
                      </td>
                      <td className="text-right font-mono">
                        <span style={{ color: order.debtAmount > 0 ? "#dc3545" : "#28a745" }}>
                          {formatCurrency(order.debtAmount)}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn-small btn-blue"
                          onClick={() => handleOpenDialog(order)}
                        >
                          Chi tiết
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {showDialog && selectedOrder && (
        <div className="dialog-overlay" onClick={handleCloseDialog}>
          <div
            className="dialog-panel dialog-panel--lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-header">
              <h2>Chi tiết đơn hàng</h2>
              <button type="button" className="close-btn" onClick={handleCloseDialog} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body">
              <div className="form-group">
                <label>Mã đơn</label>
                <div className="info-box">{selectedOrder.orderNo || selectedOrder.code || selectedOrder.id.slice(0, 8)}</div>
              </div>

              <div className="form-group">
                <label>Khách hàng</label>
                <div className="info-box">{selectedOrder.customer?.name || "-"}</div>
              </div>

              <div className="form-group">
                <label>Khu vực kinh doanh</label>
                <div className="info-box">{selectedOrder.customer?.businessArea?.name || selectedOrder.customer?.businessAreaId || "-"}</div>
              </div>

              <div className="form-group">
                <label>Chủ sở hữu</label>
                <div className="info-box">{getOwnerLabel(selectedOrder)}</div>
              </div>

              <div className="form-group">
                <label>Người tạo</label>
                <div className="info-box">{getCreatorLabel(selectedOrder)}</div>
              </div>

              <div className="form-group">
                <label>Trạng thái</label>
                <div className="info-box">
                  <span
                    className="status-badge order-status-badge"
                    style={getStatusColor(selectedOrder.status)}
                  >
                    {statusLabels[selectedOrder.status] || selectedOrder.status}
                  </span>
                </div>
              </div>

              {nextStatuses.length > 0 ? (
                <div className="form-group">
                  <label>Ghi chú cập nhật trạng thái</label>
                  <textarea
                    rows="3"
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    placeholder="Ví dụ: Đã xác nhận giao kho, đã bàn giao vận chuyển..."
                  />
                </div>
              ) : null}

              <div className="form-row">
                <div className="form-group">
                  <label>Ngày tạo</label>
                  <div className="info-box">
                    {formatDateVN(selectedOrder.createdAt)}
                  </div>
                </div>

                <div className="form-group">
                  <label>Hạn thanh toán</label>
                  <div className="info-box">
                    {formatDateVN(selectedOrder.dueDate)}
                  </div>
                </div>

                <div className="form-group">
                  <label>Cửa hàng</label>
                  <div className="info-box">{selectedOrder.store?.name || "-"}</div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Tổng tiền</label>
                  <div className="info-box font-mono">
                    {formatCurrency(selectedOrder.totalAmount)}
                  </div>
                </div>

                <div className="form-group">
                  <label>Đã trả</label>
                  <div className="info-box font-mono">
                    {formatCurrency(selectedOrder.paidAmount)}
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Còn nợ</label>
                <div className="info-box font-mono" style={{ color: selectedOrder.debtAmount > 0 ? "#dc3545" : "#28a745" }}>
                    {formatCurrency(selectedOrder.debtAmount)}
                </div>
              </div>

              <div className="form-group">
                <label>Ghi Chú</label>
                <div className="info-box">{selectedOrder.note || "-"}</div>
              </div>

              <div className="form-group">
                <label style={{ marginBottom: "12px", display: "block" }}>Chi tiết sản phẩm</label>
                <div className="table-container">
                  <table className="data-table" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Sản phẩm</th>
                        <th className="text-right">Số lượng</th>
                        <th className="text-right">Đơn giá</th>
                        <th className="text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.items && selectedOrder.items.length > 0 ? (
                        selectedOrder.items.map((item, idx) => (
                          <tr key={idx}>
                            <td>{item.product?.name || "-"}</td>
                            <td className="text-right">{item.quantity}</td>
                            <td className="text-right">{formatCurrency(item.unitPrice)}</td>
                            <td className="text-right">
                              {formatCurrency(item.quantity * item.unitPrice)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4" className="text-center">Không có sản phẩm</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="dialog-footer">
              {nextStatuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  className="btn-primary"
                  disabled={Boolean(updatingStatus)}
                  onClick={() => handleStatusUpdate(status)}
                >
                  {updatingStatus === status ? "Đang cập nhật..." : `Chuyển sang ${statusLabels[status] || status}`}
                </button>
              ))}
              <button type="button" className="btn-cancel" onClick={handleCloseDialog}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



