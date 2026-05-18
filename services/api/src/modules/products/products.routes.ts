import { Router } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { badRequest, created, forbidden, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { resolveAssignedStoreIdsForUser } from "../../security/store-assignment.js";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads", "products");
const UPLOAD_BASE_URL = (process.env.UPLOAD_BASE_URL ?? "").replace(/\/$/, "");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const productImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const uploadProductImage = multer({
  storage: productImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Chỉ chấp nhận file ảnh JPEG, PNG, WebP hoặc GIF"));
    }
  }
}).single("image");

const router = Router();

const productTypeSchema = z.enum(["GOODS", "SERVICE"]);
const productImageItemSchema = z.object({
  url: z.string().refine(isSupportedProductImageUrl, { message: "Invalid image url" }),
  isDefault: z.boolean().optional(),
  showOnCorporate: z.boolean().optional()
});

type ProductImageItem = {
  url: string;
  isDefault: boolean;
  showOnCorporate: boolean;
};

function isStockTrackedProduct(productType: string) {
  return productType === "GOODS";
}

function isSupportedProductImageUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);
}

function normalizeProductImageGallery(galleryInput: unknown, fallbackImageUrl?: string | null): ProductImageItem[] {
  const rawList = Array.isArray(galleryInput) ? galleryInput : [];
  const normalized: ProductImageItem[] = [];
  const seen = new Set<string>();

  for (const raw of rawList) {
    const parsed = productImageItemSchema.safeParse(raw);
    if (!parsed.success) continue;
    const url = parsed.data.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({
      url,
      isDefault: Boolean(parsed.data.isDefault),
      showOnCorporate: Boolean(parsed.data.showOnCorporate)
    });
  }

  const fallback = String(fallbackImageUrl || "").trim();
  if (fallback && isSupportedProductImageUrl(fallback) && !seen.has(fallback)) {
    normalized.push({ url: fallback, isDefault: normalized.length === 0, showOnCorporate: false });
  }

  if (!normalized.length) return [];

  let defaultFound = false;
  const withSingleDefault = normalized.map((item, index) => {
    if (item.isDefault && !defaultFound) {
      defaultFound = true;
      return item;
    }
    return { ...item, isDefault: false };
  });

  if (!defaultFound) {
    withSingleDefault[0] = { ...withSingleDefault[0], isDefault: true };
  }

  return withSingleDefault;
}

function resolveDefaultImageUrl(gallery: ProductImageItem[]): string | undefined {
  if (!gallery.length) return undefined;
  return gallery.find((item) => item.isDefault)?.url || gallery[0].url;
}

function resolveLocalUploadedImagePath(imageUrl: string) {
  try {
    const parsed = new URL(imageUrl);
    if (!parsed.pathname.startsWith("/uploads/products/")) {
      return null;
    }
    const filename = path.basename(parsed.pathname);
    if (!filename) {
      return null;
    }
    return path.resolve(UPLOAD_DIR, filename);
  } catch {
    return null;
  }
}

function hasImageUrlInProduct(product: { imageUrl: string | null; imageGallery: unknown }, imageUrl: string) {
  if (product.imageUrl === imageUrl) {
    return true;
  }
  const gallery = normalizeProductImageGallery(product.imageGallery, product.imageUrl);
  return gallery.some((item) => item.url === imageUrl);
}

async function cleanupRemovedProductImages(removedUrls: string[], currentProductId: string) {
  const uniqueRemovedUrls = Array.from(new Set(removedUrls.filter(Boolean)));
  if (!uniqueRemovedUrls.length) {
    return;
  }

  const otherProducts = await prisma.product.findMany({
    where: { id: { not: currentProductId } },
    select: { imageUrl: true, imageGallery: true }
  });

  for (const imageUrl of uniqueRemovedUrls) {
    const stillReferenced = otherProducts.some((product) => hasImageUrlInProduct(product, imageUrl));
    if (stillReferenced) {
      continue;
    }

    const localPath = resolveLocalUploadedImagePath(imageUrl);
    if (!localPath || !fs.existsSync(localPath)) {
      continue;
    }

    try {
      await fs.promises.unlink(localPath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`Unable to delete image file ${localPath}: ${msg}`);
    }
  }
}

function resolveUploadBaseUrl(req: AuthRequest) {
  const requestHost = req.get("x-forwarded-host") || req.get("host") || "localhost:4000";
  const isLocalRequest = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestHost);
  if (isLocalRequest) {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const proto = forwardedProto || req.protocol || "http";
    return `${proto}://${requestHost}/uploads`;
  }

  if (/^https?:\/\//i.test(UPLOAD_BASE_URL)) {
    return UPLOAD_BASE_URL;
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "http";
  return `${proto}://${requestHost}/uploads`;
}

const createProductSchema = z.object({
  sku: z.string().min(2),
  name: z.string().min(2),
  productType: productTypeSchema.default("GOODS"),
  isTrackedInOverview: z.boolean().default(true),
  isVisibleOnCorporate: z.boolean().optional(),
  categoryId: z.string(),
  unit: z.string().min(1),
  salePrice: z.number().positive().optional(),
  priceLevel2: z.number().positive().optional(),
  priceLevel2Special: z.number().positive().optional(),
  promoPrice: z.number().nonnegative().optional(),
  supplierQuotedPrice: z.number().nonnegative().optional(),
  supplierQuoteNote: z.string().max(2000).optional(),
  ingredients: z.string().max(10000).optional(),
  benefits: z.string().max(10000).optional(),
  usageGuide: z.string().max(10000).optional(),
  defaultPrice: z.number().positive().optional(),
  rewardPoints: z.number().int().min(0).default(0),
  giftPointsCost: z.number().int().min(0).default(0),
  costPrice: z.number().nonnegative().default(0),
  imageUrl: z.string().refine(isSupportedProductImageUrl, {
    message: "Invalid imageUrl"
  }).optional(),
  imageGallery: z.array(productImageItemSchema).max(30).optional()
});

