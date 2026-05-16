import { useEffect, useMemo, useState } from "react";
import {
  createPurchase,
  createPurchaseRebate,
  createSupplierPayment,
  deletePurchaseRebate,
  deletePurchaseRebateBatch,
  voidPurchase,
  getPurchaseByReference,
  getLastSupplierPrices,
  getPartners,
  getProducts,
  getPurchases,
  getPurchasesOverview,
  getStores
} from "../api";
import "../styles/pages.css";
import { formatMoneyInput as formatCurrencyInput, formatCurrency } from "../utils/currency";
import { formatDateTimeVN, formatDateVN } from "../utils/datetime";

const statusOptions = [
  { value: "ALL", label: "Tất cả trạng thái" },
  { value: "UNPAID", label: "Chưa thanh toán" },
  { value: "PARTIAL", label: "Thanh toán một phần" },
  { value: "PAID", label: "Đã thanh toán" },
  { value: "VOIDED", label: "Đã hủy" }
];

const statusStyle = {
  UNPAID: { backgroundColor: "#ffe3e3", color: "#c92a2a" },
  PARTIAL: { backgroundColor: "#fff3bf", color: "#9c6b00" },
  PAID: { backgroundColor: "#d3f9d8", color: "#2b8a3e" },
  VOIDED: { backgroundColor: "#f1f3f5", color: "#868e96", textDecoration: "line-through" }
};

function parseMoneyInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? String(Number(digits)) : "";
}


function fmtDateTime(value) {
  return formatDateTimeVN(value);
}

function buildInitialPurchase(suppliers) {
  return {
    supplierId: suppliers[0]?.id || "",
    storeId: "",
    useItems: false,
    amount: 0,
    paidAmount: 0,
    invoiceNo: "",
    note: ""
  };
}

function roundMoney2(n) {
  return Math.round((Number(n) + 1e-10) * 100) / 100;
}

const REBATE_BATCH_LINK_PREFIX = "[REBATE_BATCH_REF:";
const REBATE_PAYABLE_ONLY_TAG = "[REBATE_PAYABLE_ONLY]";

function appendBatchReferenceToNote(note, batchReferenceId) {
  const baseNote = String(note || "").trim();
  const linkTag = `${REBATE_BATCH_LINK_PREFIX}${batchReferenceId}]`;
  return baseNote ? `${baseNote}\n${linkTag}\n${REBATE_PAYABLE_ONLY_TAG}` : `${linkTag}\n${REBATE_PAYABLE_ONLY_TAG}`;
}

function extractBatchReferenceFromNote(note) {
  const text = String(note || "");
  const regex = /\[REBATE_BATCH_REF:([^\]]+)\]/;
  const match = text.match(regex);
  return match?.[1]?.trim() || "";
}

function isBatchDeleteNotFoundError(error) {
  const message = String(error?.message || "");
  return message.includes("Không tìm thấy chứng từ rebate tổng")
    || message.includes("Failed to delete purchase rebate batch");
}

