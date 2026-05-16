import { useEffect, useMemo, useRef, useState } from "react";
import DesktopPageFrame from "../components/DesktopPageFrame";
import AdvancedFiltersPopover from "../components/AdvancedFiltersPopover";
import ProductEditDialog from "../components/ProductEditDialog";
import FormBanner from "../components/FormBanner";
import { formatMoneyInput as formatCurrencyInput, formatCurrency, formatNumber } from "../utils/currency";

function flattenCategories(nodes = [], parentPath = "") {
  const result = [];
  for (const node of nodes) {
    const currentPath = parentPath ? `${parentPath} / ${node.name}` : node.name;
    if (node?.id) {
      result.push({ id: node.id, name: currentPath });
    }
    if (Array.isArray(node?.children) && node.children.length) {
      result.push(...flattenCategories(node.children, currentPath));
    }
  }
  return result;
}

function parseMoneyInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? String(Number(digits)) : "";
}

function isSupportedImageUrl(value) {
  return /^https?:\/\//i.test(value) || /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);
}

function getProductTypeLabel(productType) {
  return productType === "SERVICE" ? "Dịch vụ" : "Hàng hóa";
}

function validateProductEditForm(form) {
  const errors = {};
  const sku = form.sku.trim();
  const name = form.name.trim();
  const unit = form.unit.trim();
  const imageUrl = form.imageUrl.trim();
  const defaultPrice = Number(form.defaultPrice);
  const level2Price = Number(form.level2Price);
  const level2SpecialPrice = Number(form.level2SpecialPrice);
  const promoPrice = Number(form.promoPrice);
  const rewardPoints = Number(form.rewardPoints);
  const giftPointsCost = Number(form.giftPointsCost);

  if (sku.length < 2) errors.sku = "SKU cần tối thiểu 2 ký tự.";
  if (name.length < 2) errors.name = "Tên sản phẩm cần tối thiểu 2 ký tự.";
  if (!["GOODS", "SERVICE"].includes(form.productType)) errors.productType = "Loại sản phẩm không hợp lệ.";
  if (!form.categoryId) errors.categoryId = "Vui lòng chọn danh mục.";
  if (!unit) errors.unit = "Đơn vị không được để trống.";
  if (!(defaultPrice > 0)) errors.defaultPrice = "Giá bán phải lớn hơn 0.";
  if (String(form.level2Price || "").trim() && !(level2Price > 0)) {
    errors.level2Price = "Giá cấp 2 phải lớn hơn 0.";
  }
  if (String(form.level2SpecialPrice || "").trim() && !(level2SpecialPrice > 0)) {
    errors.level2SpecialPrice = "Giá cấp 2 đặc biệt phải lớn hơn 0.";
  }
  if (String(form.promoPrice || "").trim() && promoPrice < 0) {
    errors.promoPrice = "Giá khuyến mại không được âm.";
  }
  if (!Number.isInteger(rewardPoints) || rewardPoints < 0) errors.rewardPoints = "Điểm thưởng phải là số nguyên từ 0 trở lên.";
  if (!Number.isInteger(giftPointsCost) || giftPointsCost < 0) errors.giftPointsCost = "Điểm đổi quà phải là số nguyên từ 0 trở lên.";
  if (imageUrl && !isSupportedImageUrl(imageUrl)) {
    errors.imageUrl = "Ảnh phải là URL http/https hoặc dữ liệu ảnh đã tải lên.";
  }

  return errors;
}

function validateCreateProductForm(form) {
  const errors = {};
  const sku = form.sku.trim();
  const name = form.name.trim();
  const unit = form.unit.trim();
  const imageUrl = (form.imageUrl || "").trim();
  const defaultPrice = Number(form.defaultPrice);
  const rewardPoints = Number(form.rewardPoints);
  const giftPointsCost = Number(form.giftPointsCost);

  if (sku.length < 2) errors.sku = "SKU cần tối thiểu 2 ký tự.";
  if (name.length < 2) errors.name = "Tên sản phẩm cần tối thiểu 2 ký tự.";
  if (!["GOODS", "SERVICE"].includes(form.productType)) errors.productType = "Loại sản phẩm không hợp lệ.";
  if (!form.categoryId) errors.categoryId = "Vui lòng chọn danh mục.";
  if (!unit) errors.unit = "Đơn vị không được để trống.";
  if (!(defaultPrice > 0)) errors.defaultPrice = "Giá bán phải lớn hơn 0.";
  if (!Number.isInteger(rewardPoints) || rewardPoints < 0) errors.rewardPoints = "Điểm thưởng phải là số nguyên từ 0 trở lên.";
  if (!Number.isInteger(giftPointsCost) || giftPointsCost < 0) errors.giftPointsCost = "Điểm đổi quà phải là số nguyên từ 0 trở lên.";
  if (imageUrl && !isSupportedImageUrl(imageUrl)) {
    errors.imageUrl = "Ảnh phải là URL http/https hoặc dữ liệu ảnh đã tải lên.";
  }

  return errors;
}

function buildProductEditForm(product) {
  return {
    sku: product?.sku || "",
    name: product?.name || "",
    productType: product?.productType || "GOODS",
    categoryId: product?.categoryId || "",
    unit: product?.unit || "Cai",
    defaultPrice: Number(product?.defaultPrice || 0),
    level2Price: product?.level2Price != null ? Number(product.level2Price) : "",
    level2SpecialPrice: product?.level2SpecialPrice != null ? Number(product.level2SpecialPrice) : "",
    promoPrice: product?.promoPrice != null ? Number(product.promoPrice) : "",
    costPrice: Number(product?.costPrice || 0),
    rewardPoints: Number(product?.rewardPoints || 0),
    giftPointsCost: Number(product?.giftPointsCost || 0),
    imageUrl: product?.imageUrl || "",
    imageGallery: Array.isArray(product?.imageGallery) ? product.imageGallery : [],
    isActive: Boolean(product?.isActive),
    isTrackedInOverview: product?.isTrackedInOverview ?? true
  };
}

