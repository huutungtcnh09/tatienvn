#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Running Prisma migrations..."
  npx prisma migrate deploy --config prisma.config.ts
fi

echo "Starting API..."
exec npx tsx src/server.ts
