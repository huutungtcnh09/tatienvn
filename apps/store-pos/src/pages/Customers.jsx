import { useEffect, useMemo, useRef, useState } from "react";
import DesktopPageFrame from "../components/DesktopPageFrame";
import AdvancedFiltersPopover from "../components/AdvancedFiltersPopover";
import SearchableSelect from "../components/SearchableSelect";
import FormBanner from "../components/FormBanner";
import { formatMoneyInput as formatCurrencyInput, formatCurrency, formatNumber } from "../utils/currency";
import { formatDateTimeVN, formatDateVN } from "../utils/datetime";

function parseMoneyInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? String(Number(digits)) : "";
}

function getAgingBucketTone(bucket) {
  const key = String(bucket || "").toLowerCase();
  if (key.includes("current") || key.includes("hiện") || key.includes("hien")) {
    return "aging-card aging-card--current";
  }
  if (key.includes("1-30") || key.includes("1 - 30")) {
    return "aging-card aging-card--early";
  }
  if (key.includes("31-60") || key.includes("31 - 60")) {
    return "aging-card aging-card--watch";
  }
  if (key.includes("61-90") || key.includes("61 - 90")) {
    return "aging-card aging-card--risk";
  }
  if (key.includes(">90") || key.includes("90")) {
    return "aging-card aging-card--critical";
  }
  return "aging-card";
}

function getOverdueToneClass(days) {
  const value = Number(days || 0);
  if (value <= 0) return "overdue-pill overdue-pill--current";
  if (value <= 30) return "overdue-pill overdue-pill--early";
  if (value <= 60) return "overdue-pill overdue-pill--watch";
  if (value <= 90) return "overdue-pill overdue-pill--risk";
  return "overdue-pill overdue-pill--critical";
}

function validateCustomerInfoForm(form) {
  const errors = {};
  const name = form.name.trim();
  const email = form.email.trim();

  if (name.length < 2) errors.name = "Tên khách hàng cần tối thiểu 2 ký tự.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Email không đúng định dạng.";
  }

  return errors;
}

function getAssignedStaffName(positionId, orgPositions, staffUsers) {
  if (!positionId) return "-";

  if (Array.isArray(orgPositions) && orgPositions.length) {
    const matchedPosition = orgPositions.find((position) => position?.id === positionId);
    const assignedUser = matchedPosition?.assignments?.[0]?.user;
    if (assignedUser?.fullName || assignedUser?.name) {
      return assignedUser.fullName || assignedUser.name;
    }
  }

  if (!staffUsers) return "-";
  const now = new Date();
  for (const user of staffUsers) {
    if (!user.staffAssignments) continue;
    for (const assignment of user.staffAssignments) {
      if (assignment.positionId !== positionId) continue;
      const effFrom = assignment.effectiveFrom ? new Date(assignment.effectiveFrom) : null;
      const effTo = assignment.effectiveTo ? new Date(assignment.effectiveTo) : null;
      const isActive = (!effFrom || effFrom <= now) && (!effTo || now <= effTo);
      if (isActive) return user.fullName || user.name || "-";
    }
  }
  return "-";
}

function isReturnPayoutNote(rawNote) {
  return String(rawNote || "").includes("settlement=PAYOUT");
}

