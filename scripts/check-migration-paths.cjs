/**
 * Guardrail check for SQL migrations placement.
 * Ensures all SQL migrations reside strictly under supabase/migrations/
 * and no orphan/top-level migrations directory exists.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const ALLOWED_SQL_FILES = new Set([
  path.normalize('supabase/seed.sql')
]);

const ALLOWED_SQL_DIR = path.normalize('supabase/migrations');

function scanSqlFiles(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(repoRoot, fullPath);

    // Ignore node_modules, .git, dist, build, .turbo, target, etc.
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', '.turbo', 'target', '.dart_tool'].includes(entry.name)) {
        continue;
      }
      scanSqlFiles(fullPath, fileList);
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      fileList.push(relPath);
    }
  }
  return fileList;
}

const allSqlFiles = scanSqlFiles(repoRoot);
const violations = [];

for (const file of allSqlFiles) {
  const normalized = path.normalize(file);
  const dir = path.dirname(normalized);

  if (ALLOWED_SQL_FILES.has(normalized)) {
    continue;
  }

  if (dir === ALLOWED_SQL_DIR || dir.startsWith(ALLOWED_SQL_DIR + path.sep)) {
    continue;
  }

  violations.push(normalized);
}

if (fs.existsSync(path.join(repoRoot, 'migrations'))) {
  violations.push('Orphan top-level "migrations/" directory still exists.');
}

if (violations.length > 0) {
  console.error('\x1b[31m[ERROR] SQL migration placement violation detected:\x1b[0m');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  console.error('\x1b[33mAll Supabase SQL migrations must reside strictly inside "supabase/migrations/".\x1b[0m');
  process.exit(1);
}

console.log(`\x1b[32m[OK]\x1b[0m All ${allSqlFiles.length} SQL files are correctly placed in supabase/migrations/ (or allowed seed).`);
process.exit(0);
