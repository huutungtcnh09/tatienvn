import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import "../styles/pages.css";
import { formatMoneyInput as formatCurrencyInput, formatCurrency, formatNumber } from "../utils/currency";
import { formatDateTimeVN } from "../utils/datetime";

function flattenCategories(nodes = [], parentPath = "", level = 0) {
  const result = [];

  for (const node of nodes) {
    const currentPath = parentPath ? `${parentPath} / ${node.name}` : node.name;
    result.push({
      id: node.id,
      name: currentPath,
      rawName: node.name,
      parentId: node.parentId || null,
      level,
      productCount: Number(node?._count?.products || 0),
      hasChildren: Array.isArray(node?.children) && node.children.length > 0
    });

    if (Array.isArray(node?.children) && node.children.length) {
      result.push(...flattenCategories(node.children, currentPath, level + 1));
    }
  }

  return result;
}

function normalizeCategoryName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function collectDescendantIds(nodes = [], rootId) {
  const descendants = new Set();

  function walk(branches) {
    for (const node of branches) {
      if (node.id === rootId) {
        addChildren(node.children || []);
      } else if (Array.isArray(node.children) && node.children.length) {
        walk(node.children);
      }
    }
  }

  function addChildren(children) {
    for (const child of children) {
      descendants.add(child.id);
      if (Array.isArray(child.children) && child.children.length) {
        addChildren(child.children);
      }
    }
  }

  walk(nodes);
  return descendants;
}

function parseMoneyInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? String(Number(digits)) : "";
}

const MAX_UPLOAD_IMAGE_SIZE = 5 * 1024 * 1024;

function isSupportedImageUrl(value) {
  return /^https?:\/\//i.test(value) || /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Không đọc được tệp ảnh."));
    reader.readAsDataURL(file);
  });
}

function isBlobPreviewUrl(value) {
  return String(value || "").startsWith("blob:");
}

function revokePreviewUrl(entry) {
  const url = String(entry?.url || "");
  if (isBlobPreviewUrl(url)) {
    URL.revokeObjectURL(url);
  }
}

function normalizeImageGallery(galleryInput, fallbackImageUrl = "") {
  const raw = Array.isArray(galleryInput) ? galleryInput : [];
  const seen = new Set();
  const items = [];

  for (const entry of raw) {
    const url = String(entry?.url || "").trim();
    if (!url || !isSupportedImageUrl(url) || seen.has(url)) continue;
    seen.add(url);
    items.push({
      url,
      isDefault: Boolean(entry?.isDefault),
      showOnCorporate: Boolean(entry?.showOnCorporate)
    });
  }

  const fallback = String(fallbackImageUrl || "").trim();
  if (fallback && isSupportedImageUrl(fallback) && !seen.has(fallback)) {
    items.push({ url: fallback, isDefault: items.length === 0, showOnCorporate: false });
  }

  if (!items.length) return [];

  let hasDefault = false;
  const normalized = items.map((item) => {
    if (item.isDefault && !hasDefault) {
      hasDefault = true;
      return item;
    }
    return { ...item, isDefault: false };
  });

  if (!hasDefault) {
    normalized[0] = { ...normalized[0], isDefault: true };
  }

  return normalized;
}

function getDefaultImageUrl(imageGallery = []) {
  if (!Array.isArray(imageGallery) || !imageGallery.length) return "";
  return imageGallery.find((item) => item.isDefault)?.url || imageGallery[0]?.url || "";
}

function fmtDate(v) {
  return formatDateTimeVN(v);
}

function getProductTypeLabel(productType) {
  return productType === "SERVICE" ? "Dịch vụ" : "Hàng hóa";
}

const DETAIL_TIME_FILTER_OPTIONS = [
  { value: "month-current", label: "Tháng này" },
  { value: "quarter-current", label: "Quý này" },
  { value: "year-current", label: "Năm nay" },
  { value: "year-previous", label: "Năm trước" }
];

function calcPercentDelta(currentValue, previousValue) {
  if (!previousValue) return currentValue ? null : 0;
  const raw = ((currentValue - previousValue) / previousValue) * 100;
  return Math.round(raw * 10) / 10;
}

function parseMonthKey(key) {
  const matched = String(key || "").match(/^(\d{4})-(\d{2})$/);
  if (!matched) return null;
  return { year: Number(matched[1]), month: Number(matched[2]) };
}

function parseQuarterKey(key) {
  const matched = String(key || "").match(/^(\d{4})-Q([1-4])$/i);
  if (!matched) return null;
  return { year: Number(matched[1]), quarter: Number(matched[2]) };
}

