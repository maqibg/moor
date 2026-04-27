import { describe, expect, it } from "vite-plus/test";
import { selectImportCandidates } from "./import.js";

describe("selectImportCandidates", () => {
  it("returns only scanned servers not already present by name", () => {
    const candidates = selectImportCandidates(
      [
        { name: "github", connectionType: "stdio", command: "npx", source: "claude-code" },
        {
          name: "linear",
          connectionType: "http",
          url: "http://127.0.0.1:3000/mcp",
          source: "cursor",
        },
      ],
      new Set(["github"]),
    );

    expect(candidates).toEqual([
      {
        name: "linear",
        connectionType: "http",
        url: "http://127.0.0.1:3000/mcp",
        source: "cursor",
      },
    ]);
  });
});
