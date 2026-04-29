---
"moor-sidecar": patch
---

Harden release pipeline and fix changeset versioning

- Unify CI runners on macos-latest with Rosetta 2 cross-compilation for x86_64,eliminating macos-13 queue bottlenecks
- Fix GitHub Actions cache keys and add per-arch Node.js setup to ensure correctsidecar binary targets
- Remove fixed version grouping between moor and moor-sidecar in changeset config
- Refactor version-sync scripts to use sidecar/package.json as the source of truthand standardize JSON-based version writing
- Auto-sync sidecar/CHANGELOG.md to repo root during release
- Add CI/CD hardening spec documentation