function resolveTrendRowsByFilter(salesTrend, priceAnalysis, periodFilter) {
  const rows = Array.isArray(salesTrend) ? salesTrend : [];
  if (!rows.length || !priceAnalysis) return rows;

  const monthCurrentKey = priceAnalysis.month?.currentKey;
  const quarterCurrentKey = priceAnalysis.quarter?.currentKey;
  const yearCurrentKey = priceAnalysis.year?.currentKey;
  const yearPreviousKey = priceAnalysis.year?.previousKey;

  if (periodFilter === "month-current" && monthCurrentKey) {
    return rows.filter((row) => row.month === monthCurrentKey);
  }

  if (periodFilter === "quarter-current" && quarterCurrentKey) {
    const quarterInfo = parseQuarterKey(quarterCurrentKey);
    if (!quarterInfo) return rows;
    return rows.filter((row) => {
      const monthInfo = parseMonthKey(row.month);
      if (!monthInfo) return false;
      const quarter = Math.floor((monthInfo.month - 1) / 3) + 1;
      return monthInfo.year === quarterInfo.year && quarter === quarterInfo.quarter;
    });
  }

  if (periodFilter === "year-current" && yearCurrentKey) {
    return rows.filter((row) => String(row.month || "").startsWith(`${yearCurrentKey}-`));
  }

  if (periodFilter === "year-previous" && yearPreviousKey) {
    return rows.filter((row) => String(row.month || "").startsWith(`${yearPreviousKey}-`));
  }

  return rows;
}

  // ---- CSV import utilities ----
  const IMPORT_CSV_REQUIRED_COLS = ["sku", "name", "unit", "salePrice"];
  const IMPORT_CSV_TEMPLATE_HEADERS = [
    "sku", "name", "productType", "categoryName", "unit",
    "salePrice", "priceLevel2", "priceLevel2Special", "promoPrice",
    "rewardPoints", "supplierQuotedPrice", "supplierQuoteNote", "ingredients", "benefits", "usageGuide", "isTrackedInOverview"
  ];
  const IMPORT_CSV_COLUMN_GUIDE = [
    { key: "sku", required: true, note: "Mã SKU duy nhất. Nếu đã tồn tại thì sẽ cập nhật." },
    { key: "name", required: true, note: "Tên sản phẩm" },
    { key: "productType", required: false, note: "GOODS hoặc SERVICE. Mặc định GOODS" },
    { key: "categoryName", required: false, note: "Để trống sẽ gán 'Chưa phân loại'" },
    { key: "unit", required: true, note: "Đơn vị tính (Cái, Hộp, ... )" },
    { key: "salePrice", required: true, note: "Giá bán > 0" },
    { key: "priceLevel2", required: false, note: "Nếu trống sẽ lấy salePrice" },
    { key: "priceLevel2Special", required: false, note: "Nếu trống sẽ lấy priceLevel2" },
    { key: "promoPrice", required: false, note: "Giá khuyến mãi >= 0" },
    { key: "rewardPoints", required: false, note: "Điểm thưởng, mặc định 0" },
    { key: "supplierQuotedPrice", required: false, note: "Giá NCC chào" },
    { key: "supplierQuoteNote", required: false, note: "Ghi chú chào giá" },
    { key: "ingredients", required: false, note: "Thành phần (cách nhau bằng ; hoặc xuống dòng)" },
    { key: "benefits", required: false, note: "Công dụng (cách nhau bằng ; hoặc xuống dòng)" },
    { key: "usageGuide", required: false, note: "Hướng dẫn sử dụng" },
    { key: "isTrackedInOverview", required: false, note: "TRUE/FALSE, mặc định TRUE" },
  ];

  const IMPORT_CSV_HEADER_ALIAS = {
    sku: ["sku", "ma sku", "mã sku", "ma", "mã", "product sku"],
    name: ["name", "ten", "tên", "ten san pham", "tên sản phẩm", "product name"],
    productType: ["producttype", "product type", "loai hang", "loại hàng"],
    categoryName: ["categoryname", "category name", "danh muc", "danh mục", "nganh hang", "ngành hàng"],
    unit: ["unit", "don vi", "đơn vị", "dvt", "uom"],
    salePrice: ["saleprice", "sale price", "gia ban", "giá bán", "defaultprice", "default price"],
    priceLevel2: ["pricelevel2", "price level2", "price level 2", "gia cap 2", "giá cấp 2"],
    priceLevel2Special: ["pricelevel2special", "price level2 special", "price level 2 special", "gia cap 2 dac biet", "giá cấp 2 đặc biệt"],
    promoPrice: ["promoprice", "promo price", "gia khuyen mai", "giá khuyến mãi"],
    rewardPoints: ["rewardpoints", "reward points", "diem thuong", "điểm thưởng"],
    supplierQuotedPrice: ["supplierquotedprice", "supplier quoted price", "chao gia ncc", "chào giá ncc"],
    supplierQuoteNote: ["supplierquotenote", "supplier quote note", "ghi chu chao gia", "ghi chú chào giá"],
    ingredients: ["ingredients", "thanh phan", "thành phần"],
    benefits: ["benefits", "cong dung", "công dụng", "loi ich", "lợi ích"],
    usageGuide: ["usageguide", "usage guide", "huong dan su dung", "hướng dẫn sử dụng", "tu van", "tư vấn"],
    isTrackedInOverview: ["istrackedinoverview", "is tracked in overview", "theo doi tong quan", "theo dõi tổng quan"]
  };

  function normalizeImportHeader(value) {
    return String(value || "")
      .replace(/^\ufeff/, "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function toCanonicalImportHeader(rawHeader) {
    const normalized = normalizeImportHeader(rawHeader);
    if (!normalized) return "";

    const direct = IMPORT_CSV_TEMPLATE_HEADERS.find((h) => normalizeImportHeader(h) === normalized);
    if (direct) return direct;

    for (const [canonical, aliases] of Object.entries(IMPORT_CSV_HEADER_ALIAS)) {
      if (aliases.some((alias) => normalizeImportHeader(alias) === normalized)) {
        return canonical;
      }
    }

    return String(rawHeader || "").trim();
  }

  function parseCSVText(text) {
    const normalizedText = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const firstLine = normalizedText.split("\n", 1)[0] || "";
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const delimiter = semicolonCount > commaCount && semicolonCount >= tabCount
      ? ";"
      : tabCount > commaCount && tabCount > semicolonCount
        ? "\t"
        : ",";

    const table = [];
    let row = [];
    let cell = "";
    let inQ = false;

    for (let i = 0; i < normalizedText.length; i += 1) {
      const c = normalizedText[i];
      if (c === '"') {
        if (inQ && normalizedText[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQ = !inQ;
        }
        continue;
      }

      if (!inQ && c === delimiter) {
        row.push(cell);
        cell = "";
        continue;
      }

      if (!inQ && c === "\n") {
        row.push(cell);
        const hasAnyValue = row.some((v) => String(v || "").trim() !== "");
        if (hasAnyValue) table.push(row);
        row = [];
        cell = "";
        continue;
      }

      cell += c;
    }

    row.push(cell);
    const hasAnyTailValue = row.some((v) => String(v || "").trim() !== "");
    if (hasAnyTailValue) table.push(row);

    if (!table.length) {
      return { headers: [], rows: [] };
    }

    const rawHeaders = table[0].map((h) => String(h || "").trim());
    const headers = rawHeaders.map((h) => toCanonicalImportHeader(h));
    const rows = table.slice(1).map((vals) => {
      const mapped = {};
      headers.forEach((h, idx) => {
        if (!h) return;
        mapped[h] = String(vals[idx] ?? "").trim();
      });
      return mapped;
    });

    return { headers, rows };
  }

  function validateImportCSVRow(raw, idx) {
    const errors = [];
    const sku = String(raw.sku || "").trim();
    const name = String(raw.name || "").trim();
    const unit = String(raw.unit || "").trim();
    const salePriceStr = String(raw.salePrice || "").replace(/[^0-9.]/g, "");
    const salePrice = Number(salePriceStr);
    if (sku.length < 2) errors.push("SKU tối thiểu 2 ký tự");
    if (name.length < 2) errors.push("Tên sản phẩm tối thiểu 2 ký tự");
    if (!unit) errors.push("Đơn vị không được để trống");
    if (!salePriceStr || salePrice <= 0) errors.push("Giá bán phải > 0");
    const productType = String(raw.productType || "GOODS").trim().toUpperCase();
    if (!["GOODS", "SERVICE"].includes(productType)) errors.push("productType phải là GOODS hoặc SERVICE");
    const p2Str = String(raw.priceLevel2 || "").replace(/[^0-9.]/g, "");
    const priceLevel2 = p2Str ? Number(p2Str) : salePrice;
    const p2sStr = String(raw.priceLevel2Special || "").replace(/[^0-9.]/g, "");
    const priceLevel2Special = p2sStr ? Number(p2sStr) : priceLevel2;
    const promoPriceStr = String(raw.promoPrice || "").replace(/[^0-9.]/g, "");
    const promoPrice = promoPriceStr ? Number(promoPriceStr) : undefined;
    const rewardPoints = Number(String(raw.rewardPoints || "0").replace(/[^0-9]/g, "") || 0);
    const sqpStr = String(raw.supplierQuotedPrice || "").replace(/[^0-9.]/g, "");
    const supplierQuotedPrice = sqpStr ? Number(sqpStr) : undefined;
    const isTrackedStr = String(raw.isTrackedInOverview || "TRUE").trim().toUpperCase();
    const isTrackedInOverview = !["FALSE", "0", "NO"].includes(isTrackedStr);
    return {
      _line: idx + 2,
      _valid: errors.length === 0,
      _errors: errors,
      sku, name, productType,
      categoryName: String(raw.categoryName || "").trim(),
      unit, salePrice, priceLevel2, priceLevel2Special,
      ...(promoPrice !== undefined && { promoPrice }),
      rewardPoints,
      ...(supplierQuotedPrice !== undefined && { supplierQuotedPrice }),
      supplierQuoteNote: String(raw.supplierQuoteNote || "").trim() || undefined,
      ingredients: String(raw.ingredients || "").trim() || undefined,
      benefits: String(raw.benefits || "").trim() || undefined,
      usageGuide: String(raw.usageGuide || "").trim() || undefined,
      isTrackedInOverview,
    };
  }

function createBulkPricingDraft(product) {
  return {
    salePrice: String(Number(product?.salePrice ?? product?.defaultPrice ?? 0)),
    priceLevel2: String(Number(product?.priceLevel2 ?? product?.level2Price ?? product?.defaultPrice ?? 0)),
    priceLevel2Special: String(Number(product?.priceLevel2Special ?? product?.level2SpecialPrice ?? product?.level2Price ?? product?.defaultPrice ?? 0)),
    promoPrice: String(Number(product?.promoPrice ?? 0)),
    rewardPoints: String(Number(product?.rewardPoints || 0)),
    giftPointsCost: String(Number(product?.giftPointsCost || 0))
  };
}

function parseDraftMoney(value) {
  return Number(parseMoneyInput(value || 0) || 0);
}

function parseDraftRewardPoints(value) {
  return Number(String(value ?? "").replace(/[^\d]/g, "") || 0);
}

export default function Products({ token }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [stores, setStores] = useState([]);
  const [overview, setOverview] = useState(null);
  const [stockByProduct, setStockByProduct] = useState({});
  const [loading, setLoading] = useState(true);
  const [togglingCorporateProductId, setTogglingCorporateProductId] = useState(null);
  const [togglingActiveProductId, setTogglingActiveProductId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterProductType, setFilterProductType] = useState("");
  const [filterActiveStatus, setFilterActiveStatus] = useState("");
  const [filterCorporateStatus, setFilterCorporateStatus] = useState("");
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [showBulkPricingEditor, setShowBulkPricingEditor] = useState(false);
  const [bulkSearchTerm, setBulkSearchTerm] = useState("");
  const [bulkFilterCategory, setBulkFilterCategory] = useState("");
  const [bulkFilterProductType, setBulkFilterProductType] = useState("");
  const [bulkSort, setBulkSort] = useState({ key: "sku", direction: "asc" });
  const [bulkPricingEdits, setBulkPricingEdits] = useState({});
  const [bulkSelectedIds, setBulkSelectedIds] = useState([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: "", parentId: "" });
  const [editingCategory, setEditingCategory] = useState(null);
  const [categorySaving, setCategorySaving] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState(null);

  // CSV bulk import
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importStep, setImportStep] = useState("upload");
  const [importRows, setImportRows] = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importAction, setImportAction] = useState("import");
  const importFileInputRef = useRef(null);

  // Product consultation dialog (separate from generic product edit)
  const [showConsultDialog, setShowConsultDialog] = useState(false);
  const [consultTargetProduct, setConsultTargetProduct] = useState(null);
  const [consultForm, setConsultForm] = useState({ ingredients: "", benefits: "", usageGuide: "" });
  const [consultSaving, setConsultSaving] = useState(false);
  const [showHeaderQuickMenu, setShowHeaderQuickMenu] = useState(false);
  const headerQuickMenuRef = useRef(null);

  // Edit dialog
  const [showDialog, setShowDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const productImageInputRef = useRef(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadImageMessage, setUploadImageMessage] = useState("");
  const [formData, setFormData] = useState({
    sku: "", name: "", categoryId: "", unit: "Cái",
      salePrice: 0, priceLevel2: 0, priceLevel2Special: 0, promoPrice: 0, supplierQuotedPrice: "", supplierQuoteNote: "", ingredients: "", benefits: "", usageGuide: "", costPrice: 0, rewardPoints: 0, giftPointsCost: 0, imageUrl: "",
      imageGallery: [],
      productType: "GOODS", isTrackedInOverview: true, isActive: true, isVisibleOnCorporate: false
  });

  // Stock / cost dialog
  const [showStockDialog, setShowStockDialog] = useState(false);
  const [stockProduct, setStockProduct] = useState(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockSaving, setStockSaving] = useState(false);
  const [stockForm, setStockForm] = useState({
    costPrice: "0",
    inventoryByStore: {}
  });

  // Detail / analytics dialog
  const [showDetail, setShowDetail] = useState(false);
  const [detailProduct, setDetailProduct] = useState(null);
  const [detailAnalytics, setDetailAnalytics] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPeriodFilter, setDetailPeriodFilter] = useState("month-current");

  const categoryOptions = useMemo(() => flattenCategories(categories), [categories]);

  const disallowedParentIds = useMemo(() => {
    if (!editingCategory?.id) return new Set();
    return collectDescendantIds(categories, editingCategory.id);
  }, [categories, editingCategory]);

  const availableParentOptions = useMemo(() => {
    return categoryOptions.filter((category) => {
      if (!editingCategory?.id) return true;
      if (category.id === editingCategory.id) return false;
      if (disallowedParentIds.has(category.id)) return false;
      return true;
    });
  }, [categoryOptions, editingCategory, disallowedParentIds]);

  const categoryNameExists = useMemo(() => {
    const normalized = normalizeCategoryName(categoryForm.name);
    if (!normalized) return false;

    return categoryOptions.some((category) => {
      return category.id !== editingCategory?.id && normalizeCategoryName(category.rawName) === normalized;
    });
  }, [categoryForm.name, categoryOptions, editingCategory]);

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
    const nextDrafts = {};
    products.forEach((product) => {
      nextDrafts[product.id] = createBulkPricingDraft(product);
    });
    setBulkPricingEdits(nextDrafts);
    setBulkSelectedIds([]);
  }, [products]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!showHeaderQuickMenu) return;
      if (!headerQuickMenuRef.current?.contains(event.target)) {
        setShowHeaderQuickMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showHeaderQuickMenu]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [productsData, categoriesData, overviewData, storesData] = await Promise.all([
        api.getProducts(token, { page, pageSize, search: debouncedSearch || undefined }),
        api.getCategories(token),
        api.getProductsOverview(token).catch(() => null),
        api.getStores(token).catch(() => ({ data: [] }))
      ]);
      const productRows = Array.isArray(productsData) ? productsData : (productsData?.data || []);
      setProducts(productRows);
      setTotal(Array.isArray(productsData) ? productRows.length : Number(productsData?.total || 0));
      setCategories(categoriesData.data || categoriesData);
      setOverview(overviewData?.data || overviewData);

      const stores = storesData?.data || storesData || [];
      setStores(stores);
      if (stores.length) {
        const inventories = await Promise.all(
          stores.map((store) => api.getInventoryByStore(token, store.id).catch(() => ({ data: [] })))
        );
        const aggregate = {};
        inventories.forEach((invRes) => {
          const rows = invRes?.data || invRes || [];
          rows.forEach((row) => {
            const productId = row.productId;
            const available = Number(
              row.availableQuantity
                ?? row.availableQuảntity
                ?? (Number(row.quantity || 0) - Number(row.reservedQuantity || row.reservedQuảntity || 0))
            );
            aggregate[productId] = (aggregate[productId] || 0) + available;
          });
        });
        setStockByProduct(aggregate);
      } else {
        setStockByProduct({});
      }
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (product) => {
    setDetailProduct(product);
    setDetailAnalytics(null);
    setDetailPeriodFilter("month-current");
    setShowDetail(true);
    setDetailLoading(true);
    try {
      const res = await api.getProductAnalytics(token, product.id);
      setDetailAnalytics(res.data || res);
    } catch (e) {
      alert(`Lỗi phân tích sản phẩm: ${e.message}`);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleOpenDialog = (product = null) => {
    if (product) {
      const imageGallery = normalizeImageGallery(product.imageGallery, product.imageUrl);
      setEditingProduct(product);
      setFormData({
        sku: product.sku, name: product.name, productType: product.productType || "GOODS", categoryId: product.categoryId, unit: product.unit,
        salePrice: Number(product.salePrice ?? product.defaultPrice ?? 0),
        priceLevel2: Number(product.priceLevel2 ?? product.level2Price ?? product.defaultPrice ?? 0),
        priceLevel2Special: Number(product.priceLevel2Special ?? product.level2SpecialPrice ?? product.level2Price ?? product.defaultPrice ?? 0),
        promoPrice: Number(product.promoPrice ?? 0),
        supplierQuotedPrice: product.supplierQuotedPrice == null ? "" : String(Number(product.supplierQuotedPrice || 0)),
        supplierQuoteNote: product.supplierQuoteNote || "",
        ingredients: product.ingredients || "",
        benefits: product.benefits || "",
        usageGuide: product.usageGuide || "",
        costPrice: product.costPrice || 0, rewardPoints: product.rewardPoints || 0, giftPointsCost: product.giftPointsCost || 0,
        imageUrl: getDefaultImageUrl(imageGallery),
        imageGallery,
        isTrackedInOverview: product.isTrackedInOverview !== false, isActive: product.isActive !== false, isVisibleOnCorporate: Boolean(product.isVisibleOnCorporate)
      });
    } else {
      setEditingProduct(null);
      setFormData({ sku: "", name: "", productType: "GOODS", categoryId: "", unit: "Cái", salePrice: 0, priceLevel2: 0, priceLevel2Special: 0, promoPrice: 0, supplierQuotedPrice: "", supplierQuoteNote: "", ingredients: "", benefits: "", usageGuide: "", costPrice: 0, rewardPoints: 0, giftPointsCost: 0, imageUrl: "", imageGallery: [], isTrackedInOverview: true, isActive: true, isVisibleOnCorporate: false });
    }
    setUploadImageMessage("");
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    if (!editingProduct) {
      (Array.isArray(formData.imageGallery) ? formData.imageGallery : []).forEach(revokePreviewUrl);
    }
    setShowDialog(false);
    setEditingProduct(null);
    setUploadingImage(false);
    setUploadImageMessage("");
  };

  const handlePickImageClick = () => {
    if (uploadingImage) return;
    productImageInputRef.current?.click();
  };

  const handleUploadImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadImageMessage("Vui lòng chọn tệp ảnh hợp lệ (png, jpg, webp...).");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_UPLOAD_IMAGE_SIZE) {
      setUploadImageMessage("Ảnh vượt quá 5MB. Vui lòng chọn ảnh nhỏ hơn.");
      event.target.value = "";
      return;
    }

    try {
      setUploadingImage(true);
      setUploadImageMessage("");
      if (editingProduct?.id) {
        const currentGallery = normalizeImageGallery(formData.imageGallery, formData.imageUrl);
        const uploaded = await api.uploadProductImage(token, editingProduct.id, file, {
          makeDefault: currentGallery.length === 0,
          showOnCorporate: false
        });
        const nextGallery = normalizeImageGallery(uploaded?.data?.imageGallery ?? uploaded?.imageGallery, uploaded?.data?.imageUrl ?? uploaded?.imageUrl);
        setFormData((prev) => ({
          ...prev,
          imageGallery: nextGallery,
          imageUrl: getDefaultImageUrl(nextGallery)
        }));
      } else {
        const previewUrl = URL.createObjectURL(file);
        setFormData((prev) => {
          const prevGallery = Array.isArray(prev.imageGallery) ? prev.imageGallery : [];
          const nextGallery = [
            ...prevGallery,
            { url: previewUrl, file, isDefault: prevGallery.length === 0, showOnCorporate: false }
          ];
          return {
            ...prev,
            imageGallery: nextGallery,
            imageUrl: getDefaultImageUrl(nextGallery)
          };
        });
      }
      setUploadImageMessage("Đã tải ảnh từ máy lên thành công.");
    } catch (error) {
      setUploadImageMessage(error?.message || "Tải ảnh thất bại.");
    } finally {
      setUploadingImage(false);
      event.target.value = "";
    }
  };

  const handleSetDefaultImage = (imageUrl) => {
    setFormData((prev) => {
      const currentGallery = Array.isArray(prev.imageGallery) ? prev.imageGallery : [];
      const nextGallery = currentGallery.map((item) => ({
        ...item,
        isDefault: item.url === imageUrl
      }));
      return { ...prev, imageGallery: nextGallery, imageUrl: getDefaultImageUrl(nextGallery) };
    });
  };

  const handleToggleCorporateImage = (imageUrl, checked) => {
    setFormData((prev) => {
      const currentGallery = Array.isArray(prev.imageGallery) ? prev.imageGallery : [];
      const nextGallery = currentGallery.map((item) => (
        item.url === imageUrl ? { ...item, showOnCorporate: Boolean(checked) } : item
      ));
      return { ...prev, imageGallery: nextGallery };
    });
  };

  const handleRemoveImage = (imageUrl) => {
    setFormData((prev) => {
      const current = Array.isArray(prev.imageGallery) ? prev.imageGallery : [];
      current.filter((item) => item.url === imageUrl).forEach(revokePreviewUrl);
      const filtered = current.filter((item) => item.url !== imageUrl);
      const nextGallery = normalizeImageGallery(filtered);
      return {
        ...prev,
        imageGallery: nextGallery,
        imageUrl: getDefaultImageUrl(nextGallery)
      };
    });
  };

  const closeStockDialog = () => {
    setShowStockDialog(false);
    setStockProduct(null);
    setStockLoading(false);
    setStockSaving(false);
    setStockForm({ costPrice: "0", inventoryByStore: {} });
  };

  const openStockDialog = async (product) => {
    setStockProduct(product);
    setShowStockDialog(true);
    setStockLoading(true);

    const initialInventoryByStore = {};
    stores.forEach((store) => {
      initialInventoryByStore[store.id] = "0";
    });

    setStockForm({
      costPrice: String(Number(product.costPrice || 0)),
      inventoryByStore: initialInventoryByStore
    });

    if (product.productType !== "GOODS") {
      setStockLoading(false);
      return;
    }

    try {
      const analyticsRes = await api.getProductAnalytics(token, product.id);
      const analytics = analyticsRes?.data || analyticsRes || {};
      const inventoryRows = analytics.inventoryByStore || [];
      const mergedInventoryByStore = { ...initialInventoryByStore };

      inventoryRows.forEach((row) => {
        if (row?.storeId) {
          mergedInventoryByStore[row.storeId] = String(Number(row.quantity || 0));
        }
      });

      setStockForm({
        costPrice: String(Number(product.costPrice || 0)),
        inventoryByStore: mergedInventoryByStore
      });
    } catch (error) {
      alert(`Lỗi tải dữ liệu tồn kho: ${error.message}`);
    } finally {
      setStockLoading(false);
    }
  };

  const handleStockQuantityChange = (storeId, value) => {
    const digits = String(value ?? "").replace(/[^\d]/g, "");
    setStockForm((prev) => ({
      ...prev,
      inventoryByStore: {
        ...prev.inventoryByStore,
        [storeId]: digits
      }
    }));
  };

  const handleSubmitStockDialog = async (e) => {
    e.preventDefault();
    if (!stockProduct) return;

    try {
      setStockSaving(true);
      const payload = {
        costPrice: Number(parseMoneyInput(stockForm.costPrice || 0) || 0)
      };

      if (stockProduct.productType === "GOODS") {
        payload.inventories = stores.map((store) => ({
          storeId: store.id,
          quantity: Number(stockForm.inventoryByStore[store.id] || 0)
        }));
      }

      await api.updateProductStockCost(token, stockProduct.id, payload);
      alert("Cập nhật tồn kho/giá vốn thành công");
      closeStockDialog();
      await loadData();
    } catch (error) {
      alert(`Lỗi cập nhật tồn kho/giá vốn: ${error.message}`);
    } finally {
      setStockSaving(false);
    }
  };

  const openCategoryDialog = (category = null) => {
    setEditingCategory(category);
    setCategoryForm({ name: category?.rawName || "", parentId: category?.parentId || "" });
    setShowCategoryDialog(true);
  };

  const closeCategoryDialog = () => {
    setShowCategoryDialog(false);
    setEditingCategory(null);
    setCategoryForm({ name: "", parentId: "" });
    setCategorySaving(false);
    setDeletingCategoryId(null);
  };

    const downloadImportTemplate = () => {
      const bom = "\ufeff";
      const example = ["SP001", "Tên sản phẩm mẫu", "GOODS", "Danh mục A", "Cái",
        "100000", "90000", "80000", "0", "0", "95000", "Báo giá tháng 1/2026", "Vitamin C; Kẽm", "Hỗ trợ miễn dịch", "Uống sau ăn 1 viên/ngày", "TRUE"].join(",");
      const csv = bom + [IMPORT_CSV_TEMPLATE_HEADERS.join(","), example].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "template-nhap-san-pham.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    const handleImportFileChange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      const lowerName = String(file.name || "").toLowerCase();
      if (!(lowerName.endsWith(".csv") || lowerName.endsWith(".txt"))) {
        alert("Vui lòng chọn file .csv hoặc .txt");
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = String(ev.target?.result || "");
        if (!text.trim()) {
          alert("File CSV đang trống");
          return;
        }
        const { headers, rows } = parseCSVText(text);
        if (!headers.length) {
          alert("Không đọc được tiêu đề cột. Hãy kiểm tra định dạng CSV");
          return;
        }
        const missing = IMPORT_CSV_REQUIRED_COLS.filter((h) => !headers.includes(h));
        if (missing.length) {
          alert(`File CSV thiếu cột bắt buộc: ${missing.join(", ")}`);
          return;
        }
        if (!rows.length) {
          alert("CSV không có dữ liệu dòng nào để nhập");
          return;
        }
        const validated = rows.map((r, i) => validateImportCSVRow(r, i));
        setImportRows(validated);
        setImportStep("preview");
      };
      reader.onerror = () => {
        alert("Không thể đọc file CSV. Vui lòng thử lưu lại file với mã hóa UTF-8");
      };
      reader.readAsText(file);
    };

    const handleConfirmImport = async (dryRun = false) => {
      const validRows = importRows
        .filter((r) => r._valid)
        .map(({ _line, _valid, _errors, ...data }) => data);
      if (!validRows.length) return;
      setImportAction(dryRun ? "dry-run" : "import");
      setImportLoading(true);
      try {
        const res = await api.bulkImportProducts(token, validRows, { dryRun });
        setImportResult(res.data || res);
        setImportStep("done");
        if (!dryRun) {
          await loadData();
        }
      } catch (e) {
        alert(`Nhập thất bại: ${e.message}`);
      } finally {
        setImportLoading(false);
      }
    };

    const resetImportDialog = () => {
      setImportStep("upload");
      setImportRows([]);
      setImportResult(null);
      setImportLoading(false);
      setImportAction("import");
    };

    const closeImportDialog = () => {
      setShowImportDialog(false);
      resetImportDialog();
    };

    const openConsultDialog = (product) => {
      setConsultTargetProduct(product);
      setConsultForm({
        ingredients: product?.ingredients || "",
        benefits: product?.benefits || "",
        usageGuide: product?.usageGuide || ""
      });
      setShowConsultDialog(true);
    };

    const closeConsultDialog = () => {
      setShowConsultDialog(false);
      setConsultTargetProduct(null);
      setConsultForm({ ingredients: "", benefits: "", usageGuide: "" });
      setConsultSaving(false);
    };

    const submitConsultDialog = async () => {
      if (!consultTargetProduct?.id) return;
      try {
        setConsultSaving(true);
        await api.updateProductConsultation(token, consultTargetProduct.id, {
          ingredients: String(consultForm.ingredients || "").trim() || null,
          benefits: String(consultForm.benefits || "").trim() || null,
          usageGuide: String(consultForm.usageGuide || "").trim() || null
        });
        await loadData();
        if (detailProduct?.id === consultTargetProduct.id) {
          setDetailProduct((prev) => prev ? {
            ...prev,
            ingredients: String(consultForm.ingredients || "").trim() || null,
            benefits: String(consultForm.benefits || "").trim() || null,
            usageGuide: String(consultForm.usageGuide || "").trim() || null
          } : prev);
        }
        alert("Đã cập nhật thông tin tư vấn sản phẩm");
        closeConsultDialog();
      } catch (error) {
        alert(`Lỗi cập nhật thông tin tư vấn: ${error.message}`);
      } finally {
        setConsultSaving(false);
      }
    };

    const downloadImportErrorsCsv = () => {
      if (!importResult?.results?.length) return;
      const rows = importResult.results.filter((r) => r.status === "error");
      if (!rows.length) return;
      const escapeCsv = (v) => {
        const s = String(v ?? "");
        if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
          return `"${s.replace(/\"/g, '""')}"`;
        }
        return s;
      };
      const header = ["line", "sku", "message"];
      const body = rows.map((r) => [r.line, r.sku, r.message].map(escapeCsv).join(","));
      const csv = "\ufeff" + [header.join(","), ...body].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ket-qua-loi-import-san-pham.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const normalizedImageGallery = normalizeImageGallery(formData.imageGallery, formData.imageUrl);
    const normalizedImageUrl = getDefaultImageUrl(normalizedImageGallery);
    const pendingUploadImages = (Array.isArray(formData.imageGallery) ? formData.imageGallery : []).filter((item) => item?.file instanceof File);
    if (hasProductFormErrors) {
      alert(Object.values(productFormErrors)[0]);
      return;
    }

    try {
      const salePrice = Number(formData.salePrice || 0);
      const priceLevel2 = Number(formData.priceLevel2 || 0);
      const priceLevel2Special = Number(formData.priceLevel2Special || 0);
      const promoPrice = Number(formData.promoPrice || 0);
      const supplierQuotedPriceRaw = parseMoneyInput(formData.supplierQuotedPrice || "");
      const supplierQuoteNote = String(formData.supplierQuoteNote || "").trim();
      const ingredients = String(formData.ingredients || "").trim();
      const benefits = String(formData.benefits || "").trim();
      const usageGuide = String(formData.usageGuide || "").trim();
      if (!(salePrice > 0)) {
        alert("Giá bán phải lớn hơn 0.");
        return;
      }
      const payload = {
        ...formData,
        salePrice,
        ...(priceLevel2 > 0 ? { priceLevel2 } : {}),
        ...(priceLevel2Special > 0 ? { priceLevel2Special } : {}),
        ...(promoPrice >= 0 ? { promoPrice } : {}),
        supplierQuotedPrice: supplierQuotedPriceRaw === "" ? undefined : Number(supplierQuotedPriceRaw),
        supplierQuoteNote: supplierQuoteNote || undefined,
        ingredients: ingredients || undefined,
        benefits: benefits || undefined,
        usageGuide: usageGuide || undefined,
        costPrice: Number(formData.costPrice || 0), rewardPoints: parseInt(formData.rewardPoints), giftPointsCost: parseInt(formData.giftPointsCost || 0),
        isTrackedInOverview: Boolean(formData.isTrackedInOverview),
        isActive: Boolean(formData.isActive),
        isVisibleOnCorporate: Boolean(formData.isVisibleOnCorporate)
      };
      if (editingProduct) {
        payload.imageUrl = normalizedImageUrl || undefined;
        payload.imageGallery = normalizedImageGallery.length > 0 ? normalizedImageGallery : [];
        await api.updateProduct(token, editingProduct.id, payload);
        alert("Cập nhật thành công");
      } else {
        payload.imageUrl = normalizedImageUrl || undefined;
        payload.imageGallery = normalizedImageGallery;
        const created = await api.createProduct(token, payload);
        const createdProductId = created?.data?.id || created?.id;
        if (!createdProductId) {
          throw new Error("Không lấy được sản phẩm vừa tạo để tải ảnh.");
        }

        for (let index = 0; index < pendingUploadImages.length; index += 1) {
          const image = pendingUploadImages[index];
          await api.uploadProductImage(token, createdProductId, image.file, {
            makeDefault: image?.isDefault === true || index === 0,
            showOnCorporate: image?.showOnCorporate === true
          });
        }

        pendingUploadImages.forEach(revokePreviewUrl);
        alert("Tạo sản phẩm thành công");
      }
      handleCloseDialog();
      loadData();
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    }
  };

  const handleToggleCorporateVisibility = async (product, nextVisibleValue) => {
    try {
      setTogglingCorporateProductId(product.id);
      await api.updateProductCorporateVisibility(token, product.id, nextVisibleValue);
      setProducts((prev) => prev.map((item) => (
        item.id === product.id
          ? { ...item, isVisibleOnCorporate: Boolean(nextVisibleValue) }
          : item
      )));
    } catch (error) {
      alert(`Lỗi cập nhật hiển thị Corporate: ${error.message}`);
    } finally {
      setTogglingCorporateProductId(null);
    }
  };

  const handleToggleActiveStatus = async (product) => {
    const next = !product.isActive;
    try {
      setTogglingActiveProductId(product.id);
      await api.updateProductActiveStatus(token, product.id, next);
      setProducts((prev) => prev.map((item) => (
        item.id === product.id ? { ...item, isActive: next } : item
      )));
    } catch (error) {
      alert(`Lỗi cập nhật trạng thái: ${error.message}`);
    } finally {
      setTogglingActiveProductId(null);
    }
  };

  const handleSubmitCategory = async () => {
    const name = categoryForm.name.trim().replace(/\s+/g, " ");
    const parentId = categoryForm.parentId || undefined;
    if (name.length < 2) {
      alert("Tên danh mục tối thiểu 2 ký tự");
      return;
    }

    if (categoryNameExists) {
      alert("Tên danh mục đã tồn tại");
      return;
    }

    try {
      setCategorySaving(true);
      if (editingCategory) {
        await api.updateCategory(token, editingCategory.id, { name, parentId });
        alert("Cập nhật danh mục thành công");
      } else {
        const response = await api.createCategory(token, { name, parentId });
        const createdCategory = response?.data || response;
        if (createdCategory?.id) {
          setFormData((prev) => ({
            ...prev,
            categoryId: prev.categoryId || createdCategory.id
          }));
        }
        alert("Tạo danh mục thành công");
      }
      await loadData();
      closeCategoryDialog();
    } catch (error) {
      alert(`Lỗi danh mục: ${error.message}`);
    } finally {
      setCategorySaving(false);
    }
  };

  const handleDeleteCategory = async (category) => {
    const confirmed = window.confirm(`Xóa danh mục \"${category.rawName}\"? Chỉ xóa được khi danh mục không còn sản phẩm hoặc danh mục con.`);
    if (!confirmed) return;

    try {
      setDeletingCategoryId(category.id);
      await api.deleteCategory(token, category.id);
      if (formData.categoryId === category.id) {
        setFormData((prev) => ({ ...prev, categoryId: "" }));
      }
      await loadData();
      if (editingCategory?.id === category.id) {
        setEditingCategory(null);
        setCategoryForm({ name: "", parentId: "" });
      }
      alert("Xóa danh mục thành công");
    } catch (error) {
      const raw = String(error?.message || "");
      const normalized = raw.toLowerCase();
      const detailed = normalized.includes("cannot delete category with products or subcategories")
        ? "Không thể xóa danh mục vì vẫn còn sản phẩm hoặc danh mục con."
        : raw;
      alert(`Không thể xóa danh mục: ${detailed}`);
    } finally {
      setDeletingCategoryId(null);
    }
  };

  const getBulkDraft = (product) => {
    return bulkPricingEdits[product.id] || createBulkPricingDraft(product);
  };

  const isBulkRowDirty = (product) => {
    const draft = getBulkDraft(product);
    const nextSalePrice = parseDraftMoney(draft.salePrice);
    const nextPriceLevel2 = parseDraftMoney(draft.priceLevel2);
    const nextPriceLevel2Special = parseDraftMoney(draft.priceLevel2Special);
    const nextRewardPoints = parseDraftRewardPoints(draft.rewardPoints);
    const nextPromoPrice = parseDraftMoney(draft.promoPrice);
    const currentSalePrice = Number(product.salePrice ?? product.defaultPrice ?? 0);
    const currentPriceLevel2 = Number(product.priceLevel2 ?? product.level2Price ?? product.defaultPrice ?? 0);
    const currentPriceLevel2Special = Number(product.priceLevel2Special ?? product.level2SpecialPrice ?? product.level2Price ?? product.defaultPrice ?? 0);
    const currentPromoPrice = Number(product.promoPrice ?? 0);

    const nextGiftPointsCost = parseDraftRewardPoints(draft.giftPointsCost);
    return (
      nextSalePrice !== currentSalePrice
      || nextPriceLevel2 !== currentPriceLevel2
      || nextPriceLevel2Special !== currentPriceLevel2Special
      || nextRewardPoints !== Number(product.rewardPoints || 0)
      || nextPromoPrice !== currentPromoPrice
      || nextGiftPointsCost !== Number(product.giftPointsCost || 0)
    );
  };

  const handleBulkDraftChange = (productId, field, value) => {
    setBulkPricingEdits((prev) => {
      const current = prev[productId] || {};
      const normalizedValue = (field === "rewardPoints" || field === "giftPointsCost") ? String(value ?? "").replace(/[^\d]/g, "") : parseMoneyInput(value);
      return {
        ...prev,
        [productId]: {
          ...current,
          [field]: normalizedValue
        }
      };
    });
  };

  const handleBulkSort = (key) => {
    setBulkSort((prev) => {
      if (prev.key !== key) return { key, direction: "asc" };
      return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  };

  const bulkProducts = useMemo(() => {
    const search = bulkSearchTerm.trim().toLowerCase();
    const base = products.filter((product) => {
      const matchesSearch = !search
        || String(product.sku || "").toLowerCase().includes(search)
        || String(product.name || "").toLowerCase().includes(search);
      const matchesCategory = !bulkFilterCategory || product.categoryId === bulkFilterCategory;
      const matchesType = !bulkFilterProductType || (product.productType || "GOODS") === bulkFilterProductType;
      return matchesSearch && matchesCategory && matchesType;
    });

    const sorted = [...base].sort((a, b) => {
      const draftA = getBulkDraft(a);
      const draftB = getBulkDraft(b);

      const profitAmountA = parseDraftMoney(draftA.salePrice) - Number(a.costPrice || 0);
      const profitAmountB = parseDraftMoney(draftB.salePrice) - Number(b.costPrice || 0);

      const saleA = parseDraftMoney(draftA.salePrice);
      const saleB = parseDraftMoney(draftB.salePrice);

      const profitPctA = saleA > 0 ? (profitAmountA / saleA) * 100 : -9999;
      const profitPctB = saleB > 0 ? (profitAmountB / saleB) * 100 : -9999;

      const valueByKey = {
        sku: String(a.sku || "").localeCompare(String(b.sku || ""), "vi", { sensitivity: "base", numeric: true }),
        name: String(a.name || "").localeCompare(String(b.name || ""), "vi", { sensitivity: "base" }),
        category: String(a.category?.name || "").localeCompare(String(b.category?.name || ""), "vi", { sensitivity: "base" }),
        costPrice: Number(a.costPrice || 0) - Number(b.costPrice || 0),
        salePrice: saleA - saleB,
        rewardPoints: parseDraftRewardPoints(draftA.rewardPoints) - parseDraftRewardPoints(draftB.rewardPoints),
        giftPointsCost: parseDraftRewardPoints(draftA.giftPointsCost) - parseDraftRewardPoints(draftB.giftPointsCost),
        profitAmount: profitAmountA - profitAmountB,
        profitPct: profitPctA - profitPctB
      };

      const comparison = valueByKey[bulkSort.key] ?? 0;
      return bulkSort.direction === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [products, bulkSearchTerm, bulkFilterCategory, bulkFilterProductType, bulkSort, bulkPricingEdits]);

  const bulkDirtyCount = useMemo(() => {
    return bulkProducts.filter((product) => isBulkRowDirty(product)).length;
  }, [bulkProducts, bulkPricingEdits]);

  const allBulkRowsSelected = bulkProducts.length > 0 && bulkProducts.every((product) => bulkSelectedIds.includes(product.id));

  const handleToggleBulkSelectAll = (checked) => {
    if (checked) {
      setBulkSelectedIds(bulkProducts.map((product) => product.id));
      return;
    }
    setBulkSelectedIds([]);
  };

  const handleToggleBulkSelectRow = (id, checked) => {
    setBulkSelectedIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((item) => item !== id);
    });
  };

  const handleResetBulkDrafts = () => {
    const resetDrafts = {};
    products.forEach((product) => {
      resetDrafts[product.id] = createBulkPricingDraft(product);
    });
    setBulkPricingEdits(resetDrafts);
    setBulkSelectedIds([]);
  };

  const handleSubmitBulkPricing = async () => {
    const selectedProducts = bulkProducts.filter((product) => bulkSelectedIds.includes(product.id));
    if (!selectedProducts.length) {
      alert("Vui lòng chọn ít nhất 1 sản phẩm để cập nhật hàng loạt.");
      return;
    }

    const changedProducts = selectedProducts.filter((product) => isBulkRowDirty(product));
    if (!changedProducts.length) {
      alert("Chưa có thay đổi giá hoặc điểm thưởng để lưu.");
      return;
    }

    const invalidProduct = changedProducts.find((product) => {
      const draft = getBulkDraft(product);
      const salePrice = parseDraftMoney(draft.salePrice);
      const priceLevel2 = parseDraftMoney(draft.priceLevel2);
      const priceLevel2Special = parseDraftMoney(draft.priceLevel2Special);
      return salePrice <= 0 || priceLevel2 <= 0 || priceLevel2Special <= 0;
    });

    if (invalidProduct) {
      alert(`Giá không hợp lệ ở sản phẩm ${invalidProduct.sku}. Các mức giá phải lớn hơn 0.`);
      return;
    }

    try {
      setBulkSaving(true);
      const results = await Promise.allSettled(
        changedProducts.map(async (product) => {
          const draft = getBulkDraft(product);

          const payload = {
            sku: product.sku,
            name: product.name,
            productType: product.productType || "GOODS",
            isTrackedInOverview: Boolean(product.isTrackedInOverview),
            categoryId: product.categoryId,
            unit: product.unit,
            salePrice: parseDraftMoney(draft.salePrice),
            priceLevel2: parseDraftMoney(draft.priceLevel2),
            priceLevel2Special: parseDraftMoney(draft.priceLevel2Special),
            promoPrice: parseDraftMoney(draft.promoPrice),
            rewardPoints: parseDraftRewardPoints(draft.rewardPoints),
            giftPointsCost: parseDraftRewardPoints(draft.giftPointsCost),
            costPrice: Number(product.costPrice || 0),
            isActive: Boolean(product.isActive),
            isVisibleOnCorporate: Boolean(product.isVisibleOnCorporate)
          };

          if (product.imageUrl) {
            payload.imageUrl = product.imageUrl;
          }

          await api.updateProduct(token, product.id, payload);
        })
      );

      const successCount = results.filter((result) => result.status === "fulfilled").length;
      const failedCount = results.length - successCount;

      if (failedCount > 0) {
        alert(`Đã cập nhật ${successCount} sản phẩm, thất bại ${failedCount} sản phẩm. Vui lòng kiểm tra lại dữ liệu.`);
      } else {
        alert(`Đã cập nhật thành công ${successCount} sản phẩm.`);
      }

      await loadData();
    } catch (error) {
      alert(`Lỗi cập nhật hàng loạt: ${error.message}`);
    } finally {
      setBulkSaving(false);
    }
  };

  const renderSortLabel = (key, label) => {
    const active = bulkSort.key === key;
    const arrow = active ? (bulkSort.direction === "asc" ? "↑" : "↓") : "↕";
    return `${label} ${arrow}`;
  };

  const detailPeriodStats = useMemo(() => {
    const period = detailAnalytics?.priceAnalysis;
    if (!period) return null;

    const month = period.month;
    const quarter = period.quarter;
    const year = period.year;

    let selectedLabel = "Tháng này";
    let selectedKey = month?.currentKey || "";
    let metric = month?.current || { quantity: 0, avgSellPrice: 0, avgCostPrice: 0 };
    let baselineMetric = month?.previous || { quantity: 0, avgSellPrice: 0, avgCostPrice: 0 };
    let baselineLabel = month?.previousKey ? `kỳ trước (${month.previousKey})` : "kỳ trước";

    if (detailPeriodFilter === "quarter-current") {
      selectedLabel = "Quý này";
      selectedKey = quarter?.currentKey || "";
      metric = quarter?.current || metric;
      baselineMetric = quarter?.previous || baselineMetric;
      baselineLabel = quarter?.previousKey ? `kỳ trước (${quarter.previousKey})` : "kỳ trước";
    } else if (detailPeriodFilter === "year-current") {
      selectedLabel = "Năm nay";
      selectedKey = year?.currentKey || "";
      metric = year?.current || metric;
      baselineMetric = year?.previous || baselineMetric;
      baselineLabel = year?.previousKey ? `năm trước (${year.previousKey})` : "năm trước";
    } else if (detailPeriodFilter === "year-previous") {
      selectedLabel = "Năm trước";
      selectedKey = year?.previousKey || "";
      metric = year?.previous || { quantity: 0, avgSellPrice: 0, avgCostPrice: 0 };
      baselineMetric = year?.current || { quantity: 0, avgSellPrice: 0, avgCostPrice: 0 };
      baselineLabel = year?.currentKey ? `năm nay (${year.currentKey})` : "năm nay";
    }

    const quantity = Number(metric.quantity || 0);
    const avgSellPrice = Number(metric.avgSellPrice || 0);
    const avgCostPrice = Number(metric.avgCostPrice || 0);
    const revenue = Number(metric.revenue ?? Math.round(quantity * avgSellPrice));
    const profit = Number(metric.profit ?? Math.round(quantity * (avgSellPrice - avgCostPrice)));

    const sellDeltaPct = calcPercentDelta(avgSellPrice, Number(baselineMetric.avgSellPrice || 0));
    const costDeltaPct = calcPercentDelta(avgCostPrice, Number(baselineMetric.avgCostPrice || 0));

    return {
      label: selectedLabel,
      key: selectedKey,
      baselineLabel,
      quantity,
      avgSellPrice,
      avgCostPrice,
      revenue,
      profit,
      sellDeltaPct,
      costDeltaPct
    };
  }, [detailAnalytics, detailPeriodFilter]);

  const detailTrendRows = useMemo(() => {
    if (!detailAnalytics) return [];
    return resolveTrendRowsByFilter(detailAnalytics.salesTrend, detailAnalytics.priceAnalysis, detailPeriodFilter);
  }, [detailAnalytics, detailPeriodFilter]);

  const productFormErrors = useMemo(() => {
    const errors = {};
    const salePrice = Number(formData.salePrice || 0);
    const priceLevel2 = Number(formData.priceLevel2 || 0);
    const priceLevel2Special = Number(formData.priceLevel2Special || 0);
    const promoPrice = Number(formData.promoPrice || 0);

    if (!(salePrice > 0)) errors.salePrice = "Giá bán phải lớn hơn 0.";
    if (!(priceLevel2 > 0)) errors.priceLevel2 = "Giá cấp 2 phải lớn hơn 0.";
    if (!(priceLevel2Special > 0)) errors.priceLevel2Special = "Giá cấp 2 đặc biệt phải lớn hơn 0.";
    if (promoPrice > 0 && salePrice > 0 && promoPrice >= salePrice) {
      errors.promoPrice = "Giá khuyến mại nên nhỏ hơn giá bán thông thường.";
    }

    return errors;
  }, [formData.salePrice, formData.priceLevel2, formData.priceLevel2Special, formData.promoPrice]);

  const hasProductFormErrors = Object.keys(productFormErrors).length > 0;

  const filteredProducts = products.filter(p => {
    const matchesCategory = !filterCategory || p.categoryId === filterCategory;
    const matchesProductType = !filterProductType || (p.productType || "GOODS") === filterProductType;
    const matchesActiveStatus =
      !filterActiveStatus
      || (filterActiveStatus === "ACTIVE" && Boolean(p.isActive))
      || (filterActiveStatus === "INACTIVE" && !Boolean(p.isActive));
    const matchesCorporateStatus =
      !filterCorporateStatus
      || (filterCorporateStatus === "VISIBLE" && Boolean(p.isVisibleOnCorporate))
      || (filterCorporateStatus === "HIDDEN" && !Boolean(p.isVisibleOnCorporate));
    const stock = Number(stockByProduct[p.id] || 0);
    const matchesLowStock = !filterLowStock || p.productType === "SERVICE" || stock <= 10;
    return matchesCategory && matchesProductType && matchesActiveStatus && matchesCorporateStatus && matchesLowStock;
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Quản lý sản phẩm &amp; ngành hàng</h1>
          <p className="stat-text">
            {overview ? `${overview.total} sản phẩm  ${overview.goods || 0} hàng hóa  ${overview.services || 0} dịch vụ  Tổng tồn kho: ${formatNumber(overview.totalStock)}  Cảnh báo tồn thấp: ${overview.lowStockCount}` : "Đang tải..."}
          </p>
        </div>
        <div className="page-header-actions">
          <div className="header-quick-menu" ref={headerQuickMenuRef}>
            <button
              className="btn-cancel header-quick-menu-btn"
              type="button"
              aria-haspopup="menu"
              aria-expanded={showHeaderQuickMenu}
              onClick={() => setShowHeaderQuickMenu((prev) => !prev)}
              title="Tác vụ sản phẩm"
            >
              Tác vụ sản phẩm
            </button>
            {showHeaderQuickMenu ? (
              <div className="header-quick-menu-dropdown" role="menu">
                <button
                  type="button"
                  className="header-quick-menu-item"
                  onClick={() => { setShowHeaderQuickMenu(false); openCategoryDialog(); }}
                >
                  Quản lý danh mục
                </button>
                <button
                  type="button"
                  className="header-quick-menu-item"
                  disabled={loading}
                  onClick={() => { setShowHeaderQuickMenu(false); setShowBulkPricingEditor(true); }}
                >
                  Chỉnh giá và tích điểm hàng loạt
                </button>
                <button
                  type="button"
                  className="header-quick-menu-item"
                  disabled={loading}
                  onClick={() => { setShowHeaderQuickMenu(false); resetImportDialog(); setShowImportDialog(true); }}
                >
                  Nhập CSV
                </button>
              </div>
            ) : null}
          </div>
          <button className="btn-primary" type="button" onClick={() => handleOpenDialog()}>
            + Thêm sản phẩm
          </button>
        </div>
      </div>

      {overview ? (
        <div className="products-summary-grid">
          {[
            { label: "Tổng sản phẩm", value: overview.total, color: "#1971c2" },
            { label: "Đang hoạt động", value: overview.active, color: "#2b8a3e" },
            { label: "Dịch vụ", value: overview.services || 0, color: "#0c7c59" },
            { label: "Tổng tồn kho", value: formatNumber(overview.totalStock), color: "#6741d9" },
            { label: "Cảnh báo tồn thấp", value: overview.lowStockCount, color: "#c92a2a" }
          ].map(({ label, value, color }) => (
            <div key={label} className="products-summary-card" style={{ borderTopColor: color }}>
              <div className="products-summary-label">{label}</div>
              <div className="products-summary-value" style={{ color }}>{value ?? "-"}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="search-section">
        <input
          type="text"
          placeholder="Tìm kiếm SKU hoặc tên..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          className="search-input"
        />
        <select
          value={filterCategory}
          onChange={(e) => {
            setFilterCategory(e.target.value);
            setPage(1);
          }}
          className="filter-select"
        >
          <option value="">Tất cả danh mục</option>
          {categoryOptions.map((cat) => (<option key={cat.id} value={cat.id}>{cat.name}</option>))}
        </select>
        <select
          value={filterProductType}
          onChange={(e) => {
            setFilterProductType(e.target.value);
            setPage(1);
          }}
          className="filter-select"
        >
          <option value="">Tất cả loại</option>
          <option value="GOODS">Hàng hóa</option>
          <option value="SERVICE">Dịch vụ</option>
        </select>
        <select
          value={filterActiveStatus}
          onChange={(e) => {
            setFilterActiveStatus(e.target.value);
            setPage(1);
          }}
          className="filter-select"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="ACTIVE">Hoạt động</option>
          <option value="INACTIVE">Ngừng kinh doanh</option>
        </select>
        <select
          value={filterCorporateStatus}
          onChange={(e) => {
            setFilterCorporateStatus(e.target.value);
            setPage(1);
          }}
          className="filter-select"
        >
          <option value="">Corporate: Tất cả</option>
          <option value="VISIBLE">Đang hiển thị</option>
          <option value="HIDDEN">Đang ẩn</option>
        </select>
        <label className="filter-checkbox" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={filterLowStock}
            onChange={(e) => {
              setFilterLowStock(e.target.checked);
              setPage(1);
            }}
          />
          Chỉ tồn kho thấp
        </label>
      </div>

      {showBulkPricingEditor && !loading && (
        <div className="dialog-overlay" onClick={() => setShowBulkPricingEditor(false)}>
          <div className="dialog-panel dialog-panel--full" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Chỉnh giá &amp; tích điểm hàng loạt</h2>
                <p className="bulk-dialog-subtitle">Chỉ sửa các trường giá và điểm thưởng. Thông tin cơ bản của sản phẩm được giữ nguyên.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowBulkPricingEditor(false)} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body bulk-pricing-dialog-body">
              <div className="bulk-pricing-filters">
                <input
                  type="text"
                  className="search-input bulk-search-input"
                  placeholder="Tìm kiếm SKU hoặc tên sản phẩm..."
                  value={bulkSearchTerm}
                  onChange={(e) => setBulkSearchTerm(e.target.value)}
                />
                <select className="filter-select" value={bulkFilterCategory} onChange={(e) => setBulkFilterCategory(e.target.value)}>
                  <option value="">Tất cả danh mục</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                <select className="filter-select" value={bulkFilterProductType} onChange={(e) => setBulkFilterProductType(e.target.value)}>
                  <option value="">Tất cả loại</option>
                  <option value="GOODS">Hàng hóa</option>
                  <option value="SERVICE">Dịch vụ</option>
                </select>
              </div>

              <div className="bulk-pricing-meta">
                <span>{formatNumber(bulkProducts.length)} sản phẩm theo bộ lọc</span>
                <span>{formatNumber(bulkDirtyCount)} sản phẩm đã thay đổi</span>
                <span>{formatNumber(bulkSelectedIds.length)} sản phẩm đã chọn</span>
              </div>

              <div className="table-container bulk-pricing-table-wrap">
                <table className="data-table bulk-pricing-table">
                  <thead>
                    <tr>
                      <th className="bulk-checkbox-col">
                        <input
                          type="checkbox"
                          checked={allBulkRowsSelected}
                          onChange={(e) => handleToggleBulkSelectAll(e.target.checked)}
                          aria-label="Chọn tất cả"
                        />
                      </th>
                      <th>
                        <button type="button" className="table-sort-btn" onClick={() => handleBulkSort("sku")}>
                          {renderSortLabel("sku", "SKU")}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort-btn" onClick={() => handleBulkSort("name")}>
                          {renderSortLabel("name", "Tên sản phẩm")}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort-btn" onClick={() => handleBulkSort("category")}>
                          {renderSortLabel("category", "Danh mục")}
                        </button>
                      </th>
                      <th className="text-right">
                        <button type="button" className="table-sort-btn table-sort-btn--right" onClick={() => handleBulkSort("costPrice")}>
                          {renderSortLabel("costPrice", "Giá vốn")}
                        </button>
                      </th>
                      <th className="text-right">
                        <button type="button" className="table-sort-btn table-sort-btn--right" onClick={() => handleBulkSort("salePrice")}>
                          {renderSortLabel("salePrice", "Giá bán")}
                        </button>
                      </th>
                      <th className="text-right">Giá cấp 2</th>
                      <th className="text-right">Giá cấp 2 đặc biệt</th>
                      <th className="text-right">Giá khuyến mại</th>
                      <th className="text-right">
                        <button type="button" className="table-sort-btn table-sort-btn--right" onClick={() => handleBulkSort("rewardPoints")}>
                          {renderSortLabel("rewardPoints", "Điểm thưởng")}
                        </button>
                      </th>
                      <th className="text-right">
                        <button type="button" className="table-sort-btn table-sort-btn--right" onClick={() => handleBulkSort("giftPointsCost")}>
                          {renderSortLabel("giftPointsCost", "Điểm đổi quà")}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkProducts.length === 0 ? (
                      <tr>
                        <td colSpan="11" className="text-center">Không có sản phẩm phù hợp bộ lọc.</td>
                      </tr>
                    ) : bulkProducts.map((product) => {
                      const draft = getBulkDraft(product);
                      const isDirty = isBulkRowDirty(product);
                      const selected = bulkSelectedIds.includes(product.id);
                      const costPrice = Number(product.costPrice || 0);
                      const salePrice = parseDraftMoney(draft.salePrice);
                      const level2Price = parseDraftMoney(draft.priceLevel2);
                      const level2SpecialPrice = parseDraftMoney(draft.priceLevel2Special);
                      const promoPrice = parseDraftMoney(draft.promoPrice);

                      const renderProfitHint = (priceValue) => {
                        const amount = priceValue - costPrice;
                        const pct = priceValue > 0 ? (amount / priceValue) * 100 : 0;
                        const className = amount >= 0 ? "bulk-profit-positive" : "bulk-profit-negative";
                        return (
                          <div className={`bulk-profit-hint ${className}`}>
                            LN: {formatCurrency(amount)} ({pct.toFixed(1)}%)
                          </div>
                        );
                      };

                      return (
                        <tr key={`bulk-${product.id}`} className={isDirty ? "bulk-row-dirty" : ""}>
                          <td className="bulk-checkbox-col">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) => handleToggleBulkSelectRow(product.id, e.target.checked)}
                              aria-label={`Chọn sản phẩm ${product.sku}`}
                            />
                          </td>
                          <td className="font-mono">{product.sku}</td>
                          <td>{product.name}</td>
                          <td>{product.category?.name || "-"}</td>
                          <td className="text-right font-mono bulk-readonly-cell">{formatCurrency(costPrice)}</td>
                          <td>
                            <input
                              type="text"
                              inputMode="numeric"
                              className="bulk-price-input"
                              value={formatCurrencyInput(draft.salePrice)}
                              onChange={(e) => handleBulkDraftChange(product.id, "salePrice", e.target.value)}
                            />
                            {renderProfitHint(salePrice)}
                          </td>
                          <td>
                            <input
                              type="text"
                              inputMode="numeric"
                              className="bulk-price-input"
                              value={formatCurrencyInput(draft.priceLevel2)}
                              onChange={(e) => handleBulkDraftChange(product.id, "priceLevel2", e.target.value)}
                            />
                            {renderProfitHint(level2Price)}
                          </td>
                          <td>
                            <input
                              type="text"
                              inputMode="numeric"
                              className="bulk-price-input"
                              value={formatCurrencyInput(draft.priceLevel2Special)}
                              onChange={(e) => handleBulkDraftChange(product.id, "priceLevel2Special", e.target.value)}
                            />
                            {renderProfitHint(level2SpecialPrice)}
                          </td>
                          <td>
                            <input
                              type="text"
                              inputMode="numeric"
                              className="bulk-price-input"
                              value={formatCurrencyInput(draft.promoPrice)}
                              onChange={(e) => handleBulkDraftChange(product.id, "promoPrice", e.target.value)}
                              placeholder="0"
                            />
                            {renderProfitHint(promoPrice)}
                          </td>
                          <td>
                            <input
                              type="text"
                              inputMode="numeric"
                              className="bulk-points-input"
                              value={draft.rewardPoints}
                              onChange={(e) => handleBulkDraftChange(product.id, "rewardPoints", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              inputMode="numeric"
                              className="bulk-points-input"
                              value={draft.giftPointsCost}
                              onChange={(e) => handleBulkDraftChange(product.id, "giftPointsCost", e.target.value)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowBulkPricingEditor(false)} disabled={bulkSaving}>
                Đóng
              </button>
              <button type="button" className="btn-cancel" onClick={handleResetBulkDrafts} disabled={bulkSaving}>
                Hoàn tác toàn bộ
              </button>
              <button type="button" className="btn-primary" onClick={handleSubmitBulkPricing} disabled={bulkSaving || bulkSelectedIds.length === 0}>
                {bulkSaving ? "Đang cập nhật..." : "Lưu sản phẩm đã chọn"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p>Đang tải...</p>
      ) : (
        <div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Tên sản phẩm</th>
                  <th>Loại</th>
                  <th>Danh mục</th>
                  <th>Trạng thái</th>
                  <th>Corporate</th>
                  <th className="text-right">Giá bán</th>
                  <th className="text-right">Giá vốn</th>
                  <th className="text-right">Chào giá NCC</th>
                  <th>Ghi chú chào giá</th>
                  <th className="text-right">Biên LN</th>
                  <th className="text-right">Tồn tổng</th>
                  <th className="text-right">Dự báo tồn kho</th>
                  <th>Điểm thưởng</th>
                  <th>Điểm đổi quà</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length === 0 ? (
                  <tr><td colSpan="16" className="text-center">Không có dữ liệu</td></tr>
                ) : (
                  filteredProducts.map((product) => {
                    const salePrice = Number(product.salePrice ?? product.defaultPrice ?? 0);
                    const supplierQuotedPrice = product.supplierQuotedPrice == null ? null : Number(product.supplierQuotedPrice || 0);
                    const margin = salePrice > 0
                      ? (((salePrice - product.costPrice) / salePrice) * 100).toFixed(1)
                      : "0.0";
                    const totalStock = Number(stockByProduct[product.id] || 0);
                    const isService = product.productType === "SERVICE";
                    const forecastDays = isService ? null : (totalStock > 0 ? Math.floor(totalStock / 3) : 0);
                    return (
                      <tr key={product.id}>
                        <td className="font-mono">{product.sku}</td>
                        <td>{product.name}</td>
                        <td>{getProductTypeLabel(product.productType)}</td>
                        <td>{product.category?.name || "-"}</td>
                        <td>
                          <button
                            type="button"
                            disabled={togglingActiveProductId === product.id}
                            onClick={() => handleToggleActiveStatus(product)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "3px 10px", borderRadius: 999, border: "none",
                              cursor: togglingActiveProductId === product.id ? "wait" : "pointer",
                              fontSize: 12, fontWeight: 600, letterSpacing: "0.01em",
                              background: product.isActive ? "#d3f9d8" : "#ffe8e8",
                              color: product.isActive ? "#2b7a36" : "#c0392b",
                              opacity: togglingActiveProductId === product.id ? 0.6 : 1,
                              transition: "background 0.15s, color 0.15s"
                            }}
                          >
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: product.isActive ? "#51cf66" : "#ff8787", flexShrink: 0 }} />
                            {togglingActiveProductId === product.id ? "..." : (product.isActive ? "Hoạt động" : "Ngừng")}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            disabled={togglingCorporateProductId === product.id}
                            onClick={() => handleToggleCorporateVisibility(product, !product.isVisibleOnCorporate)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "3px 10px", borderRadius: 999, border: "none",
                              cursor: togglingCorporateProductId === product.id ? "wait" : "pointer",
                              fontSize: 12, fontWeight: 600, letterSpacing: "0.01em",
                              background: product.isVisibleOnCorporate ? "#d3f9d8" : "#f1f3f5",
                              color: product.isVisibleOnCorporate ? "#2b7a36" : "#868e96",
                              opacity: togglingCorporateProductId === product.id ? 0.6 : 1,
                              transition: "background 0.15s, color 0.15s"
                            }}
                          >
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: product.isVisibleOnCorporate ? "#51cf66" : "#ced4da", flexShrink: 0 }} />
                            {togglingCorporateProductId === product.id ? "..." : (product.isVisibleOnCorporate ? "Hiển thị" : "Ẩn")}
                          </button>
                        </td>
                        <td className="text-right font-mono">{formatCurrency(salePrice)}</td>
                        <td className="text-right font-mono">{formatCurrency(product.costPrice)}</td>
                        <td className="text-right font-mono">{supplierQuotedPrice == null ? "-" : formatCurrency(supplierQuotedPrice)}</td>
                        <td>{product.supplierQuoteNote || "-"}</td>
                        <td className="text-right" style={{ color: Number(margin) >= 20 ? "#2b8a3e" : Number(margin) >= 10 ? "#9c6b00" : "#c92a2a" }}>
                          {margin}%
                        </td>
                        <td className="text-right font-mono" style={{ color: isService ? "#0c7c59" : totalStock <= 10 ? "#c92a2a" : "#2b8a3e", fontWeight: 600 }}>
                          {isService ? "Không quản lý" : formatNumber(totalStock)}
                        </td>
                        <td className="text-right" style={{ color: isService ? "#0c7c59" : (forecastDays <= 5 ? "#c92a2a" : "#2b8a3e"), fontWeight: 600 }}>
                          {isService ? "Không quản lý" : `~${formatNumber(forecastDays)} ngày`}
                        </td>
                        <td className="text-right">{product.rewardPoints}</td>
                        <td className="text-right">{product.giftPointsCost ?? 0}</td>
                        <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn-small" type="button" onClick={() => openDetail(product)}>Chi tiết</button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div>Trang {page} / {totalPages} - Tổng {total} sản phẩm</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-cancel" type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Trang trước</button>
              <button className="btn-cancel" type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Trang sau</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail / Analytics dialog */}
      {showDetail && detailProduct && (
        <div className="dialog-overlay" onClick={() => setShowDetail(false)}>
          <div className="dialog-panel dialog-panel--lg" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>{detailProduct.sku}  {detailProduct.name}</h2>
              <button className="close-btn" type="button" onClick={() => setShowDetail(false)} aria-label="Đóng">✕</button>
            </div>
            <div className="dialog-body">
              {detailLoading || !detailAnalytics ? (
                <p>Đang tải phân tích sản phẩm...</p>
              ) : (
                <>
                  <div className="detail-period-filter" role="tablist" aria-label="Bộ lọc thời gian">
                    {DETAIL_TIME_FILTER_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="tab"
                        aria-selected={detailPeriodFilter === option.value}
                        className={`detail-period-chip ${detailPeriodFilter === option.value ? "is-active" : ""}`}
                        onClick={() => setDetailPeriodFilter(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {detailPeriodStats ? (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12, marginBottom: 16 }}>
                        {[
                          { label: `Đã bán (${detailPeriodStats.label.toLowerCase()})`, value: `${formatNumber(detailPeriodStats.quantity)} ${detailProduct.unit}`, color: "#1971c2" },
                          { label: "Doanh thu", value: formatCurrency(detailPeriodStats.revenue), color: "#2b8a3e" },
                          { label: "Lợi nhuận", value: formatCurrency(detailPeriodStats.profit), color: "#6741d9" }
                        ].map(({ label, value, color }) => (
                          <div key={label} style={{ padding: "10px 14px", border: "1px solid #dee2e6", borderTop: `3px solid ${color}`, borderRadius: 8 }}>
                            <div style={{ fontSize: "0.75em", color: "#666", marginBottom: 4 }}>{label}</div>
                            <div style={{ fontWeight: 700, color }}>{value}</div>
                          </div>
                        ))}
                      </div>


                    </>
                  ) : null}

                  {detailProduct.productType === "SERVICE" ? (
                    <div className="info-box" style={{ marginBottom: 16 }}>
                      Sản phẩm này là dịch vụ nên không theo dõi tồn kho theo cửa hàng.
                    </div>
                  ) : null}

                  {detailProduct.productType !== "SERVICE" && detailAnalytics.inventoryByStore?.length > 0 && (
                    <>
                      <h4 style={{ margin: "0 0 8px" }}>Tồn kho theo cửa hàng</h4>
                      <div className="table-container" style={{ margin: "0 0 16px" }}>
                        <table className="data-table" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Cửa hàng</th>
                              <th className="text-right">Tồn kho</th>
                              <th className="text-right">Đặt trước</th>
                              <th className="text-right">Có thể bán</th>
                              <th className="text-right">Dự báo (ngày)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailAnalytics.inventoryByStore.map((inv) => (
                              <tr key={inv.storeId}>
                                <td>{inv.storeName}</td>
                                <td className="text-right">{formatNumber(inv.quantity)}</td>
                                <td className="text-right" style={{ color: "#9c6b00" }}>{formatNumber(inv.reserved)}</td>
                                <td className="text-right" style={{ color: inv.available <= 5 ? "#c92a2a" : "#2b8a3e", fontWeight: 600 }}>{formatNumber(inv.available)}</td>
                                <td className="text-right">{inv.forecastDays != null ? `~${inv.forecastDays} ngày` : "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {detailTrendRows.length > 0 && (
                    <>
                      <h4 style={{ margin: "0 0 8px" }}>
                        Xu hướng bán hàng ({detailPeriodStats?.label || "kỳ đã chọn"}{detailPeriodStats?.key ? ` - ${detailPeriodStats.key}` : ""})
                      </h4>
                      {(() => {
                        const trendRows = [...detailTrendRows].reverse();
                        const maxRevenue = Math.max(...trendRows.map((row) => Number(row.revenue || 0)), 1);
                        return (
                          <div className="trend-chart-card" style={{ marginBottom: 12 }}>
                            <div className="trend-chart-grid">
                              {trendRows.map((row) => {
                                const revenue = Number(row.revenue || 0);
                                const barHeight = Math.max((revenue / maxRevenue) * 100, revenue > 0 ? 6 : 0);
                                return (
                                  <div key={row.month} className="trend-chart-col" title={`${row.month}: ${formatCurrency(revenue)}`}>
                                    <div className="trend-chart-value">{formatCurrency(revenue)}</div>
                                    <div className="trend-chart-bar-wrap">
                                      <div className="trend-chart-bar" style={{ height: `${barHeight}%` }} />
                                    </div>
                                    <div className="trend-chart-label">{row.month}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                      <div className="table-container" style={{ margin: 0 }}>
                        <table className="data-table" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Tháng</th>
                              <th className="text-right">SL bán</th>
                              <th className="text-right">Doanh thu</th>
                              <th className="text-right">Lợi nhuận</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...detailTrendRows].reverse().map((row) => (
                              <tr key={row.month}>
                                <td>{row.month}</td>
                                <td className="text-right">{formatNumber(row.quantity)}</td>
                                <td className="text-right font-mono">{formatCurrency(row.revenue)}</td>
                                <td className="text-right font-mono" style={{ color: row.profit >= 0 ? "#2b8a3e" : "#c92a2a" }}>
                                  {formatCurrency(row.profit)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {(!detailTrendRows.length && !detailAnalytics.inventoryByStore?.length) && (
                    <p style={{ color: "#666" }}>Chưa có dữ liệu bán hàng cho sản phẩm này.</p>
                  )}
                </>
              )}
            </div>
            <div className="dialog-footer">
              <button className="btn-small" type="button" onClick={() => openConsultDialog(detailProduct)}>
                Thông tin tư vấn
              </button>
              <button className="btn-primary" type="button" onClick={() => { setShowDetail(false); handleOpenDialog(detailProduct); }}>
                Chỉnh sửa sản phẩm
              </button>
              <button className="btn-small" type="button" onClick={() => { setShowDetail(false); openStockDialog(detailProduct); }}>
                Cập nhật tồn kho
              </button>
              <button className="btn-cancel" type="button" onClick={() => setShowDetail(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* Stock / Cost dialog */}
      {showStockDialog && stockProduct && (
        <div className="dialog-overlay" onClick={closeStockDialog}>
          <form className="dialog-panel dialog-panel--md" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmitStockDialog}>
            <div className="dialog-header">
              <h2>Cập nhật tồn kho &amp; giá vốn  {stockProduct.sku}  {stockProduct.name}</h2>
              <button type="button" className="close-btn" onClick={closeStockDialog} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body" style={{ display: "grid", gap: 16 }}>
              <div className="form-group">
                <label>Giá vốn</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  style={{ textAlign: "right" }}
                  value={formatCurrencyInput(stockForm.costPrice)}
                  onChange={(e) => setStockForm((prev) => ({ ...prev, costPrice: parseMoneyInput(e.target.value) }))}
                />
              </div>

              {stockProduct.productType !== "GOODS" ? (
                <div className="info-box">Sản phẩm dịch vụ không theo dõi tồn kho theo cửa hàng. Bạn chỉ cần cập nhật giá vốn.</div>
              ) : stockLoading ? (
                <p>Đang tải tồn kho theo cửa hàng...</p>
              ) : (
                <div>
                  <h3 style={{ margin: "0 0 10px 0", fontSize: "0.95rem", color: "#374151" }}>Tồn kho theo cửa hàng</h3>
                  <div className="table-container" style={{ margin: 0 }}>
                    <table className="data-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Cửa hàng</th>
                          <th className="text-right">Số lượng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stores.length === 0 ? (
                          <tr>
                            <td colSpan="2" className="text-center">Không có cửa hàng</td>
                          </tr>
                        ) : stores.map((store) => (
                          <tr key={store.id}>
                            <td>{store.name}</td>
                            <td>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={stockForm.inventoryByStore[store.id] ?? ""}
                                onChange={(e) => handleStockQuantityChange(store.id, e.target.value)}
                                style={{ width: "100%", textAlign: "right" }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closeStockDialog} disabled={stockSaving}>Hủy</button>
              <button type="submit" className="btn-primary" disabled={stockSaving || stockLoading}>
                {stockSaving ? "Đang cập nhật..." : "Cập nhật tồn kho"}
              </button>
            </div>
          </form>
        </div>
      )}

      {showCategoryDialog && (
        <div className="dialog-overlay" onClick={closeCategoryDialog}>
          <div className="dialog-panel dialog-panel--lg" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div className="category-dialog-title-wrap">
                <h2>{editingCategory ? "Chỉnh sửa danh mục" : "Quản lý danh mục"}</h2>
                <p>Tạo mới, chỉnh tên hoặc xóa danh mục trực tiếp từ Head Office.</p>
              </div>
              <button className="close-btn" type="button" onClick={closeCategoryDialog} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body category-dialog-body">
              <section className="category-create-card">
                <div className="category-create-card__header">
                  <div>
                    <span className="category-create-card__eyebrow">{editingCategory ? "Đang chỉnh sửa" : "Danh mục mới"}</span>
                    <h3>{editingCategory ? `Cập nhật ${editingCategory.rawName}` : "Đặt tên ngắn gọn, dễ tìm"}</h3>
                  </div>
                  <div className="category-count-chip">
                    <strong>{categoryOptions.length}</strong>
                    <span>danh mục hiện có</span>
                  </div>
                </div>

                <div className="form-group category-form-group">
                  <label>Tên danh mục</label>
                  <input
                    className={categoryNameExists ? "category-input category-input--invalid" : "category-input"}
                    value={categoryForm.name}
                    onChange={(e) => setCategoryForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="VD: Hóa mỹ phẩm"
                  />
                  <label>Danh mục cha</label>
                  <select
                    value={categoryForm.parentId}
                    onChange={(e) => setCategoryForm((prev) => ({ ...prev, parentId: e.target.value }))}
                  >
                    <option value="">-- Danh mục gốc --</option>
                    {availableParentOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                  </select>
                  <p className="form-hint category-parent-note">
                    {editingCategory
                      ? "Khi chỉnh sửa, không thể chọn chính danh mục hiện tại hoặc danh mục con làm danh mục cha."
                      : "Để trống nếu muốn tạo danh mục ở cấp gốc."}
                  </p>
                  <div className={categoryNameExists ? "category-status category-status--error" : "category-status category-status--hint"}>
                    {categoryNameExists
                      ? "Tên danh mục đã tồn tại, vui lòng chọn tên khác."
                      : editingCategory
                        ? "Chỉ nên đổi tên khi thực sự cần, để nhân viên dễ theo dõi lịch sử bán hàng."
                        : "Tên sẽ được chuẩn hóa khoảng trắng trước khi lưu."}
                  </div>
                  <div className="category-create-actions">
                    <button
                      type="button"
                      className="btn-primary category-create-btn"
                      onClick={handleSubmitCategory}
                      disabled={categorySaving || !categoryForm.name.trim() || categoryNameExists}
                    >
                      {categorySaving ? "Đang lưu..." : editingCategory ? "Lưu thay đổi" : "Tạo danh mục"}
                    </button>
                    {editingCategory ? (
                      <button type="button" className="btn-cancel" onClick={() => { setEditingCategory(null); setCategoryForm({ name: "", parentId: "" }); }} disabled={categorySaving}>
                        Tạo mới khác
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="category-suggestion-row" aria-hidden="true">
                  <span>Gợi ý:</span>
                  <div className="category-suggestion-chips">
                    <span>Đồ uống</span>
                    <span>Thực phẩm khô</span>
                    <span>Dịch vụ lắp đặt</span>
                  </div>
                </div>
              </section>

              <section className="category-library-card">
                <div className="category-library-card__header">
                  <div>
                    <h3>Danh mục hiện có</h3>
                    <p>Kiểm tra nhanh trước khi tạo mới. Bạn cũng có thể sửa hoặc xóa ngay tại đây.</p>
                  </div>
                </div>

                <div className="category-library-list">
                  {categoryOptions.length ? categoryOptions.map((category) => (
                    <div key={category.id} className="category-library-item category-library-item--actions">
                      <div className="category-library-item__content">
                        <div className="category-library-item__title-row">
                          <span className="category-library-item__name">{category.name}</span>
                          <span className={category.level > 0 ? "category-level-badge category-level-badge--child" : "category-level-badge category-level-badge--root"}>
                            {category.level > 0 ? "Cấp con" : "Cấp gốc"}
                          </span>
                        </div>
                        <span className="category-library-item__meta">
                          {category.productCount ? `${formatNumber(category.productCount)} sản phẩm` : category.hasChildren ? "Có danh mục con" : "Chưa có sản phẩm"}
                        </span>
                      </div>
                      <div className="category-library-actions">
                        <button type="button" className="btn-small btn-blue" onClick={() => openCategoryDialog(category)} disabled={categorySaving || deletingCategoryId === category.id}>
                          Sửa
                        </button>
                        <button type="button" className="btn-small btn-red" onClick={() => handleDeleteCategory(category)} disabled={categorySaving || deletingCategoryId === category.id}>
                          {deletingCategoryId === category.id ? "Đang xóa..." : "Xóa"}
                        </button>
                      </div>
                    </div>
                  )) : (
                    <div className="category-library-empty">Chưa có danh mục nào</div>
                  )}
                </div>
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closeCategoryDialog} disabled={categorySaving || Boolean(deletingCategoryId)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit dialog */}
      {showDialog && (
        <div className="dialog-overlay" onClick={handleCloseDialog}>
          <form className="dialog-panel dialog-panel--md" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
            <div className="dialog-header">
              <h2>{editingProduct ? "Chỉnh sửa sản phẩm" : "Tạo sản phẩm mới"}</h2>
              <button type="button" className="close-btn" onClick={handleCloseDialog} aria-label="Đóng">✕</button>
            </div>

            <div className="dialog-body product-edit-body">
              <section className="product-edit-section">
                <h3 className="product-edit-title">Thông tin cơ bản</h3>
                <div className="product-edit-inline-grid">
                  {!editingProduct && (
                    <div className="product-edit-inline-row">
                      <label className="product-edit-inline-label">SKU *</label>
                      <div className="product-edit-inline-control">
                        <input type="text" required value={formData.sku}
                          onChange={(e) => setFormData({ ...formData, sku: e.target.value })} placeholder="VD: SP001" />
                      </div>
                    </div>
                  )}
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Tên sản phẩm *</label>
                    <div className="product-edit-inline-control">
                      <input type="text" required value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Nhập tên sản phẩm" />
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Loại sản phẩm *</label>
                    <div className="product-edit-inline-control">
                      <select value={formData.productType} onChange={(e) => setFormData({ ...formData, productType: e.target.value })}>
                        <option value="GOODS">Hàng hóa</option>
                        <option value="SERVICE">Dịch vụ</option>
                      </select>
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Đơn vị tính</label>
                    <div className="product-edit-inline-control">
                      <input type="text" value={formData.unit}
                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })} placeholder="Cái, Hộp, kg..." />
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Danh mục *</label>
                    <div className="product-edit-inline-control">
                      <select required value={formData.categoryId} onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}>
                        <option value="">-- Chọn danh mục --</option>
                        {categoryOptions.map((cat) => (<option key={cat.id} value={cat.id}>{cat.name}</option>))}
                      </select>
                    </div>
                  </div>
                </div>
              </section>

              <section className="product-edit-section">
                <h3 className="product-edit-title">Giá bán</h3>
                <div className="product-edit-inline-grid">
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Giá bán *</label>
                    <div className="product-edit-inline-control">
                      <input type="text" inputMode="numeric" placeholder="0" className="text-input-right" required value={formatCurrencyInput(formData.salePrice)}
                        onChange={(e) => setFormData({ ...formData, salePrice: parseMoneyInput(e.target.value) })} />
                      <small className={`product-edit-help ${productFormErrors.salePrice ? "product-edit-help--error" : ""}`}>{productFormErrors.salePrice || "Giá bán thông thường"}</small>
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Giá cấp 2 *</label>
                    <div className="product-edit-inline-control">
                      <input type="text" inputMode="numeric" placeholder="0" className="text-input-right" required value={formatCurrencyInput(formData.priceLevel2)}
                        onChange={(e) => setFormData({ ...formData, priceLevel2: parseMoneyInput(e.target.value) })} />
                      <small className={`product-edit-help ${productFormErrors.priceLevel2 ? "product-edit-help--error" : ""}`}>{productFormErrors.priceLevel2 || "Áp dụng cho khách hàng cấp 2"}</small>
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Giá cấp 2 đặc biệt *</label>
                    <div className="product-edit-inline-control">
                      <input type="text" inputMode="numeric" placeholder="0" className="text-input-right" required value={formatCurrencyInput(formData.priceLevel2Special)}
                        onChange={(e) => setFormData({ ...formData, priceLevel2Special: parseMoneyInput(e.target.value) })} />
                      <small className={`product-edit-help ${productFormErrors.priceLevel2Special ? "product-edit-help--error" : ""}`}>{productFormErrors.priceLevel2Special || "Áp dụng cho khách hàng cấp 2 đặc biệt"}</small>
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Giá khuyến mại</label>
                    <div className="product-edit-inline-control">
                      <input type="text" inputMode="numeric" placeholder="0" className="text-input-right" value={formatCurrencyInput(formData.promoPrice)}
                        onChange={(e) => setFormData({ ...formData, promoPrice: parseMoneyInput(e.target.value) })} />
                      <small className={`product-edit-help ${productFormErrors.promoPrice ? "product-edit-help--error" : ""}`}>{productFormErrors.promoPrice || "Giá áp dụng khi chạy khuyến mại"}</small>
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Chào giá NCC</label>
                    <div className="product-edit-inline-control">
                      <input type="text" inputMode="numeric" placeholder="0" className="text-input-right" value={formatCurrencyInput(formData.supplierQuotedPrice)}
                        onChange={(e) => setFormData({ ...formData, supplierQuotedPrice: parseMoneyInput(e.target.value) })} />
                      <small className="product-edit-help">Giá chào gần nhất từ nhà cung cấp</small>
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Ghi chú chào giá</label>
                    <div className="product-edit-inline-control">
                      <textarea rows="2" value={formData.supplierQuoteNote}
                        onChange={(e) => setFormData({ ...formData, supplierQuoteNote: e.target.value })}
                        placeholder="Ví dụ: Báo giá theo lô, đã gồm VAT..." />
                    </div>
                  </div>
                </div>
              </section>

              <section className="product-edit-section">
                <h3 className="product-edit-title">Thêm chi tiết</h3>
                <div className="product-edit-inline-grid">
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Hình ảnh</label>
                    <div className="product-edit-inline-control">
                      <div className="product-edit-image-actions">
                        <button type="button" className="btn-small btn-blue" onClick={handlePickImageClick} disabled={uploadingImage}>
                          {uploadingImage ? "Đang tải ảnh..." : "Đính kèm từ máy"}
                        </button>
                      </div>
                      <input
                        ref={productImageInputRef}
                        type="file"
                        accept="image/*"
                        className="product-edit-file-input"
                        onChange={handleUploadImage}
                      />
                      {uploadImageMessage ? <small className="product-edit-help">{uploadImageMessage}</small> : null}
                      {Array.isArray(formData.imageGallery) && formData.imageGallery.length > 0 ? (
                        <div className="product-edit-gallery-list">
                          {formData.imageGallery.map((image) => (
                            <div className="product-edit-gallery-item" key={image.url}>
                              <img className="product-edit-gallery-thumb" src={image.url} alt="Ảnh sản phẩm" />
                              <div className="product-edit-gallery-meta">
                                <label>
                                  <input
                                    type="radio"
                                    name="default-product-image"
                                    checked={Boolean(image.isDefault)}
                                    onChange={() => handleSetDefaultImage(image.url)}
                                  />
                                  Ảnh mặc định
                                </label>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(image.showOnCorporate)}
                                    onChange={(event) => handleToggleCorporateImage(image.url, event.target.checked)}
                                  />
                                  Hiển thị trên Corporate
                                </label>
                              </div>
                              <button
                                type="button"
                                className="btn-small btn-cancel"
                                onClick={() => handleRemoveImage(image.url)}
                                disabled={uploadingImage}
                              >
                                Xóa ảnh
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <small className="product-edit-help">Chưa có ảnh nào. Hãy đính kèm từ máy.</small>
                      )}
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Điểm thưởng</label>
                    <div className="product-edit-inline-control">
                      <input type="number" step="1" value={formData.rewardPoints}
                        onChange={(e) => setFormData({ ...formData, rewardPoints: e.target.value })} />
                      <small className="product-edit-help">Điểm tích lũy cho khách hàng khi mua hàng</small>
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Điểm đổi quà</label>
                    <div className="product-edit-inline-control">
                      <input type="number" step="1" min="0" value={formData.giftPointsCost}
                        onChange={(e) => setFormData({ ...formData, giftPointsCost: e.target.value })} />
                      <small className="product-edit-help">Số điểm bị trừ khi khách dùng điểm để nhận quà</small>
                    </div>
                  </div>
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Theo dõi tổng quan</label>
                    <div className="product-edit-inline-control">
                      <label className="filter-checkbox" style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={Boolean(formData.isTrackedInOverview)}
                          onChange={(e) => setFormData({ ...formData, isTrackedInOverview: e.target.checked })}
                        />
                        Bật theo dõi trên báo cáo tổng quan
                      </label>
                      <small className="product-edit-help">Nếu tắt, sản phẩm sẽ không được tính trong bộ lọc "Theo dõi tổng quan".</small>
                    </div>
                  </div>
                  {editingProduct ? (
                    <div className="product-edit-inline-row">
                      <label className="product-edit-inline-label">Trạng thái kinh doanh</label>
                      <div className="product-edit-inline-control">
                        <select
                          value={formData.isActive ? "ACTIVE" : "INACTIVE"}
                          onChange={(e) => setFormData({ ...formData, isActive: e.target.value === "ACTIVE" })}
                        >
                          <option value="ACTIVE">Hoạt động</option>
                          <option value="INACTIVE">Ngừng kinh doanh</option>
                        </select>
                        <small className="product-edit-help">Trạng thái này áp dụng khi cập nhật sản phẩm.</small>
                      </div>
                    </div>
                  ) : null}
                  <div className="product-edit-inline-row">
                    <label className="product-edit-inline-label">Hiển thị Corporate</label>
                    <div className="product-edit-inline-control">
                      <select
                        value={formData.isVisibleOnCorporate ? "ON" : "OFF"}
                        onChange={(e) => setFormData({ ...formData, isVisibleOnCorporate: e.target.value === "ON" })}
                      >
                        <option value="OFF">Ẩn trên website Corporate</option>
                        <option value="ON">Hiển thị trên website Corporate</option>
                      </select>
                      <small className="product-edit-help">Bật để sản phẩm được phép xuất hiện trong danh mục Corporate website.</small>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={handleCloseDialog}>Hủy</button>
              <button type="submit" className="btn-primary" disabled={hasProductFormErrors}>{editingProduct ? "Cập nhật" : "Tạo"}</button>
            </div>
          </form>
        </div>
      )}

      {showConsultDialog && consultTargetProduct && (
        <div className="dialog-overlay" onClick={closeConsultDialog}>
          <div className="dialog-panel dialog-panel--md" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Thông tin tư vấn  {consultTargetProduct.sku}  {consultTargetProduct.name}</h2>
              <button type="button" className="close-btn" onClick={closeConsultDialog} aria-label="Đóng">✕</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 14 }}>
              <div className="form-group">
                <label>Thành phần</label>
                <textarea
                  rows="4"
                  value={consultForm.ingredients}
                  onChange={(e) => setConsultForm((prev) => ({ ...prev, ingredients: e.target.value }))}
                  placeholder="Ví dụ: Vitamin C; Kẽm; Lysine"
                />
                <small className="product-edit-help">Mỗi ý có thể cách nhau bằng dấu ; hoặc xuống dòng.</small>
              </div>
              <div className="form-group">
                <label>Công dụng</label>
                <textarea
                  rows="4"
                  value={consultForm.benefits}
                  onChange={(e) => setConsultForm((prev) => ({ ...prev, benefits: e.target.value }))}
                  placeholder="Ví dụ: Hỗ trợ tăng đề kháng; Giảm mệt mỏi"
                />
              </div>
              <div className="form-group">
                <label>Hướng dẫn sử dụng</label>
                <textarea
                  rows="4"
                  value={consultForm.usageGuide}
                  onChange={(e) => setConsultForm((prev) => ({ ...prev, usageGuide: e.target.value }))}
                  placeholder="Ví dụ: Uống 1 viên sau ăn, ngày 1-2 lần"
                />
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closeConsultDialog} disabled={consultSaving}>Hủy</button>
              <button type="button" className="btn-primary" onClick={submitConsultDialog} disabled={consultSaving}>
                {consultSaving ? "Đang lưu..." : "Lưu thông tin tư vấn"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* CSV Import Dialog */}
      {showImportDialog && (
          <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeImportDialog(); }}>
            <div className="dialog-panel dialog-panel--lg" onClick={(e) => e.stopPropagation()}>
              <div className="dialog-header">
                <h2>Nhập sản phẩm từ CSV</h2>
                <button className="close-btn" type="button" onClick={closeImportDialog} aria-label="Đóng">✕</button>
              </div>

              <div style={{ display: "flex", gap: 8, padding: "8px 24px", borderBottom: "1px solid #e9ecef" }}>
                {["upload", "preview", "done"].map((step, i) => (
                  <span key={step} style={{
                    padding: "4px 14px", borderRadius: 20, fontSize: 13,
                    background: importStep === step ? "#1971c2" : "#e9ecef",
                    color: importStep === step ? "#fff" : "#868e96", fontWeight: importStep === step ? 600 : 400
                  }}>
                    {i + 1}. {["Tải file", "Xem trước", "Kết quả"][i]}
                  </span>
                ))}
              </div>

              <div className="dialog-body" style={{ padding: "20px 24px" }}>
                {importStep === "upload" && (
                  <div style={{ textAlign: "center", padding: "16px 0" }}>
                    <p style={{ marginBottom: 16, color: "#495057" }}>
                      Tải lên file CSV để nhập hàng loạt. SKU đã tồn tại sẽ được <strong>cập nhật</strong>; SKU mới sẽ được tạo với trạng thái <strong>chưa hoạt động</strong>. Nếu để trống danh mục, sản phẩm sẽ được gán vào mục "Chưa phân loại".
                    </p>
                    <button type="button" className="btn-cancel" style={{ marginBottom: 16 }} onClick={downloadImportTemplate}>
                      ⬇ Tải file mẫu CSV
                    </button>
                    <br />
                    <input
                      ref={importFileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      style={{ display: "none" }}
                      onChange={handleImportFileChange}
                    />
                    <button type="button" className="btn-primary" onClick={() => importFileInputRef.current?.click()}>
                      Chọn file CSV
                    </button>
                    <div style={{ marginTop: 18, textAlign: "left", border: "1px solid #dee2e6", borderRadius: 8 }}>
                      <div style={{ padding: "10px 12px", borderBottom: "1px solid #edf2f7", fontWeight: 600, color: "#334155" }}>
                        Hướng dẫn cột CSV
                      </div>
                      <div style={{ maxHeight: 200, overflowY: "auto" }}>
                        <table className="data-table" style={{ marginBottom: 0 }}>
                          <thead>
                            <tr>
                              <th>Cột</th>
                              <th>Bắt buộc</th>
                              <th>Mô tả</th>
                            </tr>
                          </thead>
                          <tbody>
                            {IMPORT_CSV_COLUMN_GUIDE.map((col) => (
                              <tr key={col.key}>
                                <td><code>{col.key}</code></td>
                                <td>{col.required ? "Có" : "Không"}</td>
                                <td>{col.note}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {importStep === "preview" && (
                  <div>
                    <div style={{ display: "flex", gap: 16, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ color: "#2b8a3e", fontWeight: 600 }}>✓ {importRows.filter((r) => r._valid).length} hợp lệ</span>
                      {importRows.filter((r) => !r._valid).length > 0 && (
                        <span style={{ color: "#c92a2a", fontWeight: 600 }}>✗ {importRows.filter((r) => !r._valid).length} lỗi</span>
                      )}
                      <span style={{ color: "#868e96" }}>Tổng {importRows.length} dòng</span>
                    </div>
                    <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid #dee2e6", borderRadius: 6 }}>
                      <table className="data-table" style={{ minWidth: 920 }}>
                        <thead>
                          <tr>
                            <th style={{ width: 48 }}>#</th>
                            <th>SKU</th>
                            <th>Tên sản phẩm</th>
                            <th>Danh mục</th>
                            <th>ĐVT</th>
                            <th>Giá bán</th>
                            <th>Thành phần</th>
                            <th>Công dụng</th>
                            <th>HDSD</th>
                            <th style={{ width: 110 }}>Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importRows.map((row, i) => (
                            <tr key={i} style={{ background: row._valid ? undefined : "#fff5f5" }}>
                              <td style={{ color: "#adb5bd" }}>{row._line}</td>
                              <td><code style={{ fontSize: 12 }}>{row.sku || "—"}</code></td>
                              <td>{row.name || "—"}</td>
                              <td>{row.categoryName || <em style={{ color: "#adb5bd" }}>mặc định</em>}</td>
                              <td>{row.unit || "—"}</td>
                              <td>{row._valid ? formatCurrency(row.salePrice) : "—"}</td>
                              <td title={row.ingredients || ""}>{row.ingredients || <em style={{ color: "#adb5bd" }}>trống</em>}</td>
                              <td title={row.benefits || ""}>{row.benefits || <em style={{ color: "#adb5bd" }}>trống</em>}</td>
                              <td title={row.usageGuide || ""}>{row.usageGuide || <em style={{ color: "#adb5bd" }}>trống</em>}</td>
                              <td>
                                {row._valid
                                  ? <span style={{ color: "#2b8a3e", fontWeight: 600 }}>✓ Hợp lệ</span>
                                  : <span style={{ color: "#c92a2a", fontSize: 12 }} title={row._errors.join("; ")}>✗ {row._errors[0]}</span>
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="dialog-footer dialog-footer--inner">
                      <button type="button" className="btn-cancel" onClick={() => { setImportStep("upload"); setImportRows([]); }}>Quay lại</button>
                      <button
                        type="button"
                        className="btn-cancel"
                        disabled={importLoading || importRows.filter((r) => r._valid).length === 0}
                        onClick={() => handleConfirmImport(true)}
                      >
                        {importLoading && importAction === "dry-run" ? "Đang kiểm tra..." : "Kiểm tra dry-run"}
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={importLoading || importRows.filter((r) => r._valid).length === 0}
                        onClick={() => handleConfirmImport(false)}
                      >
                        {importLoading && importAction === "import" ? "Đang nhập..." : `Xác nhận nhập ${importRows.filter((r) => r._valid).length} dòng`}
                      </button>
                    </div>
                  </div>
                )}

                {importStep === "done" && importResult && (
                  <div>
                    {importResult.dryRun ? (
                      <div style={{ marginBottom: 12, color: "#1d4ed8", fontWeight: 600 }}>
                        Đây là kết quả kiểm tra dry-run, chưa ghi dữ liệu vào hệ thống.
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 110, background: "#ebfbee", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: "#2b8a3e" }}>{importResult.summary?.created ?? 0}</div>
                        <div style={{ fontSize: 13, color: "#2b8a3e" }}>Tạo mới</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 110, background: "#e7f5ff", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: "#1971c2" }}>{importResult.summary?.updated ?? 0}</div>
                        <div style={{ fontSize: 13, color: "#1971c2" }}>Cập nhật</div>
                      </div>
                      {(importResult.summary?.errors ?? 0) > 0 && (
                        <div style={{ flex: 1, minWidth: 110, background: "#fff5f5", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
                          <div style={{ fontSize: 28, fontWeight: 700, color: "#c92a2a" }}>{importResult.summary.errors}</div>
                          <div style={{ fontSize: 13, color: "#c92a2a" }}>Lỗi</div>
                        </div>
                      )}
                    </div>
                    {(importResult.results || []).some((r) => r.status === "error") && (
                      <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #dee2e6", borderRadius: 6, marginBottom: 8 }}>
                        <table className="data-table">
                          <thead><tr><th>Dòng</th><th>SKU</th><th>Lỗi</th></tr></thead>
                          <tbody>
                            {(importResult.results || []).filter((r) => r.status === "error").map((r, i) => (
                              <tr key={i} style={{ background: "#fff5f5" }}>
                                <td>{r.line}</td>
                                <td><code style={{ fontSize: 12 }}>{r.sku}</code></td>
                                <td style={{ color: "#c92a2a" }}>{r.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="dialog-footer dialog-footer--inner">
                      <button type="button" className="btn-cancel" onClick={resetImportDialog}>Nhập thêm</button>
                      {(importResult.results || []).some((r) => r.status === "error") ? (
                        <button type="button" className="btn-cancel" onClick={downloadImportErrorsCsv}>Xuất CSV lỗi</button>
                      ) : null}
                      {importResult.dryRun ? (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={importLoading || importRows.filter((r) => r._valid).length === 0}
                          onClick={() => handleConfirmImport(false)}
                        >
                          {importLoading ? "Đang nhập..." : "Tiến hành nhập thật"}
                        </button>
                      ) : null}
                      <button type="button" className="btn-primary" onClick={closeImportDialog}>Đóng</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}




