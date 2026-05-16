require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('../../../node_modules/@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const rows = await prisma.orgPositionAssignmentHistory.findMany({
    where: {
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }]
    },
    select: {
      id: true,
      positionId: true,
      userId: true,
      effectiveFrom: true,
      effectiveTo: true,
      position: { select: { code: true, name: true } },
      user: { select: { fullName: true, email: true } }
    },
    orderBy: [{ positionId: 'asc' }, { effectiveFrom: 'desc' }]
  });

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.positionId)) grouped.set(row.positionId, []);
    grouped.get(row.positionId).push(row);
  }

  const duplicates = [...grouped.entries()].filter(([, list]) => list.length > 1);

  console.log('active_assignments=', rows.length);
  console.log('positions_with_multiple_active=', duplicates.length);
  console.log(
    JSON.stringify(
      duplicates.map(([positionId, list]) => ({
        positionId,
        position: list[0].position,
        count: list.length,
        assignees: list.map((x) => ({
          id: x.id,
          userId: x.userId,
          name: x.user.fullName,
          email: x.user.email,
          effectiveFrom: x.effectiveFrom,
          effectiveTo: x.effectiveTo
        }))
      })),
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
