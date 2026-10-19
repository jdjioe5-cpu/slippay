// @ts-check
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

console.log("Checking repository tracking cleanliness for .superpowers artefacts (Issue #478)...");

// 1. Assert no path containing .superpowers is tracked by git
const output = execSync("git ls-files", { encoding: "utf8" });
const trackedFiles = output.split("\n").map((f) => f.trim()).filter(Boolean);

const trackedSuperpowers = trackedFiles.filter((f) => f.includes(".superpowers"));

if (trackedSuperpowers.length > 0) {
  console.error("Tracking check failed! Found tracked .superpowers files:");
  for (const file of trackedSuperpowers) {
    console.error("  - " + file);
  }
  process.exit(1);
}

// 2. Assert .gitignore covers .superpowers
const gitignorePath = path.join(__dirname, "..", ".gitignore");
const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");

if (!gitignoreContent.includes(".superpowers")) {
  console.error("Check failed! .gitignore does not contain entry for .superpowers");
  process.exit(1);
}

console.log("All checks passed: 0 .superpowers paths tracked, and .gitignore properly configured!");
process.exit(0);
