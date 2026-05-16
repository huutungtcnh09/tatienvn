import { useEffect, useMemo, useState } from "react";
import { getPartners, getPurchaseCashFlowReport, getStores } from "../api";
import "../styles/pages.css";
import { formatCurrency } from "../utils/currency";
import { downloadExcelXml } from "../utils/excel";

function toDateInputValue(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(base, delta) {
  const next = new Date(base);
  next.setDate(next.getDate() + delta);
  return next;
}

export default function PurchaseCashFlow({ token }) {
  const [suppliers, setSuppliers] = useState([]);
  const [stores, setStores] = useState([]);
  const [filters, setFilters] = useState({ supplierId: "", storeId: "", fromDate: "", toDate: "" });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);

  const applyQuickRange = (type) => {
    const today = new Date();
    if (type === "today") {
      const value = toDateInputValue(today);
      setFilters((prev) => ({ ...prev, fromDate: value, toDate: value }));
      return;
    }
    if (type === "last7") {
      setFilters((prev) => ({
        ...prev,
        fromDate: toDateInputValue(addDays(today, -6)),
        toDate: toDateInputValue(today)
      }));
      return;
    }
    if (type === "last30") {
      setFilters((prev) => ({
        ...prev,
        fromDate: toDateInputValue(addDays(today, -29)),
        toDate: toDateInputValue(today)
      }));
      return;
    }
    if (type === "thisMonth") {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setFilters((prev) => ({ ...prev, fromDate: toDateInputValue(start), toDate: toDateInputValue(today) }));
      return;
    }
    if (type === "clear") {
      setFilters((prev) => ({ ...prev, fromDate: "", toDate: "" }));
    }
  };

  useEffect(() => {
    const loadMasterData = async () => {
      try {
        const [partnersRes, storesRes] = await Promise.all([getPartners(token), getStores(token)]);
        const allPartners = partnersRes.data || partnersRes || [];
        setSuppliers(allPartners.filter((partner) => partner.isSupplier));
        setStores(storesRes.data || storesRes || []);
      } catch (error) {
        alert(`Lỗi tải danh mục lọc: ${error.message}`);
      }
    };
    loadMasterData();
  }, [token]);

  useEffect(() => {
    const loadReport = async () => {
      try {
        setLoading(true);
        const res = await getPurchaseCashFlowReport(token, {
          supplierId: filters.supplierId || undefined,
          storeId: filters.storeId || undefined,
          fromDate: filters.fromDate || undefined,
          toDate: filters.toDate || undefined
        });
        const payload = res.data || res || {};
        setRows(payload.rows || []);
        setTotals(payload.totals || null);
      } catch (error) {
        alert(`Lỗi tải báo cáo: ${error.message}`);
      } finally {
        setLoading(false);
      }
    };
    loadReport();
  }, [token, filters]);

  const exportRows = useMemo(() =>
    rows.map((row) => ({
      supplierName: row.supplierName,
      purchaseCount: row.purchaseCount,
      goodsAndCostAmount: row.goodsAndCostAmount,
      rebateAmount: row.rebateAmount,
      payableAmount: row.payableAmount,
      paidCashAmount: row.paidCashAmount,
      settledAmount: row.settledAmount,
      outstandingAmount: row.outstandingAmount
    })),
  [rows]);

  const exportExcel = () => {
    if (!exportRows.length) {
      alert("Không có dữ liệu để xuất Excel");
      return;
    }

    downloadExcelXml({
      fileName: `bao-cao-dong-tien-ncc-${new Date().toISOString().slice(0, 10)}`,
      sheetName: "DongTienNCC",
      columns: [
        { header: "Nhà cung cấp", key: "supplierName" },
        { header: "Số chứng từ", key: "purchaseCount", type: "number" },
        { header: "Giá trị hàng + CP", key: "goodsAndCostAmount", type: "number" },
        { header: "Chiết khấu NCC", key: "rebateAmount", type: "number" },
        { header: "Phải trả", key: "payableAmount", type: "number" },
        { header: "Tiền mặt đã trả", key: "paidCashAmount", type: "number" },
        { header: "Đã cấn trừ", key: "settledAmount", type: "number" },
        { header: "Còn nợ", key: "outstandingAmount", type: "number" }
      ],
      rows: exportRows
    });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Báo cáo dòng tiền nhà cung cấp</h1>
          <p className="stat-text">Theo dõi thực chi, cấn trừ công nợ và số dư phải trả theo nhà cung cấp</p>
        </div>
        <button type="button" className="btn-primary" onClick={exportExcel}>
          Xuất Excel
        </button>
      </div>

      <div className="search-section">
        <select className="filter-select" value={filters.supplierId} onChange={(e) => setFilters((prev) => ({ ...prev, supplierId: e.target.value }))}>
          <option value="">Tất cả nhà cung cấp</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
          ))}
        </select>

        <select className="filter-select" value={filters.storeId} onChange={(e) => setFilters((prev) => ({ ...prev, storeId: e.target.value }))}>
          <option value="">Tất cả cửa hàng</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>{store.name}</option>
          ))}
        </select>

        <input type="date" className="filter-select" value={filters.fromDate} onChange={(e) => setFilters((prev) => ({ ...prev, fromDate: e.target.value }))} />
        <input type="date" className="filter-select" value={filters.toDate} onChange={(e) => setFilters((prev) => ({ ...prev, toDate: e.target.value }))} />

        <button type="button" className="btn-small" onClick={() => applyQuickRange("today")}>Hôm nay</button>
        <button type="button" className="btn-small" onClick={() => applyQuickRange("last7")}>7 ngày</button>
        <button type="button" className="btn-small" onClick={() => applyQuickRange("last30")}>30 ngày</button>
        <button type="button" className="btn-small" onClick={() => applyQuickRange("thisMonth")}>Tháng này</button>
        <button type="button" className="btn-small" onClick={() => applyQuickRange("clear")}>Xóa ngày</button>
      </div>

      {totals ? (
        <div className="table-container" style={{ marginBottom: 16 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tổng chứng từ</th>
                <th className="text-right">Giá trị hàng + CP</th>
                <th className="text-right">Chiết khấu NCC</th>
                <th className="text-right">Phải trả</th>
                <th className="text-right">Tiền mặt đã trả</th>
                <th className="text-right">Đã cấn trừ</th>
                <th className="text-right">Còn nợ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{totals.purchaseCount || 0}</td>
                <td className="text-right font-mono">{formatCurrency(totals.goodsAndCostAmount || 0)}</td>
                <td className="text-right font-mono">{formatCurrency(totals.rebateAmount || 0)}</td>
                <td className="text-right font-mono">{formatCurrency(totals.payableAmount || 0)}</td>
                <td className="text-right font-mono">{formatCurrency(totals.paidCashAmount || 0)}</td>
                <td className="text-right font-mono">{formatCurrency(totals.settledAmount || 0)}</td>
                <td className="text-right font-mono" style={{ color: "#c92a2a" }}>{formatCurrency(totals.outstandingAmount || 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {loading ? (
        <p>Đang tải báo cáo dòng tiền...</p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nhà cung cấp</th>
                <th className="text-right">Số chứng từ</th>
                <th className="text-right">Giá trị hàng + CP</th>
                <th className="text-right">Chiết khấu NCC</th>
                <th className="text-right">Phải trả</th>
                <th className="text-right">Tiền mặt đã trả</th>
                <th className="text-right">Đã cấn trừ</th>
                <th className="text-right">Còn nợ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="8" className="text-center">Không có dữ liệu báo cáo</td></tr>
              ) : rows.map((row) => (
                <tr key={row.supplierId}>
                  <td>{row.supplierName}</td>
                  <td className="text-right font-mono">{row.purchaseCount || 0}</td>
                  <td className="text-right font-mono">{formatCurrency(row.goodsAndCostAmount || 0)}</td>
                  <td className="text-right font-mono">{formatCurrency(row.rebateAmount || 0)}</td>
                  <td className="text-right font-mono">{formatCurrency(row.payableAmount || 0)}</td>
                  <td className="text-right font-mono">{formatCurrency(row.paidCashAmount || 0)}</td>
                  <td className="text-right font-mono">{formatCurrency(row.settledAmount || 0)}</td>
                  <td className="text-right font-mono" style={{ color: (row.outstandingAmount || 0) > 0 ? "#c92a2a" : "#2b8a3e" }}>
                    {formatCurrency(row.outstandingAmount || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
