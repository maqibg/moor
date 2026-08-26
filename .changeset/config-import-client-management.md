---
"moor": patch
---

feat(config): configuration import and client management enhancements

- Client registry now declares a canonical gateway entry name; Kimi Code and dsh pin the entry to `moor-mcp`, so re-importing a client config replaces the handwritten entry instead of registering a second gateway connection.
- ConverterPanel loads client snippets dynamically from the API instead of a hardcoded client list, and snippets now expose a stable `clientId`.
- ServerCard and ServerDetail surface server status errors more robustly, and a mutation lock prevents concurrent execution of critical operations across hooks.
- ConfigImportPanel disables the import button while an import is in progress.
