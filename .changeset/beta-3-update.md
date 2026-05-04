---
"moor-sidecar": patch
---

feat: add auto-start for servers, React Query migration, and SSE reconnection

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
