import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";
import type { AuthRequest } from "../../middleware/auth.js";

const router = Router();

const createPositionSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  roleType: z.enum(["STORE_MANAGER", "STORE_SUPERVISOR", "DEPUTY_MANAGER", "CASHIER", "WAREHOUSE_STAFF", "PURCHASER", "CUSTOMER_SERVICE", "CEO", "CHIEF_ACCOUNTANT"]),
  storeId: z.string().optional().nullable()
});

const assignPositionSchema = z.object({
  userId: z.string(),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().optional().nullable(),
  decisionNo: z.string().optional(),
  note: z.string().optional()
});

const closeAssignmentSchema = z.object({
  effectiveTo: z.coerce.date()
});

const executeHandoverSchema = z.object({
  fromUserId: z.string(),
  toUserId: z.string(),
  roleType: z.enum(["STORE_MANAGER", "STORE_SUPERVISOR", "DEPUTY_MANAGER", "CASHIER", "WAREHOUSE_STAFF", "PURCHASER", "CUSTOMER_SERVICE", "CEO", "CHIEF_ACCOUNTANT"]).default("STORE_MANAGER"),
  storeId: z.string().optional(),
  effectiveFrom: z.coerce.date().optional(),
  reason: z.string().optional(),
  onlyIfAssignedFromUser: z.boolean().optional().default(false)
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
  const isActive = req.query.isActive === "false" ? false : req.query.isActive === "true" ? true : undefined;

  const rows = await prisma.orgPosition.findMany({
    where: {
      ...(roleType ? { roleType: roleType as any } : {}),
      ...(storeId ? { storeId } : {}),
      ...(typeof isActive === "boolean" ? { isActive } : {})
    },
    include: {
      store: { select: { id: true, code: true, name: true } },
      assignments: {
        where: {
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }]
        },
        include: { user: { select: { id: true, fullName: true, email: true, isActive: true } } },
        orderBy: { effectiveFrom: "desc" },
        take: 1
      }
    },
    orderBy: [{ roleType: "asc" }, { createdAt: "desc" }]
  });

  return ok(res, rows);
});

router.post("/", requirePermission("users:update"), async (req, res) => {
  const parsed = createPositionSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid org position payload");
  }

  const payload = parsed.data;
  if (!payload.storeId) {
    return badRequest(res, "storeId is required");
  }

  const store = await prisma.store.findUnique({ where: { id: payload.storeId }, select: { id: true } });
  if (!store) {
    return badRequest(res, "Store not found");
  }

  const row = await prisma.orgPosition.create({
    data: {
      code: payload.code.trim(),
      name: payload.name.trim(),
      roleType: payload.roleType,
      scopeType: "STORE",
      storeId: payload.storeId,
      isActive: true
    },
    include: {
      store: { select: { id: true, code: true, name: true } }
    }
  });

  return created(res, row, "Org position created");
});

router.get("/:positionId/assignments", requirePermission("users:read"), async (req, res) => {
  const rows = await prisma.orgPositionAssignmentHistory.findMany({
    where: { positionId: req.params.positionId },
    include: {
      user: { select: { id: true, fullName: true, email: true, isActive: true } },
      position: { select: { id: true, code: true, name: true, roleType: true } }
    },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }]
  });

  return ok(res, rows);
});

router.post("/:positionId/assignments", requirePermission("users:update"), async (req: AuthRequest, res) => {
  const parsed = assignPositionSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid position assignment payload");
  }

  const payload = parsed.data;
  if (payload.effectiveTo && payload.effectiveTo <= payload.effectiveFrom) {
    return badRequest(res, "effectiveTo must be greater than effectiveFrom");
  }

  const [position, user, existing] = await Promise.all([
    prisma.orgPosition.findUnique({ where: { id: req.params.positionId }, select: { id: true, isActive: true } }),
    prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, isActive: true } }),
    prisma.orgPositionAssignmentHistory.findMany({
      where: { positionId: req.params.positionId },
      select: { id: true, effectiveFrom: true, effectiveTo: true }
    })
  ]);

  if (!position || !position.isActive) {
    return badRequest(res, "Position is invalid or inactive");
  }

  if (!user || !user.isActive) {
    return badRequest(res, "User is invalid or inactive");
  }

  const overlapped = existing.some((row) => hasOverlap(
    payload.effectiveFrom,
    payload.effectiveTo ?? null,
    row.effectiveFrom,
    row.effectiveTo
  ));
  if (overlapped) {
    return badRequest(res, "Assignment period overlaps existing records for this position");
  }

  const row = await prisma.orgPositionAssignmentHistory.create({
    data: {
      positionId: req.params.positionId,
      userId: payload.userId,
      effectiveFrom: payload.effectiveFrom,
      effectiveTo: payload.effectiveTo ?? null,
      decisionNo: payload.decisionNo,
      note: payload.note,
      createdBy: req.user?.sub
    },
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      position: { select: { id: true, code: true, name: true, roleType: true } }
    }
  });

  return created(res, row, "Position assignment created");
});

