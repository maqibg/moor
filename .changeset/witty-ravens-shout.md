---
"moor": patch
---

Surface per-server log files for failed MCP server startups. Lifecycle events (start attempt, failure reason, unexpected exit) and redacted stderr are now written to `logs/<server-id>.log` under the app data directory, and startup error banners on the server card and detail page include an "Open Logs" button that opens the log file directly (with the full path shown on hover).
