import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const checkOnly = process.argv.includes("--check");

const expected = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;

const targets = [
  {
    name: "tauri.conf.json",
    path: path.join(root, "src-tauri", "tauri.conf.json"),
    read: (p) => {
      const content = readFileSync(p, "utf8");
      const match = content.match(/"version"\s*:\s*"([^"]+)"/);
      return match?.[1] ?? null;
    },
    write: (p, v) => {
      const content = readFileSync(p, "utf8");
      writeFileSync(p, content.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${v}"`));
    },
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
  {
    name: "sidecar/package.json",
    path: path.join(root, "sidecar", "package.json"),
    read: (p) => {
      const content = readFileSync(p, "utf8");
      const match = content.match(/"version"\s*:\s*"([^"]+)"/);
      return match?.[1] ?? null;
    },
    write: (p, v) => {
      const content = readFileSync(p, "utf8");
      writeFileSync(p, content.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${v}"`));
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
