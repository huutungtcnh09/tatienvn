import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { resolveAssignedStoreIdsForUser } from "../../security/store-assignment.js";

const router = Router();

const createStoreSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  isWarehouse: z.boolean().default(false)
});

const updateStoreSchema = createStoreSchema;

const assignStoreStaffSchema = z.object({
  userId: z.string().min(1),
  roleType: z.enum(["STORE_MANAGER", "STORE_SUPERVISOR", "DEPUTY_MANAGER", "CASHIER", "WAREHOUSE_STAFF", "PURCHASER", "CUSTOMER_SERVICE", "CEO", "CHIEF_ACCOUNTANT"]).optional(),
  effectiveFrom: z.coerce.date().optional(),
  decisionNo: z.string().optional(),
  note: z.string().optional()
});

const STORE_STAFF_ROLE_TYPES = ["STORE_MANAGER", "STORE_SUPERVISOR", "DEPUTY_MANAGER", "CASHIER", "WAREHOUSE_STAFF", "PURCHASER", "CUSTOMER_SERVICE", "CEO", "CHIEF_ACCOUNTANT"] as const;

function isActiveAtNow(effectiveFrom: Date, effectiveTo: Date | null, now: Date) {
  return effectiveFrom <= now && (!effectiveTo || effectiveTo > now);
}

function mapLegacyStaffAssignment(assignment: {
  id: string;
  userId: string;
  storeId: string | null;
  roleType: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  user: { id: string; fullName: string; email: string; roles: string; isActive: boolean };
}) {
  return {
    id: assignment.id,
    userId: assignment.userId,
    storeId: assignment.storeId,
    roleType: assignment.roleType,
    assignedAt: assignment.effectiveFrom,
    effectiveTo: assignment.effectiveTo,
    user: assignment.user
  };
}

// GET stores assigned to current user
router.get("/my-assigned", requirePermission("stores:read"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return badRequest(res, "Missing authenticated user");

    const now = new Date();
    const assignedIds = await resolveAssignedStoreIdsForUser(userId, now, req.user?.roles);

    const data = await prisma.store.findMany({
      where: { id: { in: assignedIds } },
      orderBy: { createdAt: "asc" }
    });

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch assigned stores: ${msg}`);
  }
});

// GET all stores
router.get("/", requirePermission("stores:read"), async (_req, res) => {
  try {
    const now = new Date();
    const data = await prisma.store.findMany({
      include: {
        orgAssignments: {
          where: {
            roleType: { in: [...STORE_STAFF_ROLE_TYPES] },
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }]
          },
          include: {
            user: {
              select: { id: true, fullName: true, email: true, roles: true, isActive: true }
            }
          },
          orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }]
        },
        _count: {
          select: { inventory: true, salesOrders: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const mapped = data.map((store) => {
      const { orgAssignments, ...rest } = store;
      const staffAssignments = orgAssignments
        .filter((row) => isActiveAtNow(row.effectiveFrom, row.effectiveTo, now))
        .map(mapLegacyStaffAssignment);

      return {
        ...rest,
        staffAssignments,
        _count: {
          ...rest._count,
          staffAssignments: staffAssignments.length
        }
      };
    });

    return ok(res, mapped);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch stores: ${msg}`);
  }
});

