#!/usr/bin/env sh
set -eu

BRANCH="${1:-main}"
TARGET_DIR="${2:-/opt/app-kd}"

cd "$TARGET_DIR"

if [ ! -d .git ]; then
  echo "Not a git repository: $TARGET_DIR"
  echo "Run: sh deploy/init-git-deploy.sh <repo_url> $BRANCH $TARGET_DIR"
  exit 1
fi

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

if [ ! -f deploy/.env.prod ] && [ -f deploy/.env.prod.example ]; then
  cp deploy/.env.prod.example deploy/.env.prod
fi

docker compose -f deploy/docker-compose.prod.yml build
docker compose -f deploy/docker-compose.prod.yml up -d
docker compose -f deploy/docker-compose.prod.yml ps

echo "Deploy completed for branch: $BRANCH"