export default function Purchases({ token, onNavigate }) {
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [overview, setOverview] = useState(null);
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [createItems, setCreateItems] = useState([{ productId: "", quantity: 1, unitCost: 0 }]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState(null);
  const [purchaseDetail, setPurchaseDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showVoid, setShowVoid] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidLoading, setVoidLoading] = useState(false);

  const [showRebateDialog, setShowRebateDialog] = useState(false);
  const [rebateSaving, setRebateSaving] = useState(false);
  const [rebateCandidatesLoading, setRebateCandidatesLoading] = useState(false);
  const [rebateCandidates, setRebateCandidates] = useState([]);
  const [rebateSubmitResult, setRebateSubmitResult] = useState(null);
  const [rebateDateFilter, setRebateDateFilter] = useState("ALL");
  const initRebateForm = () => ({
    label: "Chiết khấu thương mại",
    amount: 0,
    note: "",
    selectedReferenceIds: []
  });
  const [rebateForm, setRebateForm] = useState(initRebateForm);

  const [createForm, setCreateForm] = useState(buildInitialPurchase([]));
  const [payForm, setPayForm] = useState({ amount: 0, note: "" });

  const canCreate = useMemo(() => {
    if (!createForm.supplierId) return false;
    if (createForm.useItems) {
      return createItems.some((it) => it.productId && Number(it.quantity) > 0);
    }
    return Number(createForm.amount) > 0;
  }, [createForm, createItems]);

  const createItemsBaseTotal = useMemo(() =>
    roundMoney2(createItems.reduce((s, it) => s + Number(it.quantity) * Number(it.unitCost), 0)),
    [createItems]);

  const createComputedTotal = useMemo(() =>
    createForm.useItems
      ? roundMoney2(Math.max(createItemsBaseTotal, 0))
      : Number(createForm.amount || 0),
    [createForm, createItemsBaseTotal]);

  const paySettledAmount = useMemo(
    () => Number(payForm.amount || 0),
    [payForm]
  );

  const canPay = useMemo(
    () => selectedPurchase && paySettledAmount > 0 && paySettledAmount <= Number(selectedPurchase.debtAmount),
    [paySettledAmount, selectedPurchase]
  );

  useEffect(() => {
    loadAll();
  }, [token]);

  const [storeFilter, setStoreFilter] = useState("");

  useEffect(() => {
    loadPurchases();
  }, [search, status, supplierFilter, storeFilter, fromDate, toDate]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [partnersRes, overviewRes, storesRes, productsRes] = await Promise.all([
        getPartners(token),
        getPurchasesOverview(token),
        getStores(token),
        getProducts(token)
      ]);

      const allPartners = partnersRes.data || partnersRes || [];
      const supplierRows = allPartners.filter((p) => p.isSupplier);

      setSuppliers(supplierRows);
      setStores(storesRes.data || storesRes || []);
      setProducts(productsRes.data || productsRes || []);
      setCreateForm(buildInitialPurchase(supplierRows));
      setOverview(overviewRes.data || overviewRes);

      await loadPurchases();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadPurchases = async () => {
    try {
      const res = await getPurchases(token, {
        supplierId: supplierFilter || undefined,
        storeId: storeFilter || undefined,
        status,
        search,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined
      });
      setRows(res.data || res || []);
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  const handleCreateItemProductChange = async (idx, productId) => {
    let unitCost = 0;
    if (productId && createForm.supplierId) {
      try {
        const prices = await getLastSupplierPrices(token, createForm.supplierId, [productId]);
        if (prices && prices[productId] != null) {
          unitCost = prices[productId];
        }
      } catch {
        // fallback to 0
      }
    }
    setCreateItems((prev) => prev.map((x, i) => i === idx ? { ...x, productId, unitCost } : x));
  };

  const submitCreate = async () => {
    if (!canCreate) return;
    try {
      const payload = {
        supplierId: createForm.supplierId,
        paidAmount: Number(createForm.paidAmount || 0),
        invoiceNo: createForm.invoiceNo || undefined,
        note: createForm.note || undefined,
        storeId: createForm.storeId || undefined
      };
      if (createForm.useItems) {
        const validItems = createItems.filter((it) => it.productId && Number(it.quantity) > 0);
        if (!validItems.length) { alert("Vui lòng thêm ít nhất 1 sản phẩm"); return; }
        payload.items = validItems.map((it) => ({
          productId: it.productId,
          quantity: Number(it.quantity),
          unitCost: Number(it.unitCost)
        }));
      } else {
        payload.amount = Number(createForm.amount);
      }
      await createPurchase(token, payload);
      setShowCreate(false);
      setCreateForm(buildInitialPurchase(suppliers));
      setCreateItems([{ productId: "", quantity: 1, unitCost: 0 }]);
      await loadAll();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  const openPayDialog = (purchase) => {
    setSelectedPurchase(purchase);
    setPayForm({ amount: Number(purchase.debtAmount || 0), note: "" });
    setShowPay(true);
  };

  const openDetailDialog = async (referenceId) => {
    try {
      setDetailLoading(true);
      setShowDetail(true);
      const res = await getPurchaseByReference(token, referenceId);
      const detail = res.data || res;
      setPurchaseDetail(detail);
    } catch (error) {
      setShowDetail(false);
      alert(`Lỗi: ${error.message}`);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetailDialog = () => {
    setShowDetail(false);
    setPurchaseDetail(null);
  };

  const loadRebateCandidates = async (supplierId, fallbackDoc = null) => {
    if (!supplierId) {
      setRebateCandidates([]);
      return;
    }
    setRebateCandidatesLoading(true);
    try {
      const res = await getPurchases(token, {
        supplierId,
        status: "ALL"
      });
      const list = (res.data || res || [])
        .filter((row) => row.status !== "VOIDED")
        .filter((row) => !row.hasBatchRebate || row.referenceId === fallbackDoc?.referenceId)
        .map((row) => ({
          referenceId: row.referenceId,
          amount: Number(row.amount || 0),
          debtAmount: Number(row.debtAmount || 0),
          hasBatchRebate: Boolean(row.hasBatchRebate),
          documentDate: row.documentDate || null,
          createdAt: row.createdAt || null
        }))
        .sort((a, b) => {
          const da = a.documentDate ? new Date(a.documentDate + "T00:00:00") : new Date(a.createdAt || 0);
          const db = b.documentDate ? new Date(b.documentDate + "T00:00:00") : new Date(b.createdAt || 0);
          return db - da;
        });

      if (fallbackDoc?.referenceId && !list.some((row) => row.referenceId === fallbackDoc.referenceId)) {
        list.unshift({
          referenceId: fallbackDoc.referenceId,
          amount: Number(fallbackDoc.amount || 0),
          debtAmount: Number(fallbackDoc.debtAmount || 0),
          hasBatchRebate: Boolean(fallbackDoc.hasBatchRebate),
          documentDate: fallbackDoc.documentDate || null,
          createdAt: fallbackDoc.createdAt || null
        });
      }
      setRebateCandidates(list);
    } catch (error) {
      if (fallbackDoc?.referenceId) {
        setRebateCandidates([{
          referenceId: fallbackDoc.referenceId,
          amount: Number(fallbackDoc.amount || 0),
          debtAmount: Number(fallbackDoc.debtAmount || 0),
          hasBatchRebate: Boolean(fallbackDoc.hasBatchRebate)
        }]);
      } else {
        setRebateCandidates([]);
      }
      alert(`Không tải được danh sách chứng từ để phân bổ: ${error.message}`);
    } finally {
      setRebateCandidatesLoading(false);
    }
  };

  const openRebateFromDetail = async () => {
    if (!purchaseDetail?.referenceId || !purchaseDetail?.supplierId) return;
    await loadRebateCandidates(purchaseDetail.supplierId, {
      referenceId: purchaseDetail.referenceId,
      amount: Number(purchaseDetail.amount || 0),
      debtAmount: Number(purchaseDetail.debtAmount || 0),
      hasBatchRebate: Array.isArray(purchaseDetail.rebates)
        ? purchaseDetail.rebates.some((rebate) => Boolean(rebate.rebateBatchReferenceId))
        : false
    });
    setRebateForm({
      ...initRebateForm(),
      selectedReferenceIds: [purchaseDetail.referenceId]
    });
    setRebateSubmitResult(null);
    setRebateDateFilter("ALL");
    setShowRebateDialog(true);
  };

  const filteredRebateCandidates = useMemo(() => {
    if (rebateDateFilter === "ALL") return rebateCandidates;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    let from, to;
    if (rebateDateFilter === "TODAY") {
      from = new Date(y, m, now.getDate());
      to = new Date(y, m, now.getDate(), 23, 59, 59);
    } else if (rebateDateFilter === "THIS_MONTH") {
      from = new Date(y, m, 1);
      to = new Date(y, m + 1, 0, 23, 59, 59);
    } else if (rebateDateFilter === "LAST_MONTH") {
      from = new Date(y, m - 1, 1);
      to = new Date(y, m, 0, 23, 59, 59);
    } else if (rebateDateFilter === "THIS_QUARTER") {
      const q = Math.floor(m / 3);
      from = new Date(y, q * 3, 1);
      to = new Date(y, q * 3 + 3, 0, 23, 59, 59);
    } else if (rebateDateFilter === "THIS_YEAR") {
      from = new Date(y, 0, 1);
      to = new Date(y, 11, 31, 23, 59, 59);
    } else {
      return rebateCandidates;
    }
    return rebateCandidates.filter((doc) => {
      const d = doc.documentDate ? new Date(doc.documentDate + "T00:00:00") : new Date(doc.createdAt || 0);
      return d >= from && d <= to;
    });
  }, [rebateCandidates, rebateDateFilter]);

  const selectedRebateDocs = useMemo(() => {
    const selectedIds = new Set(rebateForm.selectedReferenceIds || []);
    return rebateCandidates.filter((doc) => selectedIds.has(doc.referenceId));
  }, [rebateCandidates, rebateForm.selectedReferenceIds]);

  const toggleRebateReference = (referenceId) => {
    setRebateForm((prev) => {
      const nextSet = new Set(prev.selectedReferenceIds || []);
      if (nextSet.has(referenceId)) {
        nextSet.delete(referenceId);
      } else {
        nextSet.add(referenceId);
      }
      return {
        ...prev,
        selectedReferenceIds: Array.from(nextSet)
      };
    });
  };

  const submitRebate = async () => {
    if (!purchaseDetail?.supplierId) { alert("Không tìm thấy nhà cung cấp của chứng từ"); return; }
    if (Number(rebateForm.amount) <= 0) { alert("Số tiền chiết khấu phải lớn hơn 0"); return; }
    if (!selectedRebateDocs.length) { alert("Vui lòng chọn ít nhất một chứng từ để phân bổ"); return; }
    if (rebateSaving) return;

    try {
      setRebateSaving(true);
      setRebateSubmitResult(null);
      const createResult = await createPurchaseRebate(token, purchaseDetail.referenceId, {
        supplierId: purchaseDetail.supplierId,
        label: rebateForm.label.trim() || "Chiết khấu thương mại",
        amount: Number(rebateForm.amount || 0),
        note: rebateForm.note.trim() || undefined,
        referenceIds: selectedRebateDocs.map((doc) => doc.referenceId)
      });

      setRebateSubmitResult({
        referenceId: String(createResult?.data?.referenceId || createResult?.referenceId || purchaseDetail.referenceId),
        targetCount: Number(createResult?.data?.targetCount || createResult?.targetCount || selectedRebateDocs.length),
        totalAmount: Number(rebateForm.amount || 0),
        cogsAdjustmentAmount: Number(createResult?.data?.cogsAdjustmentAmount || createResult?.cogsAdjustmentAmount || 0),
        inventoryAdjustmentAmount: Number(createResult?.data?.inventoryAdjustmentAmount || createResult?.inventoryAdjustmentAmount || 0)
      });
      const detailRes = await getPurchaseByReference(token, purchaseDetail.referenceId);
      setPurchaseDetail(detailRes.data || detailRes);
      setRebateForm({
        ...initRebateForm(),
        selectedReferenceIds: [purchaseDetail.referenceId]
      });
      await loadPurchases();
    } catch (error) {
      alert(`Ghi nhận chiết khấu thất bại: ${error.message}`);
    } finally {
      setRebateSaving(false);
    }
  };

  const removeRebate = async (rebate) => {
    if (!purchaseDetail?.referenceId) return;
    const linkedBatchReferenceId = extractBatchReferenceFromNote(rebate.note);
    const deleteLabel = rebate.rebateBatchReferenceId
      ? `chứng từ rebate tổng ${rebate.rebateBatchReferenceId}`
      : `chiết khấu ${rebate.label || "chiết khấu thương mại"}`;
    if (!window.confirm(`Xóa ${deleteLabel}? Thao tác này không thể hoàn tác.`)) return;
    try {
      if (rebate.rebateBatchReferenceId) {
        await deletePurchaseRebateBatch(token, rebate.rebateBatchReferenceId, { supplierId: purchaseDetail.supplierId });
      } else {
        if (linkedBatchReferenceId) {
          try {
            await deletePurchaseRebateBatch(token, linkedBatchReferenceId, { supplierId: purchaseDetail.supplierId });
          } catch (error) {
            if (!isBatchDeleteNotFoundError(error)) throw error;
          }
        }
        await deletePurchaseRebate(token, purchaseDetail.referenceId, rebate.index, { supplierId: purchaseDetail.supplierId });
      }
      const detailRes = await getPurchaseByReference(token, purchaseDetail.referenceId);
      setPurchaseDetail(detailRes.data || detailRes);
      await loadPurchases();
      alert(rebate.rebateBatchReferenceId
        ? "Đã xóa chứng từ rebate tổng và rollback các PO liên quan"
        : "Đã xóa chiết khấu khỏi chứng từ mua hàng");
    } catch (error) {
      alert(`Xóa chiết khấu thất bại: ${error.message}`);
    }
  };

  const purchaseRebates = Array.isArray(purchaseDetail?.rebates)
    ? purchaseDetail.rebates.map((rebate, index) => ({ ...rebate, index }))
    : [];

  const openVoidDialog = (purchase) => {
    setVoidTarget(purchase);
    setVoidReason("");
    setShowVoid(true);
  };

  const submitVoid = async () => {
    if (!voidTarget || voidReason.trim().length < 3) return;
    try {
      setVoidLoading(true);
      await voidPurchase(token, voidTarget.referenceId, {
        supplierId: voidTarget.supplierId,
        reason: voidReason.trim()
      });
      setShowVoid(false);
      setVoidTarget(null);
      setVoidReason("");
      if (showDetail) {
        setShowDetail(false);
        setPurchaseDetail(null);
      }
      await loadAll();
    } catch (error) {
      alert(`Lỗi hủy chứng từ: ${error.message}`);
    } finally {
      setVoidLoading(false);
    }
  };

  const submitPay = async () => {
    if (!selectedPurchase || !canPay) return;

    try {
      await createSupplierPayment(token, selectedPurchase.referenceId, {
        supplierId: selectedPurchase.supplierId,
        amount: Number(payForm.amount),
        note: payForm.note || undefined
      });
      setShowPay(false);
      setSelectedPurchase(null);
      setPayForm({ amount: 0, note: "" });
      await loadAll();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Quản lý mua hàng</h1>
          <p className="stat-text">
            Theo dõi chứng từ mua hàng và thanh toán nhà cung cấp
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn-primary" onClick={() => { setCreateForm(buildInitialPurchase(suppliers)); setCreateItems([{ productId: "", quantity: 1, unitCost: 0 }]); setShowCreate(true); }}>
            + Tạo chứng từ mua hàng
          </button>
        </div>
      </div>

      <div className="search-section">
        <input
          className="search-input"
          placeholder="Tìm theo mã chứng từ, nhà cung cấp, ghi chú..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          className="filter-select"
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
        >
          <option value="">Tất cả nhà cung cấp</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>

        <select
          className="filter-select"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
        >
          <option value="">Tất cả cửa hàng</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <select
          className="filter-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <input
          type="date"
          className="filter-select"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />

        <input
          type="date"
          className="filter-select"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
      </div>

      {overview ? (
        <div className="table-container" style={{ marginBottom: 20 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tổng chứng từ</th>
                <th className="text-right">Tổng giá trị mua</th>
                <th className="text-right">Tiền đã trả</th>
                <th className="text-right">Đã cấn trừ nợ</th>
                <th className="text-right">Công nợ NCC</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{overview.totalPurchases || 0}</td>
                <td className="text-right font-mono">{formatCurrency(overview.totalAmount)}</td>
                <td className="text-right font-mono">{formatCurrency(overview.totalPaidCash || 0)}</td>
                <td className="text-right font-mono">{formatCurrency(overview.totalPaid)}</td>
                <td className="text-right font-mono" style={{ color: "#c92a2a" }}>
                  {formatCurrency(overview.totalDebt)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {loading ? (
        <p>Đang tải dữ liệu mua hàng...</p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã chứng từ</th>
                <th>Nhà cung cấp</th>
                <th>Ngày tạo</th>
                <th className="text-right">Gi tr</th>
                <th className="text-right">Tiền trả</th>
                <th className="text-right">Da Can Tru</th>
                <th className="text-right">Còn nợ</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center">Không có chứng từ mua hàng</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-mono">{row.referenceId}</td>
                    <td>{row.supplierName}</td>
                    <td>{formatDateVN(row.createdAt)}</td>
                    <td className="text-right font-mono">{formatCurrency(row.amount)}</td>
                    <td className="text-right font-mono">{formatCurrency(row.paidCashAmount ?? row.paidAmount)}</td>
                    <td className="text-right font-mono">{formatCurrency(row.paidAmount)}</td>
                    <td className="text-right font-mono" style={{ color: row.debtAmount > 0 ? "#c92a2a" : "#2b8a3e" }}>
                      {formatCurrency(row.debtAmount)}
                    </td>
                    <td>
                      <span className="status-badge" style={statusStyle[row.status] || statusStyle.UNPAID}>
                        {row.status === "PAID" ? "Đã thanh toán" : row.status === "PARTIAL" ? "Thanh toán một phần" : row.status === "VOIDED" ? "Đã hủy" : "Chưa thanh toán"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn-small"
                        style={{ marginRight: 6 }}
                        onClick={() => openDetailDialog(row.referenceId)}
                      >
                        Chi tiết
                      </button>
                      {row.status !== "VOIDED" ? (
                        <>
                          <button
                            className="btn-small btn-blue"
                            style={{ marginRight: 6 }}
                            disabled={row.debtAmount <= 0}
                            onClick={() => openPayDialog(row)}
                          >
                            Thanh toán
                          </button>
                          <button
                            className="btn-small"
                            style={{ background: "#ffe3e3", color: "#c92a2a" }}
                            onClick={() => openVoidDialog(row)}
                          >
                            Hủy
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate ? (
        <div className="dialog-overlay" onClick={() => setShowCreate(false)}>
          <div className="dialog-panel dialog-panel--md" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Tạo chứng từ mua hàng</h2>
              <button className="close-btn" type="button" onClick={() => setShowCreate(false)} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body">
              <div className="form-group">
                <label>Nhà cung cấp *</label>
                <select
                  value={createForm.supplierId}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, supplierId: e.target.value }))}
                >
                  <option value="">Chọn nhà cung cấp</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Cửa hàng nhận hàng</label>
                  <select
                    value={createForm.storeId}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, storeId: e.target.value }))}
                  >
                    <option value="">-- Chọn cửa hàng --</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Số chứng từ / hóa đơn NCC (tùy chọn)</label>
                  <input
                    type="text"
                    value={createForm.invoiceNo}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, invoiceNo: e.target.value }))}
                    placeholder="VD: INV-2026-0001"
                  />
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={createForm.useItems}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, useItems: e.target.checked }))}
                  />
                  Nhập chi tiết sản phẩm (tự tính tổng tiền)
                </label>
              </div>

              {!createForm.useItems ? (
                <div className="form-row">
                  <div className="form-group">
                    <label>Tổng giá trị mua *</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      style={{ textAlign: "right" }}
                      value={formatCurrencyInput(createForm.amount)}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, amount: parseMoneyInput(e.target.value) }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Thanh toán ngay</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      style={{ textAlign: "right" }}
                      value={formatCurrencyInput(createForm.paidAmount)}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, paidAmount: parseMoneyInput(e.target.value) }))}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="table-container" style={{ margin: 0 }}>
                    <table className="data-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Sản phẩm</th>
                          <th>Số lượng</th>
                          <th>Đơn giá</th>
                          <th className="text-right">Thành tiền</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {createItems.map((it, idx) => {
                          const lineAmt = roundMoney2(Number(it.quantity) * Number(it.unitCost));
                          return (
                            <tr key={idx}>
                              <td>
                                <select
                                  value={it.productId}
                                  onChange={(e) => handleCreateItemProductChange(idx, e.target.value)}
                                  style={{ width: "100%", minWidth: 150 }}
                                >
                                  <option value="">-- Sản phẩm --</option>
                                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                              </td>
                              <td>
                                <input type="number" min="1" value={it.quantity} style={{ width: 70 }}
                                  onChange={(e) => setCreateItems((prev) => prev.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} />
                              </td>
                              <td>
                                <input type="text" inputMode="numeric" placeholder="0" value={formatCurrencyInput(it.unitCost)} style={{ width: 100, textAlign: "right" }}
                                  onChange={(e) => setCreateItems((prev) => prev.map((x, i) => i === idx ? { ...x, unitCost: parseMoneyInput(e.target.value) } : x))} />
                              </td>
                              <td className="text-right font-mono">{formatCurrency(lineAmt)}</td>
                              <td>
                                {createItems.length > 1 && (
                                  <button type="button" className="btn-small" style={{ background: "#ffe3e3", color: "#c92a2a" }}
                                    onClick={() => setCreateItems((prev) => prev.filter((_, i) => i !== idx))}>
                                    Xóa
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    className="btn-small"
                    style={{ marginTop: 8 }}
                    onClick={() => setCreateItems((prev) => [...prev, { productId: "", quantity: 1, unitCost: 0 }])}
                  >
                    + Thêm dòng
                  </button>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Tổng tiền (tự tính)</label>
                      <div className="info-box font-mono" style={{ fontWeight: 600, color: "#1971c2" }}>{formatCurrency(createComputedTotal)}</div>
                    </div>
                    <div className="form-group">
                      <label>Thanh toán ngay</label>
                      <input type="text" inputMode="numeric" placeholder="0" style={{ textAlign: "right" }} value={formatCurrencyInput(createForm.paidAmount)}
                        onChange={(e) => setCreateForm((prev) => ({ ...prev, paidAmount: parseMoneyInput(e.target.value) }))} />
                    </div>
                  </div>
                </>
              )}

              <div className="form-group">
                <label>Ghi chú</label>
                <textarea
                  rows="3"
                  value={createForm.note}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, note: e.target.value }))}
                />
              </div>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowCreate(false)}>
                Hủy
              </button>
              <button type="button" className="btn-primary" disabled={!canCreate} onClick={submitCreate}>
                Tạo chứng từ
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDetail ? (
        <div className="dialog-overlay" onClick={closeDetailDialog}>
          <div className="dialog-panel dialog-panel--xl" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Chi tiết chứng từ mua hàng</h2>
              <button className="close-btn" type="button" onClick={closeDetailDialog} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body">
              {detailLoading || !purchaseDetail ? (
                <p>Đang tải chi tiết chứng từ...</p>
              ) : (
                <>
                  <div style={{ border: "1px solid #e9ecef", borderRadius: 8, padding: "12px 14px", marginBottom: 12, background: "#fff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 340px)", columnGap: 18, rowGap: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 8, columnGap: 12, alignItems: "center", fontSize: 13 }}>
                        <div style={{ color: "#6b7280" }}>Mã chứng từ</div>
                        <div style={{ fontFamily: "monospace", fontWeight: 600 }}>{purchaseDetail.referenceId}</div>

                        <div style={{ color: "#6b7280" }}>Trạng thái</div>
                        <div>
                          <span className="status-badge" style={statusStyle[purchaseDetail.status] || statusStyle.UNPAID}>
                            {purchaseDetail.status === "PAID"
                              ? "Đã thanh toán"
                              : purchaseDetail.status === "PARTIAL"
                                ? "Thanh toán một phần"
                                : purchaseDetail.status === "VOIDED"
                                  ? "Đã hủy"
                                  : "Chưa thanh toán"}
                          </span>
                        </div>

                        <div style={{ color: "#6b7280" }}>Nhà cung cấp</div>
                        <div>{purchaseDetail.supplierName}</div>

                        <div style={{ color: "#6b7280" }}>Ngày chứng từ</div>
                        <div>
                          {purchaseDetail.documentDate
                            ? formatDateVN(`${purchaseDetail.documentDate}T00:00:00`)
                            : "-"}
                        </div>

                        <div style={{ color: "#6b7280" }}>Ngày tạo</div>
                        <div>{formatDateVN(purchaseDetail.createdAt)}</div>

                        {purchaseDetail.note ? (
                          <>
                            <div style={{ color: "#6b7280", alignSelf: "start" }}>Ghi chú</div>
                            <div style={{ lineHeight: 1.5 }}>{purchaseDetail.note}</div>
                          </>
                        ) : null}
                      </div>

                      <div style={{ borderLeft: "1px dashed #e9ecef", paddingLeft: 14, display: "grid", rowGap: 8, alignContent: "start" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", columnGap: 8, alignItems: "center", fontSize: 13 }}>
                          <span style={{ color: "#6b7280" }}>Tổng giá trị</span>
                          <span className="font-mono" style={{ color: "#1e40af", fontWeight: 700 }}>{formatCurrency(purchaseDetail.amount)}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", columnGap: 8, alignItems: "center", fontSize: 13 }}>
                          <span style={{ color: "#6b7280" }}>Còn nợ NCC</span>
                          <span className="font-mono" style={{ color: purchaseDetail.debtAmount > 0 ? "#c92a2a" : "#2b8a3e", fontWeight: 700 }}>{formatCurrency(purchaseDetail.debtAmount)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {purchaseDetail.voidedAt ? (
                    <div
                      style={{
                        background: "#f1f3f5",
                        border: "1px solid #dee2e6",
                        borderRadius: 6,
                        padding: "12px 16px",
                        marginBottom: 12
                      }}
                    >
                      <div style={{ color: "#495057", fontSize: 13, marginBottom: 4 }}>
                        <strong style={{ color: "#c92a2a" }}>Đã hủy</strong>
                        {" "}- {fmtDateTime(purchaseDetail.voidedAt)}
                      </div>
                      {purchaseDetail.voidReason ? (
                        <div style={{ color: "#495057", fontSize: 14 }}>Lý do: {purchaseDetail.voidReason}</div>
                      ) : null}
                    </div>
                  ) : null}

                  {purchaseDetail.items?.length > 0 ? (
                    <div className="form-group">
                      <label style={{ marginBottom: 8, display: "block", fontWeight: 600 }}>Dòng hàng mua</label>
                      <div className="table-container" style={{ margin: 0 }}>
                        <table className="data-table" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Mã hàng</th>
                              <th>Sản phẩm</th>
                              <th>SL</th>
                              <th className="text-right">Đơn giá</th>
                              <th className="text-right">Thành tiền</th>
                            </tr>
                          </thead>
                          <tbody>
                            {purchaseDetail.items.map((ln, i) => (
                              <tr key={i}>
                                <td className="font-mono">{ln.productSku || "-"}</td>
                                <td>{ln.productName}</td>
                                <td>{ln.quantity}</td>
                                <td className="text-right font-mono">{formatCurrency(ln.unitCost)}</td>
                                <td className="text-right font-mono">{formatCurrency(ln.lineAmount ?? (Number(ln.quantity || 0) * Number(ln.unitCost || 0)))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  <div className="form-group">
                    <label style={{ marginBottom: 12, display: "block" }}>Lịch sử thanh toán</label>
                    <div className="table-container">
                      <table className="data-table" style={{ margin: 0 }}>
                        <thead>
                          <tr>
                            <th>Thời gian</th>
                            <th className="text-right">Tiền trả</th>
                            <th className="text-right">Cấn trừ công nợ</th>
                            <th>Ghi chú</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchaseDetail.payments?.length ? (
                            purchaseDetail.payments.map((payment) => (
                              <tr key={payment.id}>
                                <td>{fmtDateTime(payment.createdAt)}</td>
                                <td className="text-right font-mono">{formatCurrency(payment.cashAmount ?? payment.amount)}</td>
                                <td className="text-right font-mono">{formatCurrency(payment.amount)}</td>
                                <td>{payment.note || "-"}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan="4" className="text-center">Chưa có thanh toán nào</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="form-group">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <label style={{ margin: 0, fontWeight: 600 }}>
                        Chiết khấu thương mại ({purchaseRebates.length} bản ghi)
                      </label>
                      {!detailLoading && purchaseDetail.status !== "VOIDED" ? (
                        <button type="button" className="btn-primary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={openRebateFromDetail}>
                          + Ghi nhận chiết khấu
                        </button>
                      ) : null}
                    </div>
                    <div style={{ fontSize: "12px", color: "#666", marginBottom: 8 }}>
                      Ghi trực tiếp chiết khấu thương mại trên đơn mua. Hệ thống tự phân bổ vào giá vốn và tồn kho theo trạng thái bán hàng.
                    </div>
                    <div style={{ fontSize: "12px", color: "#495057", marginBottom: 8 }}>
                      Tổng chiết khấu: <strong>{formatCurrency(purchaseDetail.rebateAmount || 0)}</strong>
                      {" | "}
                      GVHB: <strong>{formatCurrency(purchaseDetail.rebateCogsAdjustment || 0)}</strong>
                      {" | "}
                      Tồn kho: <strong>{formatCurrency(purchaseDetail.rebateInventoryAdjustment || 0)}</strong>
                    </div>
                    {purchaseRebates.length === 0 ? (
                      <div className="info-box" style={{ fontSize: 13, color: "#666" }}>Chưa có chiết khấu nào cho chứng từ này.</div>
                    ) : (
                      <div className="table-container" style={{ margin: 0 }}>
                        <table className="data-table" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Nội dung</th>
                              <th className="text-right">Số tiền</th>
                              <th className="text-right">GVHB</th>
                              <th className="text-right">Tồn kho</th>
                              <th>Ghi chú</th>
                              <th style={{ width: 110 }}>Thao tác</th>
                            </tr>
                          </thead>
                          <tbody>
                            {purchaseRebates.map((rebate) => (
                              <tr key={`${rebate.index}-${rebate.label || "rebate"}`}>
                                <td>
                                  <div>{rebate.label || "Chiết khấu thương mại"}</div>
                                  {rebate.rebateBatchReferenceId ? (
                                    <div style={{ fontSize: 12, color: "#495057", marginTop: 4 }}>Chứng từ tổng: {rebate.rebateBatchReferenceId}</div>
                                  ) : null}
                                </td>
                                <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(rebate.amount || 0)}</td>
                                <td className="text-right" style={{ color: "#495057" }}>{formatCurrency(rebate.cogsAdjustmentAmount || 0)}</td>
                                <td className="text-right" style={{ color: "#d9480f" }}>{formatCurrency(rebate.inventoryAdjustmentAmount || 0)}</td>
                                <td>{rebate.note || "-"}</td>
                                <td>
                                  {purchaseDetail.status !== "VOIDED" ? (
                                    <button
                                      type="button"
                                      className="btn-small"
                                      style={{ background: "#ffe3e3", color: "#c92a2a" }}
                                      onClick={() => removeRebate(rebate)}
                                    >
                                      Xóa
                                    </button>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="dialog-footer">
              {!detailLoading && purchaseDetail?.debtAmount > 0 ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    closeDetailDialog();
                    openPayDialog(purchaseDetail);
                  }}
                >
                  Thanh toán tiếp
                </button>
              ) : null}
              {!detailLoading && purchaseDetail?.status !== "VOIDED" ? (
                <button
                  type="button"
                  className="btn-small"
                  style={{ background: "#ffe3e3", color: "#c92a2a", padding: "8px 16px" }}
                  onClick={() => {
                    closeDetailDialog();
                    openVoidDialog(purchaseDetail);
                  }}
                >
                  Hủy chứng từ
                </button>
              ) : null}
              <button type="button" className="btn-cancel" onClick={closeDetailDialog}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showRebateDialog ? (
        <div className="dialog-overlay" onClick={() => { setShowRebateDialog(false); setRebateSubmitResult(null); }}>
          <div className="dialog-panel dialog-panel--md" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Chiết khấu thương mại</h2>
              <button className="close-btn" type="button" onClick={() => { setShowRebateDialog(false); setRebateSubmitResult(null); }} aria-label="Đóng">✕</button>
            </div>
            <div className="dialog-body">
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600, color: "#495057" }}>Ghi nhận chiết khấu thương mại mới</h3>
                <div className="form-group">
                  <label>Chọn chứng từ cần phân bổ *</label>
                  {rebateCandidatesLoading ? (
                    <div className="info-box" style={{ color: "#666" }}>Đang tải danh sách chứng từ...</div>
                  ) : rebateCandidates.length === 0 ? (
                    <div className="info-box" style={{ color: "#666" }}>Không có chứng từ hợp lệ để phân bổ.</div>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                        {[
                          { value: "ALL", label: "Tất cả" },
                          { value: "TODAY", label: "Hôm nay" },
                          { value: "THIS_MONTH", label: "Tháng này" },
                          { value: "LAST_MONTH", label: "Tháng trước" },
                          { value: "THIS_QUARTER", label: "Quý này" },
                          { value: "THIS_YEAR", label: "Năm nay" }
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setRebateDateFilter(opt.value)}
                            style={{
                              padding: "3px 10px", fontSize: 12, borderRadius: 14, cursor: "pointer", lineHeight: 1.6,
                              border: "1px solid",
                              borderColor: rebateDateFilter === opt.value ? "#1971c2" : "#ced4da",
                              background: rebateDateFilter === opt.value ? "#1971c2" : "#f8f9fa",
                              color: rebateDateFilter === opt.value ? "#fff" : "#495057"
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #e9ecef", borderRadius: 8, padding: 10 }}>
                        {filteredRebateCandidates.length === 0 ? (
                          <div style={{ color: "#999", fontSize: 13, textAlign: "center", padding: "8px 0" }}>Không có chứng từ trong khoảng thời gian này</div>
                        ) : filteredRebateCandidates.map((doc) => {
                          const checked = (rebateForm.selectedReferenceIds || []).includes(doc.referenceId);
                          return (
                            <label key={doc.referenceId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 0", cursor: "pointer" }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleRebateReference(doc.referenceId)}
                                />
                                <span className="font-mono">{doc.referenceId}</span>
                                <span style={{ fontSize: 11, color: "#868e96" }}>{doc.documentDate || (doc.createdAt ? doc.createdAt.slice(0, 10) : "")}</span>
                              </span>
                              <span style={{ fontSize: 12, color: "#495057", whiteSpace: "nowrap" }}>
                                Giá trị: <strong>{formatCurrency(doc.amount)}</strong> | Còn nợ: <strong>{formatCurrency(doc.debtAmount)}</strong>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
                <div className="form-group">
                  <label>Nội dung</label>
                  <input
                    type="text"
                    value={rebateForm.label}
                    onChange={(e) => setRebateForm((p) => ({ ...p, label: e.target.value }))}
                    placeholder="VD: Chiết khấu thương mại đợt 1"
                  />
                </div>
                <div className="form-group">
                  <label>Số tiền chiết khấu (đ) *</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    style={{ textAlign: "right" }}
                    value={formatCurrencyInput(rebateForm.amount)}
                    onChange={(e) => setRebateForm((p) => ({ ...p, amount: parseMoneyInput(e.target.value) }))}
                    placeholder="VD: 5.000.000"
                  />
                </div>
                <div className="form-group">
                  <label>Ghi chú</label>
                  <input
                    type="text"
                    value={rebateForm.note}
                    onChange={(e) => setRebateForm((p) => ({ ...p, note: e.target.value }))}
                    placeholder="VD: Chiết khấu Q1/2026 theo hợp đồng..."
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={Number(rebateForm.amount) <= 0 || rebateSaving || selectedRebateDocs.length === 0}
                    onClick={submitRebate}
                  >
                    {rebateSaving ? "Đang lưu..." : "Ghi nhận chiết khấu"}
                  </button>
                </div>
                {rebateSubmitResult ? (
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "#d3f9d8", borderRadius: 6, fontSize: 13, color: "#2b8a3e" }}>
                    <strong>Đã ghi nhận thành công!</strong>
                    <div style={{ marginTop: 6 }}>
                      <span>Số chứng từ: <strong>{rebateSubmitResult.targetCount || 0}</strong></span>
                      {"  "}
                      <span>Tổng CK: <strong>{formatCurrency(rebateSubmitResult.totalAmount ?? rebateForm.amount)}</strong></span>
                      {"  "}
                      <span>Điều chỉnh GVHB: <strong>{formatCurrency(rebateSubmitResult.cogsAdjustmentAmount || 0)}</strong></span>
                      {"  "}
                      <span>Điều chỉnh tồn kho: <strong>{formatCurrency(rebateSubmitResult.inventoryAdjustmentAmount || 0)}</strong></span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => { setShowRebateDialog(false); setRebateSubmitResult(null); }}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {showVoid && voidTarget ? (
        <div className="dialog-overlay dialog-overlay--centered" onClick={() => setShowVoid(false)}>
          <div className="dialog-panel dialog-panel--sm" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Hủy chứng từ mua hàng</h2>
              <button className="close-btn" type="button" onClick={() => setShowVoid(false)} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body">
              <div
                style={{
                  background: (voidTarget?.paidAmount ?? 0) > 0 ? "#fff9db" : "#fff5f5",
                  border: `1px solid ${(voidTarget?.paidAmount ?? 0) > 0 ? "#ffe066" : "#ffc9c9"}`,
                  borderRadius: 6,
                  padding: "12px 16px",
                  marginBottom: 16,
                  fontSize: 14,
                  color: (voidTarget?.paidAmount ?? 0) > 0 ? "#7c5c00" : "#c92a2a"
                }}
              >
                {(voidTarget?.paidAmount ?? 0) > 0 ? (
                  <><strong>Chứng từ còn trừ công nợ {formatCurrency(voidTarget.paidAmount)}:</strong> Hủy sẽ xóa công nợ còn lại và đảo ngược tồn kho, nhưng phần đã cấn trừ cần xử lý riêng với nhà cung cấp (hoàn tiền hoặc bù trừ đơn khác). Thao tác này không thể hoàn tác.</>
                ) : (
                  <><strong>Lưu ý:</strong> Hủy chứng từ sẽ đảo ngược tồn kho, tính lại giá vốn bình quân di động và xóa công nợ nhà cung cấp. Thao tác này không thể hoàn tác.</>
                )}
              </div>

              <div className="form-group">
                <label>Chứng từ cần hủy</label>
                <div className="info-box font-mono">{voidTarget.referenceId}</div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Nhà cung cấp</label>
                  <div className="info-box">{voidTarget.supplierName}</div>
                </div>
                <div className="form-group">
                  <label>Giá trị chứng từ</label>
                  <div className="info-box font-mono" style={{ color: "#c92a2a" }}>
                    {formatCurrency(voidTarget.amount)}
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Lý do hủy *</label>
                <textarea
                  rows="3"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="VD: Nhập sai số lượng, nhầm nhà cung cấp..."
                />
                {voidReason.trim().length > 0 && voidReason.trim().length < 3 ? (
                  <p style={{ color: "#c92a2a", fontSize: 12, marginTop: 4 }}>Lý do phải có ít nhất 3 ký tự</p>
                ) : null}
              </div>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowVoid(false)} disabled={voidLoading}>
                Không hủy
              </button>
              <button
                type="button"
                className="btn-small"
                style={{
                  background: voidReason.trim().length >= 3 ? "#c92a2a" : "#ccc",
                  color: "#fff",
                  padding: "8px 20px",
                  cursor: voidReason.trim().length >= 3 ? "pointer" : "not-allowed",
                  fontWeight: 600
                }}
                disabled={voidReason.trim().length < 3 || voidLoading}
                onClick={submitVoid}
              >
                {voidLoading ? "Đang hủy..." : "Xác nhận hủy chứng từ"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showPay && selectedPurchase ? (
        <div className="dialog-overlay" onClick={() => setShowPay(false)}>
          <div className="dialog-panel dialog-panel--md" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Thanh toán nhà cung cấp</h2>
              <button className="close-btn" type="button" onClick={() => setShowPay(false)} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body">
              <div className="form-group">
                <label>Chứng từ</label>
                <div className="info-box">{selectedPurchase.referenceId}</div>
              </div>

              <div className="form-group">
                <label>Nhà cung cấp</label>
                <div className="info-box">{selectedPurchase.supplierName}</div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Còn nợ</label>
                  <div className="info-box font-mono" style={{ color: "#c92a2a" }}>
                    {formatCurrency(selectedPurchase.debtAmount)}
                  </div>
                </div>

                <div className="form-group">
                  <label>Số tiền thanh toán</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    style={{ textAlign: "right" }}
                    value={formatCurrencyInput(payForm.amount)}
                    onChange={(e) => setPayForm((prev) => ({ ...prev, amount: parseMoneyInput(e.target.value) }))}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Cấn trừ công nợ</label>
                  <div className="info-box font-mono" style={{ color: canPay ? "#2b8a3e" : "#c92a2a" }}>
                    {formatCurrency(paySettledAmount)}
                  </div>
                </div>
              </div>

              {paySettledAmount > Number(selectedPurchase.debtAmount || 0) ? (
                <div style={{ color: "#c92a2a", fontSize: 12, marginTop: -4, marginBottom: 10 }}>
                  Số tiền thanh toán không được vượt quá công nợ còn lại.
                </div>
              ) : null}

              <div className="form-group">
                <label>Ghi chú</label>
                <textarea
                  rows="3"
                  value={payForm.note}
                  onChange={(e) => setPayForm((prev) => ({ ...prev, note: e.target.value }))}
                  placeholder="VD: Chuyển khoản ngày 28/03"
                />
              </div>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowPay(false)}>
                Hủy
              </button>
              <button type="button" className="btn-primary" disabled={!canPay} onClick={submitPay}>
                Xác nhận thanh toán
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}






