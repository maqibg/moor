import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function readJsonVersion(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8")).version;
}

function writeJsonVersion(filePath, version) {
  const json = JSON.parse(readFileSync(filePath, "utf8"));
  json.version = version;
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
}

function readCargoTomlVersion(filePath) {
  const content = readFileSync(filePath, "utf8");
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

function writeCargoTomlVersion(filePath, version) {
  const content = readFileSync(filePath, "utf8");
  writeFileSync(filePath, content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`));
}

function cargoLockPackagePattern() {
  return /\[\[package\]\][\s\S]*?(?=\n\[\[package\]\]|\s*$)/g;
}

function isCargoLockPackage(section, packageName) {
  return section.split("\n").some((line) => line === `name = "${packageName}"`);
}

function readCargoLockPackageVersion(filePath, packageName) {
  const content = readFileSync(filePath, "utf8");

  for (const match of content.matchAll(cargoLockPackagePattern())) {
    const section = match[0];
    if (!isCargoLockPackage(section, packageName)) {
      continue;
    }
    return section.match(/^version = "([^"]+)"/m)?.[1] ?? null;
  }

  return null;
}

function writeCargoLockPackageVersion(filePath, packageName, version) {
  const content = readFileSync(filePath, "utf8");
  let updatedPackage = false;

  const updated = content.replace(cargoLockPackagePattern(), (section) => {
    if (!isCargoLockPackage(section, packageName)) {
      return section;
    }

    updatedPackage = true;
    return section.replace(/^version = "[^"]+"/m, `version = "${version}"`);
  });

  if (!updatedPackage) {
    throw new Error(`Cargo.lock package "${packageName}" was not found`);
  }

  writeFileSync(filePath, updated);
}

export function syncVersions({
  root,
  checkOnly = false,
  log = console.log,
  error = console.error,
}) {
  const expected = readJsonVersion(path.join(root, "sidecar", "package.json"));

  log(`Source of truth: sidecar/package.json -> ${expected}\n`);

  const targets = [
    {
      name: "package.json",
      path: path.join(root, "package.json"),
      read: readJsonVersion,
      write: writeJsonVersion,
    },
    {
      name: "tauri.conf.json",
      path: path.join(root, "src-tauri", "tauri.conf.json"),
      read: readJsonVersion,
      write: writeJsonVersion,
    },
    {
      name: "Cargo.toml",
      path: path.join(root, "src-tauri", "Cargo.toml"),
      read: readCargoTomlVersion,
      write: writeCargoTomlVersion,
    },
    {
      name: "Cargo.lock",
      path: path.join(root, "src-tauri", "Cargo.lock"),
      read: (filePath) => readCargoLockPackageVersion(filePath, "moor"),
      write: (filePath, version) => writeCargoLockPackageVersion(filePath, "moor", version),
    },
  ];

  let hasMismatch = false;

  for (const target of targets) {
    const current = target.read(target.path);
    if (current === expected) {
      log(`  [ok] ${target.name}: ${current}`);
      continue;
    }

    hasMismatch = true;
    if (checkOnly) {
      error(`  [mismatch] ${target.name}: ${current} (expected ${expected})`);
    } else {
      target.write(target.path, expected);
      log(`  [synced] ${target.name}: ${current} -> ${expected}`);
    }
  }

  if (hasMismatch && checkOnly) {
    error(`\nVersion mismatch detected. Run "pnpm version:sync" to fix.`);
    return { expected, hasMismatch, exitCode: 1 };
  }

  if (!hasMismatch) {
    log(`\nAll versions consistent: ${expected}`);
  }

  return { expected, hasMismatch, exitCode: 0 };
}