const updateProductSchema = createProductSchema.extend({
  isActive: z.boolean().optional()
});
const updateProductOverviewTrackingSchema = z.object({
  isTrackedInOverview: z.boolean()
});
const updateProductCorporateVisibilitySchema = z.object({
  isVisibleOnCorporate: z.boolean()
});
const updateProductConsultationSchema = z.object({
  ingredients: z.string().max(10000).optional().nullable(),
  benefits: z.string().max(10000).optional().nullable(),
  usageGuide: z.string().max(10000).optional().nullable()
});
const updateProductStockSchema = z.object({
  costPrice: z.number().nonnegative().optional(),
  inventories: z.array(z.object({
    storeId: z.string().min(1),
    quantity: z.number().int().min(0)
  })).optional()
});

// GET all products
router.get("/", requirePermission("products:read"), async (req, res) => {
  try {
    const search = ((req.query.search as string) || "").trim();
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const pageSize = Math.min(200, Math.max(1, parseInt((req.query.pageSize as string) || "50", 10)));
    const skip = (page - 1) * pageSize;

    const where = search
      ? {
          OR: [
            { name: { contains: search } },
            { sku: { contains: search } }
          ]
        }
      : undefined;

    const [total, data] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: { category: true },
        orderBy: { createdAt: "desc" },
        take: pageSize,
        skip
      })
    ]);

    return ok(res, { data, total, page, pageSize });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch products: ${msg}`);
  }
});

// GET product by id
router.get("/:id", requirePermission("products:read"), async (req, res) => {
  try {
    const data = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        category: true
      }
    });
    if (!data) {
      return badRequest(res, "Product not found");
    }
    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch product: ${msg}`);
  }
});

// POST create product
router.post("/", requirePermission("products:create"), async (req, res) => {
  try {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid product payload");
    }

    const salePrice = Number(parsed.data.salePrice ?? parsed.data.defaultPrice ?? 0);
    if (salePrice <= 0) {
      return badRequest(res, "salePrice must be > 0");
    }

    const priceLevel2 = Number(parsed.data.priceLevel2 ?? salePrice);
    const priceLevel2Special = Number(parsed.data.priceLevel2Special ?? priceLevel2);
    const promoPrice = parsed.data.promoPrice ?? undefined;
    const supplierQuotedPrice = parsed.data.supplierQuotedPrice;
    const supplierQuoteNote = parsed.data.supplierQuoteNote?.trim() || undefined;
    const ingredients = parsed.data.ingredients?.trim() || undefined;
    const benefits = parsed.data.benefits?.trim() || undefined;
    const usageGuide = parsed.data.usageGuide?.trim() || undefined;
    const normalizedImageGallery = normalizeProductImageGallery(parsed.data.imageGallery, parsed.data.imageUrl);
    const defaultImageUrl = resolveDefaultImageUrl(normalizedImageGallery) || parsed.data.imageUrl;

    // Check if SKU already exists
    const existing = await prisma.product.findUnique({
      where: { sku: parsed.data.sku }
    });
    if (existing) {
      return badRequest(res, "SKU already exists");
    }

    // Verify category exists
    const category = await prisma.category.findUnique({
      where: { id: parsed.data.categoryId }
    });
    if (!category) {
      return badRequest(res, "Category not found");
    }

    const data = await prisma.product.create({
      data: {
        sku: parsed.data.sku,
        name: parsed.data.name,
        productType: parsed.data.productType,
        isTrackedInOverview: parsed.data.isTrackedInOverview,
        isVisibleOnCorporate: parsed.data.isVisibleOnCorporate ?? false,
        categoryId: parsed.data.categoryId,
        unit: parsed.data.unit,
        defaultPrice: salePrice,
        level2Price: priceLevel2,
        level2SpecialPrice: priceLevel2Special,
        promoPrice: promoPrice != null ? promoPrice : undefined,
        supplierQuotedPrice: supplierQuotedPrice != null ? supplierQuotedPrice : undefined,
        supplierQuoteNote,
        ingredients,
        benefits,
        usageGuide,
        rewardPoints: parsed.data.rewardPoints,
        giftPointsCost: parsed.data.giftPointsCost,
        costPrice: parsed.data.costPrice,
        imageUrl: defaultImageUrl,
        imageGallery: normalizedImageGallery.length ? normalizedImageGallery : Prisma.JsonNull
      },
      include: { category: true }
    });
    return created(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to create product: ${msg}`);
  }
});

// PUT update product
router.put("/:id", requirePermission("products:update"), async (req, res) => {
  try {
    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid product payload");
    }

    const existingProduct = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        sku: true,
        defaultPrice: true,
        level2Price: true,
        level2SpecialPrice: true,
        promoPrice: true,
        supplierQuotedPrice: true,
        supplierQuoteNote: true,
        ingredients: true,
        benefits: true,
        usageGuide: true,
        rewardPoints: true,
        giftPointsCost: true,
        costPrice: true,
        imageUrl: true,
        imageGallery: true,
        categoryId: true,
        productType: true,
        unit: true,
        isTrackedInOverview: true,
        isVisibleOnCorporate: true,
        name: true
      }
    });

    if (!existingProduct) {
      return badRequest(res, "Product not found");
    }

    const salePrice = Number(parsed.data.salePrice ?? parsed.data.defaultPrice ?? existingProduct.defaultPrice ?? 0);
    if (salePrice <= 0) {
      return badRequest(res, "salePrice must be > 0");
    }

    const priceLevel2 = Number(parsed.data.priceLevel2 ?? existingProduct.level2Price ?? salePrice);
    const priceLevel2Special = Number(parsed.data.priceLevel2Special ?? existingProduct.level2SpecialPrice ?? priceLevel2);
    const promoPrice = parsed.data.promoPrice ?? (existingProduct.promoPrice != null ? Number(existingProduct.promoPrice) : undefined);
    const supplierQuotedPrice = parsed.data.supplierQuotedPrice ?? (existingProduct.supplierQuotedPrice != null ? Number(existingProduct.supplierQuotedPrice) : undefined);
    const supplierQuoteNote = parsed.data.supplierQuoteNote != null
      ? (parsed.data.supplierQuoteNote.trim() || null)
      : (existingProduct.supplierQuoteNote ?? null);
    const ingredients = parsed.data.ingredients != null
      ? (parsed.data.ingredients.trim() || null)
      : (existingProduct.ingredients ?? null);
    const benefits = parsed.data.benefits != null
      ? (parsed.data.benefits.trim() || null)
      : (existingProduct.benefits ?? null);
    const usageGuide = parsed.data.usageGuide != null
      ? (parsed.data.usageGuide.trim() || null)
      : (existingProduct.usageGuide ?? null);
    const existingImageGallery = normalizeProductImageGallery(existingProduct.imageGallery, existingProduct.imageUrl);
    const hasImagePayload = parsed.data.imageGallery !== undefined
      || (parsed.data.imageUrl !== undefined && parsed.data.imageUrl !== (existingProduct.imageUrl || undefined));
    const normalizedImageGallery = hasImagePayload
      ? normalizeProductImageGallery(parsed.data.imageGallery, parsed.data.imageUrl)
      : existingImageGallery;
    const removedImageUrls = hasImagePayload
      ? existingImageGallery
        .map((item) => item.url)
        .filter((url) => !normalizedImageGallery.some((nextItem) => nextItem.url === url))
      : [];
    const defaultImageUrl = resolveDefaultImageUrl(normalizedImageGallery)
      || (hasImagePayload ? parsed.data.imageUrl : (existingProduct.imageUrl || undefined));

    if (parsed.data.sku !== existingProduct.sku) {
      const duplicateSku = await prisma.product.findUnique({
        where: { sku: parsed.data.sku },
        select: { id: true }
      });
      if (duplicateSku && duplicateSku.id !== req.params.id) {
        return badRequest(res, "SKU already exists");
      }
    }

    // Verify category exists
    const category = await prisma.category.findUnique({
      where: { id: parsed.data.categoryId }
    });
    if (!category) {
      return badRequest(res, "Category not found");
    }

    const data = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        sku: parsed.data.sku,
        name: parsed.data.name,
        productType: parsed.data.productType,
        isTrackedInOverview: parsed.data.isTrackedInOverview,
        isVisibleOnCorporate: parsed.data.isVisibleOnCorporate ?? existingProduct.isVisibleOnCorporate,
        categoryId: parsed.data.categoryId,
        unit: parsed.data.unit,
        defaultPrice: salePrice,
        level2Price: priceLevel2,
        level2SpecialPrice: priceLevel2Special,
        promoPrice: promoPrice != null ? promoPrice : null,
        supplierQuotedPrice: supplierQuotedPrice != null ? supplierQuotedPrice : null,
        supplierQuoteNote,
        ingredients,
        benefits,
        usageGuide,
        rewardPoints: parsed.data.rewardPoints,
        giftPointsCost: parsed.data.giftPointsCost,
        costPrice: parsed.data.costPrice,
        imageUrl: defaultImageUrl ?? null,
        imageGallery: normalizedImageGallery.length ? normalizedImageGallery : Prisma.JsonNull,
        isActive: parsed.data.isActive
      },
      include: { category: true }
    });

    if (removedImageUrls.length) {
      await cleanupRemovedProductImages(removedImageUrls, req.params.id);
    }

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update product: ${msg}`);
  }
});

