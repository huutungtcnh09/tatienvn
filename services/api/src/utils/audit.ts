import { prisma } from "../prisma.js";

export type RbacAuditEvent = {
  timestamp: string;
  actorUserId: string;
  actorEmail?: string;
  actorRoles: string[];
  action: string;
  targetType: "user" | "role" | "permission" | "system";
  targetId?: string;
  targetDisplay?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

type ReadRbacAuditParams = {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

type ReadRbacAuditResult = {
  items: RbacAuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function toPrismaJson(value: unknown) {
  if (value === undefined) return undefined;
  return value;
}

export async function logRbacAudit(event: Omit<RbacAuditEvent, "timestamp">) {
  const db = prisma as any;
  try {
    await db.rbacAuditLog.create({
      data: {
        timestamp: new Date(),
        actorUserId: event.actorUserId,
        actorEmail: event.actorEmail,
        actorRoles: event.actorRoles || [],
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        targetDisplay: event.targetDisplay,
        before: toPrismaJson(event.before),
        after: toPrismaJson(event.after),
        metadata: toPrismaJson(event.metadata)
      }
    });
  } catch {
    // Do not block request flow if audit logging fails.
  }
}

export async function readRbacAudit(params: ReadRbacAuditParams = {}): Promise<ReadRbacAuditResult> {
  const actor = String(params.actor || "").trim().toLowerCase();
  const action = String(params.action || "").trim().toLowerCase();
  const fromTime = params.from ? new Date(params.from).getTime() : Number.NaN;
  const toTime = params.to ? new Date(params.to).getTime() : Number.NaN;
  const pageRaw = Number(params.page || 1);
  const pageSizeRaw = Number(params.pageSize || 20);
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.min(200, Math.floor(pageSizeRaw))) : 20;

  try {
    const db = prisma as any;
    const where: any = {};
    if (actor) {
      where.OR = [
        { actorEmail: { contains: actor } },
        { actorUserId: { contains: actor } }
      ];
    }
    if (action) {
      where.action = { contains: action };
    }
    if (Number.isFinite(fromTime) || Number.isFinite(toTime)) {
      where.timestamp = {};
      if (Number.isFinite(fromTime)) {
        where.timestamp.gte = new Date(fromTime);
      }
      if (Number.isFinite(toTime)) {
        where.timestamp.lte = new Date(toTime);
      }
    }

    const total = await db.rbacAuditLog.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * pageSize;

    const rows = await db.rbacAuditLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip,
      take: pageSize
    });

    const items: RbacAuditEvent[] = rows.map((row) => ({
      timestamp: row.timestamp.toISOString(),
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail || undefined,
      actorRoles: Array.isArray(row.actorRoles) ? row.actorRoles.map((x) => String(x)) : [],
      action: row.action,
      targetType: (row.targetType as RbacAuditEvent["targetType"]) || "system",
      targetId: row.targetId || undefined,
      targetDisplay: row.targetDisplay || undefined,
      before: row.before ?? undefined,
      after: row.after ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) || undefined
    }));

    return {
      items,
      total,
      page: safePage,
      pageSize,
      totalPages
    };
  } catch {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      totalPages: 1
    };
  }
}
