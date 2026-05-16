import { useMemo, useState } from "react";
import { api } from "../api";
import DesktopPageFrame from "../components/DesktopPageFrame";
import AdvancedFiltersPopover from "../components/AdvancedFiltersPopover";
import DateQuickRanges from "../components/DateQuickRanges";
import FormBanner from "../components/FormBanner";
import SearchableSelect from "../components/SearchableSelect";
import { formatMoneyInput as formatCurrencyInput, formatCurrency } from "../utils/currency";
import { formatDateTimeVN, formatDateVN } from "../utils/datetime";
import { useFieldErrors, useFormError, usePageNotice } from "../utils/formFeedback";

const statusOpts = [
  { value: "ALL", label: "Tất cả trạng thái" },
  { value: "UNPAID", label: "Chưa thanh toán" },
  { value: "PARTIAL", label: "Thanh toán một phần" },
  { value: "PAID", label: "Đã thanh toán" },
  { value: "VOIDED", label: "Đã hủy" }
];

const statusColor = {
  UNPAID: { background: "#ffe3e3", color: "#c92a2a" },
  PARTIAL: { background: "#fff3bf", color: "#9c6b00" },
  PAID: { background: "#d3f9d8", color: "#2b8a3e" },
  VOIDED: { background: "#f1f3f5", color: "#868e96", textDecoration: "line-through" }
};

function parseMoneyInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? String(Number(digits)) : "";
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Lỗi không xác định";
}

function isBatchDeleteNotFoundError(error) {
  const message = getErrorMessage(error || "");
  return message.includes("Không tìm thấy chứng từ rebate tổng");
}

