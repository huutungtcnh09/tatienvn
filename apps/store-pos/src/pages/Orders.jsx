import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import DesktopPageFrame from "../components/DesktopPageFrame";
import AdvancedFiltersPopover from "../components/AdvancedFiltersPopover";
import PrintOrder from "../components/PrintOrder";
import DateQuickRanges from "../components/DateQuickRanges";
import SearchableSelect from "../components/SearchableSelect";
import FormBanner from "../components/FormBanner";
import { formatMoneyInput as formatCurrencyInput, formatCurrency } from "../utils/currency";
import { formatDateTimeVN, formatDateVN } from "../utils/datetime";
import { useFormError } from "../utils/formFeedback";

function parseMoneyInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? String(Number(digits)) : "";
}

function statusLabel(status) {
  const map = {
    DRAFT: "Nháp",
    CONFIRMED: "Xác nhận",
    PROCESSING: "Đang xử lý",
    DELIVERED: "Đã giao",
    COMPLETED: "Hoàn thành",
    CANCELLED: "Hủy",
    RETURNED: "Trả lại",
    REFUNDED: "Hoàn tiền"
  };
  return map[status] || status;
}

const statusTone = {
  DRAFT: { background: "#eef2ff", color: "#3730a3" },
  CONFIRMED: { background: "#e0f2fe", color: "#075985" },
  PROCESSING: { background: "#fff7ed", color: "#c2410c" },
  DELIVERED: { background: "#e0f2fe", color: "#0c4a6e" },
  COMPLETED: { background: "#dcfce7", color: "#166534" },
  CANCELLED: { background: "#fee2e2", color: "#b91c1c" },
  RETURNED: { background: "#fef3c7", color: "#92400e" },
  REFUNDED: { background: "#f3e8ff", color: "#6b21a8" }
};

function StatusPill({ status }) {
  return (
    <span className="orders-status-pill" style={statusTone[status] || statusTone.DRAFT}>
      {statusLabel(status)}
    </span>
  );
}

function paymentStatusInfo(paidAmount, totalAmount) {
  const paid = Number(paidAmount || 0);
  const total = Number(totalAmount || 0);
  if (total <= 0 || paid >= total) {
    return { label: "Đã thanh toán", background: "#dcfce7", color: "#166534" };
  }
  if (paid <= 0) {
    return { label: "Chưa thanh toán", background: "#fee2e2", color: "#b91c1c" };
  }
  return { label: "Thanh toán một phần", background: "#fff7ed", color: "#c2410c" };
}

