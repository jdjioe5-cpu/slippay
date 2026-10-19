// @ts-check
const fs = require("node:fs");
const path = require("node:path");

const workflowsDir = path.join(__dirname, "..", ".github", "workflows");
const sha40Regex = /^[a-f0-9]{40}$/;
const usesRegex = /^\s*-\s*uses:\s*([^\s#]+)/;
const usesAltRegex = /^\s*uses:\s*([^\s#]+)/;

let totalChecked = 0;
let errors = [];

const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

for (const file of files) {
  const filePath = path.join(workflowsDir, file);
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(usesRegex) || line.match(usesAltRegex);
    if (!match) continue;

    const actionRef = match[1].trim();
    // Exclude local action paths like ./ or docker://
    if (actionRef.startsWith("./") || actionRef.startsWith("docker://")) {
      continue;
    }

    totalChecked++;
    const parts = actionRef.split("@");
    if (parts.length !== 2) {
      errors.push(`${file}:${i + 1}: Malformed action ref without @: "${actionRef}"`);
      continue;
    }

    const [actionName, ref] = parts;
    if (!sha40Regex.test(ref)) {
      errors.push(
        `${file}:${i + 1}: Action "${actionName}" is not pinned to a 40-character commit SHA (found "${ref}")`
      );
    }
  }
}

console.log(`Checked ${totalChecked} action uses across ${files.length} workflow files.`);

if (errors.length > 0) {
  console.error("Action SHA pinning check failed with errors:");
  for (const err of errors) {
    console.error("  - " + err);
  }
  process.exit(1);
} else {
  console.log("All actions across all workflows are correctly pinned to 40-character commit SHAs!");
  process.exit(0);
}