function round2(n) {
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

function localDateInputValue(date = new Date()) {
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

function emptyItem() {
  return { productId: "", quantity: 1, unitCost: 0 };
}

function StatusBadge({ status }) {
  const s = statusColor[status] || statusColor.UNPAID;
  const label = status === "PAID" ? "Đã thanh toán" : status === "PARTIAL" ? "Một phần" : status === "VOIDED" ? "Đã hủy" : "Chưa thanh toán";
  return <span className="purchase-status-badge" style={s}>{label}</span>;
}

function InfoBox({ children, style = {}, className = "" }) {
  return (
    <div className={`purchase-info-box ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export default function Purchases({ token, suppliers = [], products = [], stores = [], assignedStores = [], activeStoreId: activeStoreIdProp, purchases = [], overview, onCreatePurchase, onPayPurchase, onUpdatePurchasePayment, onDeletePurchasePayment, onVoidPurchase, onCreateSupplier, onCreatePurchaseRebate, onUpdatePurchaseRebate, onDeletePurchaseRebate, onDeletePurchaseRebateBatch }) {
  const activeStoreId = activeStoreIdProp || assignedStores.find((store) => !store.isWarehouse)?.id || assignedStores[0]?.id || stores.find((store) => !store.isWarehouse)?.id || stores[0]?.id || "";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showEditPayment, setShowEditPayment] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [editingPayment, setEditingPayment] = useState(null);
  const [saving, setSaving] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");

  // Create supplier dialog
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [showSupplierManager, setShowSupplierManager] = useState(false);
  const [supplierManagerSearch, setSupplierManagerSearch] = useState("");
  const [supplierManagerDebtFilter, setSupplierManagerDebtFilter] = useState("ALL");
  const [supplierDetail, setSupplierDetail] = useState(null);

  // Supplier rebate dialog
  const [showRebateDialog, setShowRebateDialog] = useState(false);
  const [showEditRebate, setShowEditRebate] = useState(false);
  const [rebateSaving, setRebateSaving] = useState(false);
  const [rebateCandidatesLoading, setRebateCandidatesLoading] = useState(false);
  const [rebateCandidates, setRebateCandidates] = useState([]);
  const [rebateDateFilter, setRebateDateFilter] = useState("ALL");
  const [rebateSubmitResult, setRebateSubmitResult] = useState(null);
  const initRebateForm = () => ({
    label: "Chiết khấu thương mại",
    amount: 0,
    note: "",
    selectedReferenceIds: []
  });
  const [rebateForm, setRebateForm] = useState(initRebateForm);
  const [editingRebate, setEditingRebate] = useState(null);
  const [editRebateForm, setEditRebateForm] = useState(initRebateForm);
  const initSupplierForm = () => ({ name: "", phone: "", email: "", address: "", openingBalance: 0 });
  const [supplierForm, setSupplierForm] = useState(initSupplierForm);
  const initForm = () => ({
    supplierId: suppliers[0]?.id || "",
    invoiceNo: "",
    documentDate: localDateInputValue(),
    note: ""
  });

  const [form, setForm] = useState(initForm);
  const [items, setItems] = useState([emptyItem()]);
  const [payForm, setPayForm] = useState({ amount: 0, note: "" });
  const [editPayForm, setEditPayForm] = useState({ amount: 0, note: "" });
  const {
    errors: createFormErrors,
    setErrors: setCreateFormErrors,
    clearErrors: clearCreateFormErrors,
    clearFieldError: clearCreateFormFieldError
  } = useFieldErrors({});
  const [createFormMessage, setCreateFormMessage] = useState("");
  const { error: payFormError, setError: setPayFormError, clearError: clearPayFormError } = useFormError();
  const { error: editPayFormError, setError: setEditPayFormError, clearError: clearEditPayFormError } = useFormError();
  const { error: supplierFormError, setError: setSupplierFormError, clearError: clearSupplierFormError } = useFormError();
  const { error: rebateFormError, setError: setRebateFormError, clearError: clearRebateFormError } = useFormError();
  const {
    notice: pageNotice,
    setErrorNotice: setPageErrorNotice,
    setSuccessNotice: setPageSuccessNotice,
    clearNotice: clearPageNotice
  } = usePageNotice();
  const selectedSupplier = suppliers.find((supplier) => supplier.id === form.supplierId) || null;

  const filtered = useMemo(() => (purchases || []).filter((r) => {
    if (search && !(r.referenceId || "").toLowerCase().includes(search.toLowerCase()) && !(r.supplierName || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (supplierFilter && r.supplierId !== supplierFilter) return false;
    const rowDate = r.documentDate ? new Date(`${r.documentDate}T00:00:00`) : new Date(r.createdAt);
    if (fromDate && rowDate < new Date(`${fromDate}T00:00:00`)) return false;
    if (toDate && rowDate > new Date(`${toDate}T23:59:59`)) return false;
    return true;
  }), [purchases, search, statusFilter, supplierFilter, fromDate, toDate]);

  const advancedFilterCount = [
    Boolean(supplierFilter),
    Boolean(fromDate),
    Boolean(toDate)
  ].filter(Boolean).length;

  const baseTotal = useMemo(() =>
    round2(items.reduce((s, it) => s + Number(it.quantity) * Number(it.unitCost), 0)),
    [items]);

  const computedTotal = useMemo(() =>
    round2(Math.max(baseTotal, 0)),
    [baseTotal]);

  const paySettledAmount = useMemo(
    () => Number(payForm.amount || 0),
    [payForm]
  );

  const editPaySettledAmount = useMemo(
    () => Number(editPayForm.amount || 0),
    [editPayForm]
  );

  const editPayMaxAllowed = useMemo(() => {
    if (!detail || !editingPayment) return 0;
    return Number(detail.debtAmount || 0) + Number(editingPayment.settledAmount ?? editingPayment.amount ?? 0);
  }, [detail, editingPayment]);

  const openDetail = async (referenceId) => {
    setDetail(null);
    setDetailLoading(true);
    setShowDetail(true);
    try {
      clearPageNotice();
      const res = await api.purchaseByReference(token, referenceId);
      const detailData = res.data || res;
      setDetail(detailData);
    } catch (e) {
      setPageErrorNotice(`Không tải được chi tiết chứng từ: ${getErrorMessage(e)}`);
      setShowDetail(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const openPay = (row) => {
    setSelectedRow(row);
    setPayForm({ amount: Number(row.debtAmount || 0), note: "" });
    clearPayFormError();
    setShowPay(true);
  };

  const openEditPayment = (payment) => {
    setEditingPayment(payment);
    setEditPayForm({
      amount: Number(payment.cashAmount ?? payment.amount ?? 0),
      note: payment.note || ""
    });
    clearEditPayFormError();
    setShowEditPayment(true);
  };

  const closeEditPayment = () => {
    setShowEditPayment(false);
    setEditingPayment(null);
    setEditPayForm({ amount: 0, note: "" });
    clearEditPayFormError();
  };

  const refreshDetail = async () => {
    if (!detail?.referenceId) return;
    const res = await api.purchaseByReference(token, detail.referenceId);
    setDetail(res.data || res);
  };

  const loadRebateCandidates = async (supplierId, fallbackDoc = null) => {
    if (!supplierId) {
      setRebateCandidates([]);
      return;
    }
    setRebateCandidatesLoading(true);
    try {
      const res = await api.purchases(token, {
        supplierId,
        status: "ALL"
      });
      const rows = (res.data || res || [])
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

      if (fallbackDoc?.referenceId && !rows.some((row) => row.referenceId === fallbackDoc.referenceId)) {
        rows.unshift({
          referenceId: fallbackDoc.referenceId,
          amount: Number(fallbackDoc.amount || 0),
          debtAmount: Number(fallbackDoc.debtAmount || 0),
          hasBatchRebate: Boolean(fallbackDoc.hasBatchRebate),
          documentDate: fallbackDoc.documentDate || null,
          createdAt: fallbackDoc.createdAt || null
        });
      }

      setRebateCandidates(rows);
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
      setRebateFormError(`Không tải được danh sách chứng từ: ${getErrorMessage(error)}`);
    } finally {
      setRebateCandidatesLoading(false);
    }
  };

  const openRebateFromDetail = async () => {
    if (!detail?.referenceId || !detail?.supplierId) return;
    clearRebateFormError();
    await loadRebateCandidates(detail.supplierId, {
      referenceId: detail.referenceId,
      amount: Number(detail.amount || 0),
      debtAmount: Number(detail.debtAmount || 0),
      hasBatchRebate: Array.isArray(detail.rebates)
        ? detail.rebates.some((rebate) => Boolean(rebate.rebateBatchReferenceId))
        : false
    });
    setRebateForm({
      ...initRebateForm(),
      selectedReferenceIds: [detail.referenceId]
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
      const next = new Set(prev.selectedReferenceIds || []);
      if (next.has(referenceId)) {
        next.delete(referenceId);
      } else {
        next.add(referenceId);
      }
      return {
        ...prev,
        selectedReferenceIds: Array.from(next)
      };
    });
  };

  const openEditRebate = (rebate, index) => {
    setEditingRebate({ ...rebate, index });
    setEditRebateForm({
      label: rebate.label || "Chiết khấu thương mại",
      amount: Number(rebate.amount || 0),
      note: rebate.note || ""
    });
    clearRebateFormError();
    setShowEditRebate(true);
  };

  const closeEditRebate = () => {
    setShowEditRebate(false);
    setEditingRebate(null);
    setEditRebateForm(initRebateForm());
    clearRebateFormError();
  };

  const openVoid = (row) => {
    setVoidTarget(row);
    setVoidReason("");
    setShowVoid(true);
  };

  const submitVoid = async () => {
    if (!voidTarget || voidReason.trim().length < 3 || saving) return;
    setSaving(true);
    try {
      clearPageNotice();
      setProcessingMessage("Đang hủy chứng từ, vui lòng chờ...");
      await onVoidPurchase(voidTarget.referenceId, {
        supplierId: voidTarget.supplierId,
        reason: voidReason.trim()
      });
      setShowVoid(false);
      setVoidTarget(null);
      setVoidReason("");
      if (showDetail) setShowDetail(false);
    } catch (error) {
      setPageErrorNotice(`Hủy chứng từ thất bại: ${getErrorMessage(error)}`);
    } finally {
      setProcessingMessage("");
      setSaving(false);
    }
  };

  const resetCreate = () => {
    setForm(initForm());
    setItems([emptyItem()]);
  };

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("ALL");
    setSupplierFilter("");
    setFromDate("");
    setToDate("");
  };

  const openCreateDialog = () => {
    resetCreate();
    clearCreateFormErrors();
    setCreateFormMessage("");
    setShowCreate(true);
  };

  const submitCreate = async () => {
    const nextErrors = {};
    if (!form.supplierId) {
      nextErrors.supplierId = "Vui lòng chọn nhà cung cấp";
    }

    if (saving) {
      return;
    }

    const payload = {
      supplierId: form.supplierId,
      invoiceNo: form.invoiceNo || undefined,
      documentDate: form.documentDate || undefined,
      note: form.note || undefined,
      paidAmount: 0,
      storeId: activeStoreId || undefined
    };

    const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);
    if (!validItems.length) {
      nextErrors.items = "Vui lòng thêm ít nhất 1 sản phẩm";
    }
    if (!activeStoreId) {
      nextErrors.form = "Không xác định được cửa hàng đang hoạt động";
    }
    if (validItems.some((it) => Number(it.unitCost) < 0)) {
      nextErrors.items = "Đơn giá không được âm";
    }
    const duplicateProductIds = new Set();
    const hasDuplicateProducts = validItems.some((it) => {
      if (duplicateProductIds.has(it.productId)) return true;
      duplicateProductIds.add(it.productId);
      return false;
    });
    if (hasDuplicateProducts) {
      nextErrors.items = "Mỗi sản phẩm chỉ nên xuất hiện một lần trong chứng từ mua hàng";
    }
    if (Object.keys(nextErrors).length > 0) {
      setCreateFormErrors(nextErrors);
      return;
    }
    clearCreateFormErrors();
    setCreateFormMessage("");
    payload.items = validItems.map((it) => ({
      productId: it.productId,
      quantity: Number(it.quantity),
      unitCost: Number(it.unitCost)
    }));

    setSaving(true);
    try {
      setProcessingMessage("Đang lưu chứng từ mua hàng, vui lòng chờ...");
      await onCreatePurchase(payload);
      setShowCreate(false);
      resetCreate();
    } catch (error) {
      setCreateFormMessage(`Tạo chứng từ thất bại: ${getErrorMessage(error)}`);
    } finally {
      setProcessingMessage("");
      setSaving(false);
    }
  };

  const submitPay = async () => {
    if (!selectedRow || paySettledAmount <= 0) return;
    if (paySettledAmount > Number(selectedRow.debtAmount || 0)) {
      setPayFormError("Tổng cấn trừ công nợ vượt quá công nợ còn lại");
      return;
    }

    setSaving(true);
    try {
      clearPayFormError();
      setProcessingMessage("Đang ghi nhận thanh toán nhà cung cấp, vui lòng chờ...");
      await onPayPurchase(selectedRow.referenceId, {
        supplierId: selectedRow.supplierId,
        amount: Number(payForm.amount),
        note: payForm.note || undefined
      });
      setShowPay(false);
      setSelectedRow(null);
    } catch (error) {
      setPayFormError(`Thanh toán thất bại: ${getErrorMessage(error)}`);
    } finally {
      setProcessingMessage("");
      setSaving(false);
    }
  };

  const submitEditPayment = async () => {
    if (!detail || !editingPayment || !onUpdatePurchasePayment || saving) return;
    if (editPaySettledAmount <= 0) {
      setEditPayFormError("Tổng cấn trừ phải lớn hơn 0");
      return;
    }
    if (editPaySettledAmount > editPayMaxAllowed) {
      setEditPayFormError("Tổng cấn trừ công nợ vượt quá công nợ còn lại");
      return;
    }

    setSaving(true);
    try {
      clearEditPayFormError();
      setProcessingMessage("Đang cập nhật phiếu thanh toán, vui lòng chờ...");
      await onUpdatePurchasePayment(detail.referenceId, editingPayment.id, {
        supplierId: detail.supplierId,
        amount: Number(editPayForm.amount || 0),
        note: editPayForm.note || undefined
      });
      await refreshDetail();
      closeEditPayment();
    } catch (error) {
      setEditPayFormError(`Cập nhật phiếu thanh toán thất bại: ${getErrorMessage(error)}`);
    } finally {
      setProcessingMessage("");
      setSaving(false);
    }
  };

  const removePayment = async (payment) => {
    if (!detail || !onDeletePurchasePayment || saving) return;
    const settledAmount = Number(payment.settledAmount ?? payment.amount ?? 0);
    const confirmed = window.confirm(`Xóa phiếu thanh toán này? Giá trị cấn trừ: ${formatCurrency(settledAmount)}`);
    if (!confirmed) return;

    setSaving(true);
    try {
      setProcessingMessage("Đang xóa phiếu thanh toán, vui lòng chờ...");
      await onDeletePurchasePayment(detail.referenceId, payment.id, {
        supplierId: detail.supplierId
      });
      await refreshDetail();
    } catch (error) {
      setPageErrorNotice(`Xóa phiếu thanh toán thất bại: ${getErrorMessage(error)}`);
    } finally {
      setProcessingMessage("");
      setSaving(false);
    }
  };

  const submitCreateSupplier = async () => {
    const name = supplierForm.name.trim();
    if (name.length < 2) {
      setSupplierFormError("Tên nhà cung cấp cần tối thiểu 2 ký tự");
      return;
    }
    if (supplierSaving) return;
    setSupplierSaving(true);
    try {
      clearSupplierFormError();
      await onCreateSupplier({
        name,
        phone: supplierForm.phone.trim() || undefined,
        email: supplierForm.email.trim() || undefined,
        address: supplierForm.address.trim() || undefined,
        openingBalance: Number(supplierForm.openingBalance || 0)
      });
      setShowCreateSupplier(false);
      setSupplierForm(initSupplierForm());
    } catch (error) {
      setSupplierFormError(`Tạo nhà cung cấp thất bại: ${getErrorMessage(error)}`);
    } finally {
      setSupplierSaving(false);
    }
  };

  const productOptions = useMemo(
    () => products.map((p) => ({
      value: p.id,
      label: p.name,
      description: p.sku || "",
      keywords: `${p.sku || ""} ${p.unit || ""}`
    })),
    [products]
  );

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({
      value: s.id,
      label: s.name,
      description: s.code || "",
      keywords: `${s.code || ""} ${s.phone || ""}`
    })),
    [suppliers]
  );

  const supplierManagerRows = useMemo(() => {
    const keyword = supplierManagerSearch.trim().toLowerCase();
    return suppliers.filter((supplier) => {
      const name = String(supplier.name || "").toLowerCase();
      const code = String(supplier.code || "").toLowerCase();
      const phone = String(supplier.phone || "").toLowerCase();
      const email = String(supplier.email || "").toLowerCase();
      const address = String(supplier.address || "").toLowerCase();
      const debt = Number(supplier.netBalance || 0);

      const matchesSearch = !keyword || name.includes(keyword) || code.includes(keyword) || phone.includes(keyword) || email.includes(keyword) || address.includes(keyword);
      const matchesDebt = supplierManagerDebtFilter === "ALL"
        ? true
        : supplierManagerDebtFilter === "HAS_DEBT"
          ? debt > 0
          : debt <= 0;

      return matchesSearch && matchesDebt;
    });
  }, [suppliers, supplierManagerSearch, supplierManagerDebtFilter]);

  const addItem = () => setItems((p) => [...p, emptyItem()]);
  const removeItem = (i) => setItems((p) => {
    if (p.length === 1) return [emptyItem()];
    return p.filter((_, j) => j !== i);
  });
  const setItem = (i, f, v) => setItems((p) => p.map((it, j) => j === i ? { ...it, [f]: v } : it));
  const setProductItem = async (i, productId) => {
    const product = products.find((p) => p.id === productId);
    // Default: use supplierQuotedPrice from product master
    let unitCost = product?.supplierQuotedPrice != null ? String(product.supplierQuotedPrice) : "0";
    // Override with most recent price from the selected supplier if available
    if (productId && form.supplierId) {
      try {
        const prices = await api.getLastSupplierPrices(token, form.supplierId, [productId]);
        if (prices && prices[productId] != null) {
          unitCost = String(prices[productId]);
        }
      } catch {
        // fallback to default, no-op
      }
    }
    setItems((p) => p.map((it, j) => j === i ? { ...it, productId, unitCost } : it));
  };

  const submitRebate = async () => {
    if (!detail || !onCreatePurchaseRebate) {
      setRebateFormError("Không tìm thấy chứng từ mua hàng để ghi nhận chiết khấu");
      return;
    }
    const amount = Number(rebateForm.amount || 0);
    if (amount <= 0) {
      setRebateFormError("Số tiền chiết khấu phải lớn hơn 0");
      return;
    }
    if (!selectedRebateDocs.length) {
      setRebateFormError("Vui lòng chọn ít nhất một chứng từ để áp dụng");
      return;
    }
    const label = rebateForm.label.trim() || "Chiết khấu thương mại";
    if (rebateSaving) return;
    setRebateSaving(true);
    setRebateSubmitResult(null);
    try {
      clearRebateFormError();
      const createResult = await onCreatePurchaseRebate(detail.referenceId, {
        supplierId: detail.supplierId,
        label,
        amount,
        note: rebateForm.note.trim() || undefined,
        referenceIds: selectedRebateDocs.map((doc) => doc.referenceId)
      });

      setRebateSubmitResult({
        referenceId: String(createResult?.referenceId || detail.referenceId),
        targetCount: Number(createResult?.targetCount || selectedRebateDocs.length),
        totalAmount: amount,
        cogsAdjustmentAmount: Number(createResult?.cogsAdjustmentAmount || 0),
        inventoryAdjustmentAmount: Number(createResult?.inventoryAdjustmentAmount || 0)
      });
      await refreshDetail();
      setRebateForm({
        ...initRebateForm(),
        selectedReferenceIds: [detail.referenceId]
      });
    } catch (error) {
      setRebateFormError(`Ghi nhận chiết khấu thất bại: ${getErrorMessage(error)}`);
    } finally {
      setRebateSaving(false);
    }
  };

  const submitEditRebate = async () => {
    if (!detail || !editingRebate || !onUpdatePurchaseRebate) {
      setRebateFormError("Không tìm thấy chiết khấu cần cập nhật");
      return;
    }
    const amount = Number(editRebateForm.amount || 0);
    if (amount <= 0) {
      setRebateFormError("Số tiền chiết khấu phải lớn hơn 0");
      return;
    }
    const label = editRebateForm.label.trim() || "Chiết khấu thương mại";
    if (rebateSaving) return;
    setRebateSaving(true);
    try {
      clearRebateFormError();
      await onUpdatePurchaseRebate(detail.referenceId, editingRebate.index, {
        supplierId: detail.supplierId,
        label,
        amount,
        note: editRebateForm.note.trim() || undefined
      });
      await refreshDetail();
      closeEditRebate();
    } catch (error) {
      setRebateFormError(`Cập nhật chiết khấu thất bại: ${getErrorMessage(error)}`);
    } finally {
      setRebateSaving(false);
    }
  };

  const removeRebate = async (rebate) => {
    if (!detail) return;
    const linkedBatchReferenceId = extractBatchReferenceFromNote(rebate.note);
    const deleteLabel = rebate.rebateBatchReferenceId
      ? `chứng từ rebate tổng ${rebate.rebateBatchReferenceId}`
      : `chiết khấu ${rebate.label || "chiết khấu thương mại"}`;
    if (!window.confirm(`Xóa ${deleteLabel}? Thao tác này không thể hoàn tác.`)) return;
    try {
      if (rebate.rebateBatchReferenceId) {
        if (!onDeletePurchaseRebateBatch) {
          throw new Error("Không hỗ trợ xóa chứng từ rebate tổng ở màn hình này");
        }
        try {
          await onDeletePurchaseRebateBatch(rebate.rebateBatchReferenceId, {
            supplierId: detail.supplierId
          });
        } catch (error) {
          if (!isBatchDeleteNotFoundError(error)) throw error;
        }
      } else {
        if (linkedBatchReferenceId && onDeletePurchaseRebateBatch) {
          try {
            await onDeletePurchaseRebateBatch(linkedBatchReferenceId, {
              supplierId: detail.supplierId
            });
          } catch (error) {
            if (!isBatchDeleteNotFoundError(error)) throw error;
          }
        }
        if (!onDeletePurchaseRebate) return;
        await onDeletePurchaseRebate(detail.referenceId, rebate.index, {
          supplierId: detail.supplierId
        });
      }
      await refreshDetail();
      setPageSuccessNotice(rebate.rebateBatchReferenceId
        ? "Đã xóa chứng từ rebate tổng và rollback các PO liên quan"
        : "Đã xóa chiết khấu khỏi chứng từ mua hàng");
    } catch (error) {
      setPageErrorNotice(`Xóa thất bại: ${getErrorMessage(error)}`);
    }
  };

  const purchaseRebates = Array.isArray(detail?.rebates)
    ? detail.rebates.map((rebate, index) => ({ ...rebate, index }))
    : [];


  return (
    <DesktopPageFrame
      title="Mua hàng"
      description="Ghi nhận chứng từ nhập hàng, theo dõi công nợ và thanh toán cho nhà cung cấp."
      kpis={overview ? [
        { label: "Tổng chứng từ", value: overview.totalPurchases || 0 },
        { label: "Giá trị mua", value: formatCurrency(overview.totalAmount), mono: true },
        { label: "Tiền đã trả", value: formatCurrency(overview.totalPaidCash || 0), mono: true },
        { label: "CK thanh toán", value: formatCurrency(overview.totalPaymentDiscount || 0), mono: true },
        { label: "Đã cấn trừ", value: formatCurrency(overview.totalPaid), mono: true },
        { label: "Còn nợ NCC", value: formatCurrency(overview.totalDebt), mono: true }
      ] : []}
      actions={(
        <>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              setSupplierManagerSearch("");
              setSupplierManagerDebtFilter("ALL");
              setSupplierDetail(null);
              setShowSupplierManager(true);
            }}
          >
            DS NCC
          </button>
          <button className="btn-secondary" type="button" onClick={() => { setSupplierForm(initSupplierForm()); clearSupplierFormError(); setShowCreateSupplier(true); }}>
            + Tạo NCC
          </button>
          <button className="btn-secondary" type="button" onClick={() => setShowGuide(true)}>
            Hướng dẫn xử lý sai
          </button>
          <button className="btn-primary purchases-create-btn" type="button" onClick={openCreateDialog}>
            + Tạo chứng từ
          </button>
        </>
      )}
      filters={(
        <>
          <input className="filter-wide" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm theo mã chứng từ, nhà cung cấp..." />
          <select className="filter-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {statusOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <AdvancedFiltersPopover activeCount={advancedFilterCount}>
            <DateQuickRanges
              fromDate={fromDate}
              toDate={toDate}
              setFromDate={setFromDate}
              setToDate={setToDate}
            />
            <div className="advanced-filter-grid">
              <label>
                Nhà cung cấp
                <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
                  <option value="">Tất cả nhà cung cấp</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>

              <label>
                Từ ngày
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </label>

              <label>
                Đến ngày
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </label>
            </div>
          </AdvancedFiltersPopover>
          <button type="button" className="btn-secondary purchases-reset-btn" onClick={resetFilters}>Xóa lọc</button>
        </>
      )}
    >

      <FormBanner
        message={pageNotice.text}
        tone={pageNotice.type === "success" ? "success" : "error"}
        className="purchase-banner-spaced"
      />

      {showGuide ? (
        <div className="dialog-overlay" onClick={() => setShowGuide(false)}>
          <div className="dialog-panel dialog-panel--purchase-guide" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Hướng dẫn xử lý đơn mua hàng bị sai</h2>
                <p className="product-create-subtitle">Dùng khi phát hiện nhập sai giá hoặc sai số lượng sau khi đã tạo chứng từ mua hàng.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowGuide(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body product-create-body purchase-guide-body">
              <section className="detail-card purchase-guide-card purchase-guide-card--info">
                <h3>Chưa phát sinh đơn bán</h3>
                <ul className="purchase-guide-list">
                  <li>Có thể yêu cầu ADMIN xóa chứng từ mua hàng sai để tạo lại chứng từ đúng.</li>
                  <li>Chỉ áp dụng khi chưa có đơn bán, chưa cấn trừ công nợ và chưa dùng để tính giá vốn.</li>
                  <li>Sau khi xóa, nhập lại chứng từ mới với đúng giá, đúng số lượng và đúng ngày chứng từ.</li>
                </ul>
              </section>

              <section className="detail-card purchase-guide-card purchase-guide-card--warn">
                <h3>Đã phát sinh đơn bán</h3>
                <ul className="purchase-guide-list">
                  <li>Không sửa trực tiếp chứng từ mua hàng gốc vì sẽ làm lệch tồn kho, công nợ và giá vốn.</li>
                  <li>Lập chứng từ điều chỉnh riêng để phản ánh phần chênh lệch và tham chiếu về chứng từ gốc.</li>
                  <li>Nếu sai số lượng, xử lý bù/trừ ở chứng từ lần sau để đưa tồn kho về đúng thực tế.</li>
                  <li>Nếu giá mua cao hơn, nhập thêm chứng từ chiết khấu hoặc giảm trừ từ nhà cung cấp.</li>
                  <li>Nếu giá mua thấp hơn và cần bù thêm, lập chứng từ điều chỉnh tăng tương ứng.</li>
                </ul>
              </section>

              <section className="detail-card purchase-guide-card purchase-guide-card--action">
                <h3>Ghi nhớ</h3>
                <p>
                  Khi đã có giao dịch phát sinh liên quan, ưu tiên chứng từ điều chỉnh thay vì sửa hoặc xóa tay dữ liệu gốc.
                </p>
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-primary" onClick={() => setShowGuide(false)}>Đã hiểu</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="list-shell purchases-list-shell">
        <table className="simple-table">
          <thead>
            <tr>
              <th>Mã chứng từ</th>
              <th>Nhà cung cấp</th>
              <th>Ngày chứng từ</th>
              <th>Trạng thái</th>
              <th className="text-right">Tổng tiền</th>
              <th className="text-right">Tiền trả</th>
              <th className="text-right">Đã cấn trừ</th>
              <th className="text-right">Còn nợ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan="9" className="text-center purchase-empty-row-cell">Không có dữ liệu</td></tr>
            ) : filtered.map((row) => (
              <tr key={row.id}>
                <td className="mono">{row.referenceId}</td>
                <td>{row.supplierName}</td>
                <td>{row.documentDate ? formatDateVN(`${row.documentDate}T00:00:00`) : formatDateVN(row.createdAt)}</td>
                <td><StatusBadge status={row.status} /></td>
                <td className="text-right mono">{formatCurrency(row.amount)}</td>
                <td className="text-right mono">{formatCurrency(row.paidCashAmount ?? row.paidAmount)}</td>
                <td className="text-right mono">{formatCurrency(row.paidAmount)}</td>
                <td className={`text-right mono ${row.debtAmount > 0 ? "purchase-debt-text" : "purchase-paid-text"}`}>{formatCurrency(row.debtAmount)}</td>
                <td className="purchase-row-actions">
                  <button type="button" className="purchase-row-btn" onClick={() => openDetail(row.referenceId)}>Chi tiết</button>
                  {row.status !== "VOIDED" && (
                    <>
                      {row.debtAmount > 0 && (
                        <button type="button" className="purchase-row-btn purchase-row-btn-primary" onClick={() => openPay(row)}>Thanh toán</button>
                      )}
                      <button type="button" className="purchase-row-btn purchase-row-btn-danger" onClick={() => openVoid(row)}>Hủy</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* CREATE DIALOG */}
      {showCreate && (
        <div className="dialog-overlay" onClick={() => { setShowCreate(false); clearCreateFormErrors(); setCreateFormMessage(""); }}>
          <div className="dialog-panel dialog-panel--purchase" onClick={(e) => e.stopPropagation()}>

            {/* Title bar */}
            <div className="dialog-header">
              <h2>Tạo chứng từ mua hàng</h2>
              <button className="close-btn" type="button" onClick={() => { setShowCreate(false); clearCreateFormErrors(); setCreateFormMessage(""); }} aria-label="Đóng">x</button>
            </div>

            {/* Compact header fields: NCC | Invoice | Date | Note */}
            <FormBanner message={createFormMessage} tone="error" className="purchase-banner-spaced" />
            <FormBanner message={createFormErrors.form} tone="error" className="purchase-banner-spaced" />
            <div className="purchase-dlg-hdr">
              <div className="form-group">
                <label>Nhà cung cấp *</label>
                <SearchableSelect
                  value={form.supplierId}
                  onChange={(val) => {
                    setForm((p) => ({ ...p, supplierId: val }));
                    clearCreateFormFieldError("supplierId");
                    clearCreateFormFieldError("form");
                  }}
                  options={supplierOptions}
                  searchPlaceholder="Gõ tên hoặc mã nhà cung cấp..."
                  noResultsText="Không tìm thấy nhà cung cấp"
                  className="purchase-product-select"
                />
                <div className="field-error">{createFormErrors.supplierId || ""}</div>
              </div>
              <div className="form-group">
                <label>Số hóa đơn NCC</label>
                <input value={form.invoiceNo} onChange={(e) => setForm((p) => ({ ...p, invoiceNo: e.target.value }))} placeholder="Tùy chọn" />
              </div>
              <div className="form-group">
                <label>Ngày chứng từ</label>
                <input type="date" value={form.documentDate} onChange={(e) => setForm((p) => ({ ...p, documentDate: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Ghi chú</label>
                <input value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} placeholder="Tùy chọn" />
              </div>
            </div>


            {/* Main scrollable area */}
            <div className="purchase-dlg-items">
              <FormBanner message={createFormErrors.items} tone="error" className="purchase-banner-spaced" />
              <table className="purchase-items-tbl">
                <colgroup>
                  <col className="pcol-seq" />
                  <col className="pcol-product" />
                  <col className="pcol-qty" />
                  <col className="pcol-cost" />
                  <col className="pcol-total" />
                  <col className="pcol-del" />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Sản phẩm</th>
                    <th>Số lượng</th>
                    <th>Đơn giá (đ)</th>
                    <th className="text-right">Thành tiền</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const line = round2(Number(it.quantity) * Number(it.unitCost));
                    return (
                      <tr key={i} className={i % 2 === 1 ? "purchase-row-alt" : ""}>
                        <td className="purchase-seq">{i + 1}</td>
                        <td>
                          <SearchableSelect
                            value={it.productId}
                            onChange={(val) => setProductItem(i, val)}
                            options={productOptions}
                            searchPlaceholder="Gõ tên hoặc mã hàng..."
                            noResultsText="Không tìm thấy sản phẩm"
                            className="purchase-product-select"
                          />
                        </td>
                        <td>
                          <input type="number" min="1" value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} className="purchase-qty-input" />
                        </td>
                        <td>
                          <input type="text" inputMode="numeric" placeholder="0" value={formatCurrencyInput(it.unitCost)} onChange={(e) => setItem(i, "unitCost", parseMoneyInput(e.target.value))} className="purchase-num-input purchase-money-input-right" />
                        </td>
                        <td className="text-right purchase-line-amt">{formatCurrency(line)}</td>
                        <td>
                          <button type="button" className="purchase-remove-line-btn" onClick={() => removeItem(i)} title="Xóa dòng">✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="purchase-add-line-row">
                <button type="button" className="purchase-add-line-btn" onClick={addItem}>+ Thêm dòng</button>
                <span className="purchase-items-count">{items.filter(it => it.productId).length} / {items.length} dòng đã chọn sản phẩm</span>
              </div>
            </div>

            {/* Summary strip */}
            <div className="purchase-dlg-summary">
              <div className="purchase-sum-stack">
                <div className="purchase-sum-row">
                  <span>Giá trị hàng</span>
                  <span className="mono">{formatCurrency(baseTotal)}</span>
                </div>
                <div className="purchase-sum-row purchase-sum-row--total">
                  <span>Tổng chứng từ</span>
                  <strong className="mono">{formatCurrency(computedTotal)}</strong>
                </div>
                <div className="purchase-sum-row">
                  <span>Thanh toán ngay</span>
                  <span className="mono purchase-sum-paid">{formatCurrency(0)}</span>
              </div>
              <div className="purchase-sum-row purchase-sum-row--debt">
                <span>Công nợ phát sinh</span>
                  <strong className="mono">{formatCurrency(computedTotal)}</strong>
                </div>
              </div>
            </div>

            <div className="dialog-footer">
              <button className="btn-cancel" type="button" onClick={() => { setShowCreate(false); clearCreateFormErrors(); setCreateFormMessage(""); }}>Hủy</button>
              <button className="btn-primary" type="button" disabled={saving} onClick={submitCreate}>
                {saving ? "Đang lưu..." : "Tạo chứng từ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL DIALOG */}
      {showDetail && (
        <div className="dialog-overlay" onClick={() => setShowDetail(false)}>
          <div className="dialog-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Chi tiết chứng từ mua hàng</h2>
              <button className="close-btn" type="button" onClick={() => setShowDetail(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body">
              {detailLoading || !detail ? (
                <p className="purchase-loading-text">Đang tải chi tiết...</p>
              ) : (
                <>
                  <div className="purchase-detail-hero">
                    <div className="purchase-detail-layout">
                      <div className="purchase-detail-left">
                        <div className="purchase-detail-muted">Mã chứng từ</div>
                        <div className="mono purchase-strong">{detail.referenceId}</div>

                        <div className="purchase-detail-muted">Trạng thái</div>
                        <div><StatusBadge status={detail.status} /></div>

                        <div className="purchase-detail-muted">Nhà cung cấp</div>
                        <div>{detail.supplierName}</div>

                        <div className="purchase-detail-muted">Ngày chứng từ</div>
                        <div>{detail.documentDate ? formatDateVN(`${detail.documentDate}T00:00:00`) : "-"}</div>

                        <div className="purchase-detail-muted">Ngày tạo</div>
                        <div>{formatDateVN(detail.createdAt)}</div>

                        {detail.note ? (
                          <>
                            <div className="purchase-detail-muted purchase-detail-muted-top">Ghi chú</div>
                            <div className="purchase-detail-note">{detail.note}</div>
                          </>
                        ) : null}
                      </div>

                      <div className="purchase-detail-right">
                        <div className="purchase-detail-stat-row">
                          <span className="purchase-detail-muted">Tổng giá trị</span>
                          <span className="mono purchase-detail-stat-value purchase-detail-stat-value--blue">{formatCurrency(detail.amount)}</span>
                        </div>
                        <div className="purchase-detail-stat-row">
                          <span className="purchase-detail-muted">Còn nợ NCC</span>
                          <span className={`mono purchase-detail-stat-value ${detail.debtAmount > 0 ? "purchase-detail-stat-value--debt" : "purchase-detail-stat-value--paid"}`.trim()}>{formatCurrency(detail.debtAmount)}</span>
                        </div>
                        <div className="purchase-detail-stat-row">
                          <span className="purchase-detail-muted">CK thương mại</span>
                          <span className="mono purchase-detail-stat-value--amber">{formatCurrency(detail.rebateAmount || 0)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {detail.voidedAt ? (
                    <div className="purchase-voided-box">
                      <div className="purchase-voided-title">Đã hủy # {formatDateTimeVN(detail.voidedAt)}</div>
                      {detail.voidReason ? <div className="purchase-voided-reason">Lý do: {detail.voidReason}</div> : null}
                    </div>
                  ) : null}

                  {detail.items?.length > 0 && (
                    <div className="form-group">
                      <label className="purchase-section-title">Đóng hang mua</label>
                      <div className="purchase-table-wrap">
                        <table className="simple-table">
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
                            {detail.items.map((ln, i) => (
                              <tr key={i}>
                                <td className="mono">{ln.productSku || "-"}</td>
                                <td>{ln.productName}</td>
                                <td>{ln.quantity}</td>
                                <td className="text-right mono">{formatCurrency(ln.unitCost)}</td>
                                <td className="text-right mono">{formatCurrency(ln.lineAmount ?? (Number(ln.quantity || 0) * Number(ln.unitCost || 0)))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="form-group">
                    <div className="purchase-section-head">
                      <label className="purchase-section-title">
                        Lịch sử thanh toán ({detail.payments?.length || 0} lần)
                      </label>
                      {!detailLoading && detail?.debtAmount > 0 && (
                        <button type="button" className="btn-primary purchase-mini-action-btn" onClick={() => { setShowDetail(false); openPay(detail); }}>
                          Thanh toán
                        </button>
                      )}
                    </div>
                    <div className="purchase-inline-hint purchase-hint-spaced">
                      Một chứng từ có thể thanh toán nhiều lần. Có thể hạch toán chiết khấu thanh toán với số thực trả bằng 0.
                    </div>
                    <table className="simple-table">
                      <thead>
                        <tr>
                          <th>Thời gian</th>
                          <th className="text-right">Tiền trả</th>
                          <th className="text-right">Cấn trừ công nợ</th>
                          <th>Ghi chú</th>
                          <th className="purchase-col-actions-150">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.payments?.length ? detail.payments.map((pay) => (
                          <tr key={pay.id}>
                            <td className="purchase-text-13">{formatDateTimeVN(pay.createdAt)}</td>
                            <td className="text-right mono purchase-text-13-strong">{formatCurrency(pay.cashAmount ?? pay.amount)}</td>
                            <td className="text-right mono purchase-text-13-strong">{formatCurrency(pay.amount)}</td>
                            <td className="purchase-text-13">
                              {pay.note || "-"}
                            </td>
                            <td>
                              {detail.status !== "VOIDED" ? (
                                <div className="purchase-row-btn-group">
                                  {onUpdatePurchasePayment ? (
                                    <button type="button" className="purchase-row-btn purchase-row-btn-sm" onClick={() => openEditPayment(pay)}>
                                      Sửa
                                    </button>
                                  ) : null}
                                  {onDeletePurchasePayment ? (
                                    <button
                                      type="button"
                                      className="purchase-row-btn purchase-row-btn-sm purchase-row-btn-danger"
                                      onClick={() => removePayment(pay)}
                                    >
                                      Xóa
                                    </button>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="purchase-empty-dash">-</span>
                              )}
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan="5" className="text-center purchase-empty-table-note">Chưa có thanh toán nào</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* SUPPLIER REBATE SECTION */}
                  <div className="form-group">
                    <div className="purchase-section-head">
                      <label className="purchase-section-title">
                        Chiết khấu đơn mua ({purchaseRebates.length} bản ghi)
                      </label>
                      {!detailLoading && detail.status !== "VOIDED" && onCreatePurchaseRebate ? (
                        <button type="button" className="btn-secondary purchase-mini-action-btn" onClick={openRebateFromDetail}>
                          + Ghi nhận
                        </button>
                      ) : null}
                    </div>
                    <div className="purchase-inline-hint purchase-hint-spaced">
                      Ghi trực tiếp chiết khấu thương mại trên đơn mua. Hệ thống tự phân bổ vào giá vốn và tồn kho theo trạng thái bán hàng.
                    </div>
                    <div className="purchase-inline-hint purchase-hint-spaced">
                      Tổng chiết khấu: <strong>{formatCurrency(detail.rebateAmount || 0)}</strong>
                      {" | "}
                      GVHB: <strong>{formatCurrency(detail.rebateCogsAdjustment || 0)}</strong>
                      {" | "}
                      Tồn kho: <strong>{formatCurrency(detail.rebateInventoryAdjustment || 0)}</strong>
                    </div>
                    {purchaseRebates.length === 0 ? (
                      <InfoBox><span className="purchase-empty-info">Chưa có chiết khấu nào cho chứng từ này.</span></InfoBox>
                    ) : (
                      <table className="simple-table purchase-table-sm">
                        <thead>
                          <tr>
                            <th>Nội dung</th>
                            <th className="text-right">Số tiền</th>
                            <th className="text-right">Điều chỉnh GVHB</th>
                            <th className="text-right">Điều chỉnh TK</th>
                            <th>Ghi chú</th>
                            <th className="purchase-col-actions-60"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchaseRebates.map((rebate) => {
                            const linkedBatchReferenceId = extractBatchReferenceFromNote(rebate.note);
                            const hasLinkedBatch = Boolean(linkedBatchReferenceId || rebate.rebateBatchReferenceId);
                            return (
                            <tr key={`${rebate.index}-${rebate.label || "rebate"}`}>
                              <td>
                                <span className="purchase-rebate-chip-trade">CK TM</span>
                                <div className="purchase-text-13 purchase-gap-top-4">{rebate.label || "Chiết khấu thương mại"}</div>
                                {hasLinkedBatch ? (
                                  <div className="purchase-text-13 purchase-gap-top-4">Chứng từ phân bổ GV: {rebate.rebateBatchReferenceId || linkedBatchReferenceId}</div>
                                ) : null}
                              </td>
                              <td className="text-right purchase-strong">{formatCurrency(rebate.amount || 0)}</td>
                              <td className="text-right">{formatCurrency(rebate.cogsAdjustmentAmount || 0)}</td>
                              <td className="text-right">{formatCurrency(rebate.inventoryAdjustmentAmount || 0)}</td>
                              <td className="purchase-text-13">{rebate.note || "-"}</td>
                              <td>
                                {detail.status !== "VOIDED" && onUpdatePurchaseRebate && !hasLinkedBatch ? (
                                  <button
                                    type="button"
                                    className="purchase-row-btn purchase-row-btn-xs"
                                    onClick={() => openEditRebate(rebate, rebate.index)}
                                  >
                                    Sửa
                                  </button>
                                ) : null}
                                {detail.status !== "VOIDED" && (hasLinkedBatch ? onDeletePurchaseRebateBatch : onDeletePurchaseRebate) ? (
                                  <button
                                    type="button"
                                    className="purchase-row-btn purchase-row-btn-xs purchase-row-btn-danger"
                                    onClick={() => removeRebate(rebate)}
                                  >
                                    Xóa
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="dialog-footer">
              {!detailLoading && detail && detail.status !== "VOIDED" && (
                <button
                  type="button"
                  className="btn-secondary purchase-row-btn-danger"
                  onClick={() => { setShowDetail(false); openVoid(detail); }}
                >
                  Hủy chứng từ
                </button>
              )}
              <button type="button" className="btn-cancel" onClick={() => setShowDetail(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {showEditPayment && detail && editingPayment ? (
        <div className="dialog-overlay" onClick={closeEditPayment}>
          <div className="dialog-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Sửa Phiếu Thanh Toán</h2>
              <button className="close-btn" type="button" onClick={closeEditPayment} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body">
              <FormBanner message={editPayFormError} tone="error" className="purchase-banner-spaced" />
              <div className="form-group">
                <label>Chứng từ</label>
                <InfoBox className="mono">{detail.referenceId}</InfoBox>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Số tiền thanh toán (đ)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    className="purchase-money-input-right"
                    value={formatCurrencyInput(editPayForm.amount)}
                    onChange={(e) => {
                      setEditPayForm((p) => ({ ...p, amount: parseMoneyInput(e.target.value) }));
                      if (editPayFormError) clearEditPayFormError();
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>Mức tối đa cho phép</label>
                  <InfoBox className="mono">{formatCurrency(editPayMaxAllowed)}</InfoBox>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Cấn trừ công nợ</label>
                  <InfoBox className={editPaySettledAmount <= editPayMaxAllowed ? "purchase-settled-box purchase-settled-box--ok" : "purchase-settled-box purchase-settled-box--over"}>
                    {formatCurrency(editPaySettledAmount)}
                  </InfoBox>
                </div>
                <div className="form-group" />
              </div>
              {editPaySettledAmount > editPayMaxAllowed ? (
                <div className="purchase-inline-error">
                  Tổng cấn trừ vượt quá mức cho phép của chứng từ.
                </div>
              ) : null}
              <div className="form-group">
                <label>Ghi chú</label>
                <input value={editPayForm.note} onChange={(e) => setEditPayForm((p) => ({ ...p, note: e.target.value }))} />
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closeEditPayment}>Hủy</button>
              <button
                type="button"
                className="btn-primary"
                disabled={saving || editPaySettledAmount <= 0 || editPaySettledAmount > editPayMaxAllowed}
                onClick={submitEditPayment}
              >
                {saving ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* PAY DIALOG */}
      {showPay && selectedRow && (
        <div className="dialog-overlay" onClick={() => { setShowPay(false); clearPayFormError(); }}>
          <div className="dialog-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Thanh Toán Nhà Cung Cấp</h2>
              <button className="close-btn" type="button" onClick={() => { setShowPay(false); clearPayFormError(); }} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body">
              <FormBanner message={payFormError} tone="error" className="purchase-banner-spaced" />
              <div className="form-group">
                <label>Chứng từ</label>
                <InfoBox className="mono">{selectedRow.referenceId}</InfoBox>
              </div>
              <div className="form-group">
                <label>Nhà cung cấp</label>
                <InfoBox>{selectedRow.supplierName}</InfoBox>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Còn nợ</label>
                  <InfoBox className="mono purchase-strong purchase-debt-text">{formatCurrency(selectedRow.debtAmount)}</InfoBox>
                </div>
                <div className="form-group">
                  <label>Số tiền thanh toán (đ)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    className="purchase-money-input-right"
                    value={formatCurrencyInput(payForm.amount)}
                    onChange={(e) => {
                      setPayForm((p) => ({ ...p, amount: parseMoneyInput(e.target.value) }));
                      if (payFormError) clearPayFormError();
                    }}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Cấn trừ công nợ</label>
                  <InfoBox className={paySettledAmount <= Number(selectedRow.debtAmount || 0) ? "purchase-settled-box purchase-settled-box--ok" : "purchase-settled-box purchase-settled-box--over"}>
                    {formatCurrency(paySettledAmount)}
                  </InfoBox>
                </div>
                <div className="form-group" />
              </div>
              {paySettledAmount > Number(selectedRow.debtAmount || 0) && (
                <div className="purchase-inline-error">
                  Số tiền thanh toán không được vượt quá công nợ.
                </div>
              )}
              <div className="form-group">
                <label>Ghi chú</label>
                <input value={payForm.note} onChange={(e) => setPayForm((p) => ({ ...p, note: e.target.value }))} />
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => { setShowPay(false); clearPayFormError(); }}>Hủy</button>
              <button type="button" className="btn-primary" disabled={paySettledAmount <= 0 || paySettledAmount > Number(selectedRow.debtAmount || 0) || saving} onClick={submitPay}>
                {saving ? "Đang lưu..." : "Xác nhận thanh toán"}
              </button>
            </div>
          </div>
        </div>
      )}


      {showVoid && voidTarget ? (
        <div className="dialog-overlay" onClick={() => setShowVoid(false)}>
          <div className="dialog-panel purchase-dialog-panel-460" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Hủy chứng từ mua hàng</h2>
              <button className="close-btn" type="button" onClick={() => setShowVoid(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body">
              <div className={(voidTarget.paidAmount ?? 0) > 0 ? "purchase-void-warning purchase-void-warning--paid" : "purchase-void-warning purchase-void-warning--plain"}>
                {(voidTarget.paidAmount ?? 0) > 0
                  ? <><strong>Chứng từ còn trừ công nợ {formatCurrency(voidTarget.paidAmount)}:</strong> Hãy xử lý xóa công nợ còn lại và đảo ngược tồn kho. Phần đã cấn trừ cần xử lý riêng với NCC. Không thể hoàn tác.</>
                  : <><strong>Lưu ý:</strong> Hủy sẽ đảo ngược tồn kho, tính lại giá vốn và xóa công nợ NCC. Không thể hoàn tác.</>}
              </div>
              <div className="form-group">
                <label>Chứng từ</label>
                <InfoBox className="mono">{voidTarget.referenceId}</InfoBox>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nhà cung cấp</label>
                  <InfoBox>{voidTarget.supplierName}</InfoBox>
                </div>
                <div className="form-group">
                  <label>Giá trị</label>
                  <InfoBox className="mono purchase-strong purchase-debt-text">{formatCurrency(voidTarget.amount)}</InfoBox>
                </div>
              </div>
              <div className="form-group">
                <label>Lý do hủy *</label>
                <input
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="VD: Nhập sai số lượng, nhầm NCC..."
                />
                {voidReason.trim().length > 0 && voidReason.trim().length < 3 ? (
                  <p className="purchase-inline-error purchase-inline-error-top">Lý do phải có ít nhất 3 ký tự</p>
                ) : null}
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowVoid(false)} disabled={saving}>Không hủy</button>
              <button
                type="button"
                className={voidReason.trim().length >= 3 ? "btn-primary purchase-void-btn purchase-void-btn--active" : "btn-primary purchase-void-btn purchase-void-btn--disabled"}
                disabled={voidReason.trim().length < 3 || saving}
                onClick={submitVoid}
              >
                {saving ? "Đang hủy..." : "Xác nhận hủy"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {processingMessage ? (
        <div className="order-processing-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="order-processing-card">
            <span className="order-processing-spinner" aria-hidden="true" />
            <p>{processingMessage}</p>
          </div>
        </div>
      ) : null}

      {/* SUPPLIER REBATE DIALOG */}
      {showRebateDialog && (
        <div className="dialog-overlay" onClick={() => { setShowRebateDialog(false); setRebateSubmitResult(null); clearRebateFormError(); }}>
          <div className="dialog-panel purchase-dialog-panel-620" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Chiết khấu đơn mua</h2>
              <button className="close-btn" type="button" onClick={() => { setShowRebateDialog(false); setRebateSubmitResult(null); clearRebateFormError(); }} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body">
              <div className="purchase-rebate-form-wrap">
                <h3 className="purchase-rebate-form-title">Ghi nhận chiết khấu mới</h3>
                <FormBanner message={rebateFormError} tone="error" className="purchase-banner-spaced" />
                <InfoBox>
                  <div className="purchase-rebate-summary-text">
                    <div>1. Ghi nhận chiết khấu vào PO hiện tại để giảm phải trả.</div>
                    <div>2. Chọn các PO cần phân bổ lại giá vốn theo số tiền chiết khấu.</div>
                    <div>3. Khi xóa khoản chiết khấu này, hệ thống sẽ rollback phân bổ giá vốn đã áp dụng.</div>
                  </div>
                </InfoBox>
                <div className="form-group">
                  <label>Chọn chứng từ áp dụng chiết khấu *</label>
                  {rebateCandidatesLoading ? (
                    <InfoBox><span className="purchase-empty-info">Đang tải danh sách chứng từ...</span></InfoBox>
                  ) : rebateCandidates.length === 0 ? (
                    <InfoBox><span className="purchase-empty-info">Không có chứng từ hợp lệ để áp dụng.</span></InfoBox>
                  ) : (
                    <>
                      <div className="rebate-date-filter-bar">
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
                            className={`rebate-date-filter-btn${rebateDateFilter === opt.value ? " active" : ""}`}
                            onClick={() => setRebateDateFilter(opt.value)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <div className="purchase-table-wrap" style={{ maxHeight: 220 }}>
                        <table className="simple-table purchase-table-sm">
                          <thead>
                            <tr>
                              <th className="purchase-col-actions-60">Chọn</th>
                              <th>Mã chứng từ</th>
                              <th>Ngày</th>
                              <th className="text-right">Giá trị</th>
                              <th className="text-right">Còn nợ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRebateCandidates.length === 0 ? (
                              <tr><td colSpan={5} className="text-center" style={{ color: "#999", padding: "10px 0" }}>Không có chứng từ trong khoảng thời gian này</td></tr>
                            ) : filteredRebateCandidates.map((doc) => {
                              const checked = (rebateForm.selectedReferenceIds || []).includes(doc.referenceId);
                              return (
                                <tr key={doc.referenceId}>
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        toggleRebateReference(doc.referenceId);
                                        if (rebateFormError) clearRebateFormError();
                                      }}
                                    />
                                  </td>
                                  <td className="mono">{doc.referenceId}</td>
                                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{doc.documentDate || (doc.createdAt ? doc.createdAt.slice(0, 10) : "—")}</td>
                                  <td className="text-right mono">{formatCurrency(doc.amount)}</td>
                                  <td className="text-right mono">{formatCurrency(doc.debtAmount)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
                <div className="form-group">
                  <label>Nội dung</label>
                  <input
                    type="text"
                    value={rebateForm.label}
                    onChange={(e) => {
                      setRebateForm((p) => ({ ...p, label: e.target.value }));
                      if (rebateFormError) clearRebateFormError();
                    }}
                    placeholder="VD: Chiết khấu thương mại đợt 1"
                  />
                </div>
                <div className="form-group">
                  <label>Số tiền chiết khấu (đ) *</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="purchase-money-input-right"
                    value={formatCurrencyInput(rebateForm.amount)}
                    onChange={(e) => {
                      setRebateForm((p) => ({ ...p, amount: parseMoneyInput(e.target.value) }));
                      if (rebateFormError) clearRebateFormError();
                    }}
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
                <div className="purchase-action-row">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={Number(rebateForm.amount) <= 0 || rebateSaving || selectedRebateDocs.length === 0}
                    onClick={submitRebate}
                  >
                    {rebateSaving ? "Đang lưu..." : "Ghi nhận chiết khấu"}
                  </button>
                </div>
                {rebateSubmitResult && (
                  <div className="purchase-rebate-result">
                    <FormBanner message="Đã ghi nhận thành công!" tone="success" />
                    <div className="field-hint purchase-rebate-summary-text">
                      <span>Số chứng từ: <strong>{rebateSubmitResult.targetCount || 0}</strong></span>
                      {"  "}
                      <span>Tổng CK: <strong>{formatCurrency(rebateSubmitResult.totalAmount ?? rebateForm.amount)}</strong></span>
                      {"  "}
                      <span>Điều chỉnh GVHB: <strong>{formatCurrency(rebateSubmitResult.cogsAdjustmentAmount || 0)}</strong></span>
                      {"  "}
                      <span>Điều chỉnh tồn kho: <strong>{formatCurrency(rebateSubmitResult.inventoryAdjustmentAmount || 0)}</strong></span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => { setShowRebateDialog(false); setRebateSubmitResult(null); clearRebateFormError(); }}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {showEditRebate && editingRebate ? (
        <div className="dialog-overlay" onClick={closeEditRebate}>
          <div className="dialog-panel purchase-dialog-panel-620" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Sửa chiết khấu đơn mua</h2>
              <button className="close-btn" type="button" onClick={closeEditRebate} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body">
              <FormBanner message={rebateFormError} tone="error" className="purchase-banner-spaced" />
              <div className="form-group">
                <label>Nội dung</label>
                <input
                  type="text"
                  value={editRebateForm.label}
                  onChange={(e) => {
                    setEditRebateForm((p) => ({ ...p, label: e.target.value }));
                    if (rebateFormError) clearRebateFormError();
                  }}
                />
              </div>
              <div className="form-group">
                <label>Số tiền chiết khấu (đ) *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="purchase-money-input-right"
                  value={formatCurrencyInput(editRebateForm.amount)}
                  onChange={(e) => {
                    setEditRebateForm((p) => ({ ...p, amount: parseMoneyInput(e.target.value) }));
                    if (rebateFormError) clearRebateFormError();
                  }}
                />
              </div>
              <div className="form-group">
                <label>Ghi chú</label>
                <input
                  type="text"
                  value={editRebateForm.note}
                  onChange={(e) => setEditRebateForm((p) => ({ ...p, note: e.target.value }))}
                />
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closeEditRebate}>Đóng</button>
              <button type="button" className="btn-primary" onClick={submitEditRebate} disabled={Number(editRebateForm.amount) <= 0 || rebateSaving}>
                {rebateSaving ? "Đang lưu..." : "Cập nhật"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* SUPPLIER MANAGER DIALOG */}
      {showSupplierManager && (
        <div className="dialog-overlay" onClick={() => { setShowSupplierManager(false); setSupplierDetail(null); }}>
          <div className="dialog-panel dialog-panel--purchase" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Danh sách nhà cung cấp</h2>
              <button className="close-btn" type="button" onClick={() => { setShowSupplierManager(false); setSupplierDetail(null); }} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body">
              <div className="advanced-filter-grid" style={{ marginBottom: 12 }}>
                <label>
                  Tìm kiếm
                  <input
                    value={supplierManagerSearch}
                    onChange={(e) => setSupplierManagerSearch(e.target.value)}
                    placeholder="Tên, mã, SĐT, email, địa chỉ..."
                  />
                </label>

                <label>
                  Bộ lọc công nợ
                  <select value={supplierManagerDebtFilter} onChange={(e) => setSupplierManagerDebtFilter(e.target.value)}>
                    <option value="ALL">Tất cả</option>
                    <option value="HAS_DEBT">Còn nợ NCC</option>
                    <option value="NO_DEBT">Không nợ</option>
                  </select>
                </label>
              </div>

              <div className="list-shell purchases-list-shell" style={{ maxHeight: 300, overflow: "auto" }}>
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Mã NCC</th>
                      <th>Tên NCC</th>
                      <th>SĐT</th>
                      <th>Email</th>
                      <th className="text-right">Công nợ</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierManagerRows.length === 0 ? (
                      <tr><td colSpan="6" className="text-center purchase-empty-row-cell">Không có nhà cung cấp phù hợp</td></tr>
                    ) : supplierManagerRows.map((supplier) => (
                      <tr key={supplier.id}>
                        <td className="mono">{supplier.code || "-"}</td>
                        <td>{supplier.name}</td>
                        <td>{supplier.phone || "-"}</td>
                        <td>{supplier.email || "-"}</td>
                        <td className={`text-right mono ${Number(supplier.netBalance || 0) > 0 ? "purchase-debt-text" : "purchase-paid-text"}`}>
                          {formatCurrency(Number(supplier.netBalance || 0))}
                        </td>
                        <td>
                          <button type="button" className="purchase-row-btn" onClick={() => setSupplierDetail(supplier)}>
                            Chi tiết
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {supplierDetail && (
                <InfoBox style={{ marginTop: 12 }}>
                  <div className="purchase-info-grid">
                    <div>
                      <span className="purchase-detail-muted">Tên NCC</span>
                      <strong>{supplierDetail.name || "-"}</strong>
                    </div>
                    <div>
                      <span className="purchase-detail-muted">Mã NCC</span>
                      <strong className="mono">{supplierDetail.code || "-"}</strong>
                    </div>
                    <div>
                      <span className="purchase-detail-muted">SĐT</span>
                      <strong>{supplierDetail.phone || "-"}</strong>
                    </div>
                    <div>
                      <span className="purchase-detail-muted">Email</span>
                      <strong>{supplierDetail.email || "-"}</strong>
                    </div>
                    <div>
                      <span className="purchase-detail-muted">Địa chỉ</span>
                      <strong>{supplierDetail.address || "-"}</strong>
                    </div>
                    <div>
                      <span className="purchase-detail-muted">Công nợ hiện tại</span>
                      <strong className="mono">{formatCurrency(Number(supplierDetail.netBalance || 0))}</strong>
                    </div>
                  </div>
                </InfoBox>
              )}
            </div>

            <div className="dialog-footer">
              <button
                className="btn-secondary"
                type="button"
                onClick={() => {
                  setShowSupplierManager(false);
                  setSupplierForm(initSupplierForm());
                  clearSupplierFormError();
                  setShowCreateSupplier(true);
                }}
              >
                + Tạo NCC
              </button>
              <button className="btn-cancel" type="button" onClick={() => { setShowSupplierManager(false); setSupplierDetail(null); }}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE SUPPLIER DIALOG */}
      {showCreateSupplier && (
        <div className="dialog-overlay" onClick={() => { setShowCreateSupplier(false); clearSupplierFormError(); }}>
          <div className="dialog-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Tạo Nhà Cung Cấp</h2>
              <button className="close-btn" type="button" onClick={() => { setShowCreateSupplier(false); clearSupplierFormError(); }} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body">
              <FormBanner message={supplierFormError} tone="error" className="purchase-banner-spaced" />
              <div className="form-group">
                <label>Tên nhà cung cấp *</label>
                <input
                  type="text"
                  autoFocus
                  className={supplierFormError ? "form-control--invalid" : ""}
                  value={supplierForm.name}
                  onChange={(e) => {
                    setSupplierForm((p) => ({ ...p, name: e.target.value }));
                    if (supplierFormError) clearSupplierFormError();
                  }}
                  placeholder="VD: Công ty TNHH ABC"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Số điện thoại</label>
                  <input
                    type="tel"
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="Tùy chọn"
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={supplierForm.email}
                    onChange={(e) => setSupplierForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="Tùy chọn"
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Địa chỉ</label>
                <input
                  type="text"
                  value={supplierForm.address}
                  onChange={(e) => setSupplierForm((p) => ({ ...p, address: e.target.value }))}
                  placeholder="Tùy chọn"
                />
              </div>
              <div className="form-group">
                <label>Dư nợ đầu kỳ (đ)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  className="purchase-money-input-right"
                  value={formatCurrencyInput(supplierForm.openingBalance)}
                  onChange={(e) => setSupplierForm((p) => ({ ...p, openingBalance: parseMoneyInput(e.target.value) }))}
                />
              </div>
            </div>
            <div className="dialog-footer">
              <button className="btn-cancel" type="button" onClick={() => { setShowCreateSupplier(false); clearSupplierFormError(); }}>Hủy</button>
              <button
                className="btn-primary"
                type="button"
                disabled={!supplierForm.name.trim() || supplierSaving}
                onClick={submitCreateSupplier}
              >
                {supplierSaving ? "Đang lưu..." : "Tạo nhà cung cấp"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DesktopPageFrame>
  );
}






