import { Router } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs";
import multer from "multer";
import { prisma } from "../../prisma.js";
import { badRequest, created, forbidden, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";
import type { AuthRequest } from "../../middleware/auth.js";

const router = Router();
const ARTICLE_UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads", "articles");
const UPLOAD_BASE_URL = (process.env.UPLOAD_BASE_URL ?? "").replace(/\/$/, "");

fs.mkdirSync(ARTICLE_UPLOAD_DIR, { recursive: true });

const articleCoverStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ARTICLE_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const uploadArticleCover = multer({
  storage: articleCoverStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Chỉ chấp nhận file ảnh JPEG, PNG, WebP hoặc GIF"));
    }
  }
}).single("image");

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

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

const articleSchema = z.object({
  title: z.string().trim().min(1, "Tiêu đề là bắt buộc").max(255),
  slug: z.string().trim().max(100).optional(),
  content: z.string().default(""),
  coverImage: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(50).default("news"),
  status: z.enum(["DRAFT", "PUBLISHED", "HIDDEN"]).default("DRAFT"),
  seoDesc: z.string().trim().max(300).nullable().optional(),
  publishedAt: z.coerce.date().nullable().optional()
});

// GET /api/articles — danh sách bài viết (có auth)
router.get("/", requirePermission("articles:read"), async (req, res) => {
  const status = String(req.query.status || "").trim();
  const category = String(req.query.category || "").trim();
  const search = String(req.query.search || "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

  const where: Record<string, unknown> = {};
  if (status && ["DRAFT", "PUBLISHED", "HIDDEN"].includes(status)) {
    where.status = status;
  }
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { content: { contains: search } }
    ];
  }

  const [total, articles] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        slug: true,
        coverImage: true,
        category: true,
        status: true,
        seoDesc: true,
        authorId: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true
      }
    })
  ]);

  return ok(res, { data: articles, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
});

// POST /api/articles/upload-cover — upload ảnh bìa bài viết
router.post("/upload-cover", requirePermission("articles:write"), (req: AuthRequest, res) => {
  uploadArticleCover(req, res, async (err) => {
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

    const uploadBaseUrl = resolveUploadBaseUrl(req);
    const imageUrl = `${uploadBaseUrl}/articles/${file.filename}`;
    return ok(res, { imageUrl }, "Tải ảnh bìa thành công");
  });
});

// GET /api/articles/:id — chi tiết bài viết (có auth)
router.get("/:id", requirePermission("articles:read"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, "ID không hợp lệ");

  const article = await prisma.article.findUnique({ where: { id } });
  if (!article) return res.status(404).json({ message: "Không tìm thấy bài viết" });

  return ok(res, article);
});

// POST /api/articles — tạo bài viết
router.post("/", requirePermission("articles:write"), async (req: AuthRequest, res) => {
  const parsed = articleSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.errors.map(e => e.message).join("; "));

  const data = parsed.data;
  const rawSlug = data.slug || toSlug(data.title);

  // Đảm bảo slug unique
  let slug = rawSlug;
  const existing = await prisma.article.findUnique({ where: { slug } });
  if (existing) {
    slug = `${rawSlug}-${Date.now()}`;
  }

  const publishedAt = data.status === "PUBLISHED" && !data.publishedAt ? new Date() : (data.publishedAt ?? null);

  const article = await prisma.article.create({
    data: {
      title: data.title,
      slug,
      content: data.content,
      coverImage: data.coverImage ?? null,
      category: data.category,
      status: data.status,
      seoDesc: data.seoDesc ?? null,
      authorId: req.user?.sub ?? null,
      publishedAt
    }
  });

  return created(res, article, "Tạo bài viết thành công");
});

// PUT /api/articles/:id — cập nhật bài viết
router.put("/:id", requirePermission("articles:write"), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, "ID không hợp lệ");

  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Không tìm thấy bài viết" });

  const parsed = articleSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.errors.map(e => e.message).join("; "));

  const data = parsed.data;

  // Nếu slug thay đổi, kiểm tra unique
  let slug = data.slug || existing.slug;
  if (slug !== existing.slug) {
    const conflict = await prisma.article.findUnique({ where: { slug } });
    if (conflict) slug = `${slug}-${Date.now()}`;
  }

  // Tự set publishedAt khi chuyển sang PUBLISHED lần đầu
  let publishedAt = data.publishedAt ?? existing.publishedAt;
  if (data.status === "PUBLISHED" && !existing.publishedAt && !data.publishedAt) {
    publishedAt = new Date();
  }

  const updated = await prisma.article.update({
    where: { id },
    data: {
      title: data.title,
      slug,
      content: data.content,
      coverImage: data.coverImage ?? null,
      category: data.category,
      status: data.status,
      seoDesc: data.seoDesc ?? null,
      publishedAt
    }
  });

  return ok(res, updated, "Cập nhật bài viết thành công");
});

// PATCH /api/articles/:id/status — đổi trạng thái nhanh
router.patch("/:id/status", requirePermission("articles:write"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, "ID không hợp lệ");

  const { status } = req.body;
  if (!["DRAFT", "PUBLISHED", "HIDDEN"].includes(status)) {
    return badRequest(res, "Trạng thái không hợp lệ");
  }

  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Không tìm thấy bài viết" });

  const publishedAt = status === "PUBLISHED" && !existing.publishedAt ? new Date() : existing.publishedAt;

  const updated = await prisma.article.update({
    where: { id },
    data: { status, publishedAt }
  });

  return ok(res, updated, "Cập nhật trạng thái thành công");
});

// DELETE /api/articles/:id
router.delete("/:id", requirePermission("articles:write"), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, "ID không hợp lệ");

  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Không tìm thấy bài viết" });

  await prisma.article.delete({ where: { id } });
  return ok(res, null, "Xóa bài viết thành công");
});

export default router;
