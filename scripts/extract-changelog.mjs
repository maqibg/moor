import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const changelogPath = path.join(root, "CHANGELOG.md");

try {
  const content = readFileSync(changelogPath, "utf8");
  const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  const header = `## ${version}`;

  const startIdx = content.indexOf(header);
  if (startIdx === -1) {
    console.log(`No changelog entry found for v${version}`);
    process.exit(0);
  }

  const afterHeader = content.indexOf("\n", startIdx);
  const nextHeader = content.indexOf("\n## ", afterHeader + 1);
  const body = content.slice(afterHeader + 1, nextHeader === -1 ? undefined : nextHeader).trim();

  const fullBody = [
    `## Moor v${version}`,
    "",
    "### Windows Downloads",
    `- **NSIS installer (recommended)**: Download \`Moor_${version}_x64-setup.exe\``,
    `- **MSI installer**: Download \`Moor_${version}_x64_en-US.msi\``,
    "",
    "---",
    "",
    body,
  ].join("\n");

  console.log(fullBody);
} catch (err) {
  if (err.code === "ENOENT") {
    console.log("No CHANGELOG.md found.");
    process.exit(0);
  }
  throw err;
}
