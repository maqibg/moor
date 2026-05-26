# Moor CI/CD Hardening Specification

> Version: 1.0 | Date: 2026-04-29

## 1. Background & Problems

The Moor project's GitHub Actions Release workflow has the following issues:

1. **Severe macos-13 runner queuing**: GitHub is gradually reducing Intel runner capacity. The number of available macos-13 instances is far fewer than macos-latest (ARM64), resulting in long wait times during peak hours.
2. **Future deprecation risk of macos-13**: GitHub may deprecate macos-13, which would completely break x86_64 builds.
3. **Missing CHANGELOG.md**: The project is configured with changeset but has never been used. The Release page shows "No CHANGELOG.md found."
4. **Cache key conflict risk**: The two jobs use different runner types, and the caching strategy does not account for architecture differences.

## 2. Design Decisions

### 2.1 Runner Strategy

**Decision**: Standardize on `macos-latest` and cross-compile x86_64 via Rosetta 2.

**Rationale**:

- Eliminates dependency on macos-13, completely resolving queuing issues.
- All runners are the same type, making caching more efficient (shared pnpm store).
- GitHub continues to expand ARM runner capacity, providing better availability than Intel runners.

**Trade-off**: The x86_64 job runs via Rosetta emulation, which is expected to increase build time by 10-20%.

### 2.2 Build Architecture

**Decision**: Production builds use Rust in-process Axum HTTP server. No Node SEA cross-compilation is required.

**Technical Principle**:

- The Tauri app bundles a Rust in-process HTTP server (`src-tauri/src/sidecar/http/`).
- `cargo build --target x86_64-apple-darwin` produces the x86_64 binary directly.
- No Node.js runtime or SEA packaging is involved in the production build chain.

### 2.3 Changelog Strategy

**Decision**: Keep the `@changesets/cli` workflow.

**Cold start handling**: Create an initial changeset file (`.changeset/initial-release.md`) to ensure the first `pnpm release` generates CHANGELOG.md.

**Release process**:

1. After development is complete, run `pnpm changeset` to create a change record.
2. Run `pnpm release` → `changeset version` generates CHANGELOG.md → git commit + tag.
3. Push the tag → CI automatically builds and creates a GitHub Release (with full changelog).

### 2.4 Caching Strategy

| Cache Target | Key Structure                            | Isolation Strategy                                                |
| ------------ | ---------------------------------------- | ----------------------------------------------------------------- |
| pnpm store   | `{runner.os}-pnpm-store-{lockfile hash}` | Shared (tarballs are architecture-independent)                    |
| Rust target/ | `{target}-no-cargo-bin-v1`               | Isolated by target (compiled artifacts are architecture-specific) |

### 2.5 macOS Signing

**Decision**: Do not implement signing/notarization for now; keep unsigned distribution.

Users need to right-click → Open on first launch, or run `xattr -rd com.apple.quarantine`. This prompt is already included in `extract-changelog.mjs`.

## 3. Workflow Configuration Specification

### 3.1 Trigger Conditions

```yaml
on:
  push:
    tags: ["v*"]
  workflow_dispatch:
```

### 3.2 Matrix Definition

```yaml
matrix:
  include:
    - platform: "macos-latest"
      target: "aarch64-apple-darwin"
    - platform: "macos-latest"
      target: "x86_64-apple-darwin"
    - platform: "windows-latest"
      target: "x86_64-pc-windows-msvc"
    - platform: "ubuntu-22.04"
      target: "x86_64-unknown-linux-gnu"
    - platform: "ubuntu-22.04-arm"
      target: "aarch64-unknown-linux-gnu"
```

### 3.3 Build Steps

| Step              | Description                                         | Key Parameters                                    |
| ----------------- | --------------------------------------------------- | ------------------------------------------------- |
| Checkout          | `actions/checkout@v4`                               | -                                                 |
| Setup Node        | `actions/setup-node@v4`                             | `node-version: 24`                                |
| Install pnpm      | `pnpm/action-setup@v4`                              | -                                                 |
| pnpm cache        | `actions/cache@v4`                                  | key: `{os}-pnpm-store-{lockfile hash}`            |
| Install deps      | `pnpm install --frozen-lockfile`                    | -                                                 |
| Version check     | `node scripts/sync-version.mjs --check`             | -                                                 |
| Extract changelog | `node scripts/extract-changelog.mjs`                | Output to `steps.changelog.outputs.body`          |
| Install Rust      | `actions-rust-lang/setup-rust-toolchain@v1`         | `target: ${{ matrix.target }}`                    |
| Rust cache        | Built-in (`actions-rust-lang/setup-rust-toolchain`) | `cache-key: ${{ matrix.target }}-no-cargo-bin-v1` |
| Build             | `tauri-apps/tauri-action@v0`                        | `args: "--target ${{ matrix.target }}"`           |

