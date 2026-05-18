# Moor Version Management Specification

## Overview

Moor uses `@changesets/cli` for automatic version management and changelog generation. The version number in `sidecar/package.json` is the single source of truth (since it is the workspace member directly managed by changeset), and is automatically synchronized to all target files during the build.

## Version Number Distribution

The version number in `sidecar/package.json` is the single source of truth (a workspace member directly managed by changeset), and is synchronized to the following locations via `sync-version.mjs`:

| File                          | Sync Method                                             |
| ----------------------------- | ------------------------------------------------------- |
| `package.json` (root)         | Script writes to `version` field                        |
| `packages/types/package.json` | Script writes to `version` field                        |
| `src-tauri/tauri.conf.json`   | Script writes to `version` field                        |
| `src-tauri/Cargo.toml`        | Script regex replaces `version = "..."`                 |
| `src-tauri/Cargo.lock`        | Script regex replaces version in `moor` package section |

Runtime version numbers are obtained via build-time injection:

| Location                                            | Injection Method                           |
| --------------------------------------------------- | ------------------------------------------ |
| `sidecar/src/mcp/gateway.ts`                        | esbuild `define` → `APP_VERSION` constant  |
| `sidecar/src/services/server-manager.ts` (2 places) | esbuild `define` → `APP_VERSION` constant  |
| `src/components/layout/Sidebar.tsx`                 | Vite `define` → `__APP_VERSION__` constant |

## Daily Development Workflow

### Adding a Changeset

After completing a meaningful change, add a changeset:

```bash
pnpm changeset
```

Interactive selection:

1. Change type: `patch` (fix) / `minor` (feature) / `major` (breaking)
2. Change description (Markdown format, appears in the changelog)

Generated file: `.changeset/<random-name>.md`

### Releasing

```bash
pnpm release
```

Automatically executes:

1. `changeset version` — consumes pending changesets, updates `package.json` version and `CHANGELOG.md`
2. `version:sync` — syncs version number to `package.json` / `packages/types/package.json` / `tauri.conf.json` / `Cargo.toml`
3. `git add -A && git commit` — commits all version-related files
4. `git tag v<version>` — creates version tag

Push to trigger CI:

```bash
git push --follow-tags origin main
```

### Pre-release Versions

```bash
# Enter beta mode and release
pnpm release:beta

# Enter rc mode and release
pnpm release:rc

# Exit pre-release mode
pnpm release:exit
```

## Version Sync Mechanism

### Sync Script

`scripts/sync-version.mjs` is responsible for version synchronization:

- Reads the `version` from `sidecar/package.json` as the source of truth.
- Syncs to root `package.json`, `tauri.conf.json`, `Cargo.toml`.
- `--check` mode: only verifies consistency, does not write (used in CI).

### Build-time Auto-sync

`beforeBuildCommand` and `beforeDevCommand` in `src-tauri/tauri.conf.json` have been prefixed with `pnpm version:sync &&`, ensuring version consistency before every build.

### CI Verification

The GitHub Actions Release workflow executes `node scripts/sync-version.mjs --check` before building. If versions are inconsistent, the build fails.

## Changelog

- `@changesets/cli` automatically maintains the root `CHANGELOG.md`.
- Changes are categorized by type: Minor (features), Patch (fixes), Major (breaking).
- CI automatically extracts the latest version content from `CHANGELOG.md` as GitHub Release Notes.

## Configuration

### Changesets Config (`.changeset/config.json`)

- **Version sync**: Via `sync-version.mjs`, sync `sidecar/package.json` version number to root `package.json`, `tauri.conf.json`, `Cargo.toml`.
- **No npm publish**: `privatePackages: { version: true, tag: false }`
- **No auto commit**: `commit: false` (controlled by release script)

### CI Release Workflow

- Trigger: push `v*` tag or manual trigger.
- Build targets: macOS Apple Silicon + Intel.
- Release method: Draft Release (requires manual review before publishing).
- Pre-release detection: automatically marked as prerelease when tag contains `-beta.` / `-rc.` / `-alpha.`.

## Command Quick Reference

| Command                     | Purpose                                         |
| --------------------------- | ----------------------------------------------- |
| `pnpm changeset`            | Add a changeset                                 |
| `pnpm release`              | Execute release (version + sync + commit + tag) |
| `pnpm release:beta`         | Publish a beta version                          |
| `pnpm release:rc`           | Publish an rc version                           |
| `pnpm release:exit`         | Exit pre-release mode                           |
| `pnpm version:sync`         | Manually sync version numbers                   |
| `pnpm version:sync --check` | Verify version consistency (CI)                 |
