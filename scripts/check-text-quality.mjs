#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const targetDirs = [
  "apps/head-office/src",
  "apps/store-pos/src",
  "apps/corporate-web/src",
  "services/api/src"
];

const targetExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".css", ".md", ".html"]);

const ignoreDirNames = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".turbo",
  ".next",
  "out"
]);

const suspiciousPatterns = [
  { label: "replacement-char", regex: /\uFFFD/ },
  { label: "mojibake-utf8-latin1", regex: /Ã.|á».|áº.|â€“|â€”|â€|Ä./ },
  { label: "legacy-short-form", regex: /\bSĐ\b|\bĐã TT\b|\bChưa TT\b|Trả 1 phần/ },
  { label: "known-broken-phrase", regex: /Cp Nht|To Mi|Nhan tab df tai|Thoi Gian|Gia Cu|Gia Moi|SL Ban|Thanh tien|Tang\b/ }
];

function walkDir(absDir, fileList) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoreDirNames.has(entry.name)) continue;
    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      walkDir(absPath, fileList);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (targetExtensions.has(ext)) {
      fileList.push(absPath);
    }
  }
}

function getLineNumber(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function getLineText(content, line) {
  const lines = content.split(/\r?\n/);
  return lines[line - 1] || "";
}

function run() {
  const files = [];
  for (const relDir of targetDirs) {
    const absDir = path.join(root, relDir);
    if (!fs.existsSync(absDir)) continue;
    walkDir(absDir, files);
  }

  const findings = [];

  for (const absFile of files) {
    let content;
    try {
      content = fs.readFileSync(absFile, "utf8");
    } catch (error) {
      findings.push({
        file: path.relative(root, absFile),
        line: 1,
        label: "read-failed",
        text: String(error.message || error)
      });
      continue;
    }

    for (const pattern of suspiciousPatterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes("g") ? pattern.regex.flags : `${pattern.regex.flags}g`);
      let match;
      while ((match = regex.exec(content)) !== null) {
        const line = getLineNumber(content, match.index);
        findings.push({
          file: path.relative(root, absFile),
          line,
          label: pattern.label,
          text: getLineText(content, line).trim()
        });
      }
    }
  }

  if (findings.length === 0) {
    console.log("[check-text-quality] OK: khong tim thay chuoi nghi ngo loi chu/encoding.");
    process.exit(0);
  }

  console.error(`[check-text-quality] FAIL: tim thay ${findings.length} van de nghi ngo.`);
  for (const item of findings) {
    console.error(`- ${item.file}:${item.line} [${item.label}] ${item.text}`);
  }
  process.exit(1);
}

run();
