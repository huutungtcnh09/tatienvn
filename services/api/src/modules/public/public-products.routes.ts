import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, ok } from "../../utils/http.js";
import { publicReadLimiter, consultationLimiter } from "../../middleware/rate-limit.js";

const router = Router();

const createConsultationSchema = z.object({
  productId: z.string().trim().min(1),
  productName: z.string().trim().max(191).optional(),
  fullName: z.string().trim().min(2).max(191),
  phone: z.string().trim().min(6).max(32),
  email: z.string().trim().email().max(191).optional().or(z.literal("")),
  company: z.string().trim().max(191).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
  sourcePath: z.string().trim().max(300).optional().or(z.literal(""))
});

function toSlug(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sanitizeProduct(product: {
  id: string;
  sku: string;
  name: string;
  unit: string;
  imageUrl: string | null;
  imageGallery: unknown;
  ingredients: string | null;
  benefits: string | null;
  usageGuide: string | null;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; name: string } | null;
}) {
  const rawGallery = Array.isArray(product.imageGallery) ? product.imageGallery : [];
  const imageGallery = rawGallery
    .map((item) => ({
      url: String((item as { url?: string })?.url || "").trim(),
      isDefault: Boolean((item as { isDefault?: boolean })?.isDefault),
      showOnCorporate: Boolean((item as { showOnCorporate?: boolean })?.showOnCorporate)
    }))
    .filter((item) => Boolean(item.url));
  const defaultImage = imageGallery.find((item) => item.isDefault)?.url
    || imageGallery[0]?.url
    || product.imageUrl;
  const corporateImages = imageGallery.filter((item) => item.showOnCorporate);

  return {
    id: product.id,
    slug: `${toSlug(product.name) || "san-pham"}-${product.id}`,
    sku: product.sku,
    name: product.name,
    unit: product.unit,
    imageUrl: defaultImage,
    imageGallery,
    corporateImageUrls: (corporateImages.length ? corporateImages : imageGallery).map((item) => item.url),
    ingredients: product.ingredients,
    benefits: product.benefits,
    usageGuide: product.usageGuide,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    category: product.category
  };
}

router.get("/", publicReadLimiter, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const categoryId = String(req.query.categoryId || "").trim();
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const pageSize = Math.min(60, Math.max(1, parseInt(String(req.query.pageSize || "24"), 10)));
    const skip = (page - 1) * pageSize;

    const where = {
      isActive: true,
      isVisibleOnCorporate: true,
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { sku: { contains: search } }
            ]
          }
        : {})
    };

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: [
          { updatedAt: "desc" },
          { createdAt: "desc" }
        ],
        skip,
        take: pageSize,
        include: {
          category: {
            select: {
              id: true,
              name: true
            }
          }
        }
      })
    ]);

    return ok(res, {
      data: products.map(sanitizeProduct),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    });
  } catch (_error) {
    return badRequest(res, "Không tải được danh sách sản phẩm");
  }
});

router.post("/consultations", consultationLimiter, async (req, res) => {
  try {
    const parsed = createConsultationSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return badRequest(res, "Dữ liệu tư vấn không hợp lệ");
    }

    const data = parsed.data;
    const product = await prisma.product.findFirst({
      where: {
        id: data.productId,
        isActive: true
      },
      select: {
        id: true,
        sku: true,
        name: true
      }
    });

    if (!product) {
      return badRequest(res, "Sản phẩm không tồn tại hoặc đã ngừng kinh doanh");
    }

    // Chống spam: cùng SĐT + cùng sản phẩm trong 24h chỉ được gửi 1 lần
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const duplicate = await prisma.corporateConsultation.findFirst({
      where: {
        phone: data.phone,
        productId: product.id,
        submittedAt: { gte: since24h }
      },
      select: { id: true }
    });
    if (duplicate) {
      return ok(res, { saved: false, duplicate: true }, "Yêu cầu tư vấn cho sản phẩm này đã được ghi nhận. Chúng tôi sẽ liên hệ bạn trong thời gian sớm nhất.");
    }

    await prisma.corporateConsultation.create({
      data: {
        productId: product.id,
        productName: product.name,
        fullName: data.fullName,
        phone: data.phone,
        email: data.email || null,
        company: data.company || null,
        address: data.address || null,
        note: data.note || null,
        sourcePath: data.sourcePath || null
      }
    });

    return ok(res, { saved: true }, "Đã ghi nhận yêu cầu tư vấn");
  } catch (_error) {
    return badRequest(res, "Không thể gửi yêu cầu tư vấn");
  }
});

router.get("/:id", publicReadLimiter, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      return badRequest(res, "Product id is required");
    }

    const product = await prisma.product.findFirst({
      where: {
        id,
        isActive: true,
        isVisibleOnCorporate: true
      },
      include: {
        category: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!product) {
      return badRequest(res, "Product not found");
    }

    return ok(res, sanitizeProduct(product));
  } catch (_error) {
    return badRequest(res, "Không tải được chi tiết sản phẩm");
  }
});

export default router;