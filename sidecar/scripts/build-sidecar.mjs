import { build } from "esbuild";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidecarRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(sidecarRoot, "..");
const pkg = JSON.parse(readFileSync(path.join(sidecarRoot, "package.json"), "utf8"));
const distDir = path.join(sidecarRoot, "dist");
const bundlePath = path.join(distDir, "moor-sidecar.cjs");
const seaBlobPath = path.join(distDir, "moor-sidecar.blob");
const seaConfigPath = path.join(distDir, "sea-config.json");
const tauriBinDir = path.join(repoRoot, "src-tauri", "binaries");
const bundleOnly = process.argv.includes("--bundle-only");
const jsoncParserEsmEntry = "jsonc-parser/lib/esm/main.js";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: sidecarRoot, ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function targetTriple() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-gnu";
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  if (platform === "win32" && arch === "arm64") return "aarch64-pc-windows-msvc";
  throw new Error(`Unsupported platform ${platform}/${arch}`);
}

function binaryName() {
  const suffix = process.platform === "win32" ? ".exe" : "";
  return `moor-sidecar-${targetTriple()}${suffix}`;
}

function assertSeaBundleSafe() {
  const bundle = readFileSync(bundlePath, "utf8");
  const failures = [];
  if (bundle.includes("jsonc-parser/lib/umd/main.js")) {
    failures.push("jsonc-parser UMD entry was bundled");
  }
  if (bundle.includes('require2("./impl/format")') || bundle.includes('require("./impl/format")')) {
    failures.push('jsonc-parser relative require("./impl/format") remains in bundle');
  }
  if (!bundle.includes("jsonc-parser/lib/esm/main.js")) {
    failures.push("jsonc-parser ESM entry was not bundled");
  }
  if (failures.length > 0) {
    throw new Error(`Sidecar bundle is not SEA-safe: ${failures.join("; ")}`);
  }
}

mkdirSync(distDir, { recursive: true });
mkdirSync(tauriBinDir, { recursive: true });

await build({
  entryPoints: [path.join(sidecarRoot, "src", "index.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: false,
  alias: {
    "jsonc-parser": jsoncParserEsmEntry,
  },
  banner: {
    js: "globalThis.__moorSidecar = true;",
  },
  define: {
    APP_VERSION: JSON.stringify(pkg.version),
  },
});
assertSeaBundleSafe();

if (bundleOnly) {
  console.log(`Bundled sidecar to ${bundlePath}`);
  process.exit(0);
}

writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: seaBlobPath,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
    },
    null,
    2,
  ),
);

run(process.execPath, ["--experimental-sea-config", seaConfigPath]);

const outputBinary = path.join(tauriBinDir, binaryName());
copyFileSync(process.execPath, outputBinary);
chmodSync(outputBinary, 0o755);

if (process.platform === "darwin") {
  spawnSync("codesign", ["--remove-signature", outputBinary], { stdio: "ignore" });
}

const postjectBin = path.join(
  sidecarRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "postject.cmd" : "postject",
);
const postjectArgs = [
  outputBinary,
  "NODE_SEA_BLOB",
  seaBlobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
];
if (process.platform === "darwin") {
  postjectArgs.push("--macho-segment-name", "NODE_SEA");
}
run(postjectBin, postjectArgs);

if (process.platform === "darwin") {
  run("codesign", ["--sign", "-", "--force", outputBinary]);
}

console.log(`Built Tauri sidecar binary at ${outputBinary}`);
