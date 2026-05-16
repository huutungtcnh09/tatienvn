import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";
import type { AuthRequest } from "../../middleware/auth.js";

const router = Router();

const assignmentSchema = z.object({
  userId: z.string(),
  roleType: z.enum(["STORE_MANAGER", "STORE_SUPERVISOR", "DEPUTY_MANAGER", "CASHIER", "WAREHOUSE_STAFF", "PURCHASER", "CUSTOMER_SERVICE", "CEO", "CHIEF_ACCOUNTANT"]),
  storeId: z.string(),
  effectiveFrom: z.coerce.date().optional().nullable(),
  effectiveTo: z.coerce.date().optional().nullable(),
  decisionNo: z.string().optional(),
  note: z.string().optional()
});

const closeAssignmentSchema = z.object({
  effectiveTo: z.coerce.date()
});

function hasOverlap(
  leftFrom: Date,
  leftTo: Date | null,
  rightFrom: Date,
  rightTo: Date | null
) {
  const leftEnd = leftTo ? leftTo.getTime() : Number.POSITIVE_INFINITY;
  const rightEnd = rightTo ? rightTo.getTime() : Number.POSITIVE_INFINITY;
  return leftFrom.getTime() < rightEnd && rightFrom.getTime() < leftEnd;
}

router.get("/", requirePermission("users:read"), async (req, res) => {
  const roleType = typeof req.query.roleType === "string" ? req.query.roleType : undefined;
  const storeId = typeof req.query.storeId === "string" ? req.query.storeId : undefined;

  const rows = await prisma.orgAssignmentHistory.findMany({
    where: {
      ...(roleType ? { roleType: roleType as any } : {}),
      ...(storeId ? { storeId } : {})
    },
    include: {
      user: { select: { id: true, fullName: true, email: true, isActive: true } },
      store: { select: { id: true, code: true, name: true } }
    },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }]
  });

  return ok(res, rows);
});

router.post("/", requirePermission("users:update"), async (req: AuthRequest, res) => {
  const parsed = assignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid org assignment payload");
  }

  const payload = parsed.data;
  
  // Auto-set timestamps if not provided
  const effectiveFrom = payload.effectiveFrom ?? new Date();
  const effectiveTo = payload.effectiveTo ?? null;
  
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    return badRequest(res, "effectiveTo must be greater than effectiveFrom");
  }

  const [user, store, existing] = await Promise.all([
    prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, isActive: true } }),
    prisma.store.findUnique({ where: { id: payload.storeId }, select: { id: true } }),
    prisma.orgAssignmentHistory.findMany({
      where: {
        roleType: payload.roleType,
        storeId: payload.storeId,
        userId: payload.userId
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true }
    })
  ]);

  if (!user || !user.isActive) {
    return badRequest(res, "User is invalid or inactive");
  }

  if (!store) {
    return badRequest(res, "Store not found");
  }

  const overlapped = existing.some((row) => hasOverlap(
    effectiveFrom,
    effectiveTo,
    row.effectiveFrom,
    row.effectiveTo
  ));
  if (overlapped) {
    return badRequest(res, "Assignment period overlaps existing records for this user and role in store");
  }

  const row = await prisma.orgAssignmentHistory.create({
    data: {
      userId: payload.userId,
      roleType: payload.roleType,
      scopeType: "STORE",
      storeId: payload.storeId,
      effectiveFrom: effectiveFrom,
      effectiveTo: effectiveTo,
      decisionNo: payload.decisionNo,
      note: payload.note,
      createdBy: req.user?.sub
    },
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      store: { select: { id: true, code: true, name: true } }
    }
  });

  return created(res, row, "Org assignment created");
});

router.patch("/:id/close", requirePermission("users:update"), async (req, res) => {
  const parsed = closeAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid close assignment payload");
  }

  const row = await prisma.orgAssignmentHistory.findUnique({
    where: { id: req.params.id },
    select: { id: true, effectiveFrom: true, effectiveTo: true }
  });

  if (!row) {
    return badRequest(res, "Assignment not found");
  }

  if (parsed.data.effectiveTo <= row.effectiveFrom) {
    return badRequest(res, "effectiveTo must be greater than effectiveFrom");
  }

  if (row.effectiveTo && parsed.data.effectiveTo > row.effectiveTo) {
    return badRequest(res, "effectiveTo cannot be greater than current effectiveTo");
  }

  const updated = await prisma.orgAssignmentHistory.update({
    where: { id: req.params.id },
    data: { effectiveTo: parsed.data.effectiveTo },
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      store: { select: { id: true, code: true, name: true } }
    }
  });

  return ok(res, updated, "Assignment closed");
});

export default router;
