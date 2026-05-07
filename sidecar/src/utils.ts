import type { ParsedImport } from "@moor/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeParsed(...results: ParsedImport[]): ParsedImport {
  return {
    servers: results.flatMap((r) => r.servers),
    unsupported: results.flatMap((r) => r.unsupported),
    errors: results.flatMap((r) => r.errors),
    diagnostics: results.flatMap((r) => r.diagnostics),
  };
}