router.put("/:id/overview-tracking", requirePermission("products:update"), async (req, res) => {
  try {
    const parsed = updateProductOverviewTrackingSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid tracking payload");
    }

    const data = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        isTrackedInOverview: parsed.data.isTrackedInOverview
      },
      include: { category: true }
    });

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update overview tracking: ${msg}`);
  }
});

router.put("/:id/active-status", requirePermission("products:update"), async (req, res) => {
  try {
    const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid active status payload");
    }

    const data = await prisma.product.update({
      where: { id: req.params.id },
      data: { isActive: parsed.data.isActive },
      include: { category: true }
    });

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update active status: ${msg}`);
  }
});

router.put("/:id/corporate-visibility", requirePermission("products:update"), async (req, res) => {
  try {
    const parsed = updateProductCorporateVisibilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid corporate visibility payload");
    }

    const data = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        isVisibleOnCorporate: parsed.data.isVisibleOnCorporate
      },
      include: { category: true }
    });

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update corporate visibility: ${msg}`);
  }
});

router.put("/:id/consultation", requirePermission("products:update"), async (req, res) => {
  try {
    const parsed = updateProductConsultationSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid consultation payload");
    }

    const existingProduct = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: { id: true }
    });
    if (!existingProduct) {
      return badRequest(res, "Product not found");
    }

    const data = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ingredients: parsed.data.ingredients == null ? null : (parsed.data.ingredients.trim() || null),
        benefits: parsed.data.benefits == null ? null : (parsed.data.benefits.trim() || null),
        usageGuide: parsed.data.usageGuide == null ? null : (parsed.data.usageGuide.trim() || null)
      },
      include: { category: true }
    });

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update consultation info: ${msg}`);
  }
});

