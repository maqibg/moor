import { appendFileSync, createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveTargetTriple } from "./build-sidecar-target.mjs";

const NODE_TARGETS = new Map([
  ["aarch64-apple-darwin", { platform: "darwin", arch: "arm64", dist: "darwin-arm64" }],
  ["x86_64-apple-darwin", { platform: "darwin", arch: "x64", dist: "darwin-x64" }],
]);

function parseArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function runCapture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout.trim();
}

function readNodeIdentity(execPath) {
  const output = runCapture(execPath, [
    "-p",
    "JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,execPath:process.execPath})",
  ]);
  return JSON.parse(output);
}

function writeGithubOutput(values) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function download(url, outputPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with status ${response.statusCode}: ${url}`));
        return;
      }

      const file = createWriteStream(outputPath);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function ensureNodeRuntime(target) {
  const nodeTarget = NODE_TARGETS.get(target);
  if (!nodeTarget) {
    throw new Error(`SEA Node resolver only supports macOS targets, got ${target}`);
  }

  if (process.platform === nodeTarget.platform && process.arch === nodeTarget.arch) {
    return process.execPath;
  }

  const version = process.version;
  const versionWithoutPrefix = version.replace(/^v/, "");
  const cacheRoot = path.join(process.env.RUNNER_TEMP || os.tmpdir(), "moor-sea-node");
  const runtimeRoot = path.join(cacheRoot, version, nodeTarget.dist);
  const execPath = path.join(runtimeRoot, "bin", "node");
  if (existsSync(execPath)) {
    return execPath;
  }

  mkdirSync(runtimeRoot, { recursive: true });
  const tarballName = `node-v${versionWithoutPrefix}-${nodeTarget.dist}.tar.gz`;
  const tarballPath = path.join(cacheRoot, tarballName);
  const url = `https://nodejs.org/dist/${version}/${tarballName}`;

  console.log(`Downloading SEA Node runtime: ${url}`);
  await download(url, tarballPath);

  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(runtimeRoot, { recursive: true });
  run("tar", ["-xzf", tarballPath, "-C", runtimeRoot, "--strip-components=1"]);

  return execPath;
}

const target = resolveTargetTriple({ envTargetTriple: parseArg("--target") ?? undefined });
const execPath = await ensureNodeRuntime(target);
const identity = readNodeIdentity(execPath);

writeGithubOutput({
  exec_path: execPath,
  version: identity.version,
  platform: identity.platform,
  arch: identity.arch,
});

console.log(`SEA Node runtime: ${identity.execPath}`);
console.log(`SEA Node identity: ${identity.version} ${identity.platform}/${identity.arch}`);
