import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const preJsonPath = path.join(root, ".changeset", "pre.json");

const tag = process.argv[2];
if (!tag || !["beta", "rc", "alpha"].includes(tag)) {
  console.error("Usage: node scripts/pre-release.mjs <beta|rc|alpha>");
  process.exit(1);
}

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root });
}

// 检查是否已在 pre 模式中
if (existsSync(preJsonPath)) {
  const pre = JSON.parse(readFileSync(preJsonPath, "utf8"));
  if (pre.mode === "pre") {
    if (pre.tag === tag) {
      console.log(`已在 ${tag} pre-release 模式中，跳过 pre enter，直接发版。\n`);
    } else {
      console.error(`当前处于 "${pre.tag}" pre-release 模式，但你请求的是 "${tag}"。`);
      console.error(`请先运行 "pnpm release:exit" 退出当前模式，再重新进入。`);
      process.exit(1);
    }
  }
} else {
  run(`pnpm changeset pre enter ${tag}`);
}

run("pnpm release");
