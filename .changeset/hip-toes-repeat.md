---
"moor-sidecar": patch
---

feat: add support for HTTP headers in server configuration and JSON import

- Introduced `resolveHttpHeaders` function to resolve environment placeholders in HTTP headers.
- Updated `ServerManager` to store and handle headers in server configurations.
- Added `JsonImportEditor` component for importing and validating MCP JSON configurations.
- Enhanced `Servers` page to include HTTP headers input in the server creation form.
- Implemented JSON formatting and diagnostics for imported configurations.
- Updated tests to cover new functionality related to headers and JSON import.