router.patch("/assignments/:id/close", requirePermission("users:update"), async (req, res) => {
  const parsed = closeAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid close assignment payload");
  }

  const row = await prisma.orgPositionAssignmentHistory.findUnique({
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

  const updated = await prisma.orgPositionAssignmentHistory.update({
    where: { id: req.params.id },
    data: { effectiveTo: parsed.data.effectiveTo },
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      position: { select: { id: true, code: true, name: true, roleType: true } }
    }
  });

  return ok(res, updated, "Position assignment closed");
});

router.get("/handover-logs", requirePermission("users:read"), async (req, res) => {
  const storeId = typeof req.query.storeId === "string" ? req.query.storeId : undefined;
  const roleType = typeof req.query.roleType === "string" ? req.query.roleType : undefined;

  const rows = await prisma.orgPositionHandoverLog.findMany({
    where: {
      ...(storeId || roleType
        ? {
            position: {
              ...(storeId ? { storeId } : {}),
              ...(roleType ? { roleType: roleType as any } : {})
            }
          }
        : {})
    },
    include: {
      partner: { select: { id: true, code: true, name: true } },
      position: { select: { id: true, code: true, name: true, roleType: true } },
      fromUser: { select: { id: true, fullName: true, email: true } },
      toUser: { select: { id: true, fullName: true, email: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  return ok(res, rows);
});

router.post("/handover/execute", requirePermission("users:update"), async (req: AuthRequest, res) => {
  const parsed = executeHandoverSchema.safeParse(req.body);
  if (!parsed.success) {
    return badRequest(res, "Invalid handover payload");
  }

  const payload = parsed.data;
  if (payload.fromUserId === payload.toUserId) {
    return badRequest(res, "fromUserId and toUserId must be different");
  }

  const handoverAt = payload.effectiveFrom || new Date();
  const [fromUser, toUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: payload.fromUserId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: payload.toUserId }, select: { id: true, isActive: true } })
  ]);

  if (!fromUser) {
    return badRequest(res, "fromUser not found");
  }
  if (!toUser || !toUser.isActive) {
    return badRequest(res, "toUser is invalid or inactive");
  }

  const activeAssignments = await prisma.orgPositionAssignmentHistory.findMany({
    where: {
      userId: payload.fromUserId,
      effectiveFrom: { lte: handoverAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: handoverAt } }],
      position: {
        roleType: payload.roleType,
        ...(payload.storeId ? { storeId: payload.storeId } : {})
      }
    },
    include: {
      position: { select: { id: true } }
    }
  });

  if (!activeAssignments.length) {
    return badRequest(res, "No active assignments found for handover scope");
  }

  const conflictedAssignments = await prisma.orgPositionAssignmentHistory.findMany({
    where: {
      positionId: { in: activeAssignments.map((row) => row.positionId) },
      effectiveFrom: { lte: handoverAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: handoverAt } }],
      userId: { not: payload.fromUserId }
    },
    select: { id: true, positionId: true, userId: true }
  });
  if (conflictedAssignments.length > 0) {
    return badRequest(res, "Cannot handover because some positions already have another active assignee");
  }

  const positionIds = Array.from(new Set(activeAssignments.map((row) => row.positionId)));

  const result = await prisma.$transaction(async (tx) => {
    for (const assignment of activeAssignments) {
      await tx.orgPositionAssignmentHistory.update({
        where: { id: assignment.id },
        data: { effectiveTo: handoverAt }
      });

      await tx.orgPositionAssignmentHistory.create({
        data: {
          positionId: assignment.positionId,
          userId: payload.toUserId,
          effectiveFrom: handoverAt,
          effectiveTo: assignment.effectiveTo,
          decisionNo: assignment.decisionNo || undefined,
          note: payload.reason || `Handover from ${payload.fromUserId} to ${payload.toUserId}`,
          createdBy: req.user?.sub
        }
      });
    }

    const partnersScopeWhere = {
      accountOwnerPositionId: { in: positionIds }
    };

    const partnersInScopeCount = await tx.partner.count({
      where: partnersScopeWhere
    });

    const partners = await tx.partner.findMany({
      where: {
        ...partnersScopeWhere
      },
      select: { id: true, accountOwnerPositionId: true }
    });

    for (const partner of partners) {
      await tx.orgPositionHandoverLog.create({
        data: {
          partnerId: partner.id,
          positionId: partner.accountOwnerPositionId!,
          fromUserId: payload.fromUserId,
          toUserId: payload.toUserId,
          reason: payload.reason,
          createdBy: req.user?.sub
        }
      });
    }

    return {
      positionsReassigned: positionIds.length,
      assignmentsClosed: activeAssignments.length,
      partnersReassigned: partners.length,
      partnersSkipped: payload.onlyIfAssignedFromUser ? partnersInScopeCount - partners.length : 0
    };
  });

  return ok(res, result, "Handover executed");
});

export default router;
