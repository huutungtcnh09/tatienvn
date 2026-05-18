import { Router } from "express";
import os from "os";
import { execSync } from "child_process";
import { requireAuth } from "../../middleware/auth.js";
import { forbidden, ok } from "../../utils/http.js";
import { prisma } from "../../prisma.js";
import type { AuthRequest } from "../../middleware/auth.js";

const router = Router();

// In-memory flag — reset khi server restart (đủ dùng cho mục đích khóa khẩn cấp)
let maintenanceActive = false;
let maintenanceMessage = "Website đang tạm thời bảo trì. Vui lòng quay lại sau.";

/** Public: corporate-web gọi để kiểm tra chế độ bảo trì */
router.get("/maintenance", (_req, res) => {
  return ok(res, { active: maintenanceActive, message: maintenanceMessage });
});

/** Protected: chỉ SUPER_ADMIN mới được bật/tắt */
router.post("/maintenance", requireAuth, (req: AuthRequest, res) => {
  const roles: string[] = req.user?.roles || [];
  if (!roles.includes("SUPER_ADMIN")) {
    return forbidden(res, "Chỉ SUPER_ADMIN mới có quyền thao tác chế độ bảo trì.");
  }

  const body = req.body as { active?: boolean; message?: string };
  if (typeof body.active !== "boolean") {
    return ok(res, null, "Thiếu trường active (boolean).");
  }

  maintenanceActive = body.active;
  if (typeof body.message === "string" && body.message.trim()) {
    maintenanceMessage = body.message.trim();
  } else if (!body.active) {
    // Reset về mặc định khi tắt bảo trì
    maintenanceMessage = "Website đang tạm thời bảo trì. Vui lòng quay lại sau.";
  }

  return ok(res, { active: maintenanceActive, message: maintenanceMessage },
    maintenanceActive ? "Đã bật chế độ bảo trì." : "Đã tắt chế độ bảo trì."
  );
});

/** Protected: SUPER_ADMIN - server & DB health metrics */
router.get("/health", requireAuth, async (req: AuthRequest, res) => {
  const roles: string[] = req.user?.roles || [];
  if (!roles.includes("SUPER_ADMIN")) {
    return forbidden(res, "Chỉ SUPER_ADMIN mới có quyền xem thông tin hệ thống.");
  }

  // OS metrics
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  const loadAvg = os.loadavg(); // [1min, 5min, 15min]

  // Node.js process memory
  const proc = process.memoryUsage();

  // DB ping
  let dbPingMs: number | null = null;
  let dbStatus = "ok";
  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbPingMs = Date.now() - t0;
  } catch {
    dbStatus = "error";
  }

  // DB storage size
  let dbSizeMb: number | null = null;
  try {
    const rows = await prisma.$queryRaw<{ size_bytes: bigint }[]>`
      SELECT SUM(data_length + index_length) AS size_bytes
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
    `;
    const bytes = rows[0]?.size_bytes;
    if (bytes != null) dbSizeMb = Math.round(Number(bytes) / 1024 / 1024 * 10) / 10;
  } catch { /* ignore */ }

  // Disk space
  let diskTotalGb: number | null = null;
  let diskUsedGb: number | null = null;
  let diskFreeGb: number | null = null;
  let diskUsedPct: number | null = null;
  const parseDisk = (total: number, used: number, free: number) => {
    diskTotalGb = Math.round(total / 1024 / 1024 / 1024 * 10) / 10;
    diskUsedGb  = Math.round(used  / 1024 / 1024 / 1024 * 10) / 10;
    diskFreeGb  = Math.round(free  / 1024 / 1024 / 1024 * 10) / 10;
    diskUsedPct = Math.round((used / total) * 100);
  };
  if (os.platform() !== "win32") {
    // Linux / macOS
    try {
      const dfOut = execSync("df -B1 /", { timeout: 5000 }).toString();
      const line = dfOut.split("\n")[1];
      if (line) {
        const parts = line.trim().split(/\s+/);
        const total = parseInt(parts[1], 10);
        const used  = parseInt(parts[2], 10);
        const free  = parseInt(parts[3], 10);
        if (!isNaN(total) && total > 0) parseDisk(total, used, free);
      }
    } catch { /* ignore */ }
  } else {
    // Windows: wmic logicaldisk
    try {
      const out = execSync(
        "wmic logicaldisk where \"DeviceID='C:'\" get Size,FreeSpace /format:value",
        { timeout: 5000 }
      ).toString();
      const freeMatch = out.match(/FreeSpace=(\d+)/);
      const sizeMatch = out.match(/Size=(\d+)/);
      if (freeMatch && sizeMatch) {
        const total = parseInt(sizeMatch[1], 10);
        const free  = parseInt(freeMatch[1], 10);
        const used  = total - free;
        if (total > 0) parseDisk(total, used, free);
      }
    } catch { /* ignore */ }
  }

  return ok(res, {
    os: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: Math.floor(os.uptime()),
      totalMemMb: Math.round(totalMem / 1024 / 1024),
      usedMemMb: Math.round(usedMem / 1024 / 1024),
      freeMemMb: Math.round(freeMem / 1024 / 1024),
      memUsagePct: Math.round((usedMem / totalMem) * 100),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model || "unknown",
      loadAvg1m: Math.round(loadAvg[0] * 100) / 100,
      loadAvg5m: Math.round(loadAvg[1] * 100) / 100,
      loadAvg15m: Math.round(loadAvg[2] * 100) / 100
    },
    process: {
      nodeVersion: process.version,
      uptimeSec: Math.floor(process.uptime()),
      rssMemMb: Math.round(proc.rss / 1024 / 1024),
      heapUsedMb: Math.round(proc.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(proc.heapTotal / 1024 / 1024)
    },
    database: {
      status: dbStatus,
      pingMs: dbPingMs,
      sizeMb: dbSizeMb
    },
    disk: {
      totalGb: diskTotalGb,
      usedGb: diskUsedGb,
      freeGb: diskFreeGb,
      usedPct: diskUsedPct
    }
  });
});

export default router;
