# moor-sidecar

## 0.3.0-beta.3

### Patch Changes

- feat: add auto-start for servers, React Query migration, and SSE reconnection

  **Features:**
  - Add auto-start functionality for servers with DB schema updates
  - Enhance SSE connection with automatic reconnection logic
  - Improve JSON parsing error handling in AddServerForm

  **Refactors:**
  - Migrate Dashboard, ProfileDetail, ServerDetail, and Servers pages to React Query
  - Introduce AddServerForm and ConfigImportPanel components
  - Remove unused hooks and simplify components
  - Unify profile and server interfaces to camelCase naming convention
  - Update all error and warning messages to English for consistency
  - Update test imports to use vite-plus/test and enhance test configurations

  **Fixes:**
  - Update moor version to 0.2.1-beta.1 in Cargo.lock

## 0.3.0-beta.2

### Minor Changes

- feat: add client configuration converter and new shadcn/ui components

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

## 0.2.1-beta.1

### Patch Changes

- feat: add stdio server management and legacy data migration
  - Support stdio command transport for MCP servers
  - Add legacy data directory migration for ~/.moor
  - Fix TypeScript resolution for node: prefixed modules

## 0.2.1-beta.0

### Patch Changes

- 584ab23: feat: add support for HTTP headers in server configuration and JSON import
  - Introduced `resolveHttpHeaders` function to resolve environment placeholders in HTTP headers.
  - Updated `ServerManager` to store and handle headers in server configurations.
  - Added `JsonImportEditor` component for importing and validating MCP JSON configurations.
  - Enhanced `Servers` page to include HTTP headers input in the server creation form.
  - Implemented JSON formatting and diagnostics for imported configurations.
  - Updated tests to cover new functionality related to headers and JSON import.

## 0.2.0

### Minor Changes

- 536ae72: Initial release of Moor - Local MCP Gateway Manager

### Patch Changes

- 536ae72: Harden release pipeline and fix changeset versioning
  - Unify CI runners on macos-latest with Rosetta 2 cross-compilation for x86_64,eliminating macos-13 queue bottlenecks
  - Fix GitHub Actions cache keys and add per-arch Node.js setup to ensure correctsidecar binary targets
  - Remove fixed version grouping between moor and moor-sidecar in changeset config
  - Refactor version-sync scripts to use sidecar/package.json as the source of truthand standardize JSON-based version writing
  - Auto-sync sidecar/CHANGELOG.md to repo root during release
  - Add CI/CD hardening spec documentation

- Harden release pipeline and fix changeset versioning
  - Unify CI runners on macos-latest with Rosetta 2 cross-compilation for x86_64, eliminating macos-13 queue bottlenecks
  - Fix GitHub Actions cache keys and add per-arch Node.js setup to ensure correct sidecar binary targets
  - Remove fixed version grouping between moor and moor-sidecar in changeset config
  - Refactor version-sync scripts to use sidecar/package.json as the source of truth and standardize JSON-based version writing
  - Auto-sync sidecar/CHANGELOG.md to repo root during release
  - Add CI/CD hardening spec documentation