// GET store by id
router.get("/:id", requirePermission("stores:read"), async (req, res) => {
  try {
    const now = new Date();
    const data = await prisma.store.findUnique({
      where: { id: req.params.id },
      include: {
        orgAssignments: {
          where: {
            roleType: { in: [...STORE_STAFF_ROLE_TYPES] },
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }]
          },
          include: {
            user: {
              select: { id: true, fullName: true, email: true, roles: true, isActive: true }
            }
          },
          orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }]
        },
        inventory: {
          include: {
            product: {
              select: { id: true, sku: true, name: true }
            }
          }
        },
        _count: {
          select: { salesOrders: true, receipts: true }
        }
      }
    });
    if (!data) {
      return badRequest(res, "Store not found");
    }

    const { orgAssignments, ...rest } = data;
    const staffAssignments = orgAssignments
      .filter((row) => isActiveAtNow(row.effectiveFrom, row.effectiveTo, now))
      .map(mapLegacyStaffAssignment);

    return ok(res, {
      ...rest,
      staffAssignments,
      _count: {
        ...rest._count,
        staffAssignments: staffAssignments.length
      }
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch store: ${msg}`);
  }
});

// POST assign staff to store
router.post("/:id/staff", requirePermission("stores:update"), async (req, res) => {
  try {
    const parsed = assignStoreStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid staff assignment payload");
    }

    const [store, user] = await Promise.all([
      prisma.store.findUnique({ where: { id: req.params.id }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, isActive: true } })
    ]);

    if (!store) {
      return badRequest(res, "Store not found");
    }
    if (!user) {
      return badRequest(res, "User not found");
    }
    if (!user.isActive) {
      return badRequest(res, "Cannot assign inactive user");
    }

    const roleType = parsed.data.roleType ?? "STORE_MANAGER";
    const effectiveFrom = parsed.data.effectiveFrom ?? new Date();

    const overlapping = await prisma.orgAssignmentHistory.findFirst({
      where: {
        userId: parsed.data.userId,
        storeId: req.params.id,
        roleType,
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }]
      },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, roles: true, isActive: true }
        }
      }
    });

    if (overlapping && overlapping.effectiveFrom <= effectiveFrom) {
      return ok(res, mapLegacyStaffAssignment(overlapping), "Staff already assigned to store");
    }

    if (overlapping && overlapping.effectiveFrom > effectiveFrom) {
      return badRequest(res, "Assignment period overlaps existing records for this user and role in store");
    }

    const assignment = await prisma.orgAssignmentHistory.create({
      data: {
        userId: parsed.data.userId,
        roleType,
        scopeType: "STORE",
        storeId: req.params.id,
        effectiveFrom,
        effectiveTo: null,
        decisionNo: parsed.data.decisionNo,
        note: parsed.data.note
      },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, roles: true, isActive: true }
        }
      }
    });

    return ok(res, mapLegacyStaffAssignment(assignment), "Staff assigned to store");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to assign store staff: ${msg}`);
  }
});

// DELETE remove staff assignment from store
router.delete("/:id/staff/:userId", requirePermission("stores:update"), async (req, res) => {
  try {
    const now = new Date();
    const [closed, removedFuture] = await prisma.$transaction([
      prisma.orgAssignmentHistory.updateMany({
        where: {
          storeId: req.params.id,
          userId: req.params.userId,
          roleType: { in: [...STORE_STAFF_ROLE_TYPES] },
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }]
        },
        data: { effectiveTo: now }
      }),
      prisma.orgAssignmentHistory.deleteMany({
        where: {
          storeId: req.params.id,
          userId: req.params.userId,
          roleType: { in: [...STORE_STAFF_ROLE_TYPES] },
          effectiveFrom: { gt: now }
        }
      })
    ]);

    const totalRemoved = closed.count + removedFuture.count;
    if (!totalRemoved) {
      return badRequest(res, "Store staff assignment not found");
    }

    return ok(res, { removed: totalRemoved }, "Store staff assignment removed");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to remove store staff assignment: ${msg}`);
  }
});

// POST create store
router.post("/", requirePermission("stores:create"), async (req, res) => {
  try {
    const parsed = createStoreSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid store payload");
    }

    // Check if code already exists
    const existing = await prisma.store.findUnique({
      where: { code: parsed.data.code }
    });
    if (existing) {
      return badRequest(res, "Store code already exists");
    }

    const newStore = await prisma.store.create({
      data: parsed.data
    });

    return created(res, newStore);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to create store: ${msg}`);
  }
});

// PUT update store
router.put("/:id", requirePermission("stores:update"), async (req, res) => {
  try {
    const parsed = updateStoreSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid store payload");
    }

    // Check if new code already exists (excluding current store)
    if (parsed.data.code) {
      const existing = await prisma.store.findUnique({
        where: { code: parsed.data.code }
      });
      if (existing && existing.id !== req.params.id) {
        return badRequest(res, "Store code already exists");
      }
    }

    const updated = await prisma.store.update({
      where: { id: req.params.id },
      data: parsed.data
    });

    return ok(res, updated);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update store: ${msg}`);
  }
});

// DELETE store
router.delete("/:id", requirePermission("stores:delete"), async (req, res) => {
  try {
    // Check if store has inventory or orders
    const inventory = await prisma.inventory.count({
      where: { storeId: req.params.id }
    });
    const orders = await prisma.salesOrder.count({
      where: { storeId: req.params.id }
    });

    if (inventory > 0 || orders > 0) {
      return badRequest(res, "Cannot delete store with existing inventory or orders");
    }

    await prisma.store.delete({
      where: { id: req.params.id }
    });

    return ok(res, { message: "Store deleted" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to delete store: ${msg}`);
  }
});

export default router;
