#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "Usage: sh deploy/init-git-deploy.sh <repo_url> [branch] [target_dir]"
  exit 1
fi

REPO_URL="$1"
BRANCH="${2:-main}"
TARGET_DIR="${3:-/opt/app-kd}"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Target directory does not exist: $TARGET_DIR"
  exit 1
fi

cd "$TARGET_DIR"

if [ ! -d .git ]; then
  git init
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"

if [ ! -f deploy/.env.prod ] && [ -f deploy/.env.prod.example ]; then
  cp deploy/.env.prod.example deploy/.env.prod
fi

echo "Git deploy init completed"
echo "Repo: $REPO_URL"
echo "Branch: $BRANCH"
echo "Dir: $TARGET_DIR"