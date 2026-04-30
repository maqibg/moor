import { describe, expect, it } from "vite-plus/test";
import {
  formatJsonDiagnostic,
  formatJsonImport,
  getJsonImportDiagnostics,
} from "./json-import-editor";

describe("JSON import editor utilities", () => {
  it("formats minified MCP JSON with two-space indentation", () => {
    const result = formatJsonImport(
      '{"mcpServers":{"demo":{"command":"npx","args":["-y","demo"]}}}',
    );

    expect(result.formatted).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.value).toBe(`{
  "mcpServers": {
    "demo": {
      "command": "npx",
      "args": [
        "-y",
        "demo"
      ]
    }
  }
}`);
  });

  it("preserves JSONC comments and trailing commas while formatting", () => {
    const result = formatJsonImport(`{"mcpServers":{// demo server
"demo":{"command":"npx",},},}`);

    expect(result.formatted).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.value).toContain("// demo server");
    expect(result.value).toContain('"command": "npx",');
  });

  it("returns diagnostics and leaves invalid JSONC unchanged", () => {
    const content = `{
  "mcpServers": {
    "broken": {
      "command": "npx"
      "args": ["-y", "broken-server"]
    }
  }
}`;
    const result = formatJsonImport(content);

    expect(result.formatted).toBe(false);
    expect(result.value).toBe(content);
    expect(result.diagnostics).toEqual([
      {
        source: "json-import",
        message: "CommaExpected",
        code: "CommaExpected",
        line: 5,
        column: 7,
        offset: 65,
        length: 6,
      },
    ]);
    expect(formatJsonDiagnostic(result.diagnostics[0])).toBe("Line 5, Column 7: CommaExpected");
  });

  it("reports diagnostics without formatting side effects", () => {
    expect(getJsonImportDiagnostics('{"mcpServers":}')).toEqual([
      {
        source: "json-import",
        message: "ValueExpected",
        code: "ValueExpected",
        line: 1,
        column: 15,
        offset: 14,
        length: 1,
      },
    ]);
  });
});
