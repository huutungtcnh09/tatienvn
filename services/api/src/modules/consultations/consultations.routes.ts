import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";

const router = Router();

const updateSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "QUOTED", "CLOSED", "SPAM"]).optional(),
  staffNote: z.string().trim().max(2000).optional(),
  assignedTo: z.string().trim().max(191).optional().nullable()
});

router.get("/", requirePermission("consultations:read"), async (req, res) => {
  try {
    const status = String(req.query.status || "").trim() || undefined;
    const search = String(req.query.search || "").trim();
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || "20"), 10)));
    const skip = (page - 1) * pageSize;

    const where = {
      ...(status ? { status: status as "NEW" | "CONTACTED" | "QUOTED" | "CLOSED" | "SPAM" } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search } },
              { phone: { contains: search } },
              { company: { contains: search } },
              { productName: { contains: search } }
            ]
          }
        : {})
    };

    const [total, items] = await Promise.all([
      prisma.corporateConsultation.count({ where }),
      prisma.corporateConsultation.findMany({
        where,
        orderBy: { submittedAt: "desc" },
        skip,
        take: pageSize
      })
    ]);

    return ok(res, {
      data: items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    });
  } catch (_err) {
    return badRequest(res, "Không tải được danh sách tư vấn");
  }
});

router.patch("/:id", requirePermission("consultations:write"), async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return badRequest(res, "ID không hợp lệ");

    const parsed = updateSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, "Dữ liệu không hợp lệ");

    const existing = await prisma.corporateConsultation.findUnique({ where: { id } });
    if (!existing) return badRequest(res, "Không tìm thấy yêu cầu tư vấn");

    const updated = await prisma.corporateConsultation.update({
      where: { id },
      data: {
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.staffNote !== undefined ? { staffNote: parsed.data.staffNote } : {}),
        ...(parsed.data.assignedTo !== undefined ? { assignedTo: parsed.data.assignedTo } : {})
      }
    });

    return ok(res, updated, "Cập nhật thành công");
  } catch (_err) {
    return badRequest(res, "Không cập nhật được");
  }
});

export default router;
