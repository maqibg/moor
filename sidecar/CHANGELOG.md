# moor-sidecar

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
