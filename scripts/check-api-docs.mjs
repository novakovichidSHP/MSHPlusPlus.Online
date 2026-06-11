import fs from "node:fs";

const reportPath = process.argv[2] || "/tmp/jsdoc-report.json";
if (!fs.existsSync(reportPath)) {
  console.error(`JSDoc report not found: ${reportPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(reportPath, "utf8");
const doclets = JSON.parse(raw);

const documentedFunctions = new Set(
  doclets
    .filter((entry) => entry.kind === "function" && entry.undocumented !== true)
    .map((entry) => entry.name)
);

const required = [
  "init",
  "router",
  "bindUi",
  "applyResponsiveCardState",
  "runActiveFile",
  "remixSnapshot",
  "resetSnapshot"
];

const missing = required.filter((name) => !documentedFunctions.has(name));
if (missing.length) {
  console.error("Missing JSDoc coverage for required functions:");
  missing.forEach((name) => console.error(`- ${name}`));
  process.exit(1);
}

console.log(`JSDoc coverage check passed (${required.length} required functions).`);
