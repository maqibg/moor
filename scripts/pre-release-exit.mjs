import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const preJsonPath = path.join(root, ".changeset", "pre.json");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root });
}

if (!existsSync(preJsonPath)) {
  console.log("当前不在 pre-release 模式中，无需退出。");
  process.exit(0);
}

const pre = JSON.parse(readFileSync(preJsonPath, "utf8"));
console.log(`退出 "${pre.tag}" pre-release 模式...\n`);

run("pnpm changeset pre exit");
run("pnpm version:sync");

console.log("\n已退出 pre-release 模式，版本号已同步。");
