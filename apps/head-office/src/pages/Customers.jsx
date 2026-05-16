import { useState, useEffect, useCallback } from "react";
import * as api from "../api";
import "../styles/pages.css";
import { formatMoneyInput as formatCurrencyInput, formatCurrency } from "../utils/currency";
import { formatDateTimeVN } from "../utils/datetime";

function parseMoneyInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? String(Number(digits)) : "";
}

function fmtDate(v) {
  return formatDateTimeVN(v);
}

const AGING_LABELS = {
  current: "Hien hanh",
  "1-30": "1 - 30 ngay",
  "31-60": "31 - 60 ngay",
  "61-90": "61 - 90 ngay",
  ">90": "Tren 90 ngay"
};
const AGING_COLORS = {
  current: "#2b8a3e",
  "1-30": "#1971c2",
  "31-60": "#9c6b00",
  "61-90": "#d9480f",
  ">90": "#c92a2a"
};

function buildAgingBucketMap() {
  return {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    ">90": 0
  };
}

function bucketByOverdueDays(days) {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return ">90";
}

function sanitizeAgingPayload(raw) {
  const payload = raw || {};
  const rows = Array.isArray(payload.outstandingDetails) ? payload.outstandingDetails : [];
  const filteredRows = rows.filter((row) => String(row?.status || "").toUpperCase() !== "DRAFT");

  const bucketMap = buildAgingBucketMap();
  filteredRows.forEach((row) => {
    const amount = Number(row?.remainingAmount || 0);
    const overdueDays = Number(row?.overdueDays || 0);
    const bucket = bucketByOverdueDays(overdueDays);
    bucketMap[bucket] += amount;
  });

  const debt = filteredRows.reduce((sum, row) => sum + Number(row?.remainingAmount || 0), 0);
  const aging = Object.entries(bucketMap).map(([bucket, amount]) => ({ bucket, amount }));

  return {
    ...payload,
    debt,
    aging,
    outstandingDetails: filteredRows
  };
}

function flattenBusinessAreas(nodes = [], prefix = "") {
  const result = [];
  nodes.forEach((node) => {
    const label = prefix ? `${prefix} / ${node.name}` : node.name;
    result.push({ id: node.id, label });
    if (Array.isArray(node.children) && node.children.length) {
      result.push(...flattenBusinessAreas(node.children, label));
    }
  });
  return result;
}

const CUSTOMER_PRICE_TIER_LABELS = {
  LEVEL_2: "Cấp 2",
  LEVEL_2_SPECIAL: "Cấp 2 đặc biệt"
};

