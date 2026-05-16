import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";

const router = Router();

const createBusinessAreaSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(2),
  description: z.string().optional(),
  parentId: z.string().optional(),
  displayOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true)
});

const updateBusinessAreaSchema = createBusinessAreaSchema.partial();

function getDateRangeByPreset(timePreset: string) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (timePreset === "today") {
    return { dateFrom: todayStart, dateTo: todayEnd };
  }

  if (timePreset === "this-month") {
    return {
      dateFrom: new Date(now.getFullYear(), now.getMonth(), 1),
      dateTo: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    };
  }

  if (timePreset === "this-quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return {
      dateFrom: new Date(now.getFullYear(), quarterStartMonth, 1),
      dateTo: new Date(now.getFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999)
    };
  }

  if (timePreset === "this-year") {
    return {
      dateFrom: new Date(now.getFullYear(), 0, 1),
      dateTo: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
    };
  }

  if (timePreset === "last-year") {
    return {
      dateFrom: new Date(now.getFullYear() - 1, 0, 1),
      dateTo: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999)
    };
  }

  return {
    dateFrom: new Date(now.getFullYear(), now.getMonth(), 1),
    dateTo: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  };
}

// GET all business areas with hierarchy
router.get("/", requirePermission("business-areas:read"), async (_req, res) => {
  try {
    const data = await prisma.businessArea.findMany({
      include: {
        children: {
          orderBy: { displayOrder: "asc" }
        },
        _count: {
          select: { partners: true }
        }
      },
      where: { parentId: null },
      orderBy: { displayOrder: "asc" }
    });
    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch business areas: ${msg}`);
  }
});

router.get("/dashboard/overview", requirePermission("business-areas:read"), async (req, res) => {
  try {
    const timePresetRaw = String(req.query.timePreset || "this-month").toLowerCase();
    const timePreset = ["today", "this-month", "this-quarter", "this-year", "last-year"].includes(timePresetRaw)
      ? timePresetRaw
      : "this-month";

    const { dateFrom, dateTo } = getDateRangeByPreset(timePreset);

    const UNASSIGNED_ID = "__unassigned__";

    const [allAreas, allPartners, periodPartners, periodOrders] = await Promise.all([
      prisma.businessArea.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          parentId: true,
          isActive: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [{ parentId: "asc" }, { displayOrder: "asc" }, { code: "asc" }]
      }),
      prisma.partner.findMany({
        select: { businessAreaId: true, isCustomer: true, isSupplier: true }
      }),
      prisma.partner.findMany({
        where: {
          createdAt: { gte: dateFrom, lte: dateTo }
        },
        select: { businessAreaId: true, isCustomer: true, isSupplier: true }
      }),
      prisma.salesOrder.findMany({
        where: {
          createdAt: { gte: dateFrom, lte: dateTo },
          status: { in: ["DELIVERED", "COMPLETED", "RETURNED"] }
        },
        select: {
          totalAmount: true,
          customer: {
            select: {
              businessAreaId: true
            }
          }
        }
      })
    ]);

    const totalByArea = new Map<string, { partners: number; customers: number; suppliers: number }>();
    const periodByArea = new Map<string, { partners: number; customers: number; suppliers: number }>();
    const periodSalesByArea = new Map<string, { amount: number; orders: number }>();

    allPartners.forEach((partner) => {
      const areaId = partner.businessAreaId ? String(partner.businessAreaId) : UNASSIGNED_ID;
      const current = totalByArea.get(areaId) || { partners: 0, customers: 0, suppliers: 0 };
      current.partners += 1;
      if (partner.isCustomer) current.customers += 1;
      if (partner.isSupplier) current.suppliers += 1;
      totalByArea.set(areaId, current);
    });

    periodPartners.forEach((partner) => {
      const areaId = partner.businessAreaId ? String(partner.businessAreaId) : UNASSIGNED_ID;
      const current = periodByArea.get(areaId) || { partners: 0, customers: 0, suppliers: 0 };
      current.partners += 1;
      if (partner.isCustomer) current.customers += 1;
      if (partner.isSupplier) current.suppliers += 1;
      periodByArea.set(areaId, current);
    });

    periodOrders.forEach((order) => {
      const areaId = order.customer?.businessAreaId ? String(order.customer.businessAreaId) : UNASSIGNED_ID;
      const current = periodSalesByArea.get(areaId) || { amount: 0, orders: 0 };
      current.amount += Number(order.totalAmount || 0);
      current.orders += 1;
      periodSalesByArea.set(areaId, current);
    });

    const areas = allAreas.map((area) => {
      const total = totalByArea.get(area.id) || { partners: 0, customers: 0, suppliers: 0 };
      const period = periodByArea.get(area.id) || { partners: 0, customers: 0, suppliers: 0 };
      const periodSales = periodSalesByArea.get(area.id) || { amount: 0, orders: 0 };

      return {
        ...area,
        totalPartners: total.partners,
        totalCustomers: total.customers,
        totalSuppliers: total.suppliers,
        periodPartners: period.partners,
        periodCustomers: period.customers,
        periodSuppliers: period.suppliers,
        periodSalesAmount: periodSales.amount,
        periodSalesOrders: periodSales.orders
      };
    });

    // Thêm entry "Chưa xác định" nếu có dữ liệu không gán khu vực
    const unassignedTotal = totalByArea.get(UNASSIGNED_ID);
    const unassignedPeriod = periodByArea.get(UNASSIGNED_ID);
    const unassignedSales = periodSalesByArea.get(UNASSIGNED_ID);
    if (unassignedTotal || unassignedSales) {
      const total = unassignedTotal || { partners: 0, customers: 0, suppliers: 0 };
      const period = unassignedPeriod || { partners: 0, customers: 0, suppliers: 0 };
      const sales = unassignedSales || { amount: 0, orders: 0 };
      areas.push({
        id: UNASSIGNED_ID,
        code: "N/A",
        name: "Chưa xác định",
        parentId: null,
        isActive: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        totalPartners: total.partners,
        totalCustomers: total.customers,
        totalSuppliers: total.suppliers,
        periodPartners: period.partners,
        periodCustomers: period.customers,
        periodSuppliers: period.suppliers,
        periodSalesAmount: sales.amount,
        periodSalesOrders: sales.orders
      });
    }

    const periodSalesAmount = periodOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);

    const overview = {
      totalAreas: allAreas.length,
      activeAreas: allAreas.filter((a) => a.isActive).length,
      parentAreas: allAreas.filter((a) => !a.parentId).length,
      childAreas: allAreas.filter((a) => Boolean(a.parentId)).length,
      totalPartners: allPartners.length,
      totalCustomers: allPartners.filter((p) => p.isCustomer).length,
      totalSuppliers: allPartners.filter((p) => p.isSupplier).length,
      periodPartners: periodPartners.length,
      periodCustomers: periodPartners.filter((p) => p.isCustomer).length,
      periodSuppliers: periodPartners.filter((p) => p.isSupplier).length,
      periodSalesAmount
    };

    return ok(res, {
      timePreset,
      dateFrom,
      dateTo,
      overview,
      areas
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch business area dashboard: ${msg}`);
  }
});

