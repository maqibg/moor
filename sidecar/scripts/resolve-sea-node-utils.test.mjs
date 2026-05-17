import assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";

import { buildPowerShellExpandArchiveInvocation } from "./resolve-sea-node-utils.mjs";

describe("resolve SEA Node helpers", () => {
  it("passes archive paths through the environment instead of interpolating them into code", () => {
    const zipPath = "C:\\Temp\\O'Brien\\node.zip";
    const runtimeRoot = "C:\\Temp\\runtime's-root";

    assert.deepEqual(buildPowerShellExpandArchiveInvocation(zipPath, runtimeRoot), {
      args: [
        "-NoProfile",
        "-Command",
        "Expand-Archive -LiteralPath $env:MOOR_SEA_ZIP_PATH -DestinationPath $env:MOOR_SEA_RUNTIME_ROOT",
      ],
      env: {
        MOOR_SEA_ZIP_PATH: zipPath,
        MOOR_SEA_RUNTIME_ROOT: runtimeRoot,
      },
    });
  });
});
