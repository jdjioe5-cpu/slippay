#!/usr/bin/env node
/**
 * Root repository hygiene checker.
 *
 * Enforces that the repository root stays clean:
 * 1. No unreferenced one-off scripts (*.js, *.mjs, *.py, *.sh, etc.) at the root.
 * 2. No standalone HTML files (*.html) at the root (move to docs/ or apps/web).
 * 3. Root directory only contains standard project directories, top-level documents (*.md, LICENSE),
 *    and standard configuration files (package.json, pnpm-lock.yaml, tsconfig.base.json, etc.).
 * 4. Ensures retained maintenance scripts in scripts/ are wired into package.json.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "..");

// Permitted root-level configuration files
const ALLOWED_CONFIG_FILES = new Set([
  ".editorconfig",
  ".env.example",
  ".env.docker.example",
  ".env.local",
  ".env.local.ci",
  ".gitbook.yaml",
  ".gitignore",
  "docker-compose.yml",
  "ecosystem.config.cjs",
  "eslint.config.js",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]);

// Permitted extensions for documentation files
const ALLOWED_DOC_EXTENSIONS = new Set([".md"]);

console.log("=== Checking Repository Root Hygiene ===");

const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
const violations = [];

for (const entry of entries) {
  if (entry.isDirectory()) {
    // Directories are permitted
    continue;
  }

  const name = entry.name;

  // Ignore git internal files/dirs
  if (name.startsWith(".git") && name !== ".gitignore" && name !== ".gitbook.yaml") {
    continue;
  }

  // Exact license file
  if (name === "LICENSE" || name === "LICENSE.md" || name === "LICENSE.txt") {
    continue;
  }

  // Known config files
  if (ALLOWED_CONFIG_FILES.has(name)) {
    continue;
  }

  // Allowed documentation files
  const ext = path.extname(name).toLowerCase();
  if (ALLOWED_DOC_EXTENSIONS.has(ext)) {
    continue;
  }

  // Any other file is a violation
  violations.push(name);
}

if (violations.length > 0) {
  console.error("❌ Root hygiene check failed! The following stray/unregistered files were found at repository root:");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  console.error("\nGuideline: Move scripts to scripts/, HTML/docs to docs/, or delete if obsolete.");
  process.exit(1);
}

// Check that retained scripts in scripts/ are referenced in package.json
const pkgPath = path.join(repoRoot, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const scriptsMap = pkg.scripts || {};
const scriptValues = Object.values(scriptsMap).join(" ");

const requiredScriptsInPackage = ["scripts/demo-runner.mjs"];
const missingRefs = [];

for (const reqScript of requiredScriptsInPackage) {
  if (!scriptValues.includes(reqScript)) {
    missingRefs.push(reqScript);
  }
}

if (missingRefs.length > 0) {
  console.error("❌ Retained scripts missing from package.json scripts:");
  for (const s of missingRefs) {
    console.error(`  - ${s}`);
  }
  process.exit(1);
}

console.log("✔ Root hygiene verified: No stray scripts, no orphan HTML, only approved docs and configs.");
console.log("✔ Retained scripts verified reachable from package.json.");