export default function Customers({ token }) {
  const [partners, setPartners] = useState([]);
  const [positions, setPositions] = useState([]);
  const [stores, setStores] = useState([]);
  const [businessAreas, setBusinessAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterByDebt, setFilterByDebt] = useState(false);
  const [filterPosition, setFilterPosition] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [filterBusinessArea, setFilterBusinessArea] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);

  // Create / Edit dialog
  const [showDialog, setShowDialog] = useState(false);
  const [editingPartner, setEditingPartner] = useState(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    phone: "",
    phone2: "",
    phone3: "",
    email: "",
    address: "",
    ownerStoreId: "",
    accountOwnerPositionId: "",
    customerPriceTier: "",
    businessAreaId: "",
    openingBalance: 0
  });

  // Detail dialog state
  const [showDetail, setShowDetail] = useState(false);
  const [detailPartner, setDetailPartner] = useState(null);
  const [detailTab, setDetailTab] = useState("info");
  const [detailTransactions, setDetailTransactions] = useState(null);
  const [detailAging, setDetailAging] = useState(null);
  const [detailAnalytics, setDetailAnalytics] = useState(null);
  const [detailPriceList, setDetailPriceList] = useState(null);
  const [analyticsPeriod, setAnalyticsPeriod] = useState("month");
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    loadData();
  }, [token, page, debouncedSearch]);

  useEffect(() => {
    loadMeta();
  }, [token]);

  const loadMeta = async () => {
    try {
      const [positionsData, storesData, businessAreasData] = await Promise.all([
        api.getOrgPositions(token, { roleType: "CUSTOMER_SERVICE", isActive: true }),
        api.getStores(token),
        api.getBusinessAreas(token).catch(() => ({ data: [] }))
      ]);
      setPositions(positionsData.data || positionsData || []);
      setStores((storesData.data || storesData || []).filter((store) => !store.isWarehouse));
      setBusinessAreas(flattenBusinessAreas(businessAreasData.data || businessAreasData || []));
    } catch {
      setPositions([]);
      setStores([]);
      setBusinessAreas([]);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const partnersData = await api.getPartners(token, { page, pageSize, search: debouncedSearch || undefined });
      const rows = Array.isArray(partnersData) ? partnersData : (partnersData?.data || []);
      setPartners(rows.filter((p) => p.isCustomer));
      setTotal(Array.isArray(partnersData) ? rows.length : Number(partnersData?.total || 0));
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (partner) => {
    setDetailPartner(partner);
    setDetailTab("info");
    setDetailTransactions(null);
    setDetailAging(null);
    setDetailAnalytics(null);
    setDetailPriceList(null);
    setShowDetail(true);
  };

  const loadDetailTab = useCallback(async (tab, partner) => {
    if (!partner) return;
    setDetailTab(tab);
    if (tab === "info") {
      // Load aging data when info tab is clicked
      if (!detailAging) {
        try {
          const res = await api.getPartnerAging(token, partner.id);
          setDetailAging(sanitizeAgingPayload(res.data || res));
        } catch (e) {
          console.error(`Lỗi tuổi nợ: ${e.message}`);
        }
      }
      // Load price list when info tab is clicked
      if (!detailPriceList) {
        try {
          const res = await api.getPartnerAnalytics(token, partner.id, "month");
          const data = res.data || res;
          setDetailPriceList(data?.priceList || []);
        } catch (e) {
          console.error(`Lỗi lịch sử giá: ${e.message}`);
        }
      }
    }
    if (tab === "transactions" && !detailTransactions) {
      setDetailLoading(true);
      try {
        const res = await api.getPartnerTransactions(token, partner.id);
        setDetailTransactions(res.data || res || []);
      } catch (e) {
        alert(`Lỗi nhật ký: ${e.message}`);
      } finally {
        setDetailLoading(false);
      }
    }
    if (tab === "analytics") {
      setDetailLoading(true);
      try {
        const res = await api.getPartnerAnalytics(token, partner.id, analyticsPeriod);
        const data = res.data || res;
        setDetailAnalytics(data);
        // Trích xuất bảng giá từ analytics
        if (data?.priceList) setDetailPriceList(data.priceList);
      } catch (e) {
        alert(`Lỗi phân tích: ${e.message}`);
      } finally {
        setDetailLoading(false);
      }
    }
  }, [token, detailTransactions, detailAging, analyticsPeriod]);

  const handleOpenDialog = (partner = null) => {
    if (partner) {
      setEditingPartner(partner);
      setFormData({
        code: partner.code,
        name: partner.name,
        phone: partner.phone || "",
        phone2: partner.phone2 || "",
        phone3: partner.phone3 || "",
        email: partner.email || "",
        address: partner.address || "",
        ownerStoreId: partner.ownerStoreId || "",
        accountOwnerPositionId: partner.accountOwnerPositionId || "",
        customerPriceTier: partner.customerPriceTier || "",
        businessAreaId: partner.businessAreaId || "",
        openingBalance: 0
      });
    } else {
      setEditingPartner(null);
      setFormData({
        code: "",
        name: "",
        phone: "",
        phone2: "",
        phone3: "",
        email: "",
        address: "",
        ownerStoreId: "",
        accountOwnerPositionId: "",
        customerPriceTier: "",
        businessAreaId: "",
        openingBalance: 0
      });
    }
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingPartner(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingPartner) {
        const updatePayload = {
          name: formData.name,
          phone: formData.phone || undefined,
          phone2: formData.phone2 || undefined,
          phone3: formData.phone3 || undefined,
          email: formData.email || undefined,
          address: formData.address || undefined,
          ownerStoreId: formData.ownerStoreId || null,
          accountOwnerPositionId: formData.accountOwnerPositionId || null,
          customerPriceTier: formData.customerPriceTier || null,
          businessAreaId: formData.businessAreaId || null
        };
        await api.updatePartner(token, editingPartner.id, updatePayload);
        alert("Cập nhật thành công");
      } else {
        const payload = {
          ...formData,
          isCustomer: true,
          isSupplier: false,
          isCarrier: false,
          ownerStoreId: formData.ownerStoreId || undefined,
          accountOwnerPositionId: formData.accountOwnerPositionId || undefined,
          customerPriceTier: formData.customerPriceTier || undefined,
          businessAreaId: formData.businessAreaId || undefined,
          openingBalance: Number(formData.openingBalance || 0)
        };
        await api.createPartner(token, payload);
        alert("Tạo khách hàng thành công");
      }
      handleCloseDialog();
      loadData();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  const filteredPartners = partners.filter(p => {
    const matchesDebtFilter = !filterByDebt || p.netBalance > 0;
    const matchesPosition = !filterPosition || p.accountOwnerPositionId === filterPosition;
    const matchesStore = !filterStore || p.ownerStoreId === filterStore;
    const matchesTier = !filterTier || p.customerPriceTier === filterTier;
    const matchesBusinessArea = !filterBusinessArea || p.businessAreaId === filterBusinessArea;
    return matchesDebtFilter && matchesPosition && matchesStore && matchesTier && matchesBusinessArea;
  });

  const resetFilters = () => {
    setSearchTerm("");
    setFilterPosition("");
    setFilterStore("");
    setFilterTier("");
    setFilterBusinessArea("");
    setFilterByDebt(false);
    setPage(1);
  };

  const totalDebt = partners.reduce((sum, p) => sum + Math.max(Number(p.netBalance || 0), 0), 0);
  const totalAdvance = partners.reduce((sum, p) => sum + Math.max(-Number(p.netBalance || 0), 0), 0);
  const totalCustomers = total;
  const hasDebtCount = partners.filter(p => Number(p.netBalance) > 0).length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const downloadCustomersCsv = () => {
    const escapeCsv = (value) => {
      const raw = String(value ?? "");
      if (/[",\n]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
      }
      return raw;
    };

    const rows = [...filteredPartners]
      .sort((a, b) => Number(b.netBalance || 0) - Number(a.netBalance || 0))
      .map((partner) => {
        const phoneText = String(partner.phone || "").replace(/"/g, '""');
        const phone2Text = String(partner.phone2 || "").replace(/"/g, '""');
        const phone3Text = String(partner.phone3 || "").replace(/"/g, '""');
        const currentDebt = Number(partner.netBalance || 0);
        const revenue = Number(partner.totalRevenue ?? partner.revenue ?? 0);
        return [
          partner.name || "",
          `="${phoneText}"`,
          `="${phone2Text}"`,
          `="${phone3Text}"`,
          partner.address || "",
          partner.businessArea?.name || "",
          currentDebt,
          revenue
        ];
      });

    const headers = ["Tên khách hàng", "Điện thoại 1", "Điện thoại 2", "Điện thoại 3", "Địa chỉ", "Khu vực kinh doanh", "Nợ hiện tại", "Doanh thu"];
    const csv = "\ufeff" + [
      headers.map(escapeCsv).join(","),
      ...rows.map((row) => row.map(escapeCsv).join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "danh-sach-khach-hang.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Quản lý khách hàng</h1>
          <p className="stat-text">
            {totalCustomers} khách hàng &nbsp;&nbsp; {hasDebtCount} có công nợ &nbsp;&nbsp; Tổng nợ: {formatCurrency(totalDebt)} &nbsp;&nbsp; Dư trả trước: {formatCurrency(totalAdvance)}
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn-cancel" type="button" onClick={downloadCustomersCsv}>
            Xuất file khách hàng
          </button>
          <button className="btn-primary" type="button" onClick={() => handleOpenDialog()}>
            + Thêm khách hàng
          </button>
        </div>
      </div>

      <div className="search-section">
        <input
          type="text"
          placeholder="Tìm mã, tên hoặc SDT..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          className="search-input"
        />
        <select
          className="filter-select"
          value={filterPosition}
          onChange={(e) => setFilterPosition(e.target.value)}
        >
          <option value="">Tất cả vị trí phụ trách</option>
          {positions.map((pos) => (
            <option key={pos.id} value={pos.id}>{pos.code} - {pos.name}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={filterStore}
          onChange={(e) => setFilterStore(e.target.value)}
        >
          <option value="">Tất cả cửa hàng sở hữu</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>{store.code} - {store.name}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={filterTier}
          onChange={(e) => setFilterTier(e.target.value)}
        >
          <option value="">Tất cả loại khách</option>
          <option value="LEVEL_2">Cấp 2</option>
          <option value="LEVEL_2_SPECIAL">Cấp 2 đặc biệt</option>
        </select>
        <select
          className="filter-select"
          value={filterBusinessArea}
          onChange={(e) => setFilterBusinessArea(e.target.value)}
        >
          <option value="">Tất cả khu vực kinh doanh</option>
          {businessAreas.map((area) => (
            <option key={area.id} value={area.id}>{area.label}</option>
          ))}
        </select>
        <label className="filter-checkbox" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={filterByDebt}
            onChange={(e) => setFilterByDebt(e.target.checked)}
          />
          Chỉ hiển thị có nợ
        </label>
        <button className="btn-cancel" type="button" onClick={resetFilters}>Xóa lọc</button>
      </div>

      {loading ? (
        <p>Đang tải...</p>
      ) : (
        <div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên khách hàng</th>
                  <th>Điện thoại 1</th>
                  <th>Điện thoại 2</th>
                  <th>Điện thoại 3</th>
                  <th>Loại KH</th>
                  <th>Khu vực KD</th>
                  <th>Cửa hàng sở hữu</th>
                  <th className="text-right">Công nợ</th>
                  <th>Vị trí phụ trách</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredPartners.length === 0 ? (
                  <tr>
                    <td colSpan="11" className="text-center">Không có dữ liệu</td>
                  </tr>
                ) : (
                  filteredPartners.map(partner => (
                    <tr key={partner.id}>
                      <td>{partner.code}</td>
                      <td>{partner.name}</td>
                      <td>{partner.phone || "-"}</td>
                      <td>{partner.phone2 || "-"}</td>
                      <td>{partner.phone3 || "-"}</td>
                      <td>{CUSTOMER_PRICE_TIER_LABELS[partner.customerPriceTier] || "-"}</td>
                      <td>{partner.businessArea?.name || "-"}</td>
                      <td>{partner.ownerStore?.name || "-"}</td>
                      <td className="text-right" style={{ color: Number(partner.netBalance) > 0 ? "#c92a2a" : undefined }}>
                        {formatCurrency(partner.netBalance || 0)}
                      </td>
                      <td>{partner.accountOwnerPosition?.name || partner.accountOwnerPosition?.code || "-"}</td>
                      <td style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn-small"
                          onClick={() => openDetail(partner)}
                        >
                          Chi tiết
                        </button>
                        <button
                          className="btn-small btn-blue"
                          onClick={() => handleOpenDialog(partner)}
                        >
                          Sửa
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div>Trang {page} / {totalPages} - Tổng {total} khách hàng</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-cancel" type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Trang trước</button>
              <button className="btn-cancel" type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Trang sau</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      {showDetail && detailPartner && (
        <div className="dialog-overlay" onClick={() => setShowDetail(false)}>
          <div className="dialog-panel dialog-panel--lg" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>{detailPartner.name}</h2>
              <button className="close-btn" type="button" onClick={() => setShowDetail(false)} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-tabs">
              {[
                { key: "info", label: "Tổng quan" },
                { key: "transactions", label: "Nhật ký giao dịch" },
                { key: "analytics", label: "Phân tích" }
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => loadDetailTab(tab.key, detailPartner)}
                  className={`dialog-tab-btn${detailTab === tab.key ? " active" : ""}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="dialog-body">
              {detailTab === "info" && (
                <div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
                    <div><strong>Mã:</strong> {detailPartner.code}</div>
                    <div><strong>Tên:</strong> {detailPartner.name}</div>
                    <div><strong>Điện thoại 1:</strong> {detailPartner.phone || "-"}</div>
                    <div><strong>Điện thoại 2:</strong> {detailPartner.phone2 || "-"}</div>
                    <div><strong>Điện thoại 3:</strong> {detailPartner.phone3 || "-"}</div>
                    <div><strong>Email:</strong> {detailPartner.email || "-"}</div>
                    <div><strong>Địa chỉ:</strong> {detailPartner.address || "-"}</div>
                    <div><strong>Loại khách hàng:</strong> {CUSTOMER_PRICE_TIER_LABELS[detailPartner.customerPriceTier] || "-"}</div>
                    <div><strong>Khu vực kinh doanh:</strong> {detailPartner.businessArea?.name || "-"}</div>
                    <div><strong>Cửa hàng sở hữu:</strong> {detailPartner.ownerStore?.name || "-"}</div>
                    <div><strong>Vị trí phụ trách:</strong> {detailPartner.accountOwnerPosition?.name || detailPartner.accountOwnerPosition?.code || "-"}</div>
                    <div><strong>Nhân sự hiện tại:</strong> Theo bổ nhiệm của vị trí phụ trách</div>
                    <div><strong>Số dư đầu kỳ:</strong> {formatCurrency(detailPartner.openingBalance)}</div>
                    <div>
                      <strong>Số dư ròng: </strong>
                      <span style={{ color: Number(detailPartner.netBalance) > 0 ? "#c92a2a" : "#2b8a3e", fontWeight: 700 }}>
                        {formatCurrency(detailPartner.netBalance)}
                      </span>
                    </div>
                    <div>
                      <strong>Thu vt/tr trc: </strong>
                      <span style={{ color: Number(detailPartner.netBalance) < 0 ? "#1971c2" : "#2b8a3e", fontWeight: 700 }}>
                        {formatCurrency(Math.max(-Number(detailPartner.netBalance || 0), 0))}
                      </span>
                    </div>
                  </div>

                  {/* Tuổi nợ section */}
                  <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #dee2e6" }}>
                    <h4 style={{ marginBottom: 12 }}>Tuổi nợ</h4>
                    {!detailAging ? (
                      <button className="btn-primary" onClick={() => loadDetailTab("info", detailPartner)}>
                        Tải dữ liệu tuổi nợ
                      </button>
                    ) : (
                      <>
                        <div style={{ marginBottom: 16 }}>
                          <strong>Tổng công nợ tồn: </strong>
                          <span style={{ color: "#c92a2a", fontWeight: 700 }}>{formatCurrency(detailAging.debt)}</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
                          {(detailAging.aging || []).map(a => (
                            <div key={a.bucket} style={{
                              padding: "10px 16px",
                              borderRadius: 8,
                              border: `1px solid ${AGING_COLORS[a.bucket] || "#dee2e6"}`,
                              minWidth: 130
                            }}>
                              <div style={{ fontSize: "0.78em", color: "#666" }}>{AGING_LABELS[a.bucket] || a.bucket}</div>
                              <div style={{ fontSize: "1.1em", fontWeight: 700, color: AGING_COLORS[a.bucket] || "#333" }}>
                                {formatCurrency(a.amount)}
                              </div>
                            </div>
                          ))}
                        </div>
                        {detailAging.outstandingDetails?.length > 0 && (
                          <>
                            <h5 style={{ marginBottom: 8 }}>Chi tiết công nợ tồn</h5>
                            <div className="table-container" style={{ margin: 0 }}>
                              <table className="data-table">
                                <thead>
                                  <tr>
                                    <th>Ngày phát sinh</th>
                                    <th>Loại</th>
                                    <th>Số CT</th>
                                    <th className="text-right">Gốc</th>
                                    <th className="text-right">Còn lại</th>
                                    <th className="text-right">Số ngày</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detailAging.outstandingDetails.map((d, i) => (
                                    <tr key={i}>
                                      <td>{fmtDate(d.createdAt)}</td>
                                      <td>{d.transactionType}</td>
                                      <td className="font-mono">{d.referenceId}</td>
                                      <td className="text-right font-mono">{formatCurrency(d.originalAmount)}</td>
                                      <td className="text-right font-mono" style={{ color: "#c92a2a" }}>{formatCurrency(d.remainingAmount)}</td>
                                      <td className="text-right">{Number(d.overdueDays || 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>

                  {/* Lịch sử giá section */}
                  <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #dee2e6" }}>
                    <h4 style={{ marginBottom: 12 }}>Lịch sử giá</h4>
                    {!detailPriceList ? (
                      <button className="btn-primary" onClick={() => loadDetailTab("info", detailPartner)}>
                        Tải lịch sử giá
                      </button>
                    ) : detailPriceList.length === 0 ? (
                      <p style={{ color: "#6b7280" }}>Khách hàng chưa có bảng giá riêng.</p>
                    ) : (
                      <div>
                        <p style={{ marginBottom: 12, color: "#6b7280", fontSize: "0.9rem" }}>
                          {detailPriceList.length} sản phẩm có giá riêng
                        </p>
                        {detailPriceList.map((pl) => (
                          <div key={pl.productId} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                              <div>
                                <span className="font-mono" style={{ color: "#6b7280", fontSize: "0.85rem" }}>{pl.productSku}</span>
                                {" "}
                                <strong>{pl.productName}</strong>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>Mặc định: {formatCurrency(pl.defaultPrice)}</span>
                                {" - "}
                                <strong style={{ color: "#1971c2" }}>{formatCurrency(pl.customPrice)}</strong>
                              </div>
                            </div>
                            {pl.history?.length > 0 && (
                              <table className="data-table" style={{ margin: 0, fontSize: "0.85rem" }}>
                                <thead>
                                  <tr>
                                    <th>Thời gian thay đổi</th>
                                    <th className="text-right">Giá cũ</th>
                                    <th className="text-right">Giá mới</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pl.history.map((h, i) => (
                                    <tr key={i}>
                                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(h.changedAt)}</td>
                                      <td className="text-right font-mono" style={{ color: "#c92a2a" }}>{formatCurrency(h.oldPrice)}</td>
                                      <td className="text-right font-mono" style={{ color: "#2b8a3e" }}>{formatCurrency(h.newPrice)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {(!pl.history || pl.history.length === 0) && (
                              <p style={{ color: "#6b7280", margin: 0, fontSize: "0.85rem" }}>Chưa có lịch sử thay đổi.</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
                    <button className="btn-primary" onClick={() => handleOpenDialog(detailPartner)}>
                      Chỉnh Sửa
                    </button>
                  </div>
                </div>
              )}

              {detailTab === "transactions" && (
                detailLoading ? <p>Đang tải nhật ký...</p> :
                !detailTransactions ? <p>Nhấn tab để tải dữ liệu.</p> : (
                  <div className="table-container" style={{ margin: 0 }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Thời gian</th>
                          <th>Loại giao dịch</th>
                          <th>Số chứng từ</th>
                          <th className="text-right">Số tiền</th>
                          <th>Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailTransactions.length === 0 ? (
                          <tr><td colSpan="5" className="text-center">Chưa có giao dịch</td></tr>
                        ) : detailTransactions.map(tx => (
                          <tr key={tx.id}>
                            <td style={{ whiteSpace: "nowrap" }}>{fmtDate(tx.createdAt)}</td>
                            <td>{tx.transactionTypeLabel}</td>
                            <td className="font-mono">{tx.referenceId}</td>
                            <td className="text-right font-mono">{formatCurrency(tx.amount)}</td>
                            <td>{tx.note || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {detailTab === "analytics" && (
                detailLoading ? <p>Đang tải phân tích...</p> :
                !detailAnalytics ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                      <select
                        className="filter-select"
                        value={analyticsPeriod}
                        onChange={(e) => { setAnalyticsPeriod(e.target.value); setDetailAnalytics(null); }}
                      >
                        <option value="month">Theo tháng</option>
                        <option value="quarter">Theo quý</option>
                        <option value="year">Theo năm</option>
                      </select>
                      <button className="btn-primary" onClick={() => loadDetailTab("analytics", detailPartner)}>
                        Tải phân tích
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                      <select
                        className="filter-select"
                        value={analyticsPeriod}
                        onChange={(e) => {
                          setAnalyticsPeriod(e.target.value);
                          setDetailAnalytics(null);
                          setTimeout(() => loadDetailTab("analytics", detailPartner), 0);
                        }}
                      >
                        <option value="month">Theo tháng</option>
                        <option value="quarter">Theo quý</option>
                        <option value="year">Theo năm</option>
                      </select>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
                      {[
                        { label: "Tổng doanh thu", value: formatCurrency(detailAnalytics.summary?.totalRevenue), color: "#1971c2" },
                        { label: "Tổng lợi nhuận", value: formatCurrency(detailAnalytics.summary?.totalProfit), color: "#2b8a3e" },
                        { label: "Tổng đơn hàng", value: detailAnalytics.summary?.totalOrders ?? 0, color: "#6741d9" }
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ padding: "12px 16px", border: `1px solid #dee2e6`, borderTop: `3px solid ${color}`, borderRadius: 8, background: "#fff" }}>
                          <div style={{ fontSize: "0.75em", color: "#666", marginBottom: 4 }}>{label}</div>
                          <div style={{ fontWeight: 700, color }}>{value}</div>
                        </div>
                      ))}
                    </div>

                    {detailAnalytics.byPeriod?.length > 0 && (
                      <div className="table-container" style={{ margin: 0, marginBottom: 16 }}>
                        <table className="data-table" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Kỳ</th>
                              <th className="text-right">Doanh thu</th>
                              <th className="text-right">Lợi nhuận</th>
                              <th className="text-right">Số đơn</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailAnalytics.byPeriod.slice(-12).reverse().map((row) => (
                              <tr key={row.period}>
                                <td>{row.period}</td>
                                <td className="text-right font-mono">{formatCurrency(row.revenue)}</td>
                                <td className="text-right font-mono" style={{ color: row.profit >= 0 ? "#2b8a3e" : "#c92a2a" }}>
                                  {formatCurrency(row.profit)}
                                </td>
                                <td className="text-right">{row.orders}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {detailAnalytics.priceList?.length > 0 && (
                      <>
                        <h4 style={{ margin: "0 0 8px" }}>Bảng giá riêng</h4>
                        <div className="table-container" style={{ margin: 0 }}>
                          <table className="data-table" style={{ margin: 0 }}>
                            <thead>
                              <tr>
                                <th>SKU</th>
                                <th>Sản phẩm</th>
                                <th className="text-right">Giá mặc định</th>
                                <th className="text-right">Giá riêng</th>
                                <th>Cập nhật</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detailAnalytics.priceList.map((pl) => (
                                <tr key={pl.productId}>
                                  <td className="font-mono">{pl.productSku}</td>
                                  <td>{pl.productName}</td>
                                  <td className="text-right font-mono">{formatCurrency(pl.defaultPrice)}</td>
                                  <td className="text-right font-mono" style={{ fontWeight: 600, color: "#1971c2" }}>
                                    {formatCurrency(pl.customPrice)}
                                  </td>
                                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(pl.updatedAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )
              )}


            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      {showDialog && (
        <div className="dialog-overlay" onClick={handleCloseDialog}>
          <form
            className="dialog-panel dialog-panel--md"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <div className="dialog-header">
              <h2>{editingPartner ? "Chỉnh sửa khách hàng" : "Tạo khách hàng mới"}</h2>
              <button type="button" className="close-btn" onClick={handleCloseDialog} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body">
              {!editingPartner && (
                <div className="form-group">
                  <label>Mã khách hàng *</label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="VD: KH001"
                  />
                </div>
              )}

              <div className="form-group">
                <label>Tên khách hàng *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Nhập tên khách hàng"
                />
              </div>

              <div className="form-group">
                <label>Điện thoại 1</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="VD: 0912345678"
                />
              </div>

              <div className="form-group">
                <label>Điện thoại 2</label>
                <input
                  type="tel"
                  value={formData.phone2}
                  onChange={(e) => setFormData({ ...formData, phone2: e.target.value })}
                  placeholder="VD: 0987654321"
                />
              </div>

              <div className="form-group">
                <label>Điện thoại 3</label>
                <input
                  type="tel"
                  value={formData.phone3}
                  onChange={(e) => setFormData({ ...formData, phone3: e.target.value })}
                  placeholder="VD: 0900000000"
                />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="user@example.com"
                />
              </div>

              <div className="form-group">
                <label>Địa chỉ</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Nhập địa chỉ"
                  rows="2"
                />
              </div>

              <div className="form-group">
                <label>Cửa hàng sở hữu *</label>
                <select
                  required
                  value={formData.ownerStoreId}
                  onChange={(e) => setFormData({ ...formData, ownerStoreId: e.target.value })}
                >
                  <option value="">-- Chọn cửa hàng --</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{store.code} - {store.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Vị trí phụ trách</label>
                <select
                  value={formData.accountOwnerPositionId}
                  onChange={(e) => setFormData({ ...formData, accountOwnerPositionId: e.target.value })}
                >
                  <option value="">-- Không gán --</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>{position.code} - {position.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Loại khách hàng (áp dụng giá)</label>
                <select
                  value={formData.customerPriceTier}
                  onChange={(e) => setFormData({ ...formData, customerPriceTier: e.target.value })}
                >
                  <option value="">-- Mặc định (null) --</option>
                  <option value="LEVEL_2">Cấp 2</option>
                  <option value="LEVEL_2_SPECIAL">Cấp 2 đặc biệt</option>
                </select>
              </div>

              <div className="form-group">
                <label>Khu vực kinh doanh</label>
                <select
                  value={formData.businessAreaId}
                  onChange={(e) => setFormData({ ...formData, businessAreaId: e.target.value })}
                >
                  <option value="">-- Không gán --</option>
                  {businessAreas.map((area) => (
                    <option key={area.id} value={area.id}>{area.label}</option>
                  ))}
                </select>
              </div>

              {!editingPartner && (
                <div className="form-group">
                  <label>Số dư nợ đầu kỳ</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    style={{ textAlign: "right" }}
                    value={formatCurrencyInput(formData.openingBalance)}
                    onChange={(e) => setFormData({ ...formData, openingBalance: parseMoneyInput(e.target.value) })}
                    placeholder="0"
                  />
                </div>
              )}
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={handleCloseDialog}>Hủy</button>
              <button type="submit" className="btn-primary">
                {editingPartner ? "Cập nhật" : "Tạo mới"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}






