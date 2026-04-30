import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const checkOnly = process.argv.includes("--check");

// 版本号来源：sidecar/package.json（changeset 直接管理的 workspace 成员）
// changeset version 会更新 sidecar/package.json，然后由此脚本同步到其他位置
const expected = JSON.parse(
  readFileSync(path.join(root, "sidecar", "package.json"), "utf8"),
).version;

console.log(`Source of truth: sidecar/package.json -> ${expected}\n`);

const jsonReadWrite = (filePath) => ({
  read: () => JSON.parse(readFileSync(filePath, "utf8")).version,
  write: (_p, v) => {
    const json = JSON.parse(readFileSync(filePath, "utf8"));
    json.version = v;
    writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
  },
});

const targets = [
  {
    name: "package.json",
    path: path.join(root, "package.json"),
    ...jsonReadWrite(path.join(root, "package.json")),
  },
  {
    name: "tauri.conf.json",
    path: path.join(root, "src-tauri", "tauri.conf.json"),
    ...jsonReadWrite(path.join(root, "src-tauri", "tauri.conf.json")),
  },
  {
    name: "Cargo.toml",
    path: path.join(root, "src-tauri", "Cargo.toml"),
    read: (p) => {
      const content = readFileSync(p, "utf8");
      const match = content.match(/^version\s*=\s*"([^"]+)"/m);
      return match?.[1] ?? null;
    },
    write: (p, v) => {
      const content = readFileSync(p, "utf8");
      writeFileSync(p, content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${v}"`));
    },
  },
];

let hasMismatch = false;

for (const target of targets) {
  const current = target.read(target.path);
  if (current === expected) {
    console.log(`  [ok] ${target.name}: ${current}`);
    continue;
  }
  hasMismatch = true;
  if (checkOnly) {
    console.error(`  [mismatch] ${target.name}: ${current} (expected ${expected})`);
  } else {
    target.write(target.path, expected);
    console.log(`  [synced] ${target.name}: ${current} -> ${expected}`);
  }
}

if (hasMismatch && checkOnly) {
  console.error(`\nVersion mismatch detected. Run "pnpm version:sync" to fix.`);
  process.exit(1);
}

if (!hasMismatch) {
  console.log(`\nAll versions consistent: ${expected}`);
}