function getTodayDateValue() {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

function toDateInputValue(date) {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

function resolveApiDateRange(fromDate, toDate) {
  const today = getTodayDateValue();
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

function resolveLineTotal(item) {
  const qty = Number(item?.quantity || 0);
  const unitPrice = Number(item?.unitPrice || 0);
  const discountAmount = Number(item?.discountAmount || 0);
  const totalFromApi = Number(item?.totalAmount);
  if (Number.isFinite(totalFromApi)) {
    return Math.max(totalFromApi, 0);
  }
  return Math.max(qty * unitPrice - discountAmount, 0);
}

function resolveDisplayUnitPrice(item) {
  const qty = Math.max(Number(item?.quantity || 0), 0);
  if (qty <= 0) return Number(item?.unitPrice || 0);
  return resolveLineTotal(item) / qty;
}

function resolveLineDiscount(item) {
  const discountFromApi = Number(item?.discountAmount);
  if (Number.isFinite(discountFromApi)) {
    return Math.max(discountFromApi, 0);
  }

  const qty = Number(item?.quantity || 0);
  const unitPrice = Number(item?.unitPrice || 0);
  return Math.max(qty * unitPrice - resolveLineTotal(item), 0);
}

function PaymentBadge({ paidAmount, totalAmount }) {
  const info = paymentStatusInfo(paidAmount, totalAmount);
  return (
    <span className="orders-status-pill" style={info}>{info.label}</span>
  );
}

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

const statusTransitions = {
  DRAFT: ["CONFIRMED", "DELIVERED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "DELIVERED", "CANCELLED"],
  PROCESSING: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  RETURNED: [],
  REFUNDED: []
};

export default function Orders({
  orders: ordersProp = [],
  token,
  products = [],
  inventory = [],
  onUpdateOrderItems,
  onUpdateStatus,
  onReturnRefund
}) {
  const [ordersLocal, setOrdersLocal] = useState(null); // null = use prop
  const orders = ordersLocal !== null ? ordersLocal : ordersProp;
  const [dateLoading, setDateLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [processorFilter, setProcessorFilter] = useState("ALL");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadByDate = async (from, to) => {
    if (!token) return;
    try {
      setDateLoading(true);
      const dateParams = resolveApiDateRange(from, to);
      const res = await api.orders(token, dateParams);
      setOrdersLocal(res.data || res || []);
    } catch {
      // keep current data on error
    } finally {
      setDateLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadByDate(fromDate, toDate);
  }, [token, fromDate, toDate]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [nextStatus, setNextStatus] = useState("");
  const [returnForm, setReturnForm] = useState({ note: "" });
  const [returnItems, setReturnItems] = useState({});
  const [returnSettlementMode, setReturnSettlementMode] = useState("CREDIT_BALANCE");
  const [actionLoading, setActionLoading] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const { error: orderFormError, setError: setOrderFormError, clearError: clearOrderFormError } = useFormError();
  const { error: returnFormError, setError: setReturnFormError, clearError: clearReturnFormError } = useFormError();
  const selectedOrderDebt = Math.max(Number(selectedOrder?.debtAmount || 0), 0);
  const canMarkCompleted = selectedOrderDebt <= 0;
  const canReturnOrder = ["DELIVERED", "COMPLETED"].includes(String(selectedOrder?.status || ""));

  const rows = useMemo(() => {
    return orders.filter((row) => {
      const ref = (row.orderNo || row.id || "").toLowerCase();
      const customer = (row.customer?.name || "").toLowerCase();
      const created = new Date(row.createdAt).getTime();
      const matchedSearch = !search || ref.includes(search.toLowerCase()) || customer.includes(search.toLowerCase());
      const matchedStatus = status === "ALL" || row.status === status;
      const matchedCustomer = customerFilter === "ALL" || row.customerId === customerFilter;
      const matchedProcessor = processorFilter === "ALL" || row.createdByUserId === processorFilter;
      const matchedOwner = ownerFilter === "ALL" || getOwnerKey(row) === ownerFilter;

      if (!matchedSearch || !matchedStatus || !matchedCustomer || !matchedProcessor || !matchedOwner) {
        return false;
      }

      if (fromDate) {
        const from = new Date(`${fromDate}T00:00:00`).getTime();
        if (created < from) return false;
      }
      if (toDate) {
        const to = new Date(`${toDate}T23:59:59`).getTime();
        if (created > to) return false;
      }

      return true;
    });
  }, [orders, search, status, customerFilter, processorFilter, ownerFilter, fromDate, toDate]);

  const summary = useMemo(() => {
    return rows.reduce((acc, row) => {
      acc.total += 1;
      if (["DRAFT", "CONFIRMED", "PROCESSING"].includes(row.status)) acc.processing += 1;
      if (row.status === "COMPLETED") acc.completed += 1;
      const rowDebt = Math.max(Number(row.debtAmount || 0), 0);
      if (!["CANCELLED", "REFUNDED"].includes(String(row.status))) {
        acc.debt += rowDebt;
      }
      return acc;
    }, { total: 0, processing: 0, completed: 0, debt: 0 });
  }, [rows]);

  const topOwnerKpi = useMemo(() => {
    const byOwner = new Map();
    rows.forEach((order) => {
      const key = getOwnerKey(order) || "unknown";
      const label = getOwnerLabel(order);
      const bucket = byOwner.get(key) || { label, orders: 0, revenue: 0 };
      bucket.orders += 1;
      bucket.revenue += Number(order.totalAmount || 0);
      byOwner.set(key, bucket);
    });
    const list = Array.from(byOwner.values());
    if (!list.length) return null;
    return list.sort((a, b) => b.revenue - a.revenue)[0];
  }, [rows]);

  const topCreatorKpi = useMemo(() => {
    const byCreator = new Map();
    rows.forEach((order) => {
      const key = order.createdByUserId || "unknown";
      const label = getCreatorLabel(order);
      const bucket = byCreator.get(key) || { label, orders: 0, revenue: 0 };
      bucket.orders += 1;
      bucket.revenue += Number(order.totalAmount || 0);
      byCreator.set(key, bucket);
    });
    const list = Array.from(byCreator.values());
    if (!list.length) return null;
    return list.sort((a, b) => b.orders - a.orders || b.revenue - a.revenue)[0];
  }, [rows]);

  const advancedFilterCount = [
    customerFilter !== "ALL",
    processorFilter !== "ALL",
    ownerFilter !== "ALL",
    Boolean(fromDate),
    Boolean(toDate)
  ].filter(Boolean).length;

  const customerOptions = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      if (order.customerId) {
        map.set(order.customerId, order.customer?.name || order.customerId);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ value: id, label: name }));
  }, [orders]);

  const processorOptions = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      if (order.createdByUserId) {
        const label = order.createdByUser?.fullName || order.createdByUser?.email || order.createdByUserId;
        map.set(order.createdByUserId, label);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [orders]);

  const ownerOptions = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      const key = getOwnerKey(order);
      if (!key || map.has(key)) return;
      map.set(key, getOwnerLabel(order));
    });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [orders]);

  const editableStatuses = new Set(["DRAFT", "CONFIRMED"]);
  const canEditOrderItems = Boolean(selectedOrder && editableStatuses.has(String(selectedOrder.status)));
  const transitionOptions = useMemo(() => {
    if (!selectedOrder) return [];
    return (statusTransitions[selectedOrder.status] || []).filter((s) => s !== "COMPLETED" || canMarkCompleted);
  }, [selectedOrder, canMarkCompleted]);

  const productSelectOptions = useMemo(() => {
    return (products || []).map((product) => ({
      value: product.id,
      label: `${product.sku || "NO-SKU"} - ${product.name || product.id}`,
      description: `${product.name || ""}${product.category?.name ? ` | ${product.category.name}` : ""}`,
      keywords: `${product.sku || ""} ${product.name || ""} ${product.category?.name || ""}`
    }));
  }, [products]);

  const productById = useMemo(() => {
    const map = new Map();
    (products || []).forEach((product) => {
      map.set(product.id, product);
    });
    return map;
  }, [products]);

  const productLabelMap = useMemo(() => {
    const map = new Map();
    (products || []).forEach((product) => {
      map.set(product.id, `${product.sku || "NO-SKU"} - ${product.name || product.id}`);
    });
    return map;
  }, [products]);

  const inventoryAvailableMap = useMemo(() => {
    const map = new Map();
    (inventory || []).forEach((row) => {
      map.set(row.productId, Number(row.availableQuantity || 0));
    });
    return map;
  }, [inventory]);

  const originalQtyByProduct = useMemo(() => {
    const map = new Map();
    (selectedOrder?.items || []).forEach((item) => {
      map.set(item.productId, (map.get(item.productId) || 0) + Number(item.quantity || 0));
    });
    return map;
  }, [selectedOrder]);

  const editQtyByProduct = useMemo(() => {
    const map = new Map();
    (editItems || []).forEach((item) => {
      if (!item.productId) return;
      map.set(item.productId, (map.get(item.productId) || 0) + Number(item.quantity || 0));
    });
    return map;
  }, [editItems]);

  const stockConflicts = useMemo(() => {
    if (!editMode || !selectedOrder?.isReserved) return [];

    const ids = new Set([...originalQtyByProduct.keys(), ...editQtyByProduct.keys()]);
    const conflicts = [];

    ids.forEach((productId) => {
      const oldQty = Number(originalQtyByProduct.get(productId) || 0);
      const newQty = Number(editQtyByProduct.get(productId) || 0);
      const available = Number(inventoryAvailableMap.get(productId) || 0);
      const maxAllowed = oldQty + available;

      if (newQty > maxAllowed) {
        conflicts.push({
          productId,
          label: productLabelMap.get(productId) || productId,
          requested: newQty,
          available,
          maxAllowed,
          excess: newQty - maxAllowed
        });
      }
    });

    return conflicts;
  }, [editMode, selectedOrder, originalQtyByProduct, editQtyByProduct, inventoryAvailableMap, productLabelMap]);

  const stockConflictMap = useMemo(() => {
    const map = new Map();
    stockConflicts.forEach((row) => map.set(row.productId, row));
    return map;
  }, [stockConflicts]);

  const openDetail = (order) => {
    const initItems = {};
    (order.items || []).forEach((item) => {
      initItems[item.id] = 0;
    });

    setSelectedOrder(order);
    setEditMode(false);
    setEditItems(
      (order.items || []).map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        discountAmount: Number(item.discountAmount || 0),
        isGift: Boolean(item.isGift)
      }))
    );
    setNextStatus("");
    setReturnForm({
      note: ""
    });
    clearOrderFormError();
    clearReturnFormError();
    setReturnSettlementMode("CREDIT_BALANCE");
    setReturnItems(initItems);
  };

  const closeDetail = () => {
    setSelectedOrder(null);
    setEditMode(false);
    setEditItems([]);
    setNextStatus("");
    setReturnItems({});
    setReturnSettlementMode("CREDIT_BALANCE");
    clearOrderFormError();
    clearReturnFormError();
    setReturnDialogOpen(false);
    setActionLoading(false);
  };

  const openReturn = () => {
    if (!selectedOrder) return;
    if (!canReturnOrder) {
      setReturnFormError("Chỉ được trả hàng khi đơn ở trạng thái Đã giao hoặc Hoàn thành.");
      return;
    }
    const initItems = {};
    (selectedOrder.items || []).forEach((item) => {
      initItems[item.id] = 0;
    });
    setReturnItems(initItems);
    setReturnForm({
      note: ""
    });
    clearReturnFormError();
    setReturnSettlementMode("CREDIT_BALANCE");
    setReturnDialogOpen(true);
  };

  const closeReturn = () => {
    setReturnDialogOpen(false);
    setReturnItems({});
    clearReturnFormError();
    setReturnSettlementMode("CREDIT_BALANCE");
  };

  const selectedReturnItems = useMemo(() => {
    if (!selectedOrder) return [];

    return (selectedOrder.items || [])
      .map((item) => {
        const qty = Math.min(
          Math.max(Number(returnItems[item.id] || 0), 0),
          Number(item.quantity || 0)
        );
        if (qty <= 0) return null;

        const amount = (resolveLineTotal(item) / Math.max(Number(item.quantity || 1), 1)) * qty;
        return {
          orderItemId: item.id,
          quantity: qty,
          amount
        };
      })
      .filter(Boolean);
  }, [selectedOrder, returnItems]);

  const selectedReturnAmount = useMemo(() => {
    return selectedReturnItems.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }, [selectedReturnItems]);

  const returnSettlementPreview = useMemo(() => {
    if (!selectedOrder) {
      return { paidReduction: 0, canSettlePaid: false };
    }

    const currentTotal = Number(selectedOrder.totalAmount || 0);
    const currentPaid = Number(selectedOrder.paidAmount || 0);
    const nextTotal = Math.max(currentTotal - Number(selectedReturnAmount || 0), 0);
    const nextPaid = Math.min(currentPaid, nextTotal);
    const paidReduction = Math.max(currentPaid - nextPaid, 0);
    return {
      paidReduction,
      canSettlePaid: paidReduction > 0
    };
  }, [selectedOrder, selectedReturnAmount]);

  const resetFilters = () => {
    setSearch("");
    setStatus("ALL");
    setCustomerFilter("ALL");
    setProcessorFilter("ALL");
    setOwnerFilter("ALL");
    setFromDate("");
    setToDate("");
  };

  const openPrint = () => {
    setPrintDialogOpen(true);
  };

  const closePrint = () => {
    setPrintDialogOpen(false);
  };

  const addEditLine = () => {
    if (!canEditOrderItems) {
      setOrderFormError("Đơn không còn trạng thái cho phép sửa chi tiết");
      return;
    }
    clearOrderFormError();
    setEditItems((prev) => ([
      ...prev,
      {
        id: `tmp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        productId: "",
        quantity: 1,
        unitPrice: 0,
        discountAmount: 0,
        isGift: false
      }
    ]));
  };

  const removeEditLine = (lineId) => {
    setEditItems((prev) => prev.filter((row) => row.id !== lineId));
  };

  const updateEditLine = (lineId, patch) => {
    setEditItems((prev) => prev.map((row) => (row.id === lineId ? { ...row, ...patch } : row)));
  };

  const cancelEditItems = () => {
    if (!selectedOrder) return;
    setEditMode(false);
    clearOrderFormError();
    setEditItems(
      (selectedOrder.items || []).map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        discountAmount: Number(item.discountAmount || 0),
        isGift: Boolean(item.isGift)
      }))
    );
  };

  const submitEditItems = async () => {
    if (!selectedOrder || !onUpdateOrderItems) return;
    if (!canEditOrderItems) {
      setOrderFormError("Đơn không còn trạng thái cho phép sửa chi tiết");
      return;
    }
    if (editItems.length === 0) {
      setOrderFormError("Cần ít nhất 1 dòng hàng");
      return;
    }

    for (const line of editItems) {
      if (!line.productId) {
        setOrderFormError("Vui lòng chọn mã hàng cho tất cả dòng");
        return;
      }
      if (Number(line.quantity || 0) <= 0) {
        setOrderFormError("Số lượng phải lớn hơn 0");
        return;
      }
      if (!line.isGift && Number(line.unitPrice || 0) <= 0) {
        setOrderFormError("Đơn giá phải lớn hơn 0");
        return;
      }
    }

    if (stockConflicts.length > 0) {
      setOrderFormError("Còn dòng hàng vượt tồn khả dụng, vui lòng giảm số lượng trước khi lưu");
      return;
    }

    try {
      clearOrderFormError();
      setActionLoading(true);
      const updatedOrder = await onUpdateOrderItems(selectedOrder.id, {
        items: editItems.map((line) => ({
          productId: line.productId,
          quantity: Number(line.quantity || 0),
          unitPrice: Number(line.unitPrice || 0),
          discountAmount: Number(line.discountAmount || 0),
          isGift: Boolean(line.isGift)
        }))
      });

      if (updatedOrder) {
        setSelectedOrder(updatedOrder);
        setEditItems(
          (updatedOrder.items || []).map((item) => ({
            id: item.id,
            productId: item.productId,
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            discountAmount: Number(item.discountAmount || 0),
            isGift: Boolean(item.isGift)
          }))
        );
      }

      setEditMode(false);
      await loadByDate(fromDate, toDate);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setOrderFormError(`Lỗi cập nhật chi tiết đơn hàng: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  const submitStatus = async () => {
    if (!selectedOrder || !nextStatus) return;
    try {
      clearOrderFormError();
      setActionLoading(true);
      await onUpdateStatus(selectedOrder.id, { status: nextStatus });
      closeDetail();
      await loadByDate(fromDate, toDate);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setOrderFormError(`Lỗi cập nhật trạng thái: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  const submitReturnRefund = async () => {
    if (!selectedOrder) return;
    if (selectedReturnItems.length <= 0) {
      setReturnFormError("Vui lòng chọn số lượng trả hàng");
      return;
    }

    const resolvedAmount = selectedReturnAmount;
    const payoutTag = returnSettlementPreview.canSettlePaid
      ? (returnSettlementMode === "PAYOUT" ? "[Thanh toán: Trả lại tiền]" : "[Thanh toán: Ghi vào số dư]")
      : "[Thanh toán: Chỉ giảm công nợ]";
    const finalNote = [payoutTag, returnForm.note?.trim()].filter(Boolean).join(" ");

    try {
      clearReturnFormError();
      setActionLoading(true);
      await onReturnRefund(selectedOrder.id, {
        type: "RETURNED",
        amount: resolvedAmount,
        items: selectedReturnItems,
        settlementMode: returnSettlementPreview.canSettlePaid ? returnSettlementMode : undefined,
        note: finalNote || undefined,
        restock: true
      });
      closeDetail();
      await loadByDate(fromDate, toDate);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setReturnFormError(`Lỗi xử lý trả hàng: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <DesktopPageFrame
      title="Quản lý đơn hàng"
      description="Theo dõi đơn bán, trạng thái xử lý và công nợ theo thời gian thực."
      kpis={[
        { label: "Tổng đơn hiển thị", value: summary.total },
        { label: "Đang xử lý", value: summary.processing },
        { label: "Hoàn thành", value: summary.completed },
        { label: "Công nợ còn lại", value: formatCurrency(summary.debt), mono: true }
      ]}
      filters={(
        <>
          <div className="orders-search-wrap filter-wide">
            <span aria-hidden="true"></span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã đơn / tên khách"
            />
          </div>
          <select className="filter-md" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ALL">Tất cả trạng thái</option>
            <option value="DRAFT">Nháp</option>
            <option value="CONFIRMED">Xác nhận</option>
            <option value="PROCESSING">Đang xử lý</option>
            <option value="DELIVERED">Đã giao</option>
            <option value="COMPLETED">Hoàn thành</option>
            <option value="CANCELLED">Hủy</option>
            <option value="RETURNED">Trả lại</option>
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
                Khách hàng
                <SearchableSelect
                  value={customerFilter === "ALL" ? "" : customerFilter}
                  onChange={(nextValue) => setCustomerFilter(nextValue || "ALL")}
                  options={customerOptions}
                  allLabel="Tất cả khách hàng"
                  searchPlaceholder="Gõ tên khách hàng để lọc"
                />
              </label>

              <label>
                Nhân viên xử lý
                <select value={processorFilter} onChange={(e) => setProcessorFilter(e.target.value)}>
                  <option value="ALL">Tất cả nhân viên xử lý</option>
                  {processorOptions.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Chủ sở hữu
                <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
                  <option value="ALL">Tất cả chủ sở hữu</option>
                  {ownerOptions.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </label>

              <label>
                Từ ngày
                <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); }} />
              </label>

              <label>
                Đến ngày
                <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); }} />
              </label>
            </div>
          </AdvancedFiltersPopover>
          <button type="button" className="btn-secondary orders-reset-btn" onClick={resetFilters}>Xóa lọc</button>
        </>
      )}
    >

      <div className="list-shell orders-list-shell">
        <table className="simple-table orders-table">
          <thead>
            <tr>
              <th>Mã đơn</th>
              <th>Khách hàng</th>
              <th>Chủ sở hữu</th>
              <th>Người tạo</th>
              <th>Ngày tạo</th>
              <th>Hạn thanh toán</th>
              <th>Trạng thái</th>
              <th>Thanh toán</th>
              <th className="text-right">Tổng tiền</th>
              <th className="text-right">Còn nợ</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="11" className="text-center">Không có dữ liệu</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.orderNo || row.id.slice(0, 8)}</td>
                  <td>{row.customer?.name || "-"}</td>
                  <td>{getOwnerLabel(row)}</td>
                  <td>{getCreatorLabel(row)}</td>
                  <td>{formatDateVN(row.createdAt)}</td>
                  <td>{formatDateVN(row.dueDate)}</td>
                  <td><StatusPill status={row.status} /></td>
                  <td><PaymentBadge paidAmount={row.paidAmount} totalAmount={row.totalAmount} /></td>
                  <td className="text-right mono">{formatCurrency(row.totalAmount)}</td>
                  <td className={`text-right mono ${Math.max(Number(row.debtAmount || 0), 0) > 0 ? "orders-debt-text" : "orders-paid-text"}`}>
                    {formatCurrency(Math.max(Number(row.debtAmount || 0), 0))}
                  </td>
                  <td className="orders-row-actions">
                    <button type="button" className="orders-action-btn" onClick={() => openDetail(row)}>
                      Chi tiết
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedOrder ? (
        <div className="dialog-overlay" onClick={closeDetail}>
          <div className={`dialog-panel orders-dialog-panel ${editMode ? "orders-dialog-panel--editing" : ""}`.trim()} onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>Chi tiết đơn hàng</h2>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={openPrint}
                  style={{ margin: 0, padding: "8px 12px", fontSize: "14px", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9V3h12v6" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                  </svg>
                  In
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditMode(true)}
                  disabled={!canEditOrderItems || editMode}
                  title={canEditOrderItems ? "Sửa chi tiết đơn" : "Chỉ sửa được đơn ở trạng thái Nháp hoặc Xác nhận"}
                  style={{
                    margin: 0,
                    padding: "8px 12px",
                    fontSize: "14px",
                    background: canEditOrderItems && !editMode ? "#e0f2fe" : "#f1f5f9",
                    color: canEditOrderItems && !editMode ? "#075985" : "#94a3b8",
                    borderColor: canEditOrderItems && !editMode ? "#bae6fd" : "#e2e8f0",
                    opacity: canEditOrderItems && !editMode ? 1 : 0.65,
                    cursor: canEditOrderItems && !editMode ? "pointer" : "not-allowed"
                  }}
                >
                  Sửa chi tiết đơn
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={openReturn}
                  disabled={editMode || !canReturnOrder}
                  title={canReturnOrder ? undefined : "Chỉ trả hàng khi đơn ở trạng thái Đã giao hoặc Hoàn thành"}
                  style={{
                    margin: 0,
                    padding: "8px 12px",
                    fontSize: "14px",
                    background: canReturnOrder ? "#dcfce7" : "#f1f5f9",
                    color: canReturnOrder ? "#166534" : "#94a3b8",
                    borderColor: canReturnOrder ? "#86efac" : "#e2e8f0",
                    opacity: canReturnOrder ? 1 : 0.65,
                    cursor: canReturnOrder ? "pointer" : "not-allowed"
                  }}
                >
                  Trả hàng
                </button>
                <button className="close-btn close-btn--emphasis" type="button" onClick={closeDetail} aria-label="Đóng">x</button>
              </div>
            </div>

            <div className="dialog-body orders-dialog-body">
              <FormBanner message={orderFormError} tone="error" style={{ marginBottom: 12 }} />
              <div className="orders-detail-summary">
                <div className="purchase-info-box">
                  <div className="orders-detail-row"><span>Mã đơn</span><strong className="mono">{selectedOrder.orderNo || selectedOrder.id.slice(0, 8)}</strong></div>
                  <div className="orders-detail-row"><span>Tên khách hàng</span><strong>{selectedOrder.customer?.name || "-"}</strong></div>
                  <div className="orders-detail-row"><span>Điện thoại</span><strong>{selectedOrder.customer?.phone || "-"}</strong></div>
                  <div className="orders-detail-row"><span>Email</span><strong>{selectedOrder.customer?.email || "-"}</strong></div>
                  <div className="orders-detail-row"><span>Địa chỉ</span><strong>{selectedOrder.customer?.address || "-"}</strong></div>
                  <div className="orders-detail-row"><span>Khu vực kinh doanh</span><strong>{selectedOrder.customer?.businessArea?.name || selectedOrder.customer?.businessAreaId || "-"}</strong></div>
                  <div className="orders-detail-row"><span>Chủ sở hữu</span><strong>{getOwnerLabel(selectedOrder)}</strong></div>
                  <div className="orders-detail-row"><span>Người tạo</span><strong>{getCreatorLabel(selectedOrder)}</strong></div>
                </div>
                <div className="purchase-info-box">
                  <div className="orders-detail-row"><span>Ngày tạo</span><strong>{formatDateTimeVN(selectedOrder.createdAt)}</strong></div>
                  <div className="orders-detail-row"><span>Hạn thanh toán</span><strong>{formatDateVN(selectedOrder.dueDate)}</strong></div>
                  <div className="orders-detail-row"><span>Trạng thái</span><StatusPill status={selectedOrder.status} /></div>
                  <div className="orders-detail-row"><span>Tổng tiền</span><strong className="mono">{formatCurrency(selectedOrder.totalAmount)}</strong></div>
                  <div className="orders-detail-row"><span>Đã thanh toán</span><strong className="mono">{formatCurrency(selectedOrder.paidAmount)}</strong></div>
                  <div className="orders-detail-row"><span>Còn nợ</span><strong className="mono">{formatCurrency(Math.max(Number(selectedOrder.debtAmount || 0), 0))}</strong></div>
                  <div className="orders-detail-row"><span>Thanh toán</span><PaymentBadge paidAmount={selectedOrder.paidAmount} totalAmount={selectedOrder.totalAmount} /></div>
                </div>
              </div>

              <div className={`list-shell orders-detail-list-shell ${editMode ? "orders-detail-list-shell--editing" : ""}`.trim()}>
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Mã hàng</th>
                      <th>Sản phẩm</th>
                      <th className="text-right">Số lượng</th>
                      <th className="text-right">Đơn giá</th>
                      <th className="text-right">Giảm giá</th>
                      <th className="text-right">Thành tiền</th>
                      {editMode ? <th>Thao tác</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {(editMode ? editItems : (selectedOrder.items || [])).map((item) => {
                      const lineTotal = resolveLineTotal(item);
                      const lineDiscount = resolveLineDiscount(item);
                      const lineUnitPrice = resolveDisplayUnitPrice(item);
                      const originalUnitPrice = Number(item.unitPrice || 0);
                      const showAdjustedPrice = !editMode && Math.abs(lineUnitPrice - originalUnitPrice) >= 1;
                      const lineStockConflict = editMode ? stockConflictMap.get(item.productId) : null;
                      const selectedProduct = productById.get(item.productId) || item.product;
                      const availableQty = item.productId
                        ? Number(inventoryAvailableMap.get(item.productId) || 0)
                        : 0;
                      return (
                        <tr key={item.id}>
                          <td>
                            {editMode ? (
                              <SearchableSelect
                                value={item.productId || ""}
                                onChange={(nextValue) => updateEditLine(item.id, { productId: nextValue })}
                                options={productSelectOptions}
                                allLabel="Chọn mã hàng"
                                searchPlaceholder="Nhập SKU hoặc tên sản phẩm"
                                noResultsText="Không tìm thấy sản phẩm phù hợp"
                                className="orders-product-search-select"
                              />
                            ) : (selectedProduct?.sku || item.productId)}
                          </td>
                          <td>
                            {selectedProduct?.name || item.productName || "-"}
                          </td>
                          <td className="text-right">
                            {editMode ? (
                              <div>
                                <input
                                  type="number"
                                  min="1"
                                  className="orders-qty-input"
                                  value={item.quantity}
                                  onChange={(e) => updateEditLine(item.id, { quantity: Number(e.target.value || 0) })}
                                />
                                <small className="orders-stock-hint">
                                  Tồn khả dụng: {availableQty}
                                </small>
                                {lineStockConflict ? (
                                  <small style={{ color: "#b91c1c", display: "block", marginTop: 4 }}>
                                    Vượt tồn: +{lineStockConflict.excess} (tối đa {lineStockConflict.maxAllowed})
                                  </small>
                                ) : null}
                              </div>
                            ) : item.quantity}
                          </td>
                          <td className="text-right mono">
                            {editMode ? (
                              <input
                                type="text"
                                inputMode="numeric"
                                className="orders-unit-price-input mono"
                                placeholder="0"
                                value={formatCurrencyInput(item.unitPrice)}
                                onChange={(e) => updateEditLine(item.id, { unitPrice: Number(parseMoneyInput(e.target.value) || 0) })}
                              />
                            ) : (
                              <>
                                {formatCurrency(lineUnitPrice)}
                                {showAdjustedPrice ? (
                                  <small className="orders-stock-hint" style={{ display: "block" }}>
                                    Gốc: {formatCurrency(originalUnitPrice)}
                                  </small>
                                ) : null}
                              </>
                            )}
                          </td>
                          <td className="text-right mono">{formatCurrency(lineDiscount)}</td>
                          <td className="text-right mono">{formatCurrency(lineTotal)}</td>
                          {editMode ? (
                            <td>
                              <button
                                type="button"
                                className="btn-cancel"
                                onClick={() => removeEditLine(item.id)}
                                disabled={editItems.length <= 1}
                              >
                                Xóa dòng
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {editMode ? (
                  <div style={{ padding: "10px 12px", borderTop: "1px solid #e5e7eb" }}>
                    <button type="button" className="btn-secondary" onClick={addEditLine}>+ Thêm dòng hàng</button>
                    {selectedOrder?.isReserved && stockConflicts.length > 0 ? (
                      <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 13 }}>
                        Tồn không đủ cho: {stockConflicts.map((row) => row.label).join(", ")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {!editMode ? (
                <div className="orders-dialog-forms orders-status-transition-card">
                  <div className="orders-status-transition-head">
                    <span>Chuyển trạng thái đơn</span>
                    <div className="orders-status-flow">
                      <StatusPill status={selectedOrder.status} />
                      <span className="orders-status-flow-arrow" aria-hidden="true">→</span>
                      <span className={`orders-status-next ${nextStatus ? "orders-status-next--active" : ""}`.trim()}>
                        {nextStatus ? statusLabel(nextStatus) : "Chưa chọn trạng thái mới"}
                      </span>
                    </div>
                  </div>

                  <div className="form-row orders-status-transition-grid">
                    <div className="form-group orders-status-select-group">
                      <label>Trạng thái mới</label>
                      <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                        <option value="">Chọn trạng thái</option>
                        {transitionOptions.map((s) => (
                          <option key={s} value={s}>{statusLabel(s)}</option>
                        ))}
                      </select>
                      {!canMarkCompleted ? (
                        <small className="orders-status-warning">
                          Đơn còn nợ, không thể chuyển sang Hoàn thành.
                        </small>
                      ) : (
                        <small className="orders-status-hint">
                          Chọn trạng thái phù hợp để tiếp tục quy trình xử lý đơn.
                        </small>
                      )}
                    </div>

                    <div className="form-group orders-status-action-group">
                      <label>&nbsp;</label>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={!nextStatus || actionLoading || (nextStatus === "COMPLETED" && !canMarkCompleted)}
                        onClick={submitStatus}
                      >
                        {actionLoading ? "Đang xử lý..." : "Cập nhật trạng thái"}
                      </button>
                    </div>
                  </div>

                  {transitionOptions.length === 0 ? (
                    <small className="orders-status-hint">
                      Trạng thái hiện tại không có bước chuyển tiếp khả dụng.
                    </small>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="dialog-footer">
              {editMode ? (
                <>
                  <button type="button" className="btn-cancel" onClick={cancelEditItems} disabled={actionLoading}>Hủy sửa</button>
                  <button type="button" className="btn-primary" onClick={submitEditItems} disabled={actionLoading || stockConflicts.length > 0}>
                    {actionLoading ? "Đang lưu..." : "Lưu chi tiết đơn"}
                  </button>
                </>
              ) : null}
              {!canEditOrderItems ? (
                <small style={{ color: "#64748b", alignSelf: "center" }}>
                  Chỉ sửa được khi đơn ở trạng thái Nháp hoặc Xác nhận
                </small>
              ) : null}
              <button type="button" className="btn-cancel" onClick={closeDetail}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {printDialogOpen && selectedOrder ? (
        <PrintOrder order={selectedOrder} onClose={closePrint} />
      ) : null}

      {returnDialogOpen && selectedOrder ? (
        <div className="dialog-overlay" onClick={closeReturn}>
          <div className="dialog-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>Trả hàng # {selectedOrder.orderNo || selectedOrder.id.slice(0, 8)}</h2>
              <button className="close-btn close-btn--emphasis" type="button" onClick={closeReturn} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body">
              <FormBanner message={returnFormError} tone="error" style={{ marginBottom: 12 }} />
              <div className="form-row">
                <div className="form-group">
                  <label>Cách xử lý tiền trả lại</label>
                  {!returnSettlementPreview.canSettlePaid ? (
                    <small className="orders-status-warning" style={{ display: "block", marginBottom: 8 }}>
                      Đơn này chưa phát sinh phần tiền đã thu cần hoàn. Hệ thống chỉ ghi nhận giảm công nợ theo giá trị trả hàng.
                    </small>
                  ) : null}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className={returnSettlementMode === "PAYOUT" ? "btn-primary" : "btn-secondary"}
                      onClick={() => setReturnSettlementMode("PAYOUT")}
                      disabled={!returnSettlementPreview.canSettlePaid}
                      style={{ flex: 1 }}
                    >
                      Trả lại tiền
                    </button>
                    <button
                      type="button"
                      className={returnSettlementMode === "CREDIT_BALANCE" ? "btn-primary" : "btn-secondary"}
                      onClick={() => setReturnSettlementMode("CREDIT_BALANCE")}
                      disabled={!returnSettlementPreview.canSettlePaid}
                      style={{ flex: 1 }}
                    >
                      Ghi vào số dư
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label>Số tiền trả (tự tính theo số lượng)</label>
                  <input
                    type="text"
                    style={{ textAlign: "right" }}
                    value={formatCurrencyInput(Math.round(selectedReturnAmount || 0))}
                    disabled
                  />
                </div>
              </div>

              <div className="list-shell orders-detail-list-shell" style={{ marginTop: 12 }}>
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Dòng hàng trả</th>
                      <th className="text-right">Đã bán</th>
                      <th className="text-right">Tra</th>
                      <th className="text-right">Giá trị trả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOrder.items || []).map((item) => {
                      const pickedQty = Math.min(
                        Math.max(Number(returnItems[item.id] || 0), 0),
                        Number(item.quantity || 0)
                      );
                      const rowAmount = (resolveLineTotal(item) / Math.max(Number(item.quantity || 1), 1)) * pickedQty;

                      return (
                        <tr key={`return-${item.id}`}>
                          <td>{item.product?.name || item.productName || item.productId}</td>
                          <td className="text-right">{item.quantity}</td>
                          <td className="text-right" style={{ width: 120 }}>
                            <input
                              type="number"
                              min="0"
                              max={item.quantity}
                              value={returnItems[item.id] || 0}
                              onChange={(e) => {
                                const next = Math.min(
                                  Math.max(Number(e.target.value || 0), 0),
                                  Number(item.quantity || 0)
                                );
                                setReturnItems((prev) => ({ ...prev, [item.id]: next }));
                              }}
                            />
                          </td>
                          <td className="text-right mono">{formatCurrency(rowAmount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="form-group" style={{ marginTop: 12 }}>
                <label>Ghi chú</label>
                <input
                  value={returnForm.note}
                  onChange={(e) => setReturnForm((prev) => ({ ...prev, note: e.target.value }))}
                  placeholder="Nhập ghi chú xử lý"
                />
              </div>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closeReturn}>Đóng</button>
              <button type="button" className="btn-primary" disabled={actionLoading} onClick={submitReturnRefund}>
                {actionLoading ? "Đang xử lý..." : "Xác nhận trả hàng"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DesktopPageFrame>
  );
}