export default function Products({
  categories = [],
  products = [],
  inventory = [],
  onQuickUpdate = async () => {},
  onQuickUpdateConsultation = async () => {},
  onCreateCategory = async () => {},
  onCreateProduct = async () => {},
  onLoadProductAnalytics = async () => null
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [categoryId, setCategoryId] = useState("ALL");
  const [activeStatusFilter, setActiveStatusFilter] = useState("ALL");
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showConsultDialog, setShowConsultDialog] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailAnalytics, setDetailAnalytics] = useState(null);
  const [creating, setCreating] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: "" });
  const [categoryErrors, setCategoryErrors] = useState({});
  const [categoryMessage, setCategoryMessage] = useState("");
  const [productForm, setProductForm] = useState({
    sku: "",
    name: "",
    productType: "GOODS",
    categoryId: "",
    unit: "Cai",
    defaultPrice: 0,
    rewardPoints: 0,
    giftPointsCost: 0,
    imageUrl: "",
    imageGallery: []
  });
  const [createProductErrors, setCreateProductErrors] = useState({});
  const [createProductMessage, setCreateProductMessage] = useState("");
  const [detailForm, setDetailForm] = useState({
    sku: "",
    name: "",
    productType: "GOODS",
    categoryId: "",
    unit: "Cai",
    defaultPrice: 0,
    level2Price: "",
    level2SpecialPrice: "",
    promoPrice: "",
    costPrice: 0,
    rewardPoints: 0,
    giftPointsCost: 0,
    imageUrl: "",
    imageGallery: [],
    isActive: true,
    isTrackedInOverview: true
  });
  const [detailErrors, setDetailErrors] = useState({});
  const [detailMessage, setDetailMessage] = useState("");
  const [consultForm, setConsultForm] = useState({ ingredients: "", benefits: "", usageGuide: "" });
  const [consultSaving, setConsultSaving] = useState(false);
  const [consultMessage, setConsultMessage] = useState("");
  const createProductFileInputRef = useRef(null);
  const [createProductUploading, setCreateProductUploading] = useState(false);

  // PDF price list dialog
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [pdfPriceType, setPdfPriceType] = useState("sale"); // "sale" | "level2" | "level2special"
  const [pdfCategoryFilter, setPdfCategoryFilter] = useState("ALL");
  const [pdfProductTypeFilter, setPdfProductTypeFilter] = useState("ALL");
  const [pdfSelectedIds, setPdfSelectedIds] = useState([]);

  const inventoryMap = useMemo(() => {
    const map = {};
    for (const row of inventory) {
      map[row.productId] = {
        quantity: Number(row.quantity || 0),
        reservedQuantity: Number(row.reservedQuantity || 0),
        availableQuantity: Number(row.availableQuantity || 0)
      };
    }
    return map;
  }, [inventory]);

  const productRows = useMemo(() => {
    return products.map((p) => {
      const inv = inventoryMap[p.id] || { quantity: 0, reservedQuantity: 0, availableQuantity: 0 };
      return {
        ...p,
        stock: inv.quantity,
        reserved: inv.reservedQuantity,
        available: inv.availableQuantity
      };
    });
  }, [products, inventoryMap]);

  const categoryOptions = useMemo(() => {
    if (categories.length) {
      return flattenCategories(categories);
    }

    const dict = {};
    for (const p of products) {
      if (p.category?.id) dict[p.category.id] = p.category.name;
    }
    return Object.entries(dict).map(([id, name]) => ({ id, name }));
  }, [categories, products]);

  const normalizedCategoryNames = useMemo(() => {
    return new Set(categoryOptions.map((category) => category.name.trim().replace(/\s+/g, " ").toLowerCase()));
  }, [categoryOptions]);

  const categoryNameExists = useMemo(() => {
    const normalized = categoryForm.name.trim().replace(/\s+/g, " ").toLowerCase();
    if (!normalized) return false;
    return normalizedCategoryNames.has(normalized);
  }, [categoryForm.name, normalizedCategoryNames]);

  const rows = useMemo(() => {
    return productRows
      .filter((row) => {
        const k = search.toLowerCase();
        const matchedSearch =
          !k ||
          (row.sku || "").toLowerCase().includes(k) ||
          (row.name || "").toLowerCase().includes(k);
        const matchedCategory = categoryId === "ALL" || row.categoryId === categoryId;
        const matchedActiveStatus =
          activeStatusFilter === "ALL"
          || (activeStatusFilter === "ACTIVE" && Boolean(row.isActive))
          || (activeStatusFilter === "INACTIVE" && !Boolean(row.isActive));
        const matchedLowStock = !onlyLowStock || row.productType === "SERVICE" || row.available <= 10;
        return matchedSearch && matchedCategory && matchedActiveStatus && matchedLowStock;
      });
  }, [productRows, search, categoryId, activeStatusFilter, onlyLowStock]);

  const totalInventoryValue = useMemo(() => {
    return rows.reduce((sum, row) => {
      if (row.productType === "SERVICE") return sum;
      const availableQuantity = Number(row.available || 0);
      const costPrice = Number(row.costPrice || 0);
      return sum + (availableQuantity * costPrice);
    }, 0);
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const selectedProduct = useMemo(() => {
    if (!selectedProductId) return null;
    return productRows.find((row) => row.id === selectedProductId) || null;
  }, [productRows, selectedProductId]);

  const advancedFilterCount = [
    categoryId !== "ALL",
    activeStatusFilter !== "ALL",
    Boolean(onlyLowStock)
  ].filter(Boolean).length;

  const openDetail = async (row) => {
    setSelectedProductId(row.id);
    setDetailAnalytics(null);
    setDetailLoading(true);
    setShowDetail(true);

    try {
      const analytics = await onLoadProductAnalytics(row.id);
      setDetailAnalytics(analytics || null);
    } catch (error) {
      alert(`Không tải được xu hướng bán hàng: ${error?.message || error}`);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedProductId(null);
    setDetailLoading(false);
    setDetailAnalytics(null);
    setDetailErrors({});
    setDetailMessage("");
    setShowEditDialog(false);
    setShowConsultDialog(false);
    setShowDetail(false);
    setConsultForm({ ingredients: "", benefits: "", usageGuide: "" });
    setConsultMessage("");
  };

  const openEditDialog = () => {
    if (!selectedProduct) return;
    setDetailForm(buildProductEditForm(selectedProduct));
    setDetailErrors({});
    setDetailMessage("");
    setShowEditDialog(true);
  };

  const closeEditDialog = () => {
    setDetailErrors({});
    setDetailMessage("");
    setShowEditDialog(false);
  };

  const openConsultDialog = () => {
    if (!selectedProduct) return;
    setConsultForm({
      ingredients: selectedProduct.ingredients || "",
      benefits: selectedProduct.benefits || "",
      usageGuide: selectedProduct.usageGuide || ""
    });
    setConsultMessage("");
    setShowConsultDialog(true);
  };

  const closeConsultDialog = () => {
    setShowConsultDialog(false);
    setConsultMessage("");
  };

  const submitConsultEdit = async () => {
    if (!selectedProduct) return;
    try {
      setConsultSaving(true);
      await onQuickUpdateConsultation(selectedProduct.id, {
        ingredients: String(consultForm.ingredients || "").trim() || null,
        benefits: String(consultForm.benefits || "").trim() || null,
        usageGuide: String(consultForm.usageGuide || "").trim() || null
      });
      setConsultMessage("");
      setShowConsultDialog(false);
    } catch (error) {
      setConsultMessage(`Lưu thông tin tư vấn thất bại: ${error?.message || error}`);
    } finally {
      setConsultSaving(false);
    }
  };

  const handleDetailFormChange = (field, value) => {
    setDetailForm((prev) => ({ ...prev, [field]: value }));
    setDetailErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }

      const next = { ...prev };
      delete next[field];
      return next;
    });
    if (detailMessage) {
      setDetailMessage("");
    }
  };

  const submitCreateCategory = async () => {
    const name = categoryForm.name.trim();
    if (name.length < 2) {
      setCategoryErrors({ name: "Tên danh mục tối thiểu 2 ký tự." });
      setCategoryMessage("Biểu mẫu còn lỗi. Vui lòng kiểm tra lại tên danh mục.");
      return;
    }
    if (categoryNameExists) {
      setCategoryErrors({ name: "Tên danh mục đã tồn tại." });
      setCategoryMessage("Danh mục này đã tồn tại. Vui lòng chọn tên khác.");
      return;
    }
    try {
      setCreating(true);
      await onCreateCategory({ name: name.replace(/\s+/g, " ") });
      setShowCreateCategory(false);
      setCategoryForm({ name: "" });
      setCategoryErrors({});
      setCategoryMessage("");
    } catch (error) {
      setCategoryMessage(`Tạo danh mục thất bại: ${error?.message || error}`);
    } finally {
      setCreating(false);
    }
  };

  const submitCreateProduct = async () => {
    const errors = validateCreateProductForm(productForm);
    if (Object.keys(errors).length) {
      setCreateProductErrors(errors);
      setCreateProductMessage("Biểu mẫu còn lỗi. Vui lòng kiểm tra các trường được đánh dấu.");
      return;
    }

    setCreateProductErrors({});
    setCreateProductMessage("");

    const payload = {
      sku: productForm.sku.trim(),
      name: productForm.name.trim(),
      productType: productForm.productType,
      categoryId: productForm.categoryId,
      unit: productForm.unit.trim() || "Cái",
      defaultPrice: Number(productForm.defaultPrice),
      costPrice: 0,
      rewardPoints: Number(productForm.rewardPoints),
      giftPointsCost: Number(productForm.giftPointsCost ?? 0),
      imageGallery: (productForm.imageGallery && productForm.imageGallery.length > 0) ? productForm.imageGallery : undefined,
      imageUrl: (productForm.imageGallery || []).find(g => g.isDefault)?.url || (productForm.imageGallery || [])[0]?.url || productForm.imageUrl.trim() || undefined
    };

    try {
      setCreating(true);
      await onCreateProduct(payload);
      setShowCreateProduct(false);
      setCreateProductErrors({});
      setCreateProductMessage("");
      setProductForm({
        sku: "",
        name: "",
        productType: "GOODS",
        categoryId: "",
        unit: "Cai",
        defaultPrice: 0,
        rewardPoints: 0,
        giftPointsCost: 0,
        imageUrl: "",
        imageGallery: []
      });
    } catch (error) {
      setCreateProductMessage(`Tạo sản phẩm thất bại: ${error?.message || error}`);
    } finally {
      setCreating(false);
    }
  };

  const submitDetailEdit = async () => {
    if (!selectedProduct) return;
    const errors = validateProductEditForm(detailForm);
    if (Object.keys(errors).length) {
      setDetailErrors(errors);
      setDetailMessage("Biểu mẫu còn lỗi. Vui lòng kiểm tra các trường được đánh dấu.");
      return;
    }

    setDetailErrors({});
    setDetailMessage("");

    const payload = {
      sku: detailForm.sku.trim(),
      name: detailForm.name.trim(),
      productType: detailForm.productType || "GOODS",
      categoryId: detailForm.categoryId,
      unit: detailForm.unit.trim(),
      defaultPrice: Number(detailForm.defaultPrice),
      ...(String(detailForm.level2Price || "").trim() ? { priceLevel2: Number(detailForm.level2Price) } : {}),
      ...(String(detailForm.level2SpecialPrice || "").trim() ? { priceLevel2Special: Number(detailForm.level2SpecialPrice) } : {}),
      ...(String(detailForm.promoPrice || "").trim() ? { promoPrice: Number(detailForm.promoPrice) } : {}),
      rewardPoints: Number(detailForm.rewardPoints),
      costPrice: Number(selectedProduct.costPrice || 0),
      imageUrl: (detailForm.imageGallery || []).find(g => g.isDefault)?.url || (detailForm.imageGallery || [])[0]?.url || detailForm.imageUrl.trim() || undefined,
      imageGallery: (detailForm.imageGallery && detailForm.imageGallery.length > 0) ? detailForm.imageGallery : undefined,
      isActive: Boolean(detailForm.isActive),
      isTrackedInOverview: Boolean(selectedProduct.isTrackedInOverview)
    };

    try {
      setCreating(true);
      await onQuickUpdate(selectedProduct.id, payload);
      setDetailErrors({});
      setDetailMessage("");
      setShowEditDialog(false);
    } catch (error) {
      setDetailMessage(`Lưu thất bại: ${error?.message || error}`);
    } finally {
      setCreating(false);
    }
  };

  const resetFilters = () => {
    setSearch("");
    setCategoryId("ALL");
    setActiveStatusFilter("ALL");
    setOnlyLowStock(false);
    setPage(1);
  };

  const pdfFilteredProducts = useMemo(() => {
    return productRows.filter((p) => {
      const matchCat = pdfCategoryFilter === "ALL" || p.categoryId === pdfCategoryFilter;
      const matchType = pdfProductTypeFilter === "ALL" || p.productType === pdfProductTypeFilter;
      return matchCat && matchType;
    });
  }, [productRows, pdfCategoryFilter, pdfProductTypeFilter]);

  const openPdfDialog = () => {
    setPdfCategoryFilter("ALL");
    setPdfProductTypeFilter("ALL");
    setPdfPriceType("sale");
    setPdfSelectedIds([]);
    setShowPdfDialog(true);
  };

  const pdfAllSelected = pdfFilteredProducts.length > 0 && pdfFilteredProducts.every((p) => pdfSelectedIds.includes(p.id));

  const togglePdfSelectAll = (checked) => {
    if (checked) {
      setPdfSelectedIds(pdfFilteredProducts.map((p) => p.id));
    } else {
      setPdfSelectedIds([]);
    }
  };

  const togglePdfSelectRow = (id, checked) => {
    setPdfSelectedIds((prev) => checked ? [...prev, id] : prev.filter((x) => x !== id));
  };

  const getPdfPrice = (product) => {
    if (pdfPriceType === "sale") return Number(product.defaultPrice || 0);
    if (pdfPriceType === "level2") return Number(product.priceLevel2 || product.level2Price || 0);
    if (pdfPriceType === "level2special") return Number(product.priceLevel2Special || product.level2SpecialPrice || 0);
    return 0;
  };

  const getPdfPriceColName = () => {
    if (pdfPriceType === "sale") return "Giá bán";
    if (pdfPriceType === "level2") return "Giá cấp 2";
    if (pdfPriceType === "level2special") return "Giá NET";
    return "Đơn giá";
  };

  const printPriceList = () => {
    const selected = productRows.filter((p) => pdfSelectedIds.includes(p.id));
    if (selected.length === 0) { alert("Vui lòng chọn ít nhất một sản phẩm."); return; }

    const priceColName = getPdfPriceColName();
    const rows = selected.map((p, i) => {
      const price = getPdfPrice(p);
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${p.sku || ""}</td>
        <td>${p.name || ""}</td>
        <td style="text-align:center">${p.unit || ""}</td>
        <td style="text-align:right">${price > 0 ? price.toLocaleString("vi-VN") : ""}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<title>Bảng giá</title>
<style>
  @page { margin: 20mm 15mm; }
  body { font-family: Times New Roman, serif; font-size: 13pt; margin: 0; }
  h1 { text-align: center; font-size: 18pt; text-transform: uppercase; margin-bottom: 4px; }
  p.subtitle { text-align: center; font-size: 11pt; color: #555; margin-top: 0; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #333; padding: 6px 8px; }
  th { background: #f0f0f0; font-weight: bold; text-align: center; }
  tr:nth-child(even) { background: #fafafa; }
  @media print { button { display: none; } }
</style>
</head>
<body>
<h1>Bảng giá</h1>
<p class="subtitle">Ngày: ${new Date().toLocaleDateString("vi-VN")}</p>
<table>
  <thead>
    <tr>
      <th style="width:40px">STT</th>
      <th style="width:100px">Mã hàng</th>
      <th>Tên hàng hóa, dịch vụ</th>
      <th style="width:80px">Đơn vị tính</th>
      <th style="width:120px">${priceColName}</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`;

    const win = window.open("", "_blank", "width=900,height=700");
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  const handleCreateProductChange = (field, value) => {
    setProductForm((prev) => ({ ...prev, [field]: value }));
    setCreateProductErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
    if (createProductMessage) {
      setCreateProductMessage("");
    }
  };

  const handleCreateProductImageFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setCreateProductMessage("Vui lòng chọn tệp ảnh hợp lệ (png, jpg, webp...).");
      event.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setCreateProductMessage("Ảnh vượt quá 5MB. Vui lòng chọn ảnh nhỏ hơn.");
      event.target.value = "";
      return;
    }
    try {
      setCreateProductUploading(true);
      setCreateProductMessage("");
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Không đọc được tệp ảnh."));
        reader.readAsDataURL(file);
      });
      setProductForm((prev) => {
        const gallery = Array.isArray(prev.imageGallery) ? prev.imageGallery : [];
        const isDefault = gallery.length === 0;
        return { ...prev, imageGallery: [...gallery, { url: dataUrl, isDefault, showOnCorporate: true }] };
      });
    } catch (error) {
      setCreateProductMessage(error?.message || "Tải ảnh thất bại.");
    } finally {
      setCreateProductUploading(false);
      event.target.value = "";
    }
  };

  const handleCategoryFormChange = (value) => {
    setCategoryForm({ name: value });
    if (categoryErrors.name || categoryMessage) {
      setCategoryErrors({});
      setCategoryMessage("");
    }
  };

  return (
    <DesktopPageFrame
      title="Sản phẩm"
      description={`${rows.length} sản phẩm | Hiển thị tồn kho theo cửa hàng đang hoạt động`}
      kpis={[
        { label: "Tổng sản phẩm", value: rows.length },
        { label: "Tồn thấp", value: rows.filter((row) => row.available <= 10).length },
        { label: "Dịch vụ", value: rows.filter((row) => row.productType === "SERVICE").length },
        { label: "Đang kinh doanh", value: rows.filter((row) => row.isActive).length },
        { label: "Giá trị tồn", value: formatCurrency(totalInventoryValue) }
      ]}
      actions={(
        <div className="action-row">
          <button type="button" className="btn-secondary" onClick={openPdfDialog}>Tạo PDF bảng giá</button>
          <button type="button" className="btn-secondary" onClick={() => { setCategoryErrors({}); setCategoryMessage(""); setShowCreateCategory(true); }}>Tạo danh mục</button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setShowCreateProduct(true);
              setCreateProductErrors({});
              setCreateProductMessage("");
              setProductForm((prev) => ({ ...prev, categoryId: "", imageUrl: "", imageGallery: [] }));
            }}
          >
            Tạo sản phẩm
          </button>
        </div>
      )}
      filters={(
        <>
          <input
            className="filter-wide"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm theo SKU hoặc tên sản phẩm"
          />
          <AdvancedFiltersPopover activeCount={advancedFilterCount}>
            <div className="advanced-filter-grid">
              <label>
                Danh mục
                <select
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="ALL">Tất cả danh mục</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Trạng thái kinh doanh
                <select
                  value={activeStatusFilter}
                  onChange={(e) => {
                    setActiveStatusFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="ALL">Tất cả trạng thái</option>
                  <option value="ACTIVE">Hoạt động</option>
                  <option value="INACTIVE">Ngừng kinh doanh</option>
                </select>
              </label>
              <label className="checkbox-row desktop-filter-checkbox">
                <input
                  type="checkbox"
                  checked={onlyLowStock}
                  onChange={(e) => {
                    setOnlyLowStock(e.target.checked);
                    setPage(1);
                  }}
                />
                Chỉ hiển thị tồn thấp ({"<= 10"})
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
              <th>SKU</th>
              <th>Tên sản phẩm</th>
              <th>Loại</th>
              <th>Danh mục</th>
              <th>Đơn vị</th>
              <th>Trạng thái</th>
              <th className="text-right">Giá bán</th>
              <th className="text-right">Điểm thưởng</th>
              <th className="text-right">Điểm đổi quà</th>
              <th className="text-right">Tồn</th>
              <th className="text-right">Đang giữ</th>
              <th className="text-right">Có sẵn</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="13" className="text-center">Không có dữ liệu</td>
              </tr>
            ) : (
              pagedRows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.sku}</td>
                  <td>{row.name}</td>
                  <td>{getProductTypeLabel(row.productType)}</td>
                  <td>{row.category?.name || "-"}</td>
                  <td>{row.unit}</td>
                  <td>
                    <span className={`product-detail-chip ${row.isActive ? "product-detail-chip--active" : "product-detail-chip--inactive"}`}>
                      {row.isActive ? "Hoạt động" : "Ngừng kinh doanh"}
                    </span>
                  </td>
                  <td className="text-right mono">{formatCurrency(row.defaultPrice)}</td>
                  <td className="text-right mono">{row.rewardPoints > 0 ? row.rewardPoints : "-"}</td>
                  <td className="text-right mono">{row.giftPointsCost > 0 ? row.giftPointsCost : "-"}</td>
                  <td className="text-right mono">{row.stock}</td>
                  <td className="text-right mono">{row.reserved}</td>
                  <td className="text-right mono" style={{ color: row.productType === "SERVICE" ? "#0c7c59" : row.available <= 10 ? "#c92a2a" : "#2b8a3e" }}>
                    {row.productType === "SERVICE" ? "Không quản lý" : row.available}
                  </td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => openDetail(row)}>Chi tiết</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div>Trang {page} / {totalPages} - Tổng {rows.length} sản phẩm</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Trang trước</button>
          <button type="button" className="btn-secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Trang sau</button>
        </div>
      </div>



      {showDetail && selectedProduct ? (
        <div className="dialog-overlay" onClick={closeDetail}>
          <div className="dialog-panel dialog-panel--product-detail" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>Chi tiết sản phẩm</h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ margin: 0, padding: "8px 12px", fontSize: 14 }}
                  onClick={openEditDialog}
                >
                  Sửa sản phẩm
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ margin: 0, padding: "8px 12px", fontSize: 14 }}
                  onClick={openConsultDialog}
                >
                  Thông tin tư vấn
                </button>
                <button className="close-btn close-btn--emphasis" type="button" onClick={closeDetail} aria-label="Đóng">x</button>
              </div>
            </div>

            <div className="dialog-body">
              <section className="product-detail-hero detail-card">
                <div className="product-detail-hero__media">
                  {selectedProduct.imageUrl ? (
                    <img className="product-detail-thumb" src={selectedProduct.imageUrl} alt={selectedProduct.name} />
                  ) : (
                    <div className="product-detail-thumb product-detail-thumb--placeholder">{selectedProduct.productType === "SERVICE" ? "SVC" : "SKU"}</div>
                  )}
                </div>
                <div className="product-detail-hero__content">
                  <div>
                    <span className="product-detail-eyebrow mono">{selectedProduct.sku}</span>
                    <h3>{selectedProduct.name}</h3>
                    <p>{selectedProduct.category?.name || "Chưa có danh mục"} · {selectedProduct.unit || "Chưa có đơn vị"}</p>
                  </div>
                  <div className="product-detail-chip-row">
                    <span className="product-detail-chip">{getProductTypeLabel(selectedProduct.productType)}</span>
                    <span className={`product-detail-chip ${selectedProduct.isActive ? "product-detail-chip--active" : "product-detail-chip--inactive"}`}>
                      {selectedProduct.isActive ? "Đang kinh doanh" : "Ngừng kinh doanh"}
                    </span>
                  </div>
                </div>
              </section>

              <div className="product-detail-top-grid">
                <section className="detail-card product-detail-profile">
                  <div className="detail-section-head">
                    <h3>Thông tin cốt lõi</h3>
                  </div>
                  <div className="product-detail-kv-list">
                    <div className="product-detail-kv-row">
                      <span>SKU</span>
                      <strong className="mono">{selectedProduct.sku}</strong>
                    </div>
                    <div className="product-detail-kv-row">
                      <span>Tên sản phẩm</span>
                      <strong>{selectedProduct.name}</strong>
                    </div>
                    <div className="product-detail-kv-row">
                      <span>Loại</span>
                      <strong>{getProductTypeLabel(selectedProduct.productType)}</strong>
                    </div>
                    <div className="product-detail-kv-row">
                      <span>Danh mục</span>
                      <strong>{selectedProduct.category?.name || "-"}</strong>
                    </div>
                    <div className="product-detail-kv-row">
                      <span>Đơn vị</span>
                      <strong>{selectedProduct.unit || "-"}</strong>
                    </div>
                  </div>
                </section>

                <section className="detail-card product-detail-stock-card">
                  <div className="detail-section-head">
                    <h3>Tồn kho cửa hàng</h3>
                  </div>
                  {selectedProduct.productType === "SERVICE" ? (
                    <div className="product-detail-empty-state">
                      <strong>Dịch vụ không quản lý tồn kho</strong>
                      <span>Phần tồn kho được bỏ qua cho nhóm sản phẩm dịch vụ.</span>
                    </div>
                  ) : (
                    <div className="product-detail-metric-grid">
                      <div className="product-detail-metric-card">
                        <span>Tồn hiện tại</span>
                        <strong>{formatNumber(selectedProduct.stock || 0)}</strong>
                      </div>
                      <div className="product-detail-metric-card">
                        <span>Đang giữ</span>
                        <strong>{formatNumber(selectedProduct.reserved || 0)}</strong>
                      </div>
                      <div className={`product-detail-metric-card ${selectedProduct.available <= 10 ? "product-detail-metric-card--warning" : "product-detail-metric-card--healthy"}`}>
                        <span>Có sẵn</span>
                        <strong>{formatNumber(selectedProduct.available || 0)}</strong>
                      </div>
                    </div>
                  )}
                </section>
              </div>

              <section className="detail-card product-detail-price-card">
                <div className="detail-section-head">
                  <h3>Giá bán và hiệu quả</h3>
                </div>
                <div className="product-detail-metric-grid product-detail-metric-grid--prices">
                  <div className="product-detail-metric-card product-detail-metric-card--emphasis">
                    <span>Giá bán (cấp 1)</span>
                    <strong>{formatCurrency(selectedProduct.defaultPrice)}</strong>
                  </div>
                  <div className="product-detail-metric-card">
                    <span>Giá cấp 2</span>
                    <strong>{Number(selectedProduct.level2Price || 0) > 0 ? formatCurrency(selectedProduct.level2Price) : "-"}</strong>
                  </div>
                  <div className="product-detail-metric-card">
                    <span>Cấp 2 đặc biệt</span>
                    <strong>{Number(selectedProduct.level2SpecialPrice || 0) > 0 ? formatCurrency(selectedProduct.level2SpecialPrice) : "-"}</strong>
                  </div>
                  <div className="product-detail-metric-card">
                    <span>Giá khuyến mại</span>
                    <strong style={{ color: selectedProduct.promoPrice != null ? "#e53" : "inherit" }}>{selectedProduct.promoPrice != null ? formatCurrency(selectedProduct.promoPrice) : "-"}</strong>
                  </div>
                  <div className="product-detail-metric-card">
                    <span>Điểm thưởng</span>
                    <strong>{formatNumber(selectedProduct.rewardPoints || 0)}</strong>
                  </div>
                  <div className="product-detail-metric-card">
                    <span>Điểm đổi quà</span>
                    <strong style={{ color: "#c92a2a" }}>{formatNumber(selectedProduct.giftPointsCost || 0)}</strong>
                  </div>
                </div>
              </section>

              <section className="detail-card product-detail-trend-card">
                <div className="detail-section-head">
                  <h3>Xu hướng bán hàng 12 tháng gần nhất</h3>
                  <span className="product-detail-section-note">Doanh thu theo tháng của riêng sản phẩm này</span>
                </div>
                {detailLoading ? (
                  <div className="product-detail-empty-state">
                    <strong>Đang tải dữ liệu xu hướng...</strong>
                    <span>Hệ thống đang tổng hợp doanh thu theo từng tháng.</span>
                  </div>
                ) : detailAnalytics?.salesTrend?.length ? (
                  (() => {
                    const trendRows = [...detailAnalytics.salesTrend].reverse();
                    const revenues = trendRows.map((row) => Number(row.revenue || 0));
                    const totalRevenue = revenues.reduce((sum, value) => sum + value, 0);
                    const maxRevenue = Math.max(...revenues, 1);
                    const bestRow = trendRows.reduce((best, row) => Number(row.revenue || 0) > Number(best.revenue || 0) ? row : best, trendRows[0]);
                    const averageRevenue = trendRows.length ? totalRevenue / trendRows.length : 0;
                    return (
                      <div className="trend-chart-card">
                        <div className="trend-chart-summary">
                          <div className="trend-chart-summary-card">
                            <span>Tổng doanh thu</span>
                            <strong>{formatCurrency(totalRevenue)}</strong>
                          </div>
                          <div className="trend-chart-summary-card">
                            <span>Trung bình tháng</span>
                            <strong>{formatCurrency(averageRevenue)}</strong>
                          </div>
                          <div className="trend-chart-summary-card">
                            <span>Tháng cao nhất</span>
                            <strong>{bestRow?.month || "-"}</strong>
                            <small>{formatCurrency(Number(bestRow?.revenue || 0))}</small>
                          </div>
                        </div>
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
                  })()
                ) : (
                  <div className="product-detail-empty-state">
                    <strong>Chưa có dữ liệu xu hướng</strong>
                    <span>Sản phẩm chưa phát sinh doanh thu đủ để hiển thị biểu đồ.</span>
                  </div>
                )}
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closeDetail}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {showEditDialog && selectedProduct ? (
        <ProductEditDialog
          product={selectedProduct}
          categories={categoryOptions}
          form={detailForm}
          errors={detailErrors}
          message={detailMessage}
          creating={creating}
          onClose={closeEditDialog}
          onSubmit={submitDetailEdit}
          parseMoneyInput={parseMoneyInput}
          onChange={handleDetailFormChange}
        />
      ) : null}

      {showConsultDialog && selectedProduct ? (
        <div className="dialog-overlay" onClick={closeConsultDialog}>
          <div className="dialog-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Thông tin tư vấn  {selectedProduct.sku}  {selectedProduct.name}</h2>
              <button className="close-btn" type="button" onClick={closeConsultDialog} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Thành phần</label>
                <textarea
                  rows="4"
                  value={consultForm.ingredients}
                  onChange={(e) => setConsultForm((prev) => ({ ...prev, ingredients: e.target.value }))}
                  placeholder="Ví dụ: Vitamin C; Kẽm; Lysine"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Công dụng</label>
                <textarea
                  rows="4"
                  value={consultForm.benefits}
                  onChange={(e) => setConsultForm((prev) => ({ ...prev, benefits: e.target.value }))}
                  placeholder="Ví dụ: Hỗ trợ tăng đề kháng; Giảm mệt mỏi"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Hướng dẫn sử dụng</label>
                <textarea
                  rows="4"
                  value={consultForm.usageGuide}
                  onChange={(e) => setConsultForm((prev) => ({ ...prev, usageGuide: e.target.value }))}
                  placeholder="Ví dụ: Uống 1 viên sau ăn, ngày 1-2 lần"
                />
              </div>
              <FormBanner message={consultMessage} tone="error" />
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closeConsultDialog} disabled={consultSaving}>Hủy</button>
              <button type="button" className="btn-primary" onClick={submitConsultEdit} disabled={consultSaving}>
                {consultSaving ? "Đang lưu..." : "Lưu thông tin tư vấn"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateCategory ? (
        <div className="dialog-overlay" onClick={() => setShowCreateCategory(false)}>
          <div className="dialog-panel dialog-panel--category" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div className="category-dialog-title-wrap">
                <h2>Tạo danh mục</h2>
                <p>Sắp xếp ngành hàng rõ ràng trước khi tạo sản phẩm mới.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowCreateCategory(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body category-dialog-body">
              <section className="category-create-card">
                <div className="category-create-card__header">
                  <div>
                    <span className="category-create-card__eyebrow">Danh mục mới</span>
                    <h3>Đặt tên ngắn gọn, dễ tìm</h3>
                  </div>
                  <div className="category-count-chip">
                    <strong>{categoryOptions.length}</strong>
                    <span>danh mục hiện có</span>
                  </div>
                </div>

                <div className="form-group category-form-group">
                  <label>Tên danh mục</label>
                  <FormBanner message={categoryMessage} tone="error" />
                  <input
                    className={categoryNameExists || categoryErrors.name ? "category-input category-input--invalid" : "category-input"}
                    value={categoryForm.name}
                    onChange={(e) => handleCategoryFormChange(e.target.value)}
                    placeholder="VD: Hóa mỹ phẩm"
                  />
                  <div className={categoryNameExists || categoryErrors.name ? "category-status category-status--error" : "category-status category-status--hint"}>
                    {categoryErrors.name || (categoryNameExists
                      ? "Tên danh mục đã tồn tại, vui lòng chọn tên khác."
                      : "Tên sẽ được chuẩn hóa khoảng trắng trước khi lưu.")}
                  </div>
                  <div className="category-action-row">
                    <button
                      type="button"
                      className="btn-primary category-create-btn"
                      onClick={submitCreateCategory}
                      disabled={creating || !categoryForm.name.trim() || categoryNameExists}
                    >
                      {creating ? "Đang tạo..." : "Tạo danh mục"}
                    </button>
                  </div>
                </div>

                <div className="category-suggestion-row" aria-hidden="true">
                  <span>Gợi ý:</span>
                  <div className="category-suggestion-chips">
                    <span>Đồ uống</span>
                    <span>Mỹ phẩm</span>
                    <span>Dịch vụ chăm sóc</span>
                  </div>
                </div>
              </section>

              <section className="category-library-card">
                <div className="category-library-card__header">
                  <div>
                    <h3>Danh mục hiện có</h3>
                    <p>Kiểm tra nhanh để tránh tạo trùng hoặc đặt tên quá gần nhau.</p>
                  </div>
                </div>

                <div className="category-library-list">
                  {categoryOptions.length ? categoryOptions.map((category) => (
                    <div key={category.id} className="category-library-item">
                      <span className="category-library-item__name">{category.name}</span>
                    </div>
                  )) : (
                    <div className="category-library-empty">Chưa có danh mục nào</div>
                  )}
                </div>
              </section>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowCreateCategory(false)} disabled={creating}>Hủy</button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateProduct ? (
        <div className="dialog-overlay" onClick={() => setShowCreateProduct(false)}>
          <div className="dialog-panel dialog-panel--product-create" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Tạo sản phẩm</h2>
                <p className="product-create-subtitle">Chuẩn hóa thông tin hàng hóa trước khi đưa vào bán hàng tại cửa hàng.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowCreateProduct(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body product-create-body">
              <section className="product-create-hero detail-card">
                <div className="product-create-hero-grid">
                  <div>
                    {(() => {
                      const url = (productForm.imageGallery || []).find(g => g.isDefault)?.url || (productForm.imageGallery || [])[0]?.url || "";
                      return url ? <img className="product-edit-thumb" src={url} alt={productForm.name.trim() || "Xem trước sản phẩm"} /> : <div className="product-edit-thumb product-edit-thumb--placeholder">NEW</div>;
                    })()}
                  </div>
                  <div>
                    <span className="product-edit-eyebrow">Sản phẩm mới</span>
                    <h3>{productForm.name.trim() || "Chưa đặt tên"}</h3>
                    <p>{productForm.productType === "SERVICE" ? "Dịch vụ" : "Hàng hóa"} · {productForm.unit.trim() || "Chưa có đơn vị"}</p>
                  </div>
                </div>
                <div className="product-edit-chip-row">
                  <span className="product-edit-chip">SKU {productForm.sku.trim() || "--"}</span>
                  <span className="product-edit-chip">Giá bán {formatCurrency(Number(productForm.defaultPrice || 0))}</span>
                  <span className="product-edit-chip">Danh mục {productForm.categoryId ? "Đã chọn" : "Chưa chọn"}</span>
                </div>
              </section>

              <FormBanner message={createProductMessage} tone="error" />

              <section className="detail-card">
                <h3>Thông tin cơ bản</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label>SKU</label>
                    <input className={createProductErrors.sku ? "form-control form-control--invalid" : "form-control"} value={productForm.sku} onChange={(e) => handleCreateProductChange("sku", e.target.value)} />
                    <div className={createProductErrors.sku ? "field-error" : "field-hint"}>{createProductErrors.sku || "Tối thiểu 2 ký tự, nên ngắn gọn và dễ tìm."}</div>
                  </div>
                  <div className="form-group">
                    <label>Tên sản phẩm</label>
                    <input className={createProductErrors.name ? "form-control form-control--invalid" : "form-control"} value={productForm.name} onChange={(e) => handleCreateProductChange("name", e.target.value)} />
                    <div className={createProductErrors.name ? "field-error" : "field-hint"}>{createProductErrors.name || "Tên hiển thị trong danh sách bán hàng và báo cáo."}</div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Loại sản phẩm</label>
                    <select className={createProductErrors.productType ? "form-control form-control--invalid" : "form-control"} value={productForm.productType} onChange={(e) => handleCreateProductChange("productType", e.target.value)}>
                      <option value="GOODS">Hàng hóa</option>
                      <option value="SERVICE">Dịch vụ</option>
                    </select>
                    <div className={createProductErrors.productType ? "field-error" : "field-hint"}>{createProductErrors.productType || "Dịch vụ sẽ không quản lý tồn kho."}</div>
                  </div>
                  <div className="form-group">
                    <label>Đơn vị</label>
                    <input className={createProductErrors.unit ? "form-control form-control--invalid" : "form-control"} value={productForm.unit} onChange={(e) => handleCreateProductChange("unit", e.target.value)} />
                    <div className={createProductErrors.unit ? "field-error" : "field-hint"}>{createProductErrors.unit || "Ví dụ: chai, hộp, lần, gói."}</div>
                  </div>
                </div>

                <div className="form-group">
                  <label>Ảnh sản phẩm</label>
                  {(productForm.imageGallery || []).length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      {(productForm.imageGallery || []).map((img, idx) => (
                        <div key={idx} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <img src={img.url} alt={`Ảnh ${idx + 1}`} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", border: img.isDefault ? "2px solid #3b82f6" : "1px solid #e2e8f0" }} />
                          <div style={{ display: "flex", gap: 3 }}>
                            {!img.isDefault ? (
                              <button type="button" style={{ fontSize: 11, padding: "1px 5px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer", color: "#2563eb" }}
                                onClick={() => setProductForm((prev) => ({ ...prev, imageGallery: (prev.imageGallery || []).map((g, i) => ({ ...g, isDefault: i === idx })) }))}>
                                Mặc định
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 600 }}>✓ Mặc định</span>
                            )}
                            <button type="button" style={{ fontSize: 11, padding: "1px 5px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer", color: "#dc2626" }}
                              onClick={() => setProductForm((prev) => {
                                const next = (prev.imageGallery || []).filter((_, i) => i !== idx);
                                if (next.length > 0 && !next.some(g => g.isDefault)) next[0] = { ...next[0], isDefault: true };
                                return { ...prev, imageGallery: next };
                              })}>
                              Xóa
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input ref={createProductFileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleCreateProductImageFileChange} />
                    <button type="button" className="btn-secondary" onClick={() => createProductFileInputRef.current?.click()} disabled={createProductUploading || creating}>
                      {createProductUploading ? "Đang tải ảnh..." : "Đính kèm ảnh"}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label>Danh mục</label>
                  <select className={createProductErrors.categoryId ? "form-control form-control--invalid" : "form-control"} value={productForm.categoryId} onChange={(e) => handleCreateProductChange("categoryId", e.target.value)}>
                    <option value="">Chọn danh mục</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <div className={createProductErrors.categoryId ? "field-error" : "field-hint"}>
                    {createProductErrors.categoryId || (categoryOptions.length === 0 ? "Chưa có danh mục, vui lòng tạo danh mục trước." : "Chọn danh mục để lọc và báo cáo chính xác hơn.")}
                  </div>
                </div>
              </section>

              <section className="detail-card">
                <h3>Giá và tích điểm</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label>Giá bán</label>
                    <input className={createProductErrors.defaultPrice ? "form-control form-control--invalid" : "form-control"} type="text" inputMode="numeric" placeholder="0" style={{ textAlign: "right" }} value={formatCurrencyInput(productForm.defaultPrice)} onChange={(e) => handleCreateProductChange("defaultPrice", parseMoneyInput(e.target.value))} />
                    <div className={createProductErrors.defaultPrice ? "field-error" : "field-hint"}>{createProductErrors.defaultPrice || "Giá mặc định khi thêm vào đơn hàng."}</div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Điểm thưởng</label>
                    <input className={createProductErrors.rewardPoints ? "form-control form-control--invalid" : "form-control"} type="number" min="0" value={productForm.rewardPoints} onChange={(e) => handleCreateProductChange("rewardPoints", e.target.value)} />
                    <div className={createProductErrors.rewardPoints ? "field-error" : "field-hint"}>{createProductErrors.rewardPoints || "Số điểm cộng cho khách khi mua sản phẩm này."}</div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Điểm đổi quà</label>
                    <input className={createProductErrors.giftPointsCost ? "form-control form-control--invalid" : "form-control"} type="number" min="0" value={productForm.giftPointsCost} onChange={(e) => handleCreateProductChange("giftPointsCost", e.target.value)} />
                    <div className={createProductErrors.giftPointsCost ? "field-error" : "field-hint"}>{createProductErrors.giftPointsCost || "Số điểm bị trừ khi khách dùng điểm để nhận quà."}</div>
                  </div>
                </div>
              </section>
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setCreateProductErrors({});
                  setCreateProductMessage("");
                  setShowCreateProduct(false);
                }}
                disabled={creating}
              >
                Hủy
              </button>
              <button type="button" className="btn-primary" onClick={submitCreateProduct} disabled={creating}>
                {creating ? "Đang tạo..." : "Tạo sản phẩm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showPdfDialog ? (
        <div className="dialog-overlay" onClick={() => setShowPdfDialog(false)}>
          <div className="dialog-panel pdf-pricelist-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Tạo PDF bảng giá</h2>
                <p>Chọn sản phẩm và loại giá để xuất bảng giá.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowPdfDialog(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body pdf-pricelist-body">
              <div className="pdf-pricelist-filters">
                <label>
                  Ngành hàng
                  <select value={pdfCategoryFilter} onChange={(e) => setPdfCategoryFilter(e.target.value)}>
                    <option value="ALL">Tất cả danh mục</option>
                    {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label>
                  Loại hàng hóa
                  <select value={pdfProductTypeFilter} onChange={(e) => setPdfProductTypeFilter(e.target.value)}>
                    <option value="ALL">Tất cả loại</option>
                    <option value="GOODS">Hàng hóa</option>
                    <option value="SERVICE">Dịch vụ</option>
                  </select>
                </label>
                <label>
                  Loại giá
                  <select value={pdfPriceType} onChange={(e) => setPdfPriceType(e.target.value)}>
                    <option value="sale">Giá bán</option>
                    <option value="level2">Giá cấp 2</option>
                    <option value="level2special">Giá NET (cấp 2 đặc biệt)</option>
                  </select>
                </label>
              </div>
              <div className="pdf-pricelist-meta">
                <span>{pdfFilteredProducts.length} sản phẩm theo bộ lọc</span>
                <span>{pdfSelectedIds.length} đã chọn</span>
              </div>
              <div className="pdf-pricelist-table-wrap">
                <table className="simple-table pdf-pricelist-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40, textAlign: "center" }}>
                        <input type="checkbox" checked={pdfAllSelected} onChange={(e) => togglePdfSelectAll(e.target.checked)} />
                      </th>
                      <th>SKU</th>
                      <th>Tên sản phẩm</th>
                      <th>Loại</th>
                      <th>Danh mục</th>
                      <th>Đơn vị</th>
                      <th className="text-right">{getPdfPriceColName()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pdfFilteredProducts.length === 0 ? (
                      <tr><td colSpan="7" className="text-center">Không có sản phẩm phù hợp.</td></tr>
                    ) : pdfFilteredProducts.map((p) => {
                      const price = getPdfPrice(p);
                      return (
                        <tr key={p.id}>
                          <td style={{ textAlign: "center" }}>
                            <input type="checkbox" checked={pdfSelectedIds.includes(p.id)} onChange={(e) => togglePdfSelectRow(p.id, e.target.checked)} />
                          </td>
                          <td className="mono">{p.sku}</td>
                          <td>{p.name}</td>
                          <td>{getProductTypeLabel(p.productType)}</td>
                          <td>{p.category?.name || "-"}</td>
                          <td>{p.unit}</td>
                          <td className="text-right mono">{price > 0 ? formatCurrency(price) : <span style={{ color: "#aaa" }}>—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowPdfDialog(false)}>Hủy</button>
              <button type="button" className="btn-primary" onClick={printPriceList} disabled={pdfSelectedIds.length === 0}>
                In / Lưu PDF ({pdfSelectedIds.length} sản phẩm)
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DesktopPageFrame>
  );
}





