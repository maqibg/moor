import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root });
}

function getRootVersion() {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
}

const status = execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim();
const pendingChangesetFiles = status
  .split("\n")
  .filter((l) => l.includes(".changeset") && l.endsWith(".md") && !l.includes("README"));

if (pendingChangesetFiles.length === 0) {
  console.error("No pending changesets found. Run 'pnpm changeset' first.");
  process.exit(1);
}

const changedBefore = status
  .split("\n")
  .filter((l) => !l.includes(".changeset"))
  .map((l) => l.trim())
  .filter(Boolean);
if (changedBefore.length > 0) {
  console.error("Working tree has uncommitted changes outside .changeset/:");
  changedBefore.forEach((l) => console.error(`  ${l}`));
  console.error("\nCommit or stash these changes before releasing.");
  process.exit(1);
}

run("pnpm changeset version");
run("pnpm version:sync");

const version = getRootVersion();
const tagName = `v${version}`;

run(`git add -A`);
run(`git commit -m "chore(release): ${tagName}"`);
run(`git tag ${tagName}`);

console.log(`\nRelease ${tagName} committed and tagged.`);
console.log(`Push to publish: git push --follow-tags origin main`);
