import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import DesktopPageFrame from "../components/DesktopPageFrame";
import AdvancedFiltersPopover from "../components/AdvancedFiltersPopover";
import DateQuickRanges from "../components/DateQuickRanges";
import SearchableSelect from "../components/SearchableSelect";
import FormBanner from "../components/FormBanner";
import { formatMoneyInput, formatCurrency } from "../utils/currency";
import { formatDateVN } from "../utils/datetime";

const receiptTypes = ["PAYMENT", "DISCOUNT"];
const RECEIVABLE_ORDER_EXCLUDED_STATUSES = ["DRAFT", "CANCELLED", "REFUNDED"];

function receiptTypeLabel(type) {
  if (type === "DISCOUNT") return "DISCOUNT - Giảm trừ công nợ";
  return "PAYMENT - Thu tiền";
}

function receiptStatusLabel(status) {
  if (status === "VOIDED") return "Đã hủy";
  return "Hiệu lực";
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderReceiptPrintHtml(receipt) {
  const receiptNo = receipt?.receiptNo || receipt?.id || "-";
  const customerName = receipt?.customer?.name || "-";
  const collectorName = receipt?.collectedByUser?.fullName || receipt?.collectedByUser?.email || "-";
  const storeName = receipt?.store?.name || "-";
  const amount = Number(receipt?.amount || 0);
  const discountAmount = Number(receipt?.discountAmount || 0);
  const totalApplied = amount + discountAmount;
  const createdAt = receipt?.createdAt || new Date();
  const allocations = Array.isArray(receipt?.allocations) ? receipt.allocations : [];

  const allocationRows = allocations.length
    ? allocations.map((row, index) => `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${escapeHtml(row?.order?.orderNo || row?.orderId || "-")}</td>
        <td class="right">${formatCurrency(Number(row?.appliedAmount || 0))}</td>
      </tr>
    `).join("")
    : `
      <tr>
        <td colspan="3" class="center">Không có đơn hàng phân bổ cụ thể</td>
      </tr>
    `;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Phiếu thu ${escapeHtml(receiptNo)}</title>
  <style>
    @page { size: A5; margin: 10mm; }
    body { font-family: "Times New Roman", serif; color: #111; font-size: 14px; }
    .company { text-align: center; font-size: 24px; font-weight: 700; margin: 0 0 2px; }
    .store { text-align: center; font-size: 15px; margin: 0 0 10px; }
    .title { text-align: center; font-size: 22px; font-weight: 700; margin: 0 0 10px; }
    .meta { border: 1px solid #222; padding: 10px; margin-bottom: 10px; }
    .meta-row { display: flex; margin-bottom: 6px; }
    .meta-row:last-child { margin-bottom: 0; }
    .label { width: 160px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #222; padding: 6px; }
    th { text-align: center; background: #f6f6f6; }
    .center { text-align: center; }
    .right { text-align: right; white-space: nowrap; }
    .summary { margin-top: 10px; border: 1px solid #222; }
    .summary-row { display: flex; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid #ddd; }
    .summary-row:last-child { border-bottom: none; }
    .summary-row.total { font-weight: 700; }
    .note { margin-top: 10px; }
  </style>
</head>
<body>
  <p class="company">TÁ TIẾN</p>
  <p class="store">${escapeHtml(storeName)}</p>
  <h1 class="title">PHIẾU THU</h1>

  <div class="meta">
    <div class="meta-row"><div class="label">Mã phiếu:</div><div>${escapeHtml(receiptNo)}</div></div>
    <div class="meta-row"><div class="label">Khách hàng:</div><div>${escapeHtml(customerName)}</div></div>
    <div class="meta-row"><div class="label">Nhân viên thu:</div><div>${escapeHtml(collectorName)}</div></div>
    <div class="meta-row"><div class="label">Ngày tạo:</div><div>${escapeHtml(formatDateVN(createdAt))}</div></div>
    <div class="meta-row"><div class="label">Loại:</div><div>${escapeHtml(receiptTypeLabel(receipt?.type))}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 50px">STT</th>
        <th>Đơn hàng áp nợ</th>
        <th style="width: 150px">Số tiền áp</th>
      </tr>
    </thead>
    <tbody>${allocationRows}</tbody>
  </table>

  <div class="summary">
    <div class="summary-row"><span>Số tiền thu</span><span>${formatCurrency(amount)}</span></div>
    <div class="summary-row"><span>Số giảm</span><span>${formatCurrency(discountAmount)}</span></div>
    <div class="summary-row total"><span>Tổng cấn nợ</span><span>${formatCurrency(totalApplied)}</span></div>
  </div>

  <p class="note"><strong>Ghi chú:</strong> ${escapeHtml(receipt?.note || "-")}</p>

  <script>
    window.onload = function () {
      window.print();
      setTimeout(function () { window.close(); }, 300);
    };
  </script>
</body>
</html>`;
}

function printReceipt(receipt) {
  const popupWidth = 980;
  const popupHeight = 860;
  const popupLeft = Math.max(Math.round((window.screen.width - popupWidth) / 2), 0);
  const popupTop = Math.max(Math.round((window.screen.height - popupHeight) / 2), 0);
  const popupFeatures = [
    "popup=yes",
    `width=${popupWidth}`,
    `height=${popupHeight}`,
    `left=${popupLeft}`,
    `top=${popupTop}`,
    "resizable=yes",
    "scrollbars=yes",
    "toolbar=no",
    "menubar=no",
    "location=no",
    "status=no"
  ].join(",");

  const printWindow = window.open("", `print_receipt_${Date.now()}`, popupFeatures);
  if (!printWindow) {
    throw new Error("Trình duyệt đang chặn cửa sổ in. Vui lòng cho phép popup.");
  }
  if (typeof printWindow.focus === "function") {
    printWindow.focus();
  }
  printWindow.document.open();
  printWindow.document.write(renderReceiptPrintHtml(receipt));
  printWindow.document.close();
}

function parseMoneyInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? String(Number(digits)) : "";
}

function buildOrderItemsSummary(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) return "Chưa có chi tiết mặt hàng";

  const normalizedItems = items.map((item) => {
    const qty = Math.max(Number(item?.quantity || 0), 0);
    const name = item?.product?.name || item?.name || item?.product?.sku || item?.sku || "Sản phẩm";
    return { name, qty };
  });

  const totalQty = normalizedItems.reduce((sum, item) => sum + item.qty, 0);
  const head = normalizedItems
    .slice(0, 2)
    .map((item) => `${item.name}${item.qty > 0 ? ` x${item.qty}` : ""}`)
    .join(", ");

  const remain = normalizedItems.length - 2;
  const remainLabel = remain > 0 ? ` + ${remain} mặt hàng khác` : "";
  const qtyLabel = totalQty > 0 ? ` (SL: ${totalQty})` : "";
  return `${head}${remainLabel}${qtyLabel}`;
}

function getOrderPaidAmount(order) {
  const totalAmount = Math.max(Number(order?.totalAmount || 0), 0);
  const debtAmount = getReceivableOrderDebt(order);
  const paidFromApi = Number(order?.paidAmount);

  if (Number.isFinite(paidFromApi)) {
    return Math.max(paidFromApi, 0);
  }

  return Math.max(totalAmount - debtAmount, 0);
}

function getReceivableOrderDebt(order) {
  return Math.max(Number(order?.remainingAmount ?? order?.debtAmount ?? 0), 0);
}

function getTodayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function resolveApiDateRange(fromDate, toDate) {
  const today = getTodayIso();
  if (fromDate && toDate) {
    return { fromDate, toDate };
  }
  if (fromDate && !toDate) {
    return { fromDate, toDate: today };
  }
  if (!fromDate && toDate) {
    return { fromDate: toDate, toDate };
  }

  return { fromDate: today, toDate: today };
}

function validateReceiptForm(form, activeStoreId) {
  const errors = {};
  const amount = Number(form.amount);
  const discountAmount = Number(form.discountAmount || 0);

  if (!form.customerId) errors.customerId = "Vui lòng chọn khách hàng.";
  if (!form.type) errors.type = "Vui lòng chọn loại phiếu.";
  if (Number.isNaN(amount) || amount < 0) errors.amount = "Số tiền thu không được âm.";
  if (Number.isNaN(discountAmount) || discountAmount < 0) errors.discountAmount = "Chiết khấu không được âm.";
  if (amount <= 0 && discountAmount <= 0) errors.amount = "Cần nhập Số tiền thu hoặc Chiết khấu lớn hơn 0.";
  if (amount > 0 && form.type !== "PAYMENT") errors.type = "Có Số tiền thu thì loại phiếu bắt buộc là PAYMENT.";
  if (amount === 0 && form.type === "DISCOUNT" && discountAmount <= 0) {
    errors.discountAmount = "Loại DISCOUNT yêu cầu Chiết khấu lớn hơn 0.";
  }
  if (!activeStoreId) errors.storeId = "Không xác định được cửa hàng đang hoạt động.";

  return errors;
}

export default function Receipts({
  receipts: receiptsProp = [],
  token,
  orders = [],
  customers = [],
  activeStoreId,
  onCreateReceipt,
  onVoidReceipt
}) {
  const [receiptsLocal, setReceiptsLocal] = useState(null);
  const receipts = receiptsLocal !== null ? receiptsLocal : receiptsProp;
  const [dateLoading, setDateLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCustomerId, setFilterCustomerId] = useState("");
  const [filterCollectorId, setFilterCollectorId] = useState("");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [freshOrders, setFreshOrders] = useState(null);
  const [loadingFreshOrders, setLoadingFreshOrders] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [createErrors, setCreateErrors] = useState({});
  const [createMessage, setCreateMessage] = useState("");
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidingReceipt, setVoidingReceipt] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidMessage, setVoidMessage] = useState("");
  const [isSubmittingVoid, setIsSubmittingVoid] = useState(false);
  const [form, setForm] = useState({
    customerId: "",
    amount: 0,
    discountAmount: 0,
    type: "PAYMENT",
    note: ""
  });

  const loadByDate = async (from, to) => {
    if (!token) return;
    try {
      setDateLoading(true);
      const dateParams = resolveApiDateRange(from, to);
      const res = await api.receipts(token, dateParams);
      setReceiptsLocal(res.data || res || []);
    } catch {
      // keep current data on error
    } finally {
      setDateLoading(false);
    }
  };

  const loadFreshOrders = async () => {
    if (!token) return;
    const today = getTodayIso();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 10);
    const fromIso = toDateInputValue(from);

    try {
      setLoadingFreshOrders(true);
      const res = await api.orders(token, { fromDate: fromIso, toDate: today });
      setFreshOrders(res.data || res || []);
    } catch {
      setFreshOrders(null);
    } finally {
      setLoadingFreshOrders(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadByDate(filterFromDate, filterToDate);
  }, [token, filterFromDate, filterToDate]);

  const rows = useMemo(() => {
    const k = search.toLowerCase();
    return receipts.filter((row) => {
      const createdTime = new Date(row.createdAt).getTime();

      if (filterCustomerId && row.customerId !== filterCustomerId) {
        return false;
      }

      if (filterCollectorId && row.collectedByUserId !== filterCollectorId) {
        return false;
      }

      if (filterStatus) {
        const rowStatus = row.status === "VOIDED" ? "VOIDED" : "ACTIVE";
        if (rowStatus !== filterStatus) return false;
      }

      if (filterFromDate) {
        const from = new Date(`${filterFromDate}T00:00:00`).getTime();
        if (createdTime < from) return false;
      }

      if (filterToDate) {
        const to = new Date(`${filterToDate}T23:59:59`).getTime();
        if (createdTime > to) return false;
      }

      if (!k) return true;
      const ref = (row.receiptNo || row.id || "").toLowerCase();
      const customer = (row.customer?.name || "").toLowerCase();
      const collector = (row.collectedByUser?.fullName || row.collectedByUser?.email || "").toLowerCase();
      return ref.includes(k) || customer.includes(k) || collector.includes(k);
    });
  }, [receipts, search, filterCustomerId, filterCollectorId, filterStatus, filterFromDate, filterToDate]);

  const collectorOptions = useMemo(() => {
    const map = new Map();
    receipts.forEach((row) => {
      if (row.collectedByUserId) {
        const label = row.collectedByUser?.fullName || row.collectedByUser?.email || row.collectedByUserId;
        map.set(row.collectedByUserId, label);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [receipts]);

  const debtOrders = useMemo(() => {
    if (!form.customerId) return [];

    const orderSource = Array.isArray(freshOrders) ? freshOrders : orders;
    const customerOrders = orderSource.filter(o => o.customerId === form.customerId);
    
    // Lấy đơn còn nợ có thể thu tiền (loại trừ trạng thái không còn hiệu lực công nợ)
    const result = customerOrders
      .filter((order) => {
        const debtAmount = getReceivableOrderDebt(order);
        if (debtAmount <= 0) return false;

        const status = String(order.status || "").trim().toUpperCase();
        return !RECEIVABLE_ORDER_EXCLUDED_STATUSES.includes(status);
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    return result;
  }, [orders, freshOrders, form.customerId]);

  const selectedCustomer = useMemo(() => {
    return customers.find((customer) => customer.id === form.customerId) || null;
  }, [customers, form.customerId]);

  // Tính nợ từ số dư đầu kỳ theo cùng rule backend: netBalance - tổng nợ đơn còn hiệu lực.
  const openingBalanceDebt = useMemo(() => {
    if (!selectedCustomer) return 0;
    const totalOrderDebt = debtOrders.reduce((sum, order) => sum + getReceivableOrderDebt(order), 0);
    return Math.max(Number(selectedCustomer.netBalance || 0) - totalOrderDebt, 0);
  }, [selectedCustomer, debtOrders]);

  const totalSelectedDebt = useMemo(() => {
    return debtOrders
      .filter((order) => selectedOrderIds.includes(order.id))
      .reduce((sum, order) => sum + getReceivableOrderDebt(order), 0);
  }, [debtOrders, selectedOrderIds]);

  useEffect(() => {
    // Tự động ghi lại form.amount khi chọn đơn hoặc có nợ từ số dư đầu kỳ
    if (selectedOrderIds.length === 0) {
      // Nếu không chọn đơn nào nhưng có nợ từ số dư đầu kỳ, hiển thị nó
      if (Number(openingBalanceDebt || 0) > 0) {
        setForm((prev) => ({
          ...prev,
          amount: Number(openingBalanceDebt)
        }));
      }
      return;
    }
    // Tổng = nợ từ số dư đầu kỳ + nợ từ các đơn chọn
    setForm((prev) => ({
      ...prev,
      amount: Math.max(Number(openingBalanceDebt || 0) + Number(totalSelectedDebt || 0), 0)
    }));
  }, [selectedOrderIds, totalSelectedDebt, openingBalanceDebt]);

  const canSubmit = form.customerId && (Number(form.amount) > 0 || Number(form.discountAmount) > 0) && activeStoreId;
  const totalAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalDiscount = rows.reduce((sum, row) => sum + Number(row.discountAmount || 0), 0);
  const advancedFilterCount = [
    Boolean(filterCustomerId),
    Boolean(filterCollectorId),
    Boolean(filterStatus),
    Boolean(filterFromDate),
    Boolean(filterToDate)
  ].filter(Boolean).length;

  const resetCreateForm = () => {
    setForm({
      customerId: "",
      amount: 0,
      discountAmount: 0,
      type: "PAYMENT",
      note: ""
    });
    setSelectedOrderIds([]);
    setCreateErrors({});
    setCreateMessage("");
  };

  const handleCreateFormChange = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      const nextAmount = Number(field === "amount" ? value : next.amount || 0);
      if (nextAmount > 0) {
        next.type = "PAYMENT";
      }
      return next;
    });
    setCreateErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    if (createMessage) {
      setCreateMessage("");
    }
  };

  const openCreateDialog = async () => {
    resetCreateForm();
    setShowCreateDialog(true);
    await loadFreshOrders();
  };

  const submit = async () => {
    const errors = validateReceiptForm(form, activeStoreId);
    if (Object.keys(errors).length) {
      setCreateErrors(errors);
      setCreateMessage("Biểu mẫu còn lỗi. Vui lòng kiểm tra các trường được đánh dấu.");
      return;
    }

    try {
      await onCreateReceipt({
        customerId: form.customerId,
        storeId: activeStoreId,
        paymentMethod: "CASH",
        amount: Number(form.amount),
        discountAmount: Number(form.discountAmount || 0),
        type: form.type,
        note: form.note || undefined,
        orderIds: selectedOrderIds
      });

      resetCreateForm();
      setShowCreateDialog(false);
      await loadByDate(filterFromDate, filterToDate);
    } catch (error) {
      setCreateMessage(`Tạo phiếu thu thất bại: ${error?.message || error}`);
    }
  };

  const openVoidDialog = (receipt) => {
    setVoidingReceipt(receipt);
    setVoidReason("");
    setVoidMessage("");
    setShowVoidDialog(true);
  };

  const submitVoidReceipt = async () => {
    if (!voidingReceipt?.id || !onVoidReceipt) return;
    const reason = voidReason.trim();
    if (reason.length < 3) {
      setVoidMessage("Lý do hủy cần tối thiểu 3 ký tự.");
      return;
    }

    try {
      setIsSubmittingVoid(true);
      await onVoidReceipt(voidingReceipt.id, { reason });
      setShowVoidDialog(false);
      setVoidingReceipt(null);
      setVoidReason("");
      setVoidMessage("");
      await loadByDate(filterFromDate, filterToDate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoidMessage(`Hủy phiếu thu thất bại: ${message}`);
    } finally {
      setIsSubmittingVoid(false);
    }
  };

  const toggleOrder = (orderId) => {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  };

  const resetFilters = () => {
    setSearch("");
    setFilterCustomerId("");
    setFilterCollectorId("");
    setFilterStatus("");
    setFilterFromDate("");
    setFilterToDate("");
  };

  return (
    <DesktopPageFrame
      title="Phiếu thu"
      description="Ghi nhận thu tiền, chiết khấu thanh toán và áp vào công nợ đơn hàng"
      kpis={[
        { label: "Tổng phiếu", value: rows.length },
        { label: "Tổng tiền thu", value: formatCurrency(totalAmount), mono: true },
        { label: "Tổng chiết khấu", value: formatCurrency(totalDiscount), mono: true },
        { label: "Khách hàng", value: customers.length }
      ]}
      actions={(
        <button type="button" className="btn-primary" onClick={openCreateDialog}>
          + Tạo phiếu thu
        </button>
      )}
      filters={(
        <>
          <input
            className="filter-wide"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo mã phiếu, tên khách, nhân viên thu"
          />
          <AdvancedFiltersPopover activeCount={advancedFilterCount}>
            <DateQuickRanges
              fromDate={filterFromDate}
              toDate={filterToDate}
              setFromDate={setFilterFromDate}
              setToDate={setFilterToDate}
            />
            <div className="advanced-filter-grid">
              <label>
                Khách hàng
                <SearchableSelect
                  value={filterCustomerId}
                  onChange={setFilterCustomerId}
                  options={customers.map((customer) => ({
                    value: customer.id,
                    label: customer.name,
                    description: customer.phone || customer.code || ""
                  }))}
                  allLabel="Tất cả khách hàng"
                  searchPlaceholder="Gõ tên hoặc số điện thoại"
                />
              </label>

              <label>
                Nhân viên thu
                <select value={filterCollectorId} onChange={(e) => setFilterCollectorId(e.target.value)}>
                  <option value="">Tất cả nhân viên thu</option>
                  {collectorOptions.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Trạng thái
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="">Tất cả trạng thái</option>
                  <option value="ACTIVE">Hiệu lực</option>
                  <option value="VOIDED">Đã hủy</option>
                </select>
              </label>

              <label>
                Từ ngày
                <input type="date" value={filterFromDate} onChange={(e) => {
                  const v = e.target.value;
                  setFilterFromDate(v);
                }} />
              </label>

              <label>
                Đến ngày
                <input type="date" value={filterToDate} onChange={(e) => {
                  const v = e.target.value;
                  setFilterToDate(v);
                }} />
              </label>
            </div>
          </AdvancedFiltersPopover>
          <button type="button" className="btn-secondary purchases-reset-btn" onClick={resetFilters}>Xóa lọc</button>
        </>
      )}
    >
      <div className="list-shell">
        <table className="simple-table">
          <thead>
            <tr>
              <th>Mã phiếu</th>
              <th>Khách hàng</th>
              <th>Nhân viên thu</th>
              <th>Ngày tạo</th>
              <th>Loại</th>
              <th>Trạng thái</th>
              <th className="text-right">Áp đơn</th>
              <th className="text-right">Số tiền</th>
              <th className="text-right">Chiết khấu</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="10" className="text-center">Không có dữ liệu</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.receiptNo || row.id.slice(0, 8)}</td>
                  <td>{row.customer?.name || "-"}</td>
                  <td>{row.collectedByUser?.fullName || row.collectedByUser?.email || "-"}</td>
                  <td>{formatDateVN(row.createdAt)}</td>
                  <td>{receiptTypeLabel(row.type)}</td>
                  <td>
                    <span className={row.status === "VOIDED" ? "inventory-movement-badge inventory-movement-badge--out" : "inventory-movement-badge inventory-movement-badge--in"}>
                      {receiptStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="text-right mono">{Array.isArray(row.allocations) ? row.allocations.length : 0}</td>
                  <td className="text-right mono">{formatCurrency(row.amount)}</td>
                  <td className="text-right mono">{formatCurrency(row.discountAmount)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          try {
                            printReceipt(row);
                          } catch (error) {
                            const message = error instanceof Error ? error.message : "Không thể mở cửa sổ in";
                            alert(message);
                          }
                        }}
                      >
                        In phiếu
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => openVoidDialog(row)}
                        disabled={row.status === "VOIDED" || !onVoidReceipt}
                      >
                        Hủy phiếu
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreateDialog ? (
        <div className="dialog-overlay" onClick={() => setShowCreateDialog(false)}>
          <div className="dialog-panel dialog-panel--receipt-create" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Tạo Phiếu Thu</h2>
                <p className="product-create-subtitle">Ghi nhận tiền thu và áp công nợ theo khách hàng đang giao dịch.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowCreateDialog(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body product-create-body">
              <section className="product-create-hero detail-card">
                <div>
                  <span className="product-edit-eyebrow">Phiếu thu mới</span>
                  <h3>{selectedCustomer?.name || "Chưa chọn khách hàng"}</h3>
                  <p>{form.type} · {formatCurrency(Number(form.amount || 0))}</p>
                </div>
                <div className="product-edit-chip-row">
                  <span className="product-edit-chip">Áp đơn {selectedOrderIds.length}</span>
                  <span className="product-edit-chip">Chiết khấu {formatCurrency(Number(form.discountAmount || 0))}</span>
                  <span className="product-edit-chip">Cửa hàng {activeStoreId ? "Sẵn sàng" : "Thiếu cấu hình"}</span>
                </div>
              </section>

              <FormBanner message={createMessage} tone="error" />
              <FormBanner message={createErrors.storeId} tone="error" />

              <section className="detail-card">
                <h3>Thông tin phiếu thu</h3>
                <div className="grid-2">
                  <div>
                    <label>Khách hàng</label>
                    <SearchableSelect
                      value={form.customerId}
                      onChange={(nextValue) => {
                        handleCreateFormChange("customerId", nextValue || "");
                        setSelectedOrderIds([]);
                      }}
                      options={customers.map((customer) => ({
                        value: customer.id,
                        label: customer.name,
                        description: [customer.phone, customer.code, customer.ledgerCode]
                          .filter(Boolean)
                          .join(" · "),
                        keywords: `${customer.name || ""} ${customer.phone || ""} ${customer.code || ""} ${customer.ledgerCode || ""}`
                      }))}
                      allLabel="Chọn khách hàng"
                      searchPlaceholder="Gõ tên, SĐT hoặc mã khách"
                    />
                    {createErrors.customerId ? <div className="field-error">{createErrors.customerId}</div> : null}
                  </div>

                  <div>
                    <label>Loại phiếu</label>
                    <select
                      className={createErrors.type ? "form-control form-control--invalid" : "form-control"}
                      value={form.type}
                      onChange={(e) => handleCreateFormChange("type", e.target.value)}
                      disabled={Number(form.amount || 0) > 0}
                    >
                      {receiptTypes.map((t) => (
                        <option key={t} value={t}>{receiptTypeLabel(t)}</option>
                      ))}
                    </select>
                    {createErrors.type ? <div className="field-error">{createErrors.type}</div> : null}
                  </div>

                  <div>
                    <label>Số tiền thu</label>
                    <input
                      className={createErrors.amount ? "form-control form-control--invalid" : "form-control"}
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      style={{ textAlign: "right" }}
                      value={formatMoneyInput(form.amount)}
                      onChange={(e) => handleCreateFormChange("amount", parseMoneyInput(e.target.value))}
                    />
                    {createErrors.amount ? <div className="field-error">{createErrors.amount}</div> : null}
                  </div>

                  <div>
                    <label>Chiết khấu</label>
                    <input
                      className={createErrors.discountAmount ? "form-control form-control--invalid" : "form-control"}
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      style={{ textAlign: "right" }}
                      value={formatMoneyInput(form.discountAmount)}
                      onChange={(e) => handleCreateFormChange("discountAmount", parseMoneyInput(e.target.value))}
                    />
                    {createErrors.discountAmount ? <div className="field-error">{createErrors.discountAmount}</div> : null}
                  </div>

                  <div>
                    <label>Ghi chú</label>
                    <input
                      className="form-control"
                      value={form.note}
                      onChange={(e) => handleCreateFormChange("note", e.target.value)}
                      placeholder="Tùy chọn"
                    />
                  </div>
                </div>
              </section>

              {selectedCustomer ? (
                <section className="detail-card">
                  <h3>Tóm tắt công nợ khách hàng</h3>
                  <div className="purchase-info-box" style={{ marginTop: 0 }}>
                    <div className="orders-detail-row"><span>Số dư ròng</span><strong>{formatCurrency(selectedCustomer.netBalance)}</strong></div>
                    <div className="orders-detail-row"><span>Nợ từ số dư đầu kỳ</span><strong>{formatCurrency(openingBalanceDebt)}</strong></div>
                    <div className="orders-detail-row"><span>Thu vượt/trả trước</span><strong>{formatCurrency(Math.max(-Number(selectedCustomer.netBalance || 0), 0))}</strong></div>
                    <div className="orders-detail-row"><span>Công nợ đơn đã chọn</span><strong>{formatCurrency(totalSelectedDebt)}</strong></div>
                    <div className="orders-detail-row" style={{ borderTop: "1px solid #ddd", paddingTop: 8, marginTop: 8 }}><span>Tổng cần thu</span><strong>{formatCurrency(openingBalanceDebt + totalSelectedDebt)}</strong></div>
                  </div>
                </section>
              ) : null}

              {debtOrders.length ? (
                <section className="detail-card">
                  <h3>Đơn hàng công nợ cần thu</h3>
                  {loadingFreshOrders ? (
                    <p style={{ margin: "0 0 8px", color: "#5f6b7a", fontSize: 13 }}>
                      Đang tải lại danh sách đơn hàng...
                    </p>
                  ) : null}
                  <div
                    style={{
                      margin: "0 0 8px",
                      padding: "8px 10px",
                      border: "1px solid #c9d8ff",
                      borderRadius: 8,
                      background: "#f3f7ff",
                      color: "#1f3f8f",
                      fontSize: 13
                    }}
                  >
                    <strong>Lưu ý quan trọng:</strong> Nếu không chọn đơn cụ thể, hệ thống sẽ ưu tiên cấn số dư đầu kỳ trước,
                    sau đó mới phân bổ vào đơn nợ từ cũ đến mới.
                  </div>
                  <p style={{ margin: "0 0 8px", color: "#5f6b7a", fontSize: 13 }}>
                    Mẹo: Chọn đơn cụ thể nếu bạn muốn chỉ định chính xác đơn nào được cấn nợ trước.
                  </p>
                  <div className="debt-orders-box">
                    <div className="debt-orders-list">
                      {debtOrders.map((order) => {
                        const checked = selectedOrderIds.includes(order.id);
                        const totalAmount = Math.max(Number(order.totalAmount || 0), 0);
                        const paidAmount = getOrderPaidAmount(order);
                        const debtAmount = getReceivableOrderDebt(order);
                        const orderSummary = buildOrderItemsSummary(order);
                        return (
                          <label key={order.id} className={`debt-order-item ${checked ? "selected" : ""}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOrder(order.id)}
                            />
                            <div className="debt-order-main">
                              <div className="debt-order-row">
                                <span className="mono debt-order-no">{order.orderNo || order.id.slice(0, 8)}</span>
                                <span className="debt-order-date">{formatDateVN(order.createdAt)}</span>
                              </div>
                              <p className="debt-order-summary">Tóm tắt: {orderSummary}</p>
                              <p className="debt-order-money">
                                Tổng đơn: {formatCurrency(totalAmount)} • Đã thu: {formatCurrency(paidAmount)} • Còn nợ: {formatCurrency(debtAmount)}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => { resetCreateForm(); setShowCreateDialog(false); }}>Hủy</button>
              <button type="button" className="btn-primary" onClick={submit} disabled={!canSubmit}>Tạo phiếu thu</button>
            </div>
          </div>
        </div>
      ) : null}

      {showVoidDialog ? (
        <div className="dialog-overlay" onClick={() => setShowVoidDialog(false)}>
          <div className="dialog-panel dialog-panel--receipt-create" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Hủy phiếu thu</h2>
                <p className="product-create-subtitle">Thao tác này sẽ hoàn tác phân bổ công nợ và đánh dấu phiếu thu là đã hủy.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowVoidDialog(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body product-create-body">
              <section className="detail-card">
                <div className="orders-detail-row"><span>Mã phiếu</span><strong>{voidingReceipt?.receiptNo || voidingReceipt?.id?.slice(0, 8) || "-"}</strong></div>
                <div className="orders-detail-row"><span>Khách hàng</span><strong>{voidingReceipt?.customer?.name || "-"}</strong></div>
                <div className="orders-detail-row"><span>Số tiền thu</span><strong>{formatCurrency(voidingReceipt?.amount || 0)}</strong></div>
                <div className="orders-detail-row"><span>Chiết khấu</span><strong>{formatCurrency(voidingReceipt?.discountAmount || 0)}</strong></div>
              </section>

              <FormBanner message={voidMessage} tone="error" />

              <section className="detail-card">
                <label>Lý do hủy</label>
                <textarea
                  rows={4}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Nhập lý do hủy phiếu thu"
                />
                <div className="field-hint">Lý do sẽ được lưu vào lịch sử để đối soát.</div>
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowVoidDialog(false)} disabled={isSubmittingVoid}>Đóng</button>
              <button type="button" className="btn-primary" onClick={submitVoidReceipt} disabled={isSubmittingVoid || voidReason.trim().length < 3}>
                {isSubmittingVoid ? "Đang hủy..." : "Xác nhận hủy"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DesktopPageFrame>
  );
}






