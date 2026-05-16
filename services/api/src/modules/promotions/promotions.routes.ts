import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";

const router = Router();

const promotionSchema = z.object({
  name: z.string().trim().min(1, "Tên chương trình là bắt buộc"),
  type: z.string().trim().min(1, "Loại chương trình là bắt buộc"),
  customerTier: z.enum(["ALL", "RETAIL", "LEVEL_2", "LEVEL_2_SPECIAL"]).optional(),
  triggerProductId: z.string().trim().min(1, "Sản phẩm điều kiện là bắt buộc"),
  triggerQty: z.coerce.number().int().min(1, "Số lượng điều kiện phải >= 1"),
  rewardProductId: z.string().trim().optional().nullable(),
  rewardQty: z.coerce.number().int().min(0, "Số lượng thưởng phải >= 0").optional().nullable(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isActive: z.boolean().optional()
});

function normalizePromotionPayload(payload: z.infer<typeof promotionSchema>) {
  return {
    name: payload.name,
    type: payload.type,
    customerTier: payload.customerTier || "ALL",
    triggerProductId: payload.triggerProductId,
    triggerQty: payload.triggerQty,
    rewardProductId: payload.rewardProductId?.trim() || null,
    rewardQty: payload.rewardQty ?? null,
    startDate: payload.startDate,
    endDate: payload.endDate,
    isActive: payload.isActive ?? true
  };
}

// GET /api/promotions — mặc định chỉ trả về chương trình đang active hôm nay
router.get("/", requirePermission("orders:read"), async (req, res) => {
  const all = ["1", "true", "yes"].includes(String(req.query.all || "").toLowerCase());
  const type = String(req.query.type || "").trim();
  const fromDateRaw = String(req.query.fromDate || "").trim();
  const toDateRaw = String(req.query.toDate || "").trim();
  const isActiveRaw = String(req.query.isActive || "").trim().toLowerCase();
  const now = new Date();

  const fromDate = fromDateRaw ? new Date(fromDateRaw) : null;
  const toDate = toDateRaw ? new Date(toDateRaw) : null;
  if (fromDate && Number.isNaN(fromDate.getTime())) {
    return badRequest(res, "fromDate không hợp lệ");
  }
  if (toDate && Number.isNaN(toDate.getTime())) {
    return badRequest(res, "toDate không hợp lệ");
  }

  let isActiveFilter: boolean | null = null;
  if (["true", "1", "yes"].includes(isActiveRaw)) isActiveFilter = true;
  if (["false", "0", "no"].includes(isActiveRaw)) isActiveFilter = false;

  const andClauses: Record<string, unknown>[] = [];

  if (!all) {
    andClauses.push({
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now }
    });
  }

  if (type) {
    andClauses.push({ type });
  }

  if (isActiveFilter !== null) {
    andClauses.push({ isActive: isActiveFilter });
  }

  if (fromDate) {
    andClauses.push({ endDate: { gte: fromDate } });
  }

  if (toDate) {
    andClauses.push({ startDate: { lte: toDate } });
  }

  const where = andClauses.length ? { AND: andClauses } : undefined;

  const promotions = await prisma.promotion.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
  return ok(res, promotions);
});

router.post("/", requirePermission("orders:update"), async (req, res) => {
  const parsed = promotionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || "Dữ liệu khuyến mại không hợp lệ");
  }

  const payload = normalizePromotionPayload(parsed.data);
  if (payload.endDate < payload.startDate) {
    return badRequest(res, "Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu");
  }

  const createdPromotion = await prisma.promotion.create({ data: payload });
  return created(res, createdPromotion, "Tạo chương trình khuyến mại thành công");
});

router.put("/:id", requirePermission("orders:update"), async (req, res) => {
  const { id } = req.params;
  const parsed = promotionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message || "Dữ liệu khuyến mại không hợp lệ");
  }

  const payload = normalizePromotionPayload(parsed.data);
  if (payload.endDate < payload.startDate) {
    return badRequest(res, "Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu");
  }

  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) {
    return badRequest(res, "Không tìm thấy chương trình khuyến mại");
  }

  const updatedPromotion = await prisma.promotion.update({
    where: { id },
    data: payload
  });

  return ok(res, updatedPromotion, "Cập nhật chương trình khuyến mại thành công");
});

router.delete("/:id", requirePermission("orders:update"), async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) {
    return badRequest(res, "Không tìm thấy chương trình khuyến mại");
  }

  const deactivated = await prisma.promotion.update({
    where: { id },
    data: { isActive: false }
  });
  return ok(res, deactivated, "Ngưng áp dụng chương trình khuyến mại thành công");
});

export default router;
