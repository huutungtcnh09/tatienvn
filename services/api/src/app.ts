import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { config } from "./config.js";
import authRoutes from "./modules/auth/auth.routes.js";
import usersRoutes from "./modules/users/users.routes.js";
import storesRoutes from "./modules/stores/stores.routes.js";
import categoriesRoutes from "./modules/categories/categories.routes.js";
import businessAreasRoutes from "./modules/business-areas/business-areas.routes.js";
import partnersRoutes from "./modules/partners/partners.routes.js";
import productsRoutes from "./modules/products/products.routes.js";
import publicProductsRoutes from "./modules/public/public-products.routes.js";
import consultationsRoutes from "./modules/consultations/consultations.routes.js";
import ordersRoutes from "./modules/orders/orders.routes.js";
import receiptsRoutes from "./modules/receipts/receipts.routes.js";
import purchasesRoutes from "./modules/purchases/purchases.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import rbacRoutes from "./modules/rbac/rbac.routes.js";
import promotionsRoutes from "./modules/promotions/promotions.routes.js";
import orgAssignmentsRoutes from "./modules/org-assignments/org-assignments.routes.js";
import orgPositionsRoutes from "./modules/org-positions/org-positions.routes.js";
import marketingRoutes from "./modules/marketing/marketing.routes.js";
import systemRoutes from "./modules/system/system.routes.js";
import articlesRoutes from "./modules/articles/articles.routes.js";
import publicArticlesRoutes from "./modules/public/public-articles.routes.js";
import { requireAuth } from "./middleware/auth.js";
import { initializeRbacStorage } from "./security/rbac-storage.js";

const app = express();
const allowedCorsOrigins = new Set(config.corsOrigin);

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin(origin, callback) {
    // Allow non-browser or same-origin requests that do not send Origin.
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = origin.trim().replace(/\/$/, "").toLowerCase();
    const isAllowed = allowedCorsOrigins.has("*") || allowedCorsOrigins.has(normalizedOrigin);
    callback(isAllowed ? null : new Error(`Origin not allowed by CORS: ${origin}`), isAllowed);
  }
}));
app.use(express.json({ limit: "64kb" }));
app.use("/uploads", express.static(path.resolve(process.env.UPLOAD_DIR ?? "./uploads")));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/system", systemRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/public/products", publicProductsRoutes);
app.use("/api/public/articles", publicArticlesRoutes);
app.use("/api/consultations", requireAuth, consultationsRoutes);
app.use("/api/users", requireAuth, usersRoutes);
app.use("/api/stores", requireAuth, storesRoutes);
app.use("/api/categories", requireAuth, categoriesRoutes);
app.use("/api/business-areas", requireAuth, businessAreasRoutes);
app.use("/api/partners", requireAuth, partnersRoutes);
app.use("/api/products", requireAuth, productsRoutes);
app.use("/api/orders", requireAuth, ordersRoutes);
app.use("/api/receipts", requireAuth, receiptsRoutes);
app.use("/api/purchases", requireAuth, purchasesRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/rbac", requireAuth, rbacRoutes);
app.use("/api/promotions", requireAuth, promotionsRoutes);
app.use("/api/org-assignments", requireAuth, orgAssignmentsRoutes);
app.use("/api/org-positions", requireAuth, orgPositionsRoutes);
app.use("/api/marketing", requireAuth, marketingRoutes);
app.use("/api/articles", requireAuth, articlesRoutes);

void initializeRbacStorage().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error("RBAC storage init failed:", msg);
});

export default app;