// PUT update product stock + cost price
router.put("/:id/stock-cost", requirePermission("products:update"), async (req: AuthRequest, res) => {
  try {
    const parsed = updateProductStockSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid stock update payload");
    }

    const hasCostPrice = typeof parsed.data.costPrice === "number";
    const hasInventories = Array.isArray(parsed.data.inventories) && parsed.data.inventories.length > 0;
    if (!hasCostPrice && !hasInventories) {
      return badRequest(res, "costPrice or inventories is required");
    }

    const product = await prisma.product.findUnique({
      where: { id: req.params.id }
    });

    if (!product) {
      return badRequest(res, "Product not found");
    }

    const trackInventory = isStockTrackedProduct(product.productType);
    if (!trackInventory && hasInventories) {
      return badRequest(res, "Service product does not support inventory update");
    }

    const inventoryRows = parsed.data.inventories ?? [];
    const uniqueStoreIds = [...new Set(inventoryRows.map((item) => item.storeId))];
    if (uniqueStoreIds.length !== inventoryRows.length) {
      return badRequest(res, "Duplicated storeId in inventories payload");
    }

    if (hasInventories) {
      const userId = req.user?.sub;
      if (!userId) {
        return forbidden(res, "Missing authenticated user");
      }
      const assignedStoreIds = await resolveAssignedStoreIdsForUser(userId, new Date(), req.user?.roles);
      if (!assignedStoreIds.length) {
        return forbidden(res, "User has no active store assignment");
      }
      const unauthorizedStoreId = uniqueStoreIds.find((storeId) => !assignedStoreIds.includes(storeId));
      if (unauthorizedStoreId) {
        return forbidden(res, "No store assignment for one or more stores in inventories payload");
      }
    }

    if (trackInventory && uniqueStoreIds.length > 0) {
      const storeCount = await prisma.store.count({
        where: { id: { in: uniqueStoreIds } }
      });
      if (storeCount !== uniqueStoreIds.length) {
        return badRequest(res, "One or more stores are invalid");
      }
    }

    const data = await prisma.$transaction(async (tx) => {
      if (hasCostPrice) {
        await tx.product.update({
          where: { id: product.id },
          data: { costPrice: parsed.data.costPrice }
        });
      }

      if (trackInventory && inventoryRows.length > 0) {
        const existingInventory = await tx.inventory.findMany({
          where: {
            productId: product.id,
            storeId: { in: uniqueStoreIds }
          }
        });

        const reservedByStore = new Map(existingInventory.map((row) => [row.storeId, row.reservedQuantity]));
        for (const row of inventoryRows) {
          const reserved = Number(reservedByStore.get(row.storeId) || 0);
          if (row.quantity < reserved) {
            return null;
          }
        }

        for (const row of inventoryRows) {
          await tx.inventory.upsert({
            where: {
              productId_storeId: {
                productId: product.id,
                storeId: row.storeId
              }
            },
            update: {
              quantity: row.quantity
            },
            create: {
              productId: product.id,
              storeId: row.storeId,
              quantity: row.quantity,
              reservedQuantity: 0
            }
          });
        }
      }

      return tx.product.findUnique({
        where: { id: product.id },
        include: { category: true }
      });
    });

    if (!data) {
      return badRequest(res, "Quantity cannot be lower than reserved quantity");
    }

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update stock/cost: ${msg}`);
  }
});

// DELETE product
router.delete("/:id", requirePermission("products:delete"), async (req, res) => {
  try {
    // Check if product has inventory or orders
    const inventory = await prisma.inventory.count({
      where: { productId: req.params.id }
    });
    const orderItems = await prisma.salesOrderItem.count({
      where: { productId: req.params.id }
    });

    if (inventory > 0 || orderItems > 0) {
      return badRequest(res, "Cannot delete product with existing inventory or orders");
    }

    await prisma.product.delete({
      where: { id: req.params.id }
    });

    return ok(res, { message: "Product deleted" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to delete product: ${msg}`);
  }
});

// GET inventory by store
router.get("/inventory/:storeId", requirePermission("products:inventory:read"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return forbidden(res, "Missing authenticated user");
    }

    const assignedStoreIds = await resolveAssignedStoreIdsForUser(userId, new Date(), req.user?.roles);
    if (!assignedStoreIds.includes(req.params.storeId)) {
      return forbidden(res, "No store assignment for this store");
    }

    const data = await prisma.inventory.findMany({
      where: { storeId: req.params.storeId },
      include: { product: true },
      orderBy: { updatedAt: "desc" }
    });

    const mapped = data.filter((item) => isStockTrackedProduct(item.product.productType)).map((item) => ({
      ...item,
      availableQuantity: item.quantity - item.reservedQuantity,
      forecastDays: item.quantity > 0 ? Math.floor(item.quantity / 3) : 0
    }));

    return ok(res, mapped);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch inventory: ${msg}`);
  }
});

router.get("/price-list/:customerId", requirePermission("products:read"), async (req, res) => {
  try {
    const storeId = req.query.storeId as string | undefined;

    const rows = await prisma.customerPriceList.findMany({
      where: {
        customerId: req.params.customerId,
        status: "active",
        ...(storeId
          ? {
              OR: [
                { storeId },
                { storeId: null }
              ]
            }
          : {})
      },
      include: {
        product: {
          select: { id: true, name: true, sku: true, unit: true, defaultPrice: true }
        }
      },
      orderBy: [
        { storeId: "desc" },
        { updatedAt: "desc" }
      ]
    });

    const seen = new Set<string>();
    const data = rows.filter((row) => {
      if (seen.has(row.productId)) {
        return false;
      }
      seen.add(row.productId);
      return true;
    }).map((row) => ({
      id: row.id,
      customerId: row.customerId,
      productId: row.productId,
      price: Number(row.price),
      storeId: row.storeId,
      updatedAt: row.updatedAt,
      product: {
        ...row.product,
        defaultPrice: Number(row.product.defaultPrice)
      }
    }));

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch customer price list: ${msg}`);
  }
});

// PUT update customer price list
router.put("/price-list/:customerId/:productId", requirePermission("products:price-list:update"), async (req: AuthRequest, res) => {
  try {
    const payload = z.object({
      price: z.number().positive(),
      createdBy: z.string().optional(),
      storeId: z.string().optional()
    }).safeParse(req.body);

    if (!payload.success) {
      return badRequest(res, "Invalid payload");
    }

    const createdBy = payload.data.createdBy || req.user?.sub || "system";

    const existing = await prisma.customerPriceList.findUnique({
      where: {
        customerId_productId_status: {
          customerId: req.params.customerId,
          productId: req.params.productId,
          status: "active"
        }
      }
    });

    let data;
    if (existing) {
      data = await prisma.customerPriceList.update({
        where: { id: existing.id },
        data: {
          price: payload.data.price,
          updatedAt: new Date()
        }
      });
    } else {
      data = await prisma.customerPriceList.create({
        data: {
          customerId: req.params.customerId,
          productId: req.params.productId,
          status: "active",
          price: payload.data.price,
          createdBy,
          storeId: payload.data.storeId
        }
      });
    }

    return ok(res, data, "Price list updated");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update price list: ${msg}`);
  }
});

router.delete("/price-list/:customerId/:productId", requirePermission("products:price-list:update"), async (req, res) => {
  try {
    const existing = await prisma.customerPriceList.findUnique({
      where: {
        customerId_productId_status: {
          customerId: req.params.customerId,
          productId: req.params.productId,
          status: "active"
        }
      }
    });

    if (!existing) {
      return badRequest(res, "Price list row not found");
    }

    await prisma.customerPriceList.delete({
      where: { id: existing.id }
    });

    return ok(res, { id: existing.id }, "Price list row deleted");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to delete price list row: ${msg}`);
  }
});

