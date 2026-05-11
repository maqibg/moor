const TARGETS_BY_RUNTIME = new Map([
  ["darwin/arm64", "aarch64-apple-darwin"],
  ["darwin/x64", "x86_64-apple-darwin"],
  ["linux/x64", "x86_64-unknown-linux-gnu"],
  ["linux/arm64", "aarch64-unknown-linux-gnu"],
  ["win32/x64", "x86_64-pc-windows-msvc"],
  ["win32/arm64", "aarch64-pc-windows-msvc"],
]);

const SUPPORTED_TARGETS = new Set(TARGETS_BY_RUNTIME.values());

export function defaultTargetTriple(platform = process.platform, arch = process.arch) {
  const target = TARGETS_BY_RUNTIME.get(`${platform}/${arch}`);
  if (!target) {
    throw new Error(`Unsupported platform ${platform}/${arch}`);
  }
  return target;
}

export function resolveTargetTriple({
  envTargetTriple = process.env.MOOR_SIDECAR_TARGET_TRIPLE,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const target = envTargetTriple?.trim();
  if (!target) {
    return defaultTargetTriple(platform, arch);
  }

  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`Unsupported sidecar target triple: ${target}`);
  }
  return target;
}

export function binaryNameForTarget(targetTriple) {
  const suffix = targetTriple.includes("windows") ? ".exe" : "";
  return `moor-sidecar-${targetTriple}${suffix}`;
}

export function cacheFileNameForTarget(targetTriple) {
  return `moor-sidecar.${targetTriple}.sea-cache.json`;
}