export default function Customers({
  customers = [],
  businessAreas = [],
  staffUsers = [],
  orgPositions = [],
  orders = [],
  receipts = [],
  products = [],
  canEditCustomerInfo = false,
  activeStoreId,
  onLoadCustomerAging,
  onLoadCustomerTransactions,
  onLoadCustomerAnalytics,
  onLoadGiftRedemptions,
  onLoadCustomerPriceList,
  onUpdateCustomerPriceList,
  onDeleteCustomerPriceList,
  onUpdateCustomerInfo
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [onlyDebt, setOnlyDebt] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [businessAreaFilter, setBusinessAreaFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [hasPhoneOnly, setHasPhoneOnly] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showTransactionPanel, setShowTransactionPanel] = useState(false);
  const [showPricePanel, setShowPricePanel] = useState(false);
  const [pricePanelLoading, setPricePanelLoading] = useState(false);
  const [transactionKeyword, setTransactionKeyword] = useState("");
  const [transactionTypeFilter, setTransactionTypeFilter] = useState("");
  const [transactionFromDate, setTransactionFromDate] = useState("");
  const [transactionToDate, setTransactionToDate] = useState("");
  const [transactionPage, setTransactionPage] = useState(1);
  const transactionPageSize = 12;
  const [agingData, setAgingData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [analyticsPeriod, setAnalyticsPeriod] = useState("month");
  const [analyticsData, setAnalyticsData] = useState(null);
  const [giftValueTotal, setGiftValueTotal] = useState(0);
  const [priceListRows, setPriceListRows] = useState([]);
  const [priceForm, setPriceForm] = useState({ productId: "", price: 0 });
  const [priceListFilter, setPriceListFilter] = useState("");
  const [showCopyPricePanel, setShowCopyPricePanel] = useState(false);
  const [copySourceCustomerId, setCopySourceCustomerId] = useState("");
  const [deletingPriceRowId, setDeletingPriceRowId] = useState("");
  const [showEditInfoPanel, setShowEditInfoPanel] = useState(false);
  const [savingCustomerInfo, setSavingCustomerInfo] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: "",
    ledgerCode: "",
    phone: "",
    email: "",
    address: "",
    accountOwnerPositionId: "",
    businessAreaId: "",
    customerPriceTier: ""
  });
  const [customerFormErrors, setCustomerFormErrors] = useState({});
  const [customerFormMessage, setCustomerFormMessage] = useState("");

  const rows = useMemo(() => {
    return customers.filter((row) => {
      const k = search.toLowerCase();
      const matchedSearch =
        !k ||
        (row.name || "").toLowerCase().includes(k) ||
        (row.phone || "").toLowerCase().includes(k) ||
        (row.ledgerCode || "").toLowerCase().includes(k) ||
        (row.code || "").toLowerCase().includes(k);
      const matchedDebt = !onlyDebt || Number(row.netBalance) > 0;
      const matchedOwner = !ownerFilter || row.accountOwnerPositionId === ownerFilter;
      const matchedBusinessArea = !businessAreaFilter || row.businessAreaId === businessAreaFilter;
      const matchedTier = !tierFilter || row.customerPriceTier === tierFilter;
      const matchedPhone = !hasPhoneOnly || Boolean(String(row.phone || "").trim());
      return matchedSearch && matchedDebt && matchedOwner && matchedBusinessArea && matchedTier && matchedPhone;
    });
  }, [customers, search, onlyDebt, ownerFilter, businessAreaFilter, tierFilter, hasPhoneOnly]);

  const totalDebt = rows.reduce((sum, row) => sum + Math.max(Number(row.netBalance || 0), 0), 0);
  const totalAdvance = rows.reduce((sum, row) => sum + Math.max(-Number(row.netBalance || 0), 0), 0);
  const ownerOptions = useMemo(() => {
    const map = new Map();
    customers.forEach((customer) => {
      if (customer.accountOwnerPositionId) {
        map.set(
          customer.accountOwnerPositionId,
          customer.accountOwnerPosition?.name || customer.accountOwnerPosition?.code || customer.accountOwnerPositionId
        );
      }
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [customers]);

  const summary = useMemo(() => {
    const customerIds = new Set(rows.map((row) => row.id));
    const recognizedStatuses = new Set(["DELIVERED", "COMPLETED", "RETURNED", "REFUNDED"]);
    const customerOrders = orders.filter((order) => customerIds.has(order.customerId) && recognizedStatuses.has(String(order.status || "")));
    const customerReceipts = receipts.filter((receipt) => customerIds.has(receipt.customerId) && receipt.status !== "VOIDED");
    return {
      customers: rows.length,
      withDebt: rows.filter((row) => Number(row.netBalance) > 0).length,
      totalDebt,
      totalAdvance,
      totalRevenue: customerOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0),
      totalReceipts: customerReceipts.reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0)
    };
  }, [rows, orders, receipts, totalDebt, totalAdvance]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page]);

  useEffect(() => {
    setPage(1);
  }, [search, onlyDebt, ownerFilter, businessAreaFilter, tierFilter, hasPhoneOnly]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const advancedFilterCount = [
    Boolean(ownerFilter),
    Boolean(businessAreaFilter),
    Boolean(onlyDebt),
    Boolean(tierFilter),
    Boolean(hasPhoneOnly)
  ].filter(Boolean).length;

  const productOptions = useMemo(() => {
    return products.map((product) => ({
      value: product.id,
      label: `[${product.sku}] ${product.name}`,
      description: `${product.unit} - ${formatCurrency(product.defaultPrice)}`,
      keywords: `${product.sku} ${product.name} ${product.unit}`.toLowerCase()
    }));
  }, [products]);

  const copySourceCustomerOptions = useMemo(() => {
    return customers
      .filter((customer) => customer.id !== selectedCustomer?.id)
      .map((customer) => ({
        value: customer.id,
        label: customer.name || "Khong ten",
        description: `${customer.phone || "-"} - ${customer.address || "-"}`,
        keywords: `${customer.name || ""} ${customer.phone || ""} ${customer.address || ""}`.toLowerCase()
      }));
  }, [customers, selectedCustomer]);

  const positionOptions = useMemo(() => {
    if (!canEditCustomerInfo) return [];
    const byId = new Map();
    customers.forEach((customer) => {
      if (!customer?.accountOwnerPositionId || byId.has(customer.accountOwnerPositionId)) return;
      byId.set(customer.accountOwnerPositionId, {
        value: customer.accountOwnerPositionId,
        label: customer.accountOwnerPosition?.name || customer.accountOwnerPosition?.code || customer.accountOwnerPositionId,
        description: customer.accountOwnerPosition?.code || "",
        keywords: `${customer.accountOwnerPosition?.name || ""} ${customer.accountOwnerPosition?.code || ""}`.toLowerCase()
      });
    });
    return Array.from(byId.values());
  }, [customers, canEditCustomerInfo]);

  const customerPriceTierOptions = useMemo(() => {
    return [
      {
        value: "LEVEL_2",
        label: "Cấp 2",
        description: "Áp dụng giá cấp 2",
        keywords: "cap 2 gia cap 2 level 2"
      },
      {
        value: "LEVEL_2_SPECIAL",
        label: "Cấp 2 đặc biệt",
        description: "Áp dụng giá cấp 2 đặc biệt",
        keywords: "cap 2 dac biet gia cap 2 dac biet level 2 special"
      }
    ];
  }, []);

  const businessAreaOptions = useMemo(() => {
    const fromApi = [];
    const walk = (nodes = [], prefix = "") => {
      nodes.forEach((node) => {
        const label = prefix ? `${prefix} / ${node.name}` : node.name;
        fromApi.push({
          value: node.id,
          label,
          description: node.code || "",
          keywords: `${node.code || ""} ${node.name || ""}`.toLowerCase()
        });
        if (Array.isArray(node.children) && node.children.length) {
          walk(node.children, label);
        }
      });
    };

    walk(businessAreas);
    if (fromApi.length) return fromApi;

    const fallback = new Map();
    customers.forEach((customer) => {
      if (!customer?.businessAreaId || fallback.has(customer.businessAreaId)) return;
      const name = customer.businessArea?.name || customer.businessAreaId;
      fallback.set(customer.businessAreaId, {
        value: customer.businessAreaId,
        label: name,
        description: customer.businessArea?.code || "",
        keywords: `${customer.businessArea?.code || ""} ${name}`.toLowerCase()
      });
    });
    return Array.from(fallback.values());
  }, [businessAreas, customers]);

  const openDetail = async (customer) => {
    try {
      setSelectedCustomer(customer);
      setShowDetail(true);
      setShowTransactionPanel(false);
      setDetailLoading(true);
      const [agingRes, priceListRes, txRes, analyticsRes] = await Promise.allSettled([
        onLoadCustomerAging(customer.id),
        onLoadCustomerPriceList(customer.id),
        onLoadCustomerTransactions(customer.id),
        onLoadCustomerAnalytics(customer.id, analyticsPeriod)
      ]);
      const aging = agingRes.status === "fulfilled" ? agingRes.value : null;
      const priceList = priceListRes.status === "fulfilled" ? (priceListRes.value || []) : [];
      const txRows = txRes.status === "fulfilled" ? (txRes.value || []) : [];
      const analytics = analyticsRes.status === "fulfilled" ? (analyticsRes.value || null) : null;
      setAgingData(aging);
      setPriceListRows(priceList);
      setTransactions(txRows);
      setAnalyticsData(analytics);
      if (onLoadGiftRedemptions) {
        try {
          const giftRows = await onLoadGiftRedemptions(customer.id);
          const totalGiftValue = (giftRows || [])
            .filter((row) => String(row?.status || "") !== "CANCELLED")
            .reduce((sum, row) => {
              const productDefaultPrice = Number(products.find((item) => item.id === row.productId)?.defaultPrice || 0);
              const quantity = Number(row.quantity || 0);
              return sum + productDefaultPrice * quantity;
            }, 0);
          setGiftValueTotal(totalGiftValue);
        } catch {
          setGiftValueTotal(0);
        }
      } else {
        setGiftValueTotal(0);
      }
      const initialProductId = priceList[0]?.productId || products[0]?.id || "";
      const initialProduct = products.find((item) => item.id === initialProductId);
      setPriceForm({
        productId: initialProductId,
        price: Number(priceList[0]?.price ?? initialProduct?.defaultPrice ?? 0)
      });
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
      setShowDetail(false);
      setSelectedCustomer(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setShowPricePanel(false);
    setShowTransactionPanel(false);
    setTransactionKeyword("");
    setTransactionTypeFilter("");
    setTransactionFromDate("");
    setTransactionToDate("");
    setShowDetail(false);
    setSelectedCustomer(null);
    setAgingData(null);
    setTransactions([]);
    setAnalyticsData(null);
    setGiftValueTotal(0);
    setPriceListRows([]);
    setPriceForm({ productId: "", price: 0 });
    setPriceListFilter("");
    setShowCopyPricePanel(false);
    setCopySourceCustomerId("");
    setShowEditInfoPanel(false);
    setSavingCustomerInfo(false);
    setCustomerForm({ name: "", ledgerCode: "", phone: "", email: "", address: "", accountOwnerPositionId: "", businessAreaId: "", customerPriceTier: "" });
    setCustomerFormErrors({});
    setCustomerFormMessage("");
  };

  useEffect(() => {
    if (!selectedCustomer) return;
    const latest = customers.find((row) => row.id === selectedCustomer.id);
    if (latest) {
      setSelectedCustomer(latest);
    }
  }, [customers, selectedCustomer?.id]);

  const reloadAging = async (customerId) => {
    try {
      const aging = await onLoadCustomerAging(customerId);
      setAgingData(aging || null);
    } catch {
      // silent — aging is non-critical
    }
  };

  const reloadAnalytics = async () => {
    if (!selectedCustomer) return;
    try {
      setDetailLoading(true);
      const data = await onLoadCustomerAnalytics(selectedCustomer.id, analyticsPeriod);
      setAnalyticsData(data || null);
    } catch (error) {
      alert(`Lỗi tải phân tích: ${error.message}`);
    } finally {
      setDetailLoading(false);
    }
  };

  // Reload aging + analytics when customer balance changes (e.g. after void receipt)
  const prevNetBalanceRef = useRef(null);
  useEffect(() => {
    if (!showDetail || !selectedCustomer) return;
    const currentBalance = selectedCustomer.netBalance;
    if (prevNetBalanceRef.current !== null && prevNetBalanceRef.current !== currentBalance) {
      void reloadAging(selectedCustomer.id);
      void reloadAnalytics();
    }
    prevNetBalanceRef.current = currentBalance;
  }, [selectedCustomer?.netBalance]);

  useEffect(() => {
    if (!showDetail || !selectedCustomer) return;
    void reloadAnalytics();
  }, [analyticsPeriod]);

  const customerNetBalance = Number(selectedCustomer?.netBalance || 0);
  const customerDebt = Math.max(customerNetBalance, 0);
  const customerAdvance = Math.max(-customerNetBalance, 0);

  const transactionTypeOptions = useMemo(() => {
    const map = new Map();
    transactions.forEach((row) => {
      const key = row.transactionType;
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, row.transactionTypeLabel || key);
      }
    });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [transactions]);

  const normalizedTransactions = useMemo(() => {
    return transactions
      .map((row) => {
        const createdTs = new Date(row.createdAt).getTime();
        const type = String(row.transactionType || "");
        const typeLabel = String(row.transactionTypeLabel || type || "-");
        const documentNo = String(row.documentNo || row.referenceId || "-");
        const note = String(row.note || "").trim();
        const amount = Number(row.amount || 0);
        const displayAmount = Number(row.displayAmount ?? amount);
        const amountClass = "transaction-amount transaction-amount--neutral";
        const amountLabel = formatCurrency(displayAmount);
        return {
          ...row,
          createdTs,
          type,
          typeLabel,
          documentNo,
          note,
          amount,
          displayAmount,
          amountClass,
          amountLabel
        };
      })
      .sort((a, b) => b.createdTs - a.createdTs);
  }, [transactions]);

  const analyticsByPeriod = analyticsData?.byPeriod || [];



  const priceByProductId = useMemo(() => {
    const map = new Map();
    priceListRows.forEach((row) => {
      map.set(row.productId, Number(row.price || 0));
    });
    return map;
  }, [priceListRows]);

  const handlePriceProductChange = (productId) => {
    const product = products.find((item) => item.id === productId);
    const customPrice = priceByProductId.get(productId);
    setPriceForm({
      productId,
      price: customPrice ?? Number(product?.defaultPrice || 0)
    });
  };

  const filteredPriceListRows = useMemo(() => {
    const keyword = priceListFilter.trim().toLowerCase();
    if (!keyword) return priceListRows;
    return priceListRows.filter((row) => {
      const searchText = [row.product?.sku || "", row.product?.name || "", row.product?.unit || ""].join(" ").toLowerCase();
      return searchText.includes(keyword);
    });
  }, [priceListRows, priceListFilter]);

  const filteredTransactions = useMemo(() => {
    const keyword = transactionKeyword.trim().toLowerCase();
    const fromTs = transactionFromDate ? new Date(`${transactionFromDate}T00:00:00`).getTime() : null;
    const toTs = transactionToDate ? new Date(`${transactionToDate}T23:59:59.999`).getTime() : null;

    return normalizedTransactions.filter((row) => {
      const matchesKeyword = !keyword ||
        String(row.referenceId ?? "").toLowerCase().includes(keyword) ||
        String(row.documentNo ?? "").toLowerCase().includes(keyword) ||
        String(row.note ?? "").toLowerCase().includes(keyword) ||
        String(row.typeLabel ?? "").toLowerCase().includes(keyword);
      const matchesType = !transactionTypeFilter || row.type === transactionTypeFilter;
      const matchesFrom = fromTs === null || row.createdTs >= fromTs;
      const matchesTo = toTs === null || row.createdTs <= toTs;
      return matchesKeyword && matchesType && matchesFrom && matchesTo;
    });
  }, [normalizedTransactions, transactionKeyword, transactionTypeFilter, transactionFromDate, transactionToDate]);

  const transactionTotalPages = Math.max(1, Math.ceil(filteredTransactions.length / transactionPageSize));
  const pagedTransactions = useMemo(() => {
    const start = (transactionPage - 1) * transactionPageSize;
    return filteredTransactions.slice(start, start + transactionPageSize);
  }, [filteredTransactions, transactionPage]);

  useEffect(() => {
    if (!showTransactionPanel) return;
    setTransactionPage(1);
  }, [showTransactionPanel, transactionKeyword, transactionTypeFilter, transactionFromDate, transactionToDate]);

  useEffect(() => {
    if (transactionPage > transactionTotalPages) {
      setTransactionPage(transactionTotalPages);
    }
  }, [transactionPage, transactionTotalPages]);

  const submitPrice = async () => {
    if (!selectedCustomer || !priceForm.productId || Number(priceForm.price) <= 0) return;

    try {
      await onUpdateCustomerPriceList(selectedCustomer.id, priceForm.productId, {
        price: Number(priceForm.price),
        storeId: activeStoreId || undefined
      });
      const [nextPriceList, nextAnalytics] = await Promise.all([
        onLoadCustomerPriceList(selectedCustomer.id),
        onLoadCustomerAnalytics(selectedCustomer.id, analyticsPeriod)
      ]);
      setPriceListRows(nextPriceList || []);
      setAnalyticsData(nextAnalytics || null);
      const updatedPrice = (nextPriceList || []).find((row) => row.productId === priceForm.productId)?.price;
      setPriceForm((prev) => ({
        ...prev,
        price: Number(updatedPrice ?? (prev.price || 0))
      }));
      alert("Đã cập nhật bảng giá riêng");
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  const openPricePanel = async () => {
    if (!selectedCustomer) return;
    try {
      setShowPricePanel(true);
      setPricePanelLoading(true);
      const [priceList, analytics] = await Promise.all([
        onLoadCustomerPriceList(selectedCustomer.id),
        onLoadCustomerAnalytics(selectedCustomer.id, analyticsPeriod)
      ]);
      setPriceListRows(priceList || []);
      setAnalyticsData(analytics || null);

      const activeProductId = priceForm.productId || priceList?.[0]?.productId || products?.[0]?.id || "";
      if (activeProductId) {
        handlePriceProductChange(activeProductId);
      }
    } catch (error) {
      alert(`Lỗi tải bảng giá riêng: ${error.message}`);
      setShowPricePanel(false);
    } finally {
      setPricePanelLoading(false);
    }
  };

  const closePricePanel = () => {
    setShowPricePanel(false);
    setPriceListFilter("");
    setShowCopyPricePanel(false);
    setCopySourceCustomerId("");
    setDeletingPriceRowId("");
  };

  const deletePriceRow = async (row) => {
    if (!selectedCustomer || !onDeleteCustomerPriceList) return;

    const confirmDelete = window.confirm(`Xóa giá riêng của sản phẩm ${row.product?.name || row.productId}?`);
    if (!confirmDelete) return;

    try {
      setDeletingPriceRowId(row.id);
      await onDeleteCustomerPriceList(selectedCustomer.id, row.productId);

      const [nextPriceList, nextAnalytics] = await Promise.all([
        onLoadCustomerPriceList(selectedCustomer.id),
        onLoadCustomerAnalytics(selectedCustomer.id, analyticsPeriod)
      ]);

      setPriceListRows(nextPriceList || []);
      setAnalyticsData(nextAnalytics || null);

      if (priceForm.productId === row.productId) {
        const fallbackProductId = (nextPriceList || [])[0]?.productId || "";
        if (fallbackProductId) {
          handlePriceProductChange(fallbackProductId);
        }
      }
    } catch (error) {
      alert(`Lỗi xóa giá riêng: ${error.message}`);
    } finally {
      setDeletingPriceRowId("");
    }
  };

  const copyPriceListFromCustomer = async () => {
    if (!selectedCustomer || !copySourceCustomerId) return;
    
    try {
      setPricePanelLoading(true);
      const sourcePriceList = await onLoadCustomerPriceList(copySourceCustomerId);
      
      if (!sourcePriceList || sourcePriceList.length === 0) {
        alert("Khách hàng được chọn không có bảng giá riêng");
        return;
      }
      
      // Copy từng giá từ khách hàng nguồn sang khách hàng đích
      let successCount = 0;
      for (const sourcePriceItem of sourcePriceList) {
        try {
          await onUpdateCustomerPriceList(selectedCustomer.id, sourcePriceItem.productId, {
            price: sourcePriceItem.price,
            storeId: activeStoreId || undefined
          });
          successCount++;
        } catch (error) {
          console.error(`Failed to copy price for product ${sourcePriceItem.productId}:`, error);
        }
      }
      
      // Reload bảng giá sau khi copy
      const [nextPriceList, nextAnalytics] = await Promise.all([
        onLoadCustomerPriceList(selectedCustomer.id),
        onLoadCustomerAnalytics(selectedCustomer.id, analyticsPeriod)
      ]);
      setPriceListRows(nextPriceList || []);
      setAnalyticsData(nextAnalytics || null);
      setShowCopyPricePanel(false);
      setCopySourceCustomerId("");
      
      alert(`Đã sao chép thành công ${successCount}/${sourcePriceList.length} giá từ khách hàng đó`);
    } catch (error) {
      alert(`Lỗi khi sao chép bảng giá: ${error.message}`);
    } finally {
      setPricePanelLoading(false);
    }
  };

  const openEditInfoPanel = () => {
    if (!selectedCustomer) return;
    setCustomerForm({
      name: selectedCustomer.name || "",
      ledgerCode: selectedCustomer.ledgerCode || "",
      phone: selectedCustomer.phone || "",
      email: selectedCustomer.email || "",
      address: selectedCustomer.address || "",
      accountOwnerPositionId: selectedCustomer.accountOwnerPositionId || "",
      businessAreaId: selectedCustomer.businessAreaId || "",
      customerPriceTier: selectedCustomer.customerPriceTier || ""
    });
    setCustomerFormErrors({});
    setCustomerFormMessage("");
    setShowEditInfoPanel(true);
  };

  const handleCustomerFormChange = (field, value) => {
    setCustomerForm((prev) => ({ ...prev, [field]: value }));
    setCustomerFormErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    if (customerFormMessage) {
      setCustomerFormMessage("");
    }
  };

  const submitCustomerInfo = async () => {
    if (!selectedCustomer || !onUpdateCustomerInfo || !canEditCustomerInfo) return;
    const errors = validateCustomerInfoForm(customerForm);
    if (Object.keys(errors).length) {
      setCustomerFormErrors(errors);
      setCustomerFormMessage("Biểu mẫu còn lỗi. Vui lòng kiểm tra các trường được đánh dấu.");
      return;
    }

    const name = customerForm.name.trim();

    try {
      setSavingCustomerInfo(true);
      const updated = await onUpdateCustomerInfo(selectedCustomer.id, {
        name,
        ledgerCode: customerForm.ledgerCode?.trim() || null,
        phone: customerForm.phone?.trim() || "",
        email: customerForm.email?.trim() || "",
        address: customerForm.address?.trim() || "",
        accountOwnerPositionId: customerForm.accountOwnerPositionId || null,
        businessAreaId: customerForm.businessAreaId || null,
        customerPriceTier: customerForm.customerPriceTier || null
      });
      setSelectedCustomer(updated || selectedCustomer);
      setShowEditInfoPanel(false);
      setCustomerFormErrors({});
      setCustomerFormMessage("");
    } catch (error) {
      setCustomerFormMessage(`Lỗi: ${error.message}`);
    } finally {
      setSavingCustomerInfo(false);
    }
  };

  const resetFilters = () => {
    setSearch("");
    setOwnerFilter("");
    setBusinessAreaFilter("");
    setOnlyDebt(false);
    setTierFilter("");
    setHasPhoneOnly(false);
  };

  return (
    <DesktopPageFrame
      title="Khách hàng"
      description="Theo dõi công nợ, vị trí phụ trách và bảng giá riêng theo cửa hàng"
      kpis={[
        { label: "Khách hàng", value: summary.customers },
        { label: "Khách có nợ", value: summary.withDebt },
        { label: "Tổng công nợ", value: formatCurrency(summary.totalDebt), mono: true },
        { label: "Dư trả trước", value: formatCurrency(summary.totalAdvance), mono: true }
      ]}
      filters={(
        <>
          <input
            className="filter-wide"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên, mã KH, mã sổ gốc, số điện thoại"
          />
          <AdvancedFiltersPopover activeCount={advancedFilterCount}>
            <div className="advanced-filter-grid">
              <label>
                Vị trí phụ trách
                <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
                  <option value="">Tất cả vị trí</option>
                  {ownerOptions.map((owner) => (
                    <option key={owner.id} value={owner.id}>{owner.label}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox-row desktop-filter-checkbox">
                <input
                  type="checkbox"
                  checked={onlyDebt}
                  onChange={(e) => setOnlyDebt(e.target.checked)}
                />
                Chỉ hiển thị khách có nợ
              </label>
              <label>
                Loại khách hàng
                <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
                  <option value="">Tất cả loại khách</option>
                  <option value="LEVEL_2">Cấp 2</option>
                  <option value="LEVEL_2_SPECIAL">Cấp 2 đặc biệt</option>
                </select>
              </label>
              <label>
                Khu vực kinh doanh
                <select value={businessAreaFilter} onChange={(e) => setBusinessAreaFilter(e.target.value)}>
                  <option value="">Tất cả khu vực</option>
                  {businessAreaOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox-row desktop-filter-checkbox">
                <input
                  type="checkbox"
                  checked={hasPhoneOnly}
                  onChange={(e) => setHasPhoneOnly(e.target.checked)}
                />
                Chỉ hiển thị khách có số điện thoại
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
              <th>Mã KH</th>
              <th>Mã sổ gốc</th>
              <th>Tên khách hàng</th>
              <th>Số điện thoại</th>
              <th>Khu vực KD</th>
              <th>Phụ trách hiện tại</th>
              <th>Địa chỉ</th>
              <th className="text-right">Công nợ</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="9" className="text-center">Không có dữ liệu</td>
              </tr>
            ) : (
              pagedRows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.code || row.id.slice(0, 8)}</td>
                  <td className="mono">{row.ledgerCode || "-"}</td>
                  <td>{row.name}</td>
                  <td>{row.phone || "-"}</td>
                  <td>{row.businessArea?.name || "-"}</td>
                  <td>{getAssignedStaffName(row.accountOwnerPositionId, orgPositions, staffUsers)}</td>
                  <td>{row.address || "-"}</td>
                  <td className="text-right mono" style={{ color: Number(row.netBalance) > 0 ? "#c92a2a" : "#2b8a3e" }}>
                    {formatCurrency(row.netBalance)}
                  </td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => openDetail(row)}>
                      Chi tiết
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div>Trang {page} / {totalPages} - Tổng {rows.length} khách hàng</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Trang trước</button>
          <button type="button" className="btn-secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Trang sau</button>
        </div>
      </div>

      {showDetail ? (
        <div className="dialog-overlay" onClick={closeDetail}>
          <div className="dialog-panel dialog-panel--customer" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Chi tiết khách hàng</h2>
              <div className="dialog-header-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={openEditInfoPanel}
                  disabled={!selectedCustomer || !onUpdateCustomerInfo || !canEditCustomerInfo}
                >
                  Sửa thông tin
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={openPricePanel}
                  disabled={!selectedCustomer}
                >
                  Bảng giá
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowTransactionPanel(true)}
                  disabled={!selectedCustomer}
                >
                  Lịch sử giao dịch
                </button>
                <button className="close-btn close-btn--emphasis" type="button" onClick={closeDetail} aria-label="Đóng">x</button>
              </div>
            </div>

            <div className="dialog-body">
              {detailLoading || !selectedCustomer ? (
                <p>Đang tải thông tin khách hàng...</p>
              ) : (
                <>
                  <div className="customer-detail-top">
                    <div className="detail-card detail-card--profile">
                      <h3>Thông tin cơ bản</h3>
                      <div className="customer-kv-list">
                        <div className="customer-kv-row">
                          <span>Họ tên</span>
                          <strong>{selectedCustomer.name}</strong>
                        </div>
                        <div className="customer-kv-row">
                          <span>Số điện thoại</span>
                          <strong>{selectedCustomer.phone || "-"}</strong>
                        </div>
                        <div className="customer-kv-row">
                          <span>Số dư hiện tại</span>
                          <strong className="mono" style={{ color: customerNetBalance > 0 ? "#c92a2a" : customerNetBalance < 0 ? "#2b8a3e" : undefined }}>
                            {formatCurrency(customerNetBalance)}
                          </strong>
                        </div>
                        <div className="customer-kv-row">
                          <span>Mã khách hàng</span>
                          <strong className="mono">{selectedCustomer.code || selectedCustomer.id.slice(0, 8)}</strong>
                        </div>
                        <div className="customer-kv-row">
                          <span>Mã sổ gốc</span>
                          <strong className="mono">{selectedCustomer.ledgerCode || "-"}</strong>
                        </div>
                        <div className="customer-kv-row">
                          <span>Phụ trách hiện tại</span>
                          <strong>{getAssignedStaffName(selectedCustomer.accountOwnerPositionId, orgPositions, staffUsers)}</strong>
                        </div>
                        <div className="customer-kv-row">
                          <span>Khu vực kinh doanh</span>
                          <strong>{selectedCustomer.businessArea?.name || "-"}</strong>
                        </div>
                        <div className="customer-kv-row">
                          <span>Địa chỉ</span>
                          <strong>{selectedCustomer.address || "-"}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="detail-section">
                    <div className="detail-section-head">
                      <h3>Tuổi nợ</h3>
                      <span className="aging-legend">Xanh: an toàn, đỏ: cần thu hồi sớm</span>
                    </div>
                    <div className="aging-grid">
                      {(agingData?.aging || []).map((item) => (
                        <div key={item.bucket} className={getAgingBucketTone(item.bucket)}>
                          <span>{item.bucket}</span>
                          <strong>{formatCurrency(item.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="detail-section">
                    <h3>Khoản nợ còn treo</h3>
                    <div className="list-shell">
                      <table className="simple-table">
                        <thead>
                          <tr>
                            <th>Số chứng từ</th>
                            <th>Ngày chứng từ</th>
                            <th>Tóm tắt đơn hàng</th>
                            <th>Loại</th>
                            <th>Tuổi nợ</th>
                            <th className="text-right">Còn lại</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agingData?.outstandingDetails?.length ? (
                            agingData.outstandingDetails.map((item) => (
                              <tr key={`${item.referenceId}-${item.createdAt}`}>
                                <td className="mono">{item.documentNo || item.referenceId}</td>
                                <td>{formatDateVN(item.createdAt)}</td>
                                <td>
                                  {item.orderItemsSummary?.length ? (
                                    <div style={{ display: "grid", gap: 4 }}>
                                      {item.orderItemsSummary.map((line, idx) => (
                                        <div key={`${line.sku}-${idx}`}>
                                          {line.sku} x {formatNumber(line.quantity || 0)} x {formatCurrency(line.unitPrice)}
                                        </div>
                                      ))}
                                      <div style={{ fontWeight: 600, color: "#0f766e" }}>
                                        Đã thanh toán: {formatCurrency(item.settledAmount)}
                                      </div>
                                    </div>
                                  ) : (
                                    <span>-</span>
                                  )}
                                </td>
                                <td>{item.transactionType}</td>
                                <td>
                                  <span className={getOverdueToneClass(item.overdueDays)}>
                                    {formatNumber(item.overdueDays || 0)} ngày
                                  </span>
                                </td>
                                <td className="text-right mono">{formatCurrency(item.remainingAmount)}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan="6" className="text-center">Không có khoản nợ treo</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="detail-section">
                    <div className="detail-section-head">
                      <h3>Phân tích doanh thu khách hàng</h3>
                      <div className="detail-section-controls">
                        <select
                          value={analyticsPeriod}
                          onChange={(e) => setAnalyticsPeriod(e.target.value)}
                        >
                          <option value="month">Theo tháng</option>
                          <option value="quarter">Theo quý</option>
                          <option value="year">Theo năm</option>
                        </select>
                        <button type="button" onClick={reloadAnalytics}>Tải lại</button>
                      </div>
                    </div>

                    {!analyticsData ? (
                      <p style={{ color: "#6b7280" }}>Chưa có dữ liệu phân tích.</p>
                    ) : (
                      <>
                        <div className="analytics-kpi-grid" style={{ marginTop: 12 }}>
                          <div className="analytics-kpi-card">
                            <span>Doanh thu</span>
                            <strong>{formatCurrency(analyticsData.summary?.totalRevenue)}</strong>
                          </div>
                          <div className="analytics-kpi-card">
                            <span>Tổng đơn</span>
                            <strong>{formatNumber(analyticsData.summary?.totalOrders || 0)}</strong>
                          </div>
                          <div className="analytics-kpi-card">
                            <span>Đã thu ròng</span>
                            <strong>{formatCurrency(analyticsData.summary?.totalPaidNet ?? analyticsData.summary?.totalPaid)}</strong>
                          </div>
                          <div className="analytics-kpi-card">
                            <span>Số dư ròng</span>
                            <strong>{formatCurrency(analyticsData.summary?.netBalance)}</strong>
                          </div>
                          <div className="analytics-kpi-card">
                            <span>Giá trị đã tặng quà</span>
                            <strong>{formatCurrency(giftValueTotal)}</strong>
                          </div>
                        </div>

                        <div className="list-shell">
                          <table className="simple-table">
                            <thead>
                              <tr>
                                <th>Kỳ</th>
                                <th className="text-right">Doanh thu</th>
                                <th className="text-right">Số đơn</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analyticsByPeriod.length ? (
                                analyticsByPeriod.map((row) => (
                                  <tr key={row.period}>
                                    <td>{row.period}</td>
                                    <td className="text-right mono">{formatCurrency(row.revenue)}</td>
                                    <td className="text-right">{row.orders}</td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan="3" className="text-center">Chưa có dữ liệu theo kỳ</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>

                </>
              )}
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closeDetail}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {showPricePanel ? (
        <div className="dialog-overlay dialog-overlay--stack" onClick={closePricePanel}>
          <div className="dialog-panel dialog-panel--price" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Bảng giá riêng {selectedCustomer ? `- ${selectedCustomer.name}` : ""}</h2>
              <button className="close-btn close-btn--emphasis" type="button" onClick={closePricePanel} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body">
              {pricePanelLoading ? (
                <p>Đang tải bảng giá...</p>
              ) : (
                <>
                  <div className="detail-section">
                    <div className="form-row">
                      <div className="form-group">
                        <label>Sản phẩm</label>
                        <SearchableSelect
                          value={priceForm.productId}
                          onChange={(e) => handlePriceProductChange(e)}
                          options={productOptions}
                          searchPlaceholder="Tìm theo mã, tên, đơn vị..."
                        />
                      </div>
                      <div className="form-group">
                        <label>Giá áp dụng</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          style={{ textAlign: "right" }}
                          value={formatCurrencyInput(priceForm.price)}
                          onChange={(e) => setPriceForm((prev) => ({ ...prev, price: parseMoneyInput(e.target.value) }))}
                        />
                      </div>
                    </div>
                    <div className="detail-actions">
                      <button type="button" className="btn-primary" onClick={submitPrice} disabled={!priceForm.productId || Number(priceForm.price) <= 0}>
                        Lưu giá riêng
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setShowCopyPricePanel(true)} disabled={!selectedCustomer}>
                        Sao chép từ khách khác
                      </button>
                    </div>
                  </div>

                  <div className="detail-section">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                      <h3 style={{ margin: 0 }}>Bảng giá riêng hiện có</h3>
                      <input
                        type="text"
                        placeholder="Tìm theo mã, tên, đơn vị..."
                        value={priceListFilter}
                        onChange={(e) => setPriceListFilter(e.target.value)}
                        style={{ width: 200, padding: "6px 10px", border: "1px solid var(--line)", borderRadius: "8px", fontFamily: 'inherit' }}
                      />
                    </div>
                    <div className="list-shell">
                      <table className="simple-table">
                        <thead>
                          <tr>
                            <th>Mã</th>
                            <th>Sản phẩm</th>
                            <th>Đơn vị</th>
                            <th className="text-right">Giá riêng</th>
                            <th className="text-right">Giá mặc định</th>
                            <th className="text-right">Chênh lệch</th>
                            <th className="text-right">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPriceListRows.length ? (
                            filteredPriceListRows.map((row) => {
                              const customPrice = Number(row.price);
                              const defaultPrice = Number(row.product?.defaultPrice || 0);
                              const diff = customPrice - defaultPrice;
                              const diffPercent = defaultPrice > 0 ? ((diff / defaultPrice) * 100).toFixed(1) : 0;
                              return (
                                <tr
                                  key={row.id}
                                  className={row.productId === priceForm.productId ? "customer-price-row customer-price-row--active" : "customer-price-row"}
                                  onClick={() => handlePriceProductChange(row.productId)}
                                  title="Bấm để nạp dòng này lên form chỉnh giá"
                                >
                                  <td className="mono">{row.product?.sku || row.productId.slice(0, 8)}</td>
                                  <td>{row.product?.name || row.productId}</td>
                                  <td>{row.product?.unit || "-"}</td>
                                  <td className="text-right mono">{formatCurrency(customPrice)}</td>
                                  <td className="text-right mono">{formatCurrency(defaultPrice)}</td>
                                  <td className="text-right mono" style={{ color: diff > 0 ? "#2b8a3e" : diff < 0 ? "#c92a2a" : "#666" }}>
                                    {formatCurrency(diff)} ({diffPercent}%)
                                  </td>
                                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="btn-cancel"
                                      style={{ padding: "4px 10px", fontSize: 12 }}
                                      disabled={deletingPriceRowId === row.id}
                                      onClick={() => deletePriceRow(row)}
                                    >
                                      {deletingPriceRowId === row.id ? "Đang xóa..." : "Xóa"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan="7" className="text-center">Chưa có bảng giá riêng</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </>
              )}
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closePricePanel}>Đóng</button>
            </div>
          </div>

          {showCopyPricePanel ? (
            <div className="dialog-overlay dialog-overlay--stack" onClick={() => setShowCopyPricePanel(false)}>
              <div className="dialog-panel" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                  <h3>Sao chép bảng giá từ khách hàng khác</h3>
                  <button className="close-btn close-btn--emphasis" type="button" onClick={() => setShowCopyPricePanel(false)} aria-label="Đóng">x</button>
                </div>

                <div className="dialog-body">
                  <div className="detail-section">
                    <label>Chọn khách hàng để sao chép:</label>
                    <div style={{ marginTop: 8 }}>
                      <SearchableSelect
                        value={copySourceCustomerId}
                        onChange={setCopySourceCustomerId}
                        options={copySourceCustomerOptions}
                        allLabel="-- Chọn khách hàng --"
                        searchPlaceholder="Tìm theo tên, số điện thoại, địa chỉ..."
                      />
                    </div>
                  </div>
                </div>

                <div className="dialog-footer">
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setShowCopyPricePanel(false)}
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={copyPriceListFromCustomer}
                    disabled={!copySourceCustomerId}
                  >
                    Sao chép
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showTransactionPanel ? (
        <div className="dialog-overlay dialog-overlay--stack" onClick={() => setShowTransactionPanel(false)}>
          <div className="dialog-panel dialog-panel--transaction" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Lịch sử giao dịch {selectedCustomer ? `- ${selectedCustomer.name}` : ""}</h2>
              <button className="close-btn close-btn--emphasis" type="button" onClick={() => setShowTransactionPanel(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body">
              <div className="transaction-filter-bar">
                <input
                  className="transaction-search-input"
                  placeholder="Tìm theo số chứng từ, loại, ghi chú"
                  value={transactionKeyword}
                  onChange={(e) => setTransactionKeyword(e.target.value)}
                />
                <select className="transaction-type-select" value={transactionTypeFilter} onChange={(e) => setTransactionTypeFilter(e.target.value)}>
                  <option value="">Tất cả loại giao dịch</option>
                  {transactionTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={transactionFromDate}
                  onChange={(e) => setTransactionFromDate(e.target.value)}
                />
                <input
                  type="date"
                  value={transactionToDate}
                  onChange={(e) => setTransactionToDate(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setTransactionKeyword("");
                    setTransactionTypeFilter("");
                    setTransactionFromDate("");
                    setTransactionToDate("");
                    setTransactionPage(1);
                  }}
                >
                  Xóa lọc
                </button>
              </div>

              <div className="transaction-filter-summary">
                Hiển thị {formatNumber(filteredTransactions.length)}/{formatNumber(transactions.length)} giao dịch • Trang {formatNumber(transactionPage)}/{formatNumber(transactionTotalPages)}
              </div>

              <div className="list-shell">
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th className="text-right">#</th>
                      <th>Thời gian</th>
                      <th>Loại giao dịch</th>
                      <th>Số chứng từ</th>
                      <th className="text-right">Số tiền</th>
                      <th>Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTransactions.length ? (
                      pagedTransactions.map((row, index) => (
                        <tr key={row.id}>
                          <td className="text-right mono">{(transactionPage - 1) * transactionPageSize + index + 1}</td>
                          <td>{formatDateTimeVN(row.createdAt)}</td>
                          <td>
                            <span className="transaction-type-pill">{row.typeLabel}</span>
                          </td>
                          <td className="mono">{row.documentNo}</td>
                          <td className="text-right mono">
                            <span className={row.amountClass}>{row.amountLabel}</span>
                          </td>
                          <td className="transaction-note-cell" title={row.note || ""}>{row.note || "Không có ghi chú"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="text-center">Không có giao dịch phù hợp bộ lọc</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="transaction-pagination">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setTransactionPage((p) => Math.max(1, p - 1))}
                  disabled={transactionPage <= 1}
                >
                  Trang trước
                </button>
                <span>
                  Trang {formatNumber(transactionPage)} / {formatNumber(transactionTotalPages)}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setTransactionPage((p) => Math.min(transactionTotalPages, p + 1))}
                  disabled={transactionPage >= transactionTotalPages}
                >
                  Trang sau
                </button>
              </div>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowTransactionPanel(false)}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {showEditInfoPanel && canEditCustomerInfo ? (
        <div className="dialog-overlay dialog-overlay--stack" onClick={() => setShowEditInfoPanel(false)}>
          <div className="dialog-panel dialog-panel--customer-edit" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Sửa thông tin khách hàng</h2>
                <p className="product-create-subtitle">Cập nhật thông tin liên hệ và phân công phụ trách cho khách hàng này.</p>
              </div>
              <button className="close-btn close-btn--emphasis" type="button" onClick={() => setShowEditInfoPanel(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body product-create-body">
              <section className="product-create-hero detail-card">
                <div>
                  <span className="product-edit-eyebrow">Khách hàng</span>
                  <h3>{customerForm.name.trim() || selectedCustomer?.name || "Chưa có tên"}</h3>
                  <p>{customerForm.phone || selectedCustomer?.phone || "Chưa có số điện thoại"} · {customerForm.email || selectedCustomer?.email || "Chưa có email"}</p>
                </div>
                <div className="product-edit-chip-row">
                  <span className="product-edit-chip">Mã {(selectedCustomer?.code || selectedCustomer?.id?.slice(0, 8) || "--")}</span>
                  <span className="product-edit-chip">Sổ gốc {(customerForm.ledgerCode || selectedCustomer?.ledgerCode || "--")}</span>
                  <span className="product-edit-chip">Vị trí {customerForm.accountOwnerPositionId ? "Đã gán" : "Chưa gán"}</span>
                  <span className="product-edit-chip">Khu vực {businessAreaOptions.find((item) => item.value === customerForm.businessAreaId)?.label || "Chưa gán"}</span>
                  <span className="product-edit-chip">Loại KH {customerForm.customerPriceTier === "LEVEL_2" ? "Cấp 2" : customerForm.customerPriceTier === "LEVEL_2_SPECIAL" ? "Cấp 2 đặc biệt" : "Mặc định"}</span>
                </div>
              </section>

              <FormBanner message={customerFormMessage} tone="error" />

              <div className="form-card" style={{ margin: 0 }}>
                <div className="grid-2">
                  <div>
                    <label>Họ tên</label>
                    <input
                      className={customerFormErrors.name ? "form-control form-control--invalid" : "form-control"}
                      value={customerForm.name}
                      onChange={(e) => handleCustomerFormChange("name", e.target.value)}
                      placeholder="Nhập họ tên khách hàng"
                    />
                    <div className={customerFormErrors.name ? "field-error" : "field-hint"}>{customerFormErrors.name || "Tên hiển thị trong hồ sơ khách hàng và chứng từ."}</div>
                  </div>

                  <div>
                    <label>Mã sổ gốc</label>
                    <input
                      className="form-control"
                      value={customerForm.ledgerCode}
                      onChange={(e) => handleCustomerFormChange("ledgerCode", e.target.value)}
                      placeholder="Ví dụ: SG-KH-001"
                    />
                    <div className="field-hint">Mã tham chiếu sổ tay để đối soát ghi chép công nợ khách hàng.</div>
                  </div>

                  <div>
                    <label>Số điện thoại</label>
                    <input
                      className="form-control"
                      value={customerForm.phone}
                      onChange={(e) => handleCustomerFormChange("phone", e.target.value)}
                      placeholder="Nhập số điện thoại"
                    />
                    <div className="field-hint">Dùng để tìm nhanh khách hàng tại POS.</div>
                  </div>

                  <div>
                    <label>Email</label>
                    <input
                      className={customerFormErrors.email ? "form-control form-control--invalid" : "form-control"}
                      value={customerForm.email}
                      onChange={(e) => handleCustomerFormChange("email", e.target.value)}
                      placeholder="Nhập email"
                    />
                    <div className={customerFormErrors.email ? "field-error" : "field-hint"}>{customerFormErrors.email || "Có thể để trống nếu chưa có email."}</div>
                  </div>

                  <div>
                    <label>Vị trí phụ trách</label>
                    <SearchableSelect
                      value={customerForm.accountOwnerPositionId}
                      onChange={(value) => handleCustomerFormChange("accountOwnerPositionId", value)}
                      options={positionOptions}
                      allLabel="Không gán vị trí"
                      searchPlaceholder="Tìm theo tên hoặc mã vị trí"
                    />
                    <div className="field-hint">Gán vị trí phụ trách để theo dõi chăm sóc khách hàng.</div>
                  </div>

                  <div>
                    <label>Loại khách hàng</label>
                    <SearchableSelect
                      value={customerForm.customerPriceTier}
                      onChange={(value) => handleCustomerFormChange("customerPriceTier", value)}
                      options={customerPriceTierOptions}
                      allLabel="Mặc định (không áp dụng cấp giá)"
                      searchPlaceholder="Tìm loại khách hàng"
                    />
                    <div className="field-hint">Dùng để áp dụng giá bán theo cấp khi tạo đơn hàng.</div>
                  </div>

                  <div>
                    <label>Khu vực kinh doanh</label>
                    <SearchableSelect
                      value={customerForm.businessAreaId}
                      onChange={(value) => handleCustomerFormChange("businessAreaId", value)}
                      options={businessAreaOptions}
                      allLabel="Không gán khu vực"
                      searchPlaceholder="Tìm khu vực kinh doanh"
                    />
                    <div className="field-hint">Dùng để phân nhóm khách hàng theo khu vực phụ trách.</div>
                  </div>

                  <div style={{ gridColumn: "1 / -1" }}>
                    <label>Địa chỉ</label>
                    <input
                      className="form-control"
                      value={customerForm.address}
                      onChange={(e) => handleCustomerFormChange("address", e.target.value)}
                      placeholder="Nhập địa chỉ"
                    />
                    <div className="field-hint">Địa chỉ giúp giao hàng và ghi chú hồ sơ đầy đủ hơn.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowEditInfoPanel(false)} disabled={savingCustomerInfo}>
                Hủy
              </button>
              <button type="button" className="btn-primary" onClick={submitCustomerInfo} disabled={savingCustomerInfo}>
                {savingCustomerInfo ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DesktopPageFrame>
  );
}








