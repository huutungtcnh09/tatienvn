import { prisma } from "../prisma.js";

const HEAD_OFFICE_ROLES = new Set(["SUPER_ADMIN", "HEAD_MANAGER"]);

export async function resolveAssignedStoreIdsForUser(userId: string, snapshotAt = new Date(), roles?: string[]) {
  if (roles?.some((r) => HEAD_OFFICE_ROLES.has(r))) {
    const allStores = await prisma.store.findMany({ select: { id: true } });
    return allStores.map((s) => s.id);
  }

  const [positionAssignments, legacyAssignments] = await Promise.all([
    prisma.orgPositionAssignmentHistory.findMany({
      where: {
        userId,
        effectiveFrom: { lte: snapshotAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: snapshotAt } }],
        position: {
          storeId: { not: null },
          isActive: true
        }
      },
      select: {
        position: {
          select: {
            storeId: true
          }
        }
      }
    }),
    prisma.orgAssignmentHistory.findMany({
      where: {
        userId,
        storeId: { not: null },
        effectiveFrom: { lte: snapshotAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: snapshotAt } }]
      },
      select: { storeId: true }
    })
  ]);

  const storeIdSet = new Set<string>();

  for (const row of positionAssignments) {
    if (row.position.storeId) {
      storeIdSet.add(row.position.storeId);
    }
  }

  for (const row of legacyAssignments) {
    if (row.storeId) {
      storeIdSet.add(row.storeId);
    }
  }

  return Array.from(storeIdSet);
}

export async function isUserAssignedToStore(userId: string, storeId: string, snapshotAt = new Date()) {
  const assignedStoreIds = await resolveAssignedStoreIdsForUser(userId, snapshotAt);
  return assignedStoreIds.includes(storeId);
}