// GET product analytics: sales trend + inventory by store
router.get("/:id/analytics", requirePermission("products:read"), async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { category: true }
    });
    if (!product) return badRequest(res, "Product not found");

    const [orderItems, returnItems, inventory] = await Promise.all([
      prisma.salesOrderItem.findMany({
        where: { productId: req.params.id },
        include: {
          order: { select: { createdAt: true, status: true, store: { select: { name: true } } } }
        },
        orderBy: { order: { createdAt: "asc" } }
      }),
      prisma.salesOrderReturnItem.findMany({
        where: { orderItem: { productId: req.params.id } },
        include: {
          saleReturn: { select: { createdAt: true } },
          orderItem: { select: { unitCost: true } }
        }
      }),
      prisma.inventory.findMany({
        where: { productId: req.params.id },
        include: { store: { select: { id: true, name: true } } }
      })
    ]);

    const trackInventory = isStockTrackedProduct(product.productType);

    const toMonthKey = (date: Date) => date.toISOString().slice(0, 7);
    const getQuarter = (date: Date) => Math.floor(date.getUTCMonth() / 3) + 1;
    const toQuarterKey = (date: Date) => `${date.getUTCFullYear()}-Q${getQuarter(date)}`;
    const toYearKey = (date: Date) => String(date.getUTCFullYear());

    const now = new Date();
    const currentMonthKey = toMonthKey(now);

    const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const previousMonthKey = toMonthKey(prevMonthDate);

    const currentQuarterKey = toQuarterKey(now);
    const currentQuarter = getQuarter(now);
    const previousQuarterDate = currentQuarter === 1
      ? new Date(Date.UTC(now.getUTCFullYear() - 1, 9, 1))
      : new Date(Date.UTC(now.getUTCFullYear(), (currentQuarter - 2) * 3, 1));
    const previousQuarterKey = toQuarterKey(previousQuarterDate);

    const currentYearKey = toYearKey(now);
    const previousYearKey = String(now.getUTCFullYear() - 1);

    const periodBuckets: Record<string, Record<string, { revenue: number; cogs: number; quantity: number }>> = {
      month: {},
      quarter: {},
      year: {}
    };

    // Monthly sales trend
    const monthGroups: Record<string, { revenue: number; cogs: number; quantity: number }> = {};
    for (const item of orderItems) {
      if (["CANCELLED", "REFUNDED"].includes(item.order.status)) continue;
      const orderDate = new Date(item.order.createdAt);
      const key = toMonthKey(orderDate);
      if (!monthGroups[key]) monthGroups[key] = { revenue: 0, cogs: 0, quantity: 0 };

      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice || 0);
      const itemUnitCostRaw = Number(item.unitCost || 0);
      const unitCost = itemUnitCostRaw > 0 ? itemUnitCostRaw : Number(product.costPrice || 0);

      const revenue = quantity * unitPrice;
      const cogs = quantity * unitCost;

      monthGroups[key].revenue += revenue;
      monthGroups[key].cogs += cogs;
      monthGroups[key].quantity += quantity;

      const monthBucket = periodBuckets.month[key] || { revenue: 0, cogs: 0, quantity: 0 };
      monthBucket.revenue += revenue;
      monthBucket.cogs += cogs;
      monthBucket.quantity += quantity;
      periodBuckets.month[key] = monthBucket;

      const quarterKey = toQuarterKey(orderDate);
      const quarterBucket = periodBuckets.quarter[quarterKey] || { revenue: 0, cogs: 0, quantity: 0 };
      quarterBucket.revenue += revenue;
      quarterBucket.cogs += cogs;
      quarterBucket.quantity += quantity;
      periodBuckets.quarter[quarterKey] = quarterBucket;

      const yearKey = toYearKey(orderDate);
      const yearBucket = periodBuckets.year[yearKey] || { revenue: 0, cogs: 0, quantity: 0 };
      yearBucket.revenue += revenue;
      yearBucket.cogs += cogs;
      yearBucket.quantity += quantity;
      periodBuckets.year[yearKey] = yearBucket;
    }

    // Subtract returned items (use return createdAt for period bucketing)
    for (const ret of returnItems) {
      const returnDate = new Date(ret.saleReturn.createdAt);
      const monthKey = toMonthKey(returnDate);
      const quarterKey = toQuarterKey(returnDate);
      const yearKey = toYearKey(returnDate);

      const retQty = Number(ret.quantity || 0);
      const retRevenue = Number(ret.amount || 0);
      const unitCostRaw = Number(ret.orderItem?.unitCost || 0);
      const retUnitCost = unitCostRaw > 0 ? unitCostRaw : Number(product.costPrice || 0);
      const retCogs = retQty * retUnitCost;

      if (monthGroups[monthKey]) {
        monthGroups[monthKey].revenue -= retRevenue;
        monthGroups[monthKey].cogs -= retCogs;
        monthGroups[monthKey].quantity -= retQty;
      }
      if (periodBuckets.month[monthKey]) {
        periodBuckets.month[monthKey].revenue -= retRevenue;
        periodBuckets.month[monthKey].cogs -= retCogs;
        periodBuckets.month[monthKey].quantity -= retQty;
      }
      if (periodBuckets.quarter[quarterKey]) {
        periodBuckets.quarter[quarterKey].revenue -= retRevenue;
        periodBuckets.quarter[quarterKey].cogs -= retCogs;
        periodBuckets.quarter[quarterKey].quantity -= retQty;
      }
      if (periodBuckets.year[yearKey]) {
        periodBuckets.year[yearKey].revenue -= retRevenue;
        periodBuckets.year[yearKey].cogs -= retCogs;
        periodBuckets.year[yearKey].quantity -= retQty;
      }
    }

    const calcPeriodMetric = (bucket: { revenue: number; cogs: number; quantity: number } | undefined) => {
      const quantity = Number(bucket?.quantity || 0);
      const revenue = Number(bucket?.revenue || 0);
      const cogs = Number(bucket?.cogs || 0);
      const avgSellPrice = quantity > 0 ? revenue / quantity : 0;
      const avgCostPrice = quantity > 0 ? cogs / quantity : 0;
      return {
        quantity,
        revenue: Math.round(revenue),
        profit: Math.round(revenue - cogs),
        avgSellPrice: Math.round(avgSellPrice),
        avgCostPrice: Math.round(avgCostPrice)
      };
    };

    const calcChangePct = (currentValue: number, previousValue: number) => {
      if (!previousValue) {
        return currentValue ? null : 0;
      }
      const raw = ((currentValue - previousValue) / previousValue) * 100;
      return Math.round(raw * 10) / 10;
    };

    const buildPeriodAnalysis = (label: string, currentKey: string, previousKey: string, bucketType: "month" | "quarter" | "year") => {
      const current = calcPeriodMetric(periodBuckets[bucketType][currentKey]);
      const previous = calcPeriodMetric(periodBuckets[bucketType][previousKey]);
      return {
        label,
        currentKey,
        previousKey,
        current,
        previous,
        delta: {
          avgSellPricePct: calcChangePct(current.avgSellPrice, previous.avgSellPrice),
          avgCostPricePct: calcChangePct(current.avgCostPrice, previous.avgCostPrice)
        }
      };
    };

    const priceAnalysis = {
      month: buildPeriodAnalysis("Tháng này", currentMonthKey, previousMonthKey, "month"),
      quarter: buildPeriodAnalysis("Quý này", currentQuarterKey, previousQuarterKey, "quarter"),
      year: buildPeriodAnalysis("Năm nay", currentYearKey, previousYearKey, "year")
    };

    const salesTrend = Object.entries(monthGroups)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, d]) => ({
        month,
        revenue: Math.round(d.revenue),
        cogs: Math.round(d.cogs),
        profit: Math.round(d.revenue - d.cogs),
        quantity: Math.max(0, d.quantity)
      }));

    const totalQtySold = salesTrend.reduce((s, x) => s + x.quantity, 0);
    const totalRevenue = salesTrend.reduce((s, x) => s + x.revenue, 0);
    const totalProfit = salesTrend.reduce((s, x) => s + x.profit, 0);

    // Inventory by store + simple forecast (avg monthly sold)
    const recentMonths = salesTrend.slice(-3);
    const avgMonthly = recentMonths.length
      ? recentMonths.reduce((s, x) => s + x.quantity, 0) / recentMonths.length
      : 0;

    const inventoryByStore = trackInventory ? inventory.map((inv) => {
      const available = inv.quantity - inv.reservedQuantity;
      const forecastDays = avgMonthly > 0 ? Math.round((available / avgMonthly) * 30) : null;
      return {
        storeId: inv.storeId,
        storeName: inv.store.name,
        quantity: inv.quantity,
        reserved: inv.reservedQuantity,
        available,
        forecastDays
      };
    }) : [];

    const totalStock = trackInventory ? inventory.reduce((s, i) => s + i.quantity, 0) : 0;

    return ok(res, {
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        productType: product.productType,
        costPrice: Number(product.costPrice),
        salePrice: Number(product.defaultPrice),
        priceLevel2: Number(product.level2Price || 0),
        priceLevel2Special: Number(product.level2SpecialPrice || 0),
        promoPrice: product.promoPrice != null ? Number(product.promoPrice) : null,
        category: product.category?.name || null
      },
      summary: {
        totalQtySold,
        totalRevenue,
        totalProfit,
        totalStock,
        avgMonthlySold: Math.round(avgMonthly * 10) / 10
      },
      priceAnalysis,
      salesTrend,
      inventoryByStore
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get product analytics: ${msg}`);
  }
});

// GET inventory movement history by product for traceability
router.get("/:id/inventory-history", requirePermission("products:inventory:read"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return forbidden(res, "Missing authenticated user");
    }

    const assignedStoreIds = await resolveAssignedStoreIdsForUser(userId, new Date(), req.user?.roles);
    if (!assignedStoreIds.length) {
      return forbidden(res, "User has no active store assignment");
    }

    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: { id: true, sku: true, name: true, productType: true }
    });
    if (!product) {
      return badRequest(res, "Product not found");
    }

    if (!isStockTrackedProduct(product.productType)) {
      return ok(res, {
        product,
        movements: [],
        summary: { totalIn: 0, totalOut: 0, netChange: 0 }
      });
    }

    const [purchaseItems, saleItems, returnItems, giftRedemptions] = await Promise.all([
      prisma.purchaseOrderItem.findMany({
        where: { productId: req.params.id },
        include: {
          purchaseOrder: {
            select: {
              referenceId: true,
              createdAt: true,
              voidedAt: true,
              store: { select: { id: true, name: true } },
              supplier: { select: { id: true, name: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 100
      }),
      prisma.salesOrderItem.findMany({
        where: { productId: req.params.id },
        include: {
          order: {
            select: {
              orderNo: true,
              createdAt: true,
              status: true,
              store: { select: { id: true, name: true } },
              customer: { select: { id: true, name: true } }
            }
          }
        },
        orderBy: { order: { createdAt: "desc" } },
        take: 100
      }),
      prisma.salesOrderReturnItem.findMany({
        where: { orderItem: { productId: req.params.id }, saleReturn: { restock: true } },
        include: {
          orderItem: {
            include: {
              order: {
                select: {
                  orderNo: true,
                  createdAt: true,
                  store: { select: { id: true, name: true } },
                  customer: { select: { id: true, name: true } }
                }
              }
            }
          },
          saleReturn: {
            select: {
              id: true,
              createdAt: true,
              note: true
            }
          }
        },
        orderBy: { saleReturn: { createdAt: "desc" } },
        take: 100
      }),
      prisma.giftRedemption.findMany({
        where: { productId: req.params.id },
        include: {
          partner: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 100
      })
    ]);

    const giftStoreIds = Array.from(new Set(giftRedemptions.map((row) => row.storeId).filter(Boolean))) as string[];
    const giftStores = giftStoreIds.length
      ? await prisma.store.findMany({
          where: { id: { in: giftStoreIds } },
          select: { id: true, name: true }
        })
      : [];
    const giftStoreMap = new Map(giftStores.map((row) => [row.id, row.name]));

    const purchaseMovements = purchaseItems
      .filter((item) => !item.purchaseOrder.voidedAt)
      .map((item) => ({
        movementType: "IN",
        sourceType: "PURCHASE",
        sourceNo: item.purchaseOrder.referenceId,
        quantity: Number(item.quantity || 0),
        unitCost: Number(item.unitCost || 0),
        storeId: item.purchaseOrder.store?.id || null,
        storeName: item.purchaseOrder.store?.name || "Không xác định",
        actorName: item.purchaseOrder.supplier?.name || null,
        note: null,
        happenedAt: item.purchaseOrder.createdAt
      }));

    const saleMovements = saleItems
      .filter((item) => !["CANCELLED", "REFUNDED"].includes(item.order.status))
      .map((item) => ({
        movementType: "OUT",
        sourceType: "SALE",
        sourceNo: item.order.orderNo,
        quantity: Number(item.quantity || 0),
        unitCost: Number(item.unitCost || 0),
        storeId: item.order.store?.id || null,
        storeName: item.order.store?.name || "Không xác định",
        actorName: item.order.customer?.name || null,
        note: null,
        happenedAt: item.order.createdAt
      }));

    const returnMovements = returnItems.map((item) => ({
      movementType: "IN",
      sourceType: "RETURN",
      sourceNo: item.orderItem.order.orderNo,
      quantity: Number(item.quantity || 0),
      unitCost: Number(item.orderItem.unitCost || 0),
      storeId: item.orderItem.order.store?.id || null,
      storeName: item.orderItem.order.store?.name || "Không xác định",
      actorName: item.orderItem.order.customer?.name || null,
      note: item.saleReturn.note || null,
      happenedAt: item.saleReturn.createdAt
    }));

    const giftRedeemOutMovements = giftRedemptions
      .filter((row) => row.status === "ACTIVE")
      .map((row) => ({
        movementType: "OUT",
        sourceType: "GIFT_REDEEM",
        sourceNo: `TGQ-${row.id.slice(0, 8).toUpperCase()}`,
        quantity: Number(row.quantity || 0),
        unitCost: 0,
        storeId: row.storeId || null,
        storeName: row.storeId ? (giftStoreMap.get(row.storeId) || "Khong xac dinh") : "Khong xac dinh",
        actorName: row.partner?.name || null,
        note: row.note || "Tang qua khach hang",
        happenedAt: row.createdAt
      }));

    const giftRedeemCancelInMovements = giftRedemptions
      .filter((row) => row.status === "CANCELLED" && row.cancelledAt)
      .map((row) => ({
        movementType: "IN",
        sourceType: "GIFT_CANCEL",
        sourceNo: `TGQ-${row.id.slice(0, 8).toUpperCase()}`,
        quantity: Number(row.quantity || 0),
        unitCost: 0,
        storeId: row.storeId || null,
        storeName: row.storeId ? (giftStoreMap.get(row.storeId) || "Khong xac dinh") : "Khong xac dinh",
        actorName: row.partner?.name || null,
        note: row.note ? `Huy tang qua: ${row.note}` : "Huy tang qua",
        happenedAt: row.cancelledAt as Date
      }));

    const movements = [
      ...purchaseMovements,
      ...saleMovements,
      ...returnMovements,
      ...giftRedeemOutMovements,
      ...giftRedeemCancelInMovements
    ]
      .filter((row) => row.storeId && assignedStoreIds.includes(row.storeId))
      .sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime())
      .slice(0, 200);

    const totalIn = movements
      .filter((row) => row.movementType === "IN")
      .reduce((sum, row) => sum + row.quantity, 0);
    const totalOut = movements
      .filter((row) => row.movementType === "OUT")
      .reduce((sum, row) => sum + row.quantity, 0);

    return ok(res, {
      product,
      summary: {
        totalIn,
        totalOut,
        netChange: totalIn - totalOut
      },
      movements
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch inventory history: ${msg}`);
  }
});