// GET business area by id with children
router.get("/:id", requirePermission("business-areas:read"), async (req, res) => {
  try {
    const data = await prisma.businessArea.findUnique({
      where: { id: req.params.id },
      include: {
        parent: true,
        children: {
          orderBy: { displayOrder: "asc" }
        },
        partners: {
          select: {
            id: true,
            code: true,
            name: true,
            phone: true,
            email: true,
            isCustomer: true,
            isSupplier: true
          },
          take: 100
        }
      }
    });
    if (!data) {
      return badRequest(res, "Business area not found");
    }
    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch business area: ${msg}`);
  }
});

// POST create business area
router.post("/", requirePermission("business-areas:create"), async (req, res) => {
  try {
    const parsed = createBusinessAreaSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid business area payload");
    }

    // Verify code is unique
    const existing = await prisma.businessArea.findUnique({
      where: { code: parsed.data.code }
    });
    if (existing) {
      return badRequest(res, "Business area code already exists");
    }

    // Verify parent exists if provided
    if (parsed.data.parentId) {
      const parent = await prisma.businessArea.findUnique({
        where: { id: parsed.data.parentId }
      });
      if (!parent) {
        return badRequest(res, "Parent business area not found");
      }
    }

    const data = await prisma.businessArea.create({
      data: parsed.data,
      include: {
        parent: true,
        children: true
      }
    });

    return created(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to create business area: ${msg}`);
  }
});

