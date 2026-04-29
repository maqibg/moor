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
    "### macOS Downloads",
    "- **Apple Silicon (M1/M2/M3)**: Download `Moor_*_aarch64.dmg`",
    "- **Intel Mac**: Download `Moor_*_x86_64.dmg`",
    "",
    '> ⚠️ On first launch, macOS may show an "unverified developer" warning. Right-click the app icon and select **Open** to proceed.',
    ">",
    "> If the app is still blocked or quarantined, run the following command in Terminal and reopen:",
    "> ```bash",
    "> xattr -rd com.apple.quarantine /Applications/moor.app",
    "> ```",
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