// GET products overview: total, low stock alerts
router.get("/overview/stats", requirePermission("products:read"), async (_req, res) => {
  try {
    const [products, inventory] = await Promise.all([
      prisma.product.findMany({ select: { id: true, isActive: true, productType: true } }),
      prisma.inventory.findMany({ select: { quantity: true, reservedQuantity: true } })
    ]);

    const total = products.length;
    const active = products.filter((p) => p.isActive).length;
    const goods = products.filter((p) => p.productType === "GOODS").length;
    const services = products.filter((p) => p.productType === "SERVICE").length;
    const totalStock = inventory.reduce((s, i) => s + i.quantity, 0);
    const lowStockCount = inventory.filter((i) => i.quantity - i.reservedQuantity <= 5).length;

    return ok(res, { total, active, goods, services, totalStock, lowStockCount });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to get products overview: ${msg}`);
  }
});

// POST /bulk-import — upsert products from parsed CSV rows
const bulkImportRowSchema = z.object({
  sku: z.string().min(2),
  name: z.string().min(2),
  productType: productTypeSchema.default("GOODS"),
  isTrackedInOverview: z.boolean().default(true),
  categoryName: z.string().optional(),
  unit: z.string().min(1),
  salePrice: z.number().positive(),
  priceLevel2: z.number().positive().optional(),
  priceLevel2Special: z.number().positive().optional(),
  promoPrice: z.number().nonnegative().optional(),
  rewardPoints: z.number().int().min(0).default(0),
  supplierQuotedPrice: z.number().nonnegative().optional(),
  supplierQuoteNote: z.string().max(2000).optional(),
  ingredients: z.string().max(10000).optional(),
  benefits: z.string().max(10000).optional(),
  usageGuide: z.string().max(10000).optional(),
});

router.post("/bulk-import", requirePermission("products:bulk-import"), async (req, res) => {
  try {
    const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
    const dryRun = Boolean(!Array.isArray(req.body) && req.body?.dryRun);
    if (!Array.isArray(rows) || rows.length === 0) {
      return badRequest(res, "Expected non-empty array of rows");
    }
    if (rows.length > 500) {
      return badRequest(res, "Maximum 500 rows per import");
    }

    const categoryCache = new Map<string, string>();
    let defaultCategoryId: string | null = null;
    const results: Array<{ line: number; sku: string; status: string; message?: string }> = [];
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i++) {
      const lineNum = i + 1;
      const raw = rows[i];
      const parsed = bulkImportRowSchema.safeParse(raw);
      if (!parsed.success) {
        const msg = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
        results.push({ line: lineNum, sku: String(raw?.sku || ""), status: "error", message: msg });
        errors++;
        continue;
      }
      const data = parsed.data;

      // Resolve categoryId — blank name => use/create "Chưa phân loại"
      let categoryId: string;
      const catName = (data.categoryName || "").trim();
      if (!catName) {
        if (!defaultCategoryId) {
          const defaultCat = await prisma.category.findFirst({ where: { name: "Chưa phân loại" } });
          if (defaultCat) {
            defaultCategoryId = defaultCat.id;
          } else if (!dryRun) {
            const newCat = await prisma.category.create({ data: { name: "Chưa phân loại" } });
            defaultCategoryId = newCat.id;
          } else {
            defaultCategoryId = "__default_category_dry_run__";
          }
        }
        categoryId = defaultCategoryId!;
      } else if (categoryCache.has(catName)) {
        categoryId = categoryCache.get(catName)!;
      } else {
        const cat = await prisma.category.findFirst({ where: { name: catName } });
        if (!cat) {
          results.push({ line: lineNum, sku: data.sku, status: "error", message: `Không tìm thấy danh mục "${catName}"` });
          errors++;
          continue;
        }
        categoryCache.set(catName, cat.id);
        categoryId = cat.id;
      }

      const salePrice = data.salePrice;
      const priceLevel2 = data.priceLevel2 ?? salePrice;
      const priceLevel2Special = data.priceLevel2Special ?? priceLevel2;

      try {
        const existing = await prisma.product.findUnique({ where: { sku: data.sku } });
        if (existing) {
          if (!dryRun) {
            await prisma.product.update({
              where: { id: existing.id },
              data: {
                name: data.name,
                productType: data.productType,
                isTrackedInOverview: data.isTrackedInOverview,
                categoryId,
                unit: data.unit,
                defaultPrice: salePrice,
                level2Price: priceLevel2,
                level2SpecialPrice: priceLevel2Special,
                promoPrice: data.promoPrice ?? null,
                rewardPoints: data.rewardPoints,
                supplierQuotedPrice: data.supplierQuotedPrice ?? null,
                supplierQuoteNote: data.supplierQuoteNote?.trim() || null,
                ingredients: data.ingredients?.trim() || null,
                benefits: data.benefits?.trim() || null,
                usageGuide: data.usageGuide?.trim() || null,
              },
            });
          }
          results.push({ line: lineNum, sku: data.sku, status: "updated" });
          updated++;
        } else {
          if (!dryRun) {
            await prisma.product.create({
              data: {
                sku: data.sku,
                name: data.name,
                productType: data.productType,
                isTrackedInOverview: data.isTrackedInOverview,
                categoryId,
                unit: data.unit,
                defaultPrice: salePrice,
                level2Price: priceLevel2,
                level2SpecialPrice: priceLevel2Special,
                ...(data.promoPrice !== undefined && { promoPrice: data.promoPrice }),
                rewardPoints: data.rewardPoints,
                costPrice: 0,
                ...(data.supplierQuotedPrice !== undefined && { supplierQuotedPrice: data.supplierQuotedPrice }),
                ...(data.supplierQuoteNote?.trim() && { supplierQuoteNote: data.supplierQuoteNote.trim() }),
                ...(data.ingredients?.trim() && { ingredients: data.ingredients.trim() }),
                ...(data.benefits?.trim() && { benefits: data.benefits.trim() }),
                ...(data.usageGuide?.trim() && { usageGuide: data.usageGuide.trim() }),
                isActive: false,
              },
            });
          }
          results.push({ line: lineNum, sku: data.sku, status: "created" });
          created++;
        }
      } catch (rowErr) {
        const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
        results.push({ line: lineNum, sku: data.sku, status: "error", message: msg });
        errors++;
      }
    }

    return ok(res, { dryRun, summary: { total: rows.length, created, updated, errors }, results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Bulk import failed: ${msg}`);
  }
});

