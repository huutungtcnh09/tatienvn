import { Router } from "express";
import { prisma } from "../../prisma.js";
import { badRequest, ok } from "../../utils/http.js";

const router = Router();

// GET /api/public/articles — danh sách bài viết đã đăng (không cần auth)
router.get("/", async (req, res) => {
  const category = String(req.query.category || "").trim();
  const search = String(req.query.search || "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 12));

  const where: Record<string, unknown> = { status: "PUBLISHED" };
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { seoDesc: { contains: search } }
    ];
  }

  const [total, articles] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        slug: true,
        coverImage: true,
        category: true,
        seoDesc: true,
        publishedAt: true
      }
    })
  ]);

  return ok(res, { data: articles, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
});

// GET /api/public/articles/:slug — chi tiết bài viết công khai
router.get("/:slug", async (req, res) => {
  const slug = req.params.slug;
  if (!slug) return badRequest(res, "Slug không hợp lệ");

  const article = await prisma.article.findUnique({
    where: { slug },
    select: {
      id: true,
      title: true,
      slug: true,
      content: true,
      coverImage: true,
      category: true,
      seoDesc: true,
      publishedAt: true
    }
  });

  if (!article || article === null) {
    return res.status(404).json({ message: "Không tìm thấy bài viết" });
  }

  // Chỉ trả về bài đã published
  const fullArticle = await prisma.article.findUnique({ where: { slug } });
  if (!fullArticle || fullArticle.status !== "PUBLISHED") {
    return res.status(404).json({ message: "Không tìm thấy bài viết" });
  }

  return ok(res, article);
});

export default router;