// PUT update business area
router.put("/:id", requirePermission("business-areas:update"), async (req, res) => {
  try {
    const parsed = updateBusinessAreaSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid business area payload");
    }

    // Check if business area exists
    const existing = await prisma.businessArea.findUnique({
      where: { id: req.params.id }
    });
    if (!existing) {
      return badRequest(res, "Business area not found");
    }

    // Verify code uniqueness if changing code
    if (parsed.data.code && parsed.data.code !== existing.code) {
      const codeExists = await prisma.businessArea.findUnique({
        where: { code: parsed.data.code }
      });
      if (codeExists) {
        return badRequest(res, "Business area code already exists");
      }
    }

    // Verify parent exists and prevent circular reference
    if (parsed.data.parentId !== undefined) {
      if (parsed.data.parentId) {
        // Check if trying to set as parent a child of this area (circular reference)
        const parent = await prisma.businessArea.findUnique({
          where: { id: parsed.data.parentId }
        });
        if (!parent) {
          return badRequest(res, "Parent business area not found");
        }

        // Check for circular reference
        let checkId: string | null = parsed.data.parentId;
        let depth = 0;
        while (checkId && depth < 100) {
          const checkArea = await prisma.businessArea.findUnique({
            where: { id: checkId }
          });
          if (!checkArea) break;
          if (checkArea.id === req.params.id) {
            return badRequest(res, "Cannot set child as parent (circular reference)");
          }
          checkId = checkArea.parentId;
          depth++;
        }
      }
    }

    const data = await prisma.businessArea.update({
      where: { id: req.params.id },
      data: parsed.data,
      include: {
        parent: true,
        children: true,
        _count: { select: { partners: true } }
      }
    });

    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update business area: ${msg}`);
  }
});

// DELETE business area
router.delete("/:id", requirePermission("business-areas:delete"), async (req, res) => {
  try {
    // Check if business area exists
    const existing = await prisma.businessArea.findUnique({
      where: { id: req.params.id },
      include: { children: true, partners: true }
    });
    if (!existing) {
      return badRequest(res, "Business area not found");
    }

    // Prevent deletion if has children or partners
    if (existing.children.length > 0) {
      return badRequest(res, "Cannot delete business area that has child areas");
    }
    if (existing.partners.length > 0) {
      return badRequest(res, "Cannot delete business area that has assigned partners. Reassign them first.");
    }

    await prisma.businessArea.delete({
      where: { id: req.params.id }
    });

    return ok(res, { message: "Business area deleted successfully" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to delete business area: ${msg}`);
  }
});

// GET customers by business area
router.get("/:id/customers", requirePermission("business-areas:read"), async (req, res) => {
  try {
    const data = await prisma.partner.findMany({
      where: {
        businessAreaId: req.params.id,
        isCustomer: true
      },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        netBalance: true,
        rewardPoints: true,
        createdAt: true
      },
      orderBy: { code: "asc" }
    });
    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch customers: ${msg}`);
  }
});

export default router;