// POST upload product image
router.post("/:id/image", requirePermission("products:update"), (req: AuthRequest, res) => {
  uploadProductImage(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return badRequest(res, err.code === "LIMIT_FILE_SIZE" ? "File quá lớn, tối đa 5MB" : err.message);
    }
    if (err) {
      return badRequest(res, err instanceof Error ? err.message : "Upload thất bại");
    }
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return badRequest(res, "Không có file được gửi lên");
    }
    try {
      const product = await prisma.product.findUnique({ where: { id: req.params.id } });
      if (!product) {
        fs.unlink(file.path, () => {});
        return badRequest(res, "Không tìm thấy sản phẩm");
      }
      const uploadBaseUrl = resolveUploadBaseUrl(req);
      const imageUrl = `${uploadBaseUrl}/products/${file.filename}`;
      const makeDefault = String(req.query.makeDefault || "false").toLowerCase() === "true";
      const showOnCorporate = String(req.query.showOnCorporate || "false").toLowerCase() === "true";
      const existingImageGallery = normalizeProductImageGallery(product.imageGallery, product.imageUrl);
      const nextGallery = existingImageGallery.map((item) => ({
        ...item,
        isDefault: makeDefault ? false : item.isDefault
      }));
      nextGallery.push({
        url: imageUrl,
        isDefault: makeDefault || nextGallery.length === 0,
        showOnCorporate
      });
      const normalizedImageGallery = normalizeProductImageGallery(nextGallery, imageUrl);
      const updated = await prisma.product.update({
        where: { id: req.params.id },
        data: {
          imageUrl: resolveDefaultImageUrl(normalizedImageGallery) || imageUrl,
          imageGallery: normalizedImageGallery
        },
        select: { id: true, imageUrl: true, imageGallery: true }
      });
      return ok(res, updated);
    } catch (error) {
      fs.unlink(file.path, () => {});
      const msg = error instanceof Error ? error.message : String(error);
      return badRequest(res, `Lỗi lưu ảnh: ${msg}`);
    }
  });
});

export default router;
