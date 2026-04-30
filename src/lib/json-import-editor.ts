import {
  applyEdits,
  format,
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError,
} from "jsonc-parser";

export interface ImportDiagnostic {
  source: string;
  message: string;
  code?: string;
  line?: number;
  column?: number;
  offset?: number;
  length?: number;
}

export interface JsonImportFormatResult {
  value: string;
  formatted: boolean;
  diagnostics: ImportDiagnostic[];
}

function lineColumnAtOffset(content: string, offset: number): { line: number; column: number } {
  const previousLineBreak = content.lastIndexOf("\n", Math.max(0, offset - 1));
  return {
    line: content.slice(0, offset).split("\n").length,
    column: offset - previousLineBreak,
  };
}

function toJsonDiagnostic(source: string, content: string, error: ParseError): ImportDiagnostic {
  const position = lineColumnAtOffset(content, error.offset);
  const code = printParseErrorCode(error.error);
  return {
    source,
    message: code,
    code,
    line: position.line,
    column: position.column,
    offset: error.offset,
    length: error.length,
  };
}

export function getJsonImportDiagnostics(
  content: string,
  source = "json-import",
): ImportDiagnostic[] {
  if (!content.trim()) return [];

  const errors: ParseError[] = [];
  parseJsonc(content, errors, { allowTrailingComma: true });
  return errors.map((error) => toJsonDiagnostic(source, content, error));
}

export function formatJsonDiagnostic(diagnostic: ImportDiagnostic): string {
  if (diagnostic.line && diagnostic.column) {
    return `Line ${diagnostic.line}, Column ${diagnostic.column}: ${diagnostic.message}`;
  }
  return diagnostic.message;
}

export function formatJsonImport(content: string): JsonImportFormatResult {
  const diagnostics = getJsonImportDiagnostics(content);
  if (diagnostics.length > 0 || !content.trim()) {
    return { value: content, formatted: false, diagnostics };
  }

  const edits = format(content, undefined, {
    eol: "\n",
    insertSpaces: true,
    tabSize: 2,
  });

  return {
    value: applyEdits(content, edits),
    formatted: edits.length > 0,
    diagnostics: [],
  };
}
