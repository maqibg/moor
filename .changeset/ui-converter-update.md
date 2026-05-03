---
"moor-sidecar": minor
---

feat: add client configuration converter and new shadcn/ui components

**Sidecar:**

- Add configuration converter supporting Claude Code, Codex, OpenCode, and Cursor
- Add `/api/import/convert` and `/api/import/parse` endpoints
- Enhance scanner to support Cursor client configs
- Add formatter functions for each client output format
- Add sidecar build cache script for faster rebuilds
- Refactor version sync scripts with core extraction and tests

**Frontend:**

- Add 6 new shadcn/ui components based on Radix UI: Select, Checkbox, Textarea, Label, Separator, Skeleton
- Replace native `<select>`, `<input type="checkbox">`, and `<textarea>` elements with shadcn/ui equivalents
- Add `ConverterPanel` component for cross-client MCP configuration conversion
- Add `CodeBlock` shared component with copy-to-clipboard support
- Fix `ServerCard` side-stripe border anti-pattern; use background tint for status indication
- Unify icon button size system: `icon-sm` (32px) for dense UIs, `icon` (36px) standard
- Enhance card close button visibility with 20px icons and stronger hover feedback
- Enhance `ScrollArea` with Radix UI primitives and warm-toned scrollbar
- Update `README.md` and `README.zh.md` with Radix UI and latest feature docs
