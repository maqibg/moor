export function buildPowerShellExpandArchiveInvocation(zipPath, runtimeRoot) {
  return {
    args: [
      "-NoProfile",
      "-Command",
      "Expand-Archive -LiteralPath $env:MOOR_SEA_ZIP_PATH -DestinationPath $env:MOOR_SEA_RUNTIME_ROOT",
    ],
    env: {
      MOOR_SEA_ZIP_PATH: zipPath,
      MOOR_SEA_RUNTIME_ROOT: runtimeRoot,
    },
  };
}
