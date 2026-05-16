import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { badRequest, created, ok } from "../../utils/http.js";
import { requirePermission } from "../../middleware/authorize.js";

const router = Router();

function normalizeCategoryName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const createCategorySchema = z.object({
  name: z.string().min(2),
  parentId: z.string().optional()
});

const updateCategorySchema = createCategorySchema;

// GET all categories (with hierarchy)
router.get("/", requirePermission("categories:read"), async (_req, res) => {
  try {
    const data = await prisma.category.findMany({
      include: {
        children: true,
        _count: {
          select: { products: true }
        }
      },
      where: { parentId: null },
      orderBy: { name: "asc" }
    });
    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch categories: ${msg}`);
  }
});

// GET category by id with full tree
router.get("/:id", requirePermission("categories:read"), async (req, res) => {
  try {
    const data = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: {
        parent: true,
        children: true,
        products: {
          select: { id: true, sku: true, name: true }
        }
      }
    });
    if (!data) {
      return badRequest(res, "Category not found");
    }
    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to fetch category: ${msg}`);
  }
});

// POST create category
router.post("/", requirePermission("categories:create"), async (req, res) => {
  try {
    const parsed = createCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid category payload");
    }

    const normalizedName = normalizeCategoryName(parsed.data.name);

    // Verify parent exists if provided
    if (parsed.data.parentId) {
      const parent = await prisma.category.findUnique({
        where: { id: parsed.data.parentId }
      });
      if (!parent) {
        return badRequest(res, "Parent category not found");
      }
    }

    const existingCategories = await prisma.category.findMany({
      select: { id: true, name: true }
    });

    const duplicated = existingCategories.find((category) => normalizeCategoryName(category.name) === normalizedName);
    if (duplicated) {
      return badRequest(res, "Category name already exists");
    }

    const data = await prisma.category.create({
      data: {
        ...parsed.data,
        name: parsed.data.name.trim().replace(/\s+/g, " ")
      },
      include: { parent: true }
    });
    return created(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to create category: ${msg}`);
  }
});

// PUT update category
router.put("/:id", requirePermission("categories:update"), async (req, res) => {
  try {
    const parsed = updateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Invalid category payload");
    }

    const normalizedName = normalizeCategoryName(parsed.data.name);

    // Prevent circular parent reference
    if (parsed.data.parentId === req.params.id) {
      return badRequest(res, "Cannot set category as its own parent");
    }

    // Verify parent exists if provided
    if (parsed.data.parentId) {
      const parent = await prisma.category.findUnique({
        where: { id: parsed.data.parentId }
      });
      if (!parent) {
        return badRequest(res, "Parent category not found");
      }
    }

    const existingCategories = await prisma.category.findMany({
      select: { id: true, name: true }
    });

    const duplicated = existingCategories.find((category) => {
      return category.id !== req.params.id && normalizeCategoryName(category.name) === normalizedName;
    });

    if (duplicated) {
      return badRequest(res, "Category name already exists");
    }

    const data = await prisma.category.update({
      where: { id: req.params.id },
      data: {
        ...parsed.data,
        name: parsed.data.name.trim().replace(/\s+/g, " ")
      },
      include: { parent: true, children: true }
    });
    return ok(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to update category: ${msg}`);
  }
});

// DELETE category
router.delete("/:id", requirePermission("categories:delete"), async (req, res) => {
  try {
    // Check if category has products or children
    const products = await prisma.product.count({
      where: { categoryId: req.params.id }
    });
    const children = await prisma.category.count({
      where: { parentId: req.params.id }
    });

    if (products > 0 || children > 0) {
      return badRequest(res, "Cannot delete category with products or subcategories");
    }

    await prisma.category.delete({
      where: { id: req.params.id }
    });

    return ok(res, { message: "Category deleted" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return badRequest(res, `Failed to delete category: ${msg}`);
  }
});

export default router;
