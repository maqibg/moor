import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { lintGutter, linter, type Diagnostic } from "@codemirror/lint";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  formatJsonDiagnostic,
  getJsonImportDiagnostics,
  type ImportDiagnostic,
} from "@/lib/json-import-editor";

interface JsonImportEditorProps {
  value: string;
  placeholder: string;
  diagnostics: ImportDiagnostic[];
  onChange: (value: string) => void;
}

function toCodeMirrorDiagnostic(content: string, diagnostic: ImportDiagnostic): Diagnostic {
  const from = Math.min(diagnostic.offset ?? 0, content.length);
  const length = Math.max(diagnostic.length ?? 1, 1);
  return {
    from,
    to: Math.min(from + length, content.length),
    severity: "error",
    source: diagnostic.source,
    message: diagnostic.message,
  };
}

// 颜色一律走主题变量，编辑器外观随 data-theme 在明暗之间切换。
const moorEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontSize: "12px",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily:
      "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.65",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "var(--color-cursor-orange)",
    minHeight: "260px",
    padding: "12px 0",
  },
  ".cm-content ::selection": {
    color: "var(--foreground)",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--fg-04)",
    borderRight: "1px solid var(--fg-08)",
    color: "var(--fg-70)",
    fontFamily:
      "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(245, 78, 0, 0.045)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(245, 78, 0, 0.07)",
    color: "var(--foreground)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--fg-06)",
    border: "1px solid var(--fg-10)",
    color: "var(--fg-70)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    border: "1px solid var(--fg-12)",
    color: "var(--popover-foreground)",
    fontFamily: "var(--font-headline), system-ui, sans-serif",
  },
  ".cm-tooltip-lint": {
    borderRadius: "8px",
    padding: "6px 8px",
  },
  ".cm-diagnosticText": {
    color: "color-mix(in srgb, var(--destructive), var(--foreground) 20%)",
  },
  ".cm-placeholder": {
    color: "var(--fg-70)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(245, 78, 0, 0.16) !important",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

function isDocumentInDarkTheme(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

export function JsonImportEditor({
  value,
  placeholder,
  diagnostics,
  onChange,
}: JsonImportEditorProps) {
  // 主题是 useTheme 写在 documentElement 上的 data-theme，这里只跟随它。
  const [isDarkTheme, setIsDarkTheme] = useState(isDocumentInDarkTheme);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDarkTheme(root.dataset.theme === "dark");
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    syncTheme();
    return () => observer.disconnect();
  }, []);

  const extensions = useMemo(
    () => [
      json(),
      linter((view) => {
        const content = view.state.doc.toString();
        return getJsonImportDiagnostics(content).map((diagnostic) =>
          toCodeMirrorDiagnostic(content, diagnostic),
        );
      }),
      lintGutter(),
      // 保留 Moor 的布局与背景，优先于内置暗色主题。
      Prec.high(moorEditorTheme),
    ],
    [],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--fg-10)] bg-surface-200/40 focus-within:border-[var(--fg-20)]">
      <CodeMirror
        value={value}
        height="300px"
        placeholder={placeholder}
        basicSetup={{
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          lineNumbers: true,
        }}
        extensions={extensions}
        theme={isDarkTheme ? "dark" : "none"}
        onChange={onChange}
      />
      {diagnostics.length > 0 && (
        <div className="space-y-1 border-t border-error-warm/15 bg-error-warm/8 px-3 py-2">
          {diagnostics.map((diagnostic) => (
            <p
              key={`${diagnostic.offset ?? "root"}:${diagnostic.message}`}
              className="font-mono text-[11px] leading-relaxed text-[color-mix(in_srgb,var(--destructive),var(--foreground)_20%)]"
            >
              {formatJsonDiagnostic(diagnostic)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
