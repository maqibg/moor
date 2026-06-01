---
"moor": minor
---

Migrate from Node.js sidecar to unified Rust gateway

- **Remove Node.js sidecar entirely**: Delete the `sidecar/` package including all TypeScript source, build scripts, tests, and configuration. Implements ADR-0001: single in-process Rust gateway.
- **Complete Rust gateway features**: Add import service, config converter, import parser, audit redaction, and database migrations for the Rust implementation.
- **Refactor HTTP error handling**: Introduce `AppError` for consistent error responses across all HTTP routes.
- **Migrate to variable fonts**: Replace Google Fonts CDN with `@fontsource-variable` packages (Space Grotesk, Inter) for offline-first rendering and reduced external dependencies.
- **Improve server lifecycle**: Handle mid-start interruptions gracefully, add session cleanup for stopped servers during startup phase.
- **Update documentation**: Add CONTEXT.md, ADR-0001, update README translations (en, es, ja, zh) to reflect Rust-only architecture.
