#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function runGit(args) {
  return spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });
}

const isRepo = runGit(["rev-parse", "--is-inside-work-tree"]);
if (isRepo.status !== 0) {
  console.log("[hooks:install] Skip: current folder is not a Git repository.");
  console.log("[hooks:install] Run again after `git init` or when opening the repository root.");
  process.exit(0);
}

const setPath = runGit(["config", "core.hooksPath", ".githooks"]);
if (setPath.status !== 0) {
  console.error("[hooks:install] Failed to set core.hooksPath.");
  if (setPath.stderr) console.error(setPath.stderr.trim());
  process.exit(setPath.status || 1);
}

console.log("[hooks:install] Installed. Git hooks path => .githooks");
console.log("[hooks:install] pre-commit will run: npm run check:text");
