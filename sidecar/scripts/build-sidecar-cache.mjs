import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_VERSION = 2;
const helperPath = fileURLToPath(import.meta.url);

function listFilesRecursive(root) {
  if (!existsSync(root)) {
    return [];
  }

  const entries = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      entries.push(...listFilesRecursive(entryPath));
    } else if (entry.isFile()) {
      entries.push(entryPath);
    }
  }

  return entries.sort();
}

function updateHashWithFile(hash, label, filePath) {
  hash.update(`file:${label}\0`);

  if (!existsSync(filePath)) {
    hash.update("missing\0");
    return;
  }

  const stat = statSync(filePath);
  hash.update(`size:${stat.size}\0`);
  hash.update(readFileSync(filePath));
  hash.update("\0");
}

function readCache(cachePath) {
  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  } catch {
    return null;
  }
}

export function computeSeaBuildFingerprint({
  repoRoot,
  sidecarRoot,
  buildScriptPath,
  targetTriple,
  nodeVersion = process.version,
  platform = process.platform,
  arch = process.arch,
  seaNodeVersion = nodeVersion,
  seaNodePlatform = platform,
  seaNodeArch = arch,
}) {
  const hash = createHash("sha256");
  const srcFiles = listFilesRecursive(path.join(sidecarRoot, "src"));
  const inputFiles = [
    path.join(sidecarRoot, "package.json"),
    path.join(sidecarRoot, "tsconfig.json"),
    path.join(repoRoot, "pnpm-lock.yaml"),
    buildScriptPath,
    helperPath,
    ...srcFiles,
  ];

  hash.update(`cache-version:${CACHE_VERSION}\0`);
  hash.update(`target:${targetTriple}\0`);
  hash.update(`node:${nodeVersion}\0`);
  hash.update(`platform:${platform}\0`);
  hash.update(`arch:${arch}\0`);
  hash.update(`sea-node:${seaNodeVersion}\0`);
  hash.update(`sea-platform:${seaNodePlatform}\0`);
  hash.update(`sea-arch:${seaNodeArch}\0`);

  for (const filePath of inputFiles) {
    updateHashWithFile(hash, path.relative(repoRoot, filePath), filePath);
  }

  return {
    hash: hash.digest("hex"),
    targetTriple,
    nodeVersion,
    platform,
    arch,
    seaNodeVersion,
    seaNodePlatform,
    seaNodeArch,
    inputCount: inputFiles.length,
  };
}

export function getSeaBuildCacheState({
  repoRoot,
  sidecarRoot,
  outputBinary,
  cachePath,
  buildScriptPath,
  targetTriple,
  nodeVersion = process.version,
  platform = process.platform,
  arch = process.arch,
  seaNodeVersion = nodeVersion,
  seaNodePlatform = platform,
  seaNodeArch = arch,
}) {
  const fingerprint = computeSeaBuildFingerprint({
    repoRoot,
    sidecarRoot,
    buildScriptPath,
    targetTriple,
    nodeVersion,
    platform,
    arch,
    seaNodeVersion,
    seaNodePlatform,
    seaNodeArch,
  });

  if (!existsSync(outputBinary)) {
    return { shouldBuild: true, reason: "missing-binary", fingerprint };
  }

  const cache = readCache(cachePath);
  if (!cache || cache.version !== CACHE_VERSION || !cache.fingerprint) {
    return { shouldBuild: true, reason: "missing-cache", fingerprint };
  }

  if (cache.fingerprint.hash !== fingerprint.hash) {
    return { shouldBuild: true, reason: "fingerprint-changed", fingerprint };
  }

  return { shouldBuild: false, reason: "up-to-date", fingerprint };
}

export function writeSeaBuildCache(cachePath, fingerprint) {
  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(
    cachePath,
    `${JSON.stringify(
      {
        version: CACHE_VERSION,
        fingerprint,
      },
      null,
      2,
    )}\n`,
  );
}
