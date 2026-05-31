---
status: accepted
---

# Single Rust gateway; remove the Node sidecar

Moor's business layer existed twice — the Rust in-process Axum gateway (`src-tauri/src/sidecar/`) shipped in production, and a mirror Node sidecar (`sidecar/`) used only for the browser dev loop (`pnpm dev:all`) and an SEA standalone build. We are standardising on the **single Rust implementation** and removing the Node sidecar.

This supersedes AD-13 (the "keep both implementations consistent by hand" rule) and finalises AD-12: there is now one implementation, so behavioural drift is impossible by construction.

## Considered options

- **Conformance contract (keep both).** Language-neutral golden fixtures both adapters must pass in CI. Rejected: it pays for a second implementation that nothing ships, to serve a dev loop the sole contributor barely uses.
- **Single Rust implementation (chosen).** Delete the Node twin. Evidence: the release pipeline (`release.yml`) builds Rust-only via `tauri-action`; `tauri.conf.json` has `externalBin: []`; the SEA build is orphaned (never invoked by CI, never bundled). Production already proves Rust parity.

## Consequences

- `pnpm dev:all` (system-browser UI loop) and the SEA standalone build are dropped. Dev is `pnpm tauri dev` (Vite HMR still runs inside the WebView).
- `@moor/types` is now consumed only by the frontend and must match Rust's serde JSON by hand — a smaller, one-directional drift seam. Optional follow-up: generate TS types from Rust (`ts-rs`/`typeshare`).
- Before deleting `sidecar/`, port any edge-case tests that exist only in the Node suite into Rust `#[cfg(test)]` so coverage does not regress.
