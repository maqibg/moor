# @moor/types

## 0.5.2

### Patch Changes

- Add Windows platform support and improve tool exposed name strategy
  - Add Windows x64 CI/CD build job producing installers
  - Adapt stdio environment handling for Windows (case-insensitive PATH, semicolon separator, PATHEXT resolution)
  - Conditionally compile tray icons per platform (macOS template icon / Windows regular icon)
  - Unify tool exposed names to `{serverSlug}__{toolName}` format, with shortest unique server ID prefix for slug collisions
  - Add `_meta.serverName` field to MCP gateway tools/list response
  - Switch home directory resolution to `dirs::home_dir()` for Windows compatibility

## 0.5.1

### Patch Changes

- Refactor settings management to use database instead of file system, and enhance Rust toolchain setup in release workflow

## 0.4.0

### Minor Changes

- Implement server ordering API and UI, enhance import API with improved candidate selection and error handling, refactor server management and tool catalog services, improve API error handling and validation responses, and add IPC patterns documentation with macOS login autostart improvements.

## 0.3.0

### Patch Changes

- Moor v0.3.0 — Settings Center, SSE, React Query migration and full Sidecar refactor

  **Features:**
  - Settings Center with General / Appearance / Advanced groups (9 configurable items)
  - SSE auto-reconnection and real-time data streaming
  - React Query data layer migration (Dashboard, Profiles, Servers, ServerDetail, ProfileDetail)
  - stdio transport mode for MCP servers
  - Configuration converter for Claude Code, Codex, OpenCode and Cursor
  - Audit log service
  - Server lifecycle management with auto-start support
  - Session manager

  **Frontend:**
  - New Settings and AuditLogs pages
  - New shared components: ConverterPanel, CodeBlock, KeyValueTable, StatCard, DetailPageHeader
  - 6 new shadcn/ui components (Select, Checkbox, Textarea, Label, Separator, Skeleton)
  - SSE Context and useSettings / useTheme hooks
  - ServerCard and ScrollArea component refinements

  **Sidecar:**
  - Service layer extraction: Profiles, Settings, Import, Audit Log
  - Server Manager refactored to lifecycle-based architecture
  - API schemas layer with Zod v4 validation
  - DB layer enhancements (server-repository, tool-catalog)
  - Enhanced client config scanner with Cursor support

  **Tauri:**
  - Major Rust backend enhancements in lib.rs (286+ lines added)
  - Settings persistence and sidecar port management

  **Fixes:**
  - Node.js version requirement updated to 22+
  - Enhanced config import documentation
  - Unified error and warning messages to English
