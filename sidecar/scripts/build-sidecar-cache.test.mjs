import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { getSeaBuildCacheState, writeSeaBuildCache } from "./build-sidecar-cache.mjs";

function createBuildFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "moor-sidecar-cache-"));
  const repoRoot = path.join(root, "repo");
  const sidecarRoot = path.join(repoRoot, "sidecar");
  const outputBinary = path.join(repoRoot, "src-tauri", "binaries", "moor-sidecar-test");
  const cachePath = path.join(sidecarRoot, "dist", "moor-sidecar.sea-cache.json");
  const buildScriptPath = path.join(sidecarRoot, "scripts", "build-sidecar.mjs");

  mkdirSync(path.join(sidecarRoot, "src"), { recursive: true });
  mkdirSync(path.dirname(outputBinary), { recursive: true });
  mkdirSync(path.dirname(cachePath), { recursive: true });
  mkdirSync(path.dirname(buildScriptPath), { recursive: true });

  writeFileSync(path.join(sidecarRoot, "src", "index.ts"), "console.log('one');\n");
  writeFileSync(path.join(sidecarRoot, "package.json"), '{"name":"moor-sidecar"}\n');
  writeFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(buildScriptPath, "export {};\n");
  writeFileSync(outputBinary, "binary\n");

  return { root, repoRoot, sidecarRoot, outputBinary, cachePath, buildScriptPath };
}

test("getSeaBuildCacheState skips when fingerprint matches and binary exists", () => {
  const fixture = createBuildFixture();

  try {
    const firstState = getSeaBuildCacheState({
      repoRoot: fixture.repoRoot,
      sidecarRoot: fixture.sidecarRoot,
      outputBinary: fixture.outputBinary,
      cachePath: fixture.cachePath,
      buildScriptPath: fixture.buildScriptPath,
      nodeVersion: "v24.0.0",
      platform: "darwin",
      arch: "arm64",
    });
    assert.equal(firstState.shouldBuild, true);

    writeSeaBuildCache(fixture.cachePath, firstState.fingerprint);

    const secondState = getSeaBuildCacheState({
      repoRoot: fixture.repoRoot,
      sidecarRoot: fixture.sidecarRoot,
      outputBinary: fixture.outputBinary,
      cachePath: fixture.cachePath,
      buildScriptPath: fixture.buildScriptPath,
      nodeVersion: "v24.0.0",
      platform: "darwin",
      arch: "arm64",
    });

    assert.equal(secondState.shouldBuild, false);
    assert.equal(secondState.reason, "up-to-date");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("getSeaBuildCacheState rebuilds when sidecar source changes", () => {
  const fixture = createBuildFixture();

  try {
    const firstState = getSeaBuildCacheState({
      repoRoot: fixture.repoRoot,
      sidecarRoot: fixture.sidecarRoot,
      outputBinary: fixture.outputBinary,
      cachePath: fixture.cachePath,
      buildScriptPath: fixture.buildScriptPath,
      nodeVersion: "v24.0.0",
      platform: "darwin",
      arch: "arm64",
    });
    writeSeaBuildCache(fixture.cachePath, firstState.fingerprint);

    writeFileSync(path.join(fixture.sidecarRoot, "src", "index.ts"), "console.log('two');\n");

    const changedState = getSeaBuildCacheState({
      repoRoot: fixture.repoRoot,
      sidecarRoot: fixture.sidecarRoot,
      outputBinary: fixture.outputBinary,
      cachePath: fixture.cachePath,
      buildScriptPath: fixture.buildScriptPath,
      nodeVersion: "v24.0.0",
      platform: "darwin",
      arch: "arm64",
    });

    assert.equal(changedState.shouldBuild, true);
    assert.equal(changedState.reason, "fingerprint-changed");

    const cacheFile = readFileSync(fixture.cachePath, "utf8");
    assert.match(cacheFile, /"hash"/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