## 4. Build Chain Verification

Complete build chains:

```
macOS x86_64:
setup-node → pnpm install → tauri-action
                              └─ beforeBuildCommand: pnpm version:sync && pnpm build:frontend
                                 ├─ tsc -b
                                 └─ vp build (Vite)
                              └─ cargo build --target x86_64-apple-darwin
                                 └─ bundles .dmg with in-process Rust HTTP server

Windows x64:
setup-node → pnpm install → tauri-action
                              └─ beforeBuildCommand: pnpm version:sync && pnpm build:frontend
                                 ├─ tsc -b
                                 └─ vp build (Vite)
                              └─ cargo build --target x86_64-pc-windows-msvc
                                 └─ bundles Windows installers with in-process Rust HTTP server

Linux x86_64 / aarch64:
setup-node → install system deps (webkit2gtk, etc.) → pnpm install → tauri-action
                              └─ beforeBuildCommand: pnpm version:sync && pnpm build:frontend
                                 ├─ tsc -b
                                 └─ vp build (Vite)
                              └─ cargo build --target {x86_64-unknown-linux-gnu | aarch64-unknown-linux-gnu}
                                 └─ bundles .deb, .rpm, .AppImage with in-process Rust HTTP server
```

## 5. Version Management Architecture

### 5.1 Source of Truth

`moor-sidecar` (`sidecar/package.json`) serves as the single source of truth for the version number. Reason: changeset discovers pnpm workspace members, and `sidecar` is the primary package that changeset bumps directly.

### 5.2 Version Sync Flow

```
pnpm changeset version
  └─ bumps moor-sidecar version in sidecar/package.json
pnpm version:sync
  ├─ reads sidecar/package.json version (source)
  ├─ syncs → package.json (root)
  ├─ syncs → packages/types/package.json
  ├─ syncs → src-tauri/tauri.conf.json
  ├─ syncs → src-tauri/Cargo.toml
  └─ syncs → src-tauri/Cargo.lock
```

### 5.3 Changeset Configuration Changes

- Remove `fixed` option (root package `moor` is not a workspace member and cannot be discovered by changeset).
- `sync-version.mjs` source of truth changed from root `package.json` to `sidecar/package.json`.
- Targets changed from `[tauri.conf.json, Cargo.toml, sidecar/package.json]` to `[package.json, packages/types/package.json, tauri.conf.json, Cargo.toml, Cargo.lock]`.

## 6. File Change List

| File                            | Action  | Description                                       |
| ------------------------------- | ------- | ------------------------------------------------- |
| `.github/workflows/release.yml` | Rewrite | Standardize macos-latest matrix + Windows x64 job |
| `.changeset/initial-release.md` | New     | Initial changeset, solves CHANGELOG cold start    |
| `.changeset/config.json`        | Modify  | Remove `fixed` option                             |
| `scripts/sync-version.mjs`      | Modify  | Source of truth changed to sidecar/package.json   |

## 7. Verification Checklist

- [ ] YAML syntax is correct, CI can parse it normally.
- [ ] Both macOS jobs launch on macos-latest without queuing.
- [ ] x86_64 job produces x86_64 Rust binary.
- [ ] Windows job launches on windows-latest and produces x86_64-pc-windows-msvc Rust binary.
- [ ] Rust cache keys are isolated by target, no conflicts.
- [ ] pnpm cache is shared within each runner OS family.
- [ ] Release page contains complete changelog content.
- [ ] Generates both `_aarch64.dmg` and `_x86_64.dmg` artifacts.
- [ ] Generates Windows installer artifacts for x64 releases.
- [ ] `pnpm release` correctly generates CHANGELOG.md.
