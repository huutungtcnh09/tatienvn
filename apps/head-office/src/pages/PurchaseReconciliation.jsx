import { useEffect, useMemo, useState } from "react";
import { getPartners, getPurchaseReconciliationReport, getStores } from "../api";
import "../styles/pages.css";
import { formatCurrency } from "../utils/currency";
import { formatDateVN } from "../utils/datetime";
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

function statusLabel(value) {
  if (value === "PAID") return "Đã thanh toán";
  if (value === "PARTIAL") return "Thanh toán một phần";
  if (value === "VOIDED") return "Đã hủy";
  return "Chưa thanh toán";
}

export default function PurchaseReconciliation({ token }) {
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
        const res = await getPurchaseReconciliationReport(token, {
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
      referenceId: row.referenceId,
      documentDate: row.documentDate || "",
      supplierName: row.supplierName,
      storeName: row.storeName || "",
      lineAmount: row.lineAmount,
      rebateAmount: row.rebateAmount,
      payableByFormula: row.payableByFormula,
      payableStored: row.payableStored,
      payableDiff: row.payableDiff,
      paidSettledAmount: row.paidSettledAmount,
      outstandingAmount: row.outstandingAmount,
      status: statusLabel(row.status)
    })),
  [rows]);

  const exportExcel = () => {
    if (!exportRows.length) {
      alert("Không có dữ liệu để xuất Excel");
      return;
    }

    downloadExcelXml({
      fileName: `doi-soat-mua-hang-${new Date().toISOString().slice(0, 10)}`,
      sheetName: "DoiSoatMuaHang",
      columns: [
        { header: "Mã chứng từ", key: "referenceId" },
        { header: "Ngày chứng từ", key: "documentDate" },
        { header: "Nhà cung cấp", key: "supplierName" },
        { header: "Cửa hàng", key: "storeName" },
        { header: "Thành tiền dòng", key: "lineAmount", type: "number" },
        { header: "Chiết khấu NCC", key: "rebateAmount", type: "number" },
        { header: "Phải trả theo CT", key: "payableByFormula", type: "number" },
        { header: "Phải trả lưu DB", key: "payableStored", type: "number" },
        { header: "Chênh lệch", key: "payableDiff", type: "number" },
        { header: "Đã cấn trừ", key: "paidSettledAmount", type: "number" },
        { header: "Còn nợ", key: "outstandingAmount", type: "number" },
        { header: "Trạng thái", key: "status" }
      ],
      rows: exportRows
    });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Đối soát chứng từ mua hàng</h1>
          <p className="stat-text">So sánh công thức giá trị chứng từ với số phải trả lưu hệ thống để kiểm soát sai lệch</p>
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
                <th className="text-right">Thành tiền dòng</th>
                <th className="text-right">Chiết khấu NCC</th>
                <th className="text-right">Phải trả theo CT</th>
                <th className="text-right">Phải trả DB</th>
                <th className="text-right">Chênh lệch</th>
                <th className="text-right">Đã cấn trừ</th>
                <th className="text-right">Còn nợ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-right font-mono">{formatCurrency(totals.lineAmount || 0)}</td>
                <td className="text-right font-mono">{formatCurrency(totals.rebateAmount || 0)}</td>
                <td className="text-right font-mono">{formatCurrency(totals.payableByFormula || 0)}</td>
                <td className="text-right font-mono">{formatCurrency(totals.payableStored || 0)}</td>
                <td className="text-right font-mono" style={{ color: Math.abs(totals.payableDiff || 0) > 0.5 ? "#c92a2a" : "#2b8a3e" }}>{formatCurrency(totals.payableDiff || 0)}</td>
                <td className="text-right font-mono">{formatCurrency(totals.paidSettledAmount || 0)}</td>
                <td className="text-right font-mono" style={{ color: "#c92a2a" }}>{formatCurrency(totals.outstandingAmount || 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {loading ? (
        <p>Đang tải báo cáo đối soát...</p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã chứng từ</th>
                <th>Ngày CT</th>
                <th>Nhà cung cấp</th>
                <th>Cửa hàng</th>
                <th className="text-right">Phải trả CT</th>
                <th className="text-right">Phải trả DB</th>
                <th className="text-right">Chênh lệch</th>
                <th className="text-right">Đã cấn trừ</th>
                <th className="text-right">Còn nợ</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="10" className="text-center">Không có dữ liệu đối soát</td></tr>
              ) : rows.map((row) => (
                <tr key={row.referenceId}>
                  <td className="font-mono">{row.referenceId}</td>
                  <td>{row.documentDate ? formatDateVN(`${row.documentDate}T00:00:00`) : "-"}</td>
                  <td>{row.supplierName}</td>
                  <td>{row.storeName || "-"}</td>
                  <td className="text-right font-mono">{formatCurrency(row.payableByFormula || 0)}</td>
                  <td className="text-right font-mono">{formatCurrency(row.payableStored || 0)}</td>
                  <td className="text-right font-mono" style={{ color: Math.abs(row.payableDiff || 0) > 0.5 ? "#c92a2a" : "#2b8a3e" }}>{formatCurrency(row.payableDiff || 0)}</td>
                  <td className="text-right font-mono">{formatCurrency(row.paidSettledAmount || 0)}</td>
                  <td className="text-right font-mono" style={{ color: (row.outstandingAmount || 0) > 0 ? "#c92a2a" : "#2b8a3e" }}>{formatCurrency(row.outstandingAmount || 0)}</td>
                  <td>{statusLabel(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
