# Deep Interview Spec: Moor — Local MCP Manager for AI Agents

## Metadata

- Interview ID: moor-deep-interview-2026-04-28
- Rounds: 12
- Final Ambiguity Score: 17.4%
- Type: Greenfield
- Generated: 2026-04-28
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown

| Dimension          | Score | Weight | Weighted  |
| ------------------ | ----- | ------ | --------- |
| Goal Clarity       | 0.88  | 0.40   | 0.352     |
| Constraint Clarity | 0.88  | 0.30   | 0.264     |
| Success Criteria   | 0.70  | 0.30   | 0.210     |
| **Total Clarity**  |       |        | **0.826** |
| **Ambiguity**      |       |        | **17.4%** |

## Goal

Build a local MCP console + gateway application running on macOS. Moor acts as a **Smart Aggregator**, aggregating multiple MCP servers (stdio + HTTP/SSE), filtering tools by Profile, and exposing them to AI Agents such as Claude Code, Codex, Cursor, and OpenCode through a single HTTP endpoint (`http://127.0.0.1:<port>/mcp`). All operations are observable, auditable, and hot-swappable.

> **Status Note**: This is the MVP-phase spec (2026-04-28). Several features marked as deferred or excluded below — such as Cursor support, Config Converter, and Windows builds — have since been implemented in subsequent iterations. The production architecture also evolved from a bundled Node.js sidecar to a Rust in-process Axum HTTP server.

## Core Architecture Decisions (from Interview)

### AD-1: Gateway Role — Smart Aggregator

- **Decision**: Moor is a Smart Aggregator, not a transparent proxy.
- **Why**: Needs to filter tools by Profile, with built-in logging and security audit capabilities.
- **Consequences**: Moor needs to fully implement both MCP server and MCP client sides.
  - Server side: Exposes `tools/list`, `tools/call`, `resources/list`, etc. to the Agent.
  - Client side: Connects to backend MCP servers, aggregates and filters responses.

### AD-2: Protocol Support — stdio + HTTP/SSE Complete

- **Decision**: MVP supports both stdio and HTTP/SSE MCP server connection methods simultaneously.
- **Why**: Covers the broadest range of server types; users don't need to distinguish.
- **Consequences**: Sidecar needs to manage the lifecycle of two types of connections:
  - stdio: Spawn child processes, manage stdin/stdout pipes.
  - HTTP/SSE: Maintain long-lived connections, handle reconnections.

### AD-3: Data Model — Profile Only (No Workspace for MVP)

- **Decision**: MVP only has the Profile concept; Workspace is deferred.
- **Why**: Simplifies the data model. Profile is sufficient to cover the need for "different server combinations in different scenarios."
- **Profile Definition**: A set of MCP server configurations + each server's enabled status + each tool's toggle status.
- **Consequences**: Data model is simplified to Profile → Server → Tool three layers.

### AD-4: App Lifecycle — Tray + Background Daemon

- **Decision**: Closing the window minimizes to the macOS tray; the gateway continues to run.
- **Why**: The Agent may call tools at any time; the gateway needs to be resident.
- **Consequences**:
  - Need to implement tray icon + right-click menu (status, open, quit).
  - Node sidecar process lifecycle is managed by the Tauri Rust layer.
  - Need to handle sidecar crash restart logic.

### AD-5: Safety Model — Audit Log Only for MVP

- **Decision**: MVP does not do real-time interception; only audit logging.
- **Why**: Real-time interception involves asynchronously pausing MCP requests + popup interaction, which is highly complex.
- **Consequences**:
  - MVP feature #6 (request logs) and #7 (security confirmation) are merged into "request audit log."
  - Log records: who called, which tool, parameters, duration, result/error.
  - Subsequent iterations can add "mark destructive tool" + "real-time confirmation popup."

### AD-6: IPC Architecture — Hybrid

- **Decision**: System operations go through Tauri IPC → Rust; business operations go through WebView → HTTP → Sidecar.
- **Why**: Rust handles system-level capabilities (Keychain, tray, file permissions), while Sidecar handles MCP protocol and business logic.
- **Consequences**:
  - Rust layer: macOS Keychain, tray icon, window management, sidecar process management.
  - Node sidecar: MCP gateway, server management, profile management, logging, SQLite read/write.
  - Sidecar exposes local HTTP API (e.g., `http://127.0.0.1:<port>/api/`).
  - WebView calls sidecar API directly via `fetch()`.

### AD-7: Config Import — Progressive Scan

- **Decision**: Automatically scan Claude Code, Codex, OpenCode, and Cursor configurations; manually add others.
- **Why**: These four are the most common and have fixed configuration paths; other clients are covered via manual addition.
- **Scan Paths**:
  - Claude Code: `~/.claude/settings.json` → `mcpServers` field
  - Codex: `~/.codex/config.toml` → `mcp_servers` field
  - OpenCode: `~/.config/opencode/opencode.json` / `.jsonc` → `mcp` field
  - Cursor: `~/.cursor/mcp.json` → `mcpServers` field
  - Manual: User inputs command + args + env
- **Consequences**: Need to parse JSON and TOML formats.

### AD-8: Profile Routing — Global Active Profile

- **Decision**: Only one Active Profile at any given time, shared by all Agents.
- **Why**: The simplest routing model; a single endpoint is sufficient.
- **Endpoint**: `http://127.0.0.1:<port>/mcp` (no URL routing)
- **Consequences**: Agent-side configurations are unified to the same URL.

### AD-9: Tool Toggle — Server-Level First, Tool-Level Secondary

- **Decision**: Main switch is at the server level; tool-level is in a secondary panel on the server details page.
- **Why**: Most users only need to toggle the entire server; tool-level is an advanced need.
- **Implementation**: Moor filters out disabled tools when returning `tools/list` to the Agent.
- **Consequences**: Server details page needs an expandable tool list panel.

### AD-10: Config Write-Back — Show Instructions + One-Click Copy

- **Decision**: Moor does not directly modify client configuration files; instead, it generates configuration instructions and code snippets.
- **Why**: Zero intrusion, no file permission risks, no format compatibility issues.
- **Implementation**: One card per client, displaying CLI command + JSON snippet + copy button.
- **Consequences**: Safer, but requires one manual step from the user.

### AD-11: Profile Switching — Hot-Swap (No Disconnect)

- **Decision**: Switching Profiles does not disconnect the Agent connection; changes are automatically reflected on the next `tools/list`.
- **Why**: The smoothest UX, does not interrupt the Agent workflow.
- **Consequences**: If the Agent is currently using a removed tool, the next `tools/call` returns an error.

### AD-12: Gateway Packaging — Rust In-Process HTTP Server (Evolved)

- **Original Decision (MVP)**: Node sidecar was planned to be compiled as a standalone binary (pkg/SEA) and packaged into Moor.app.
- **Evolved Decision**: The production gateway is now a **Rust in-process Axum HTTP server** embedded directly in the Tauri app. No external Node.js runtime or sidecar process is required.
- **Why**: Better performance, smaller bundle size, simpler lifecycle management, and no Node.js SEA compatibility risks.
- **Development**: Node.js sidecar (Hono) is still used for `pnpm dev:all` / `pnpm sidecar` for faster iteration.

## Tech Stack (Confirmed)

```
Moor.app
├─ UI Layer: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
├─ Desktop Layer: Tauri 2 / Rust
│   ├─ Window management + tray icon
│   ├─ macOS Keychain access
│   ├─ Sidecar process lifecycle management (dev mode only)
│   └─ File permissions
├─ Gateway Daemon
│   ├─ Production: Rust in-process Axum HTTP server (no external sidecar)
│   ├─ Development: Node.js / TypeScript sidecar (Hono, via tsx watch)
│   ├─ MCP protocol: @modelcontextprotocol/sdk
│   ├─ Server management (stdio spawn + HTTP/SSE client)
│   ├─ Profile management + tool filtering
│   ├─ Request audit logging
│   └─ SQLite storage
├─ Local Storage: SQLite
│   ├─ servers (configs, status)
│   ├─ profiles (server groups + tool toggles)
│   └─ audit_logs (tool calls, params, results, errors)
├─ IPC: WebView ↔ HTTP ↔ Gateway (business), WebView ↔ Tauri IPC ↔ Rust (system)
└─ Design: Cursor-inspired warm minimalism (DESIGN.md + Stitch screens)
```

## Data Model

```
Profile
├─ id: uuid
├─ name: string (e.g., "coding", "research")
├─ is_active: boolean
├─ created_at: timestamp
└─ updated_at: timestamp

MCPServer
├─ id: uuid
├─ name: string (e.g., "github", "filesystem")
├─ connection_type: "stdio" | "http"
├─ command: string? (for stdio)
├─ args: string[]? (for stdio)
├─ url: string? (for http)
├─ env: Record<string, string>
├─ headers: Record<string, string>? (for http)
├─ working_dir: string?
├─ auto_start: boolean
├─ sort_order: integer (display order, default 0)
├─ status: "stopped" | "starting" | "running" | "error"
├─ error_message: string? (human-readable error when status is "error")
├─ created_at: timestamp
└─ updated_at: timestamp

ProfileServer (join table)
├─ profile_id: uuid → Profile
├─ server_id: uuid → MCPServer
├─ enabled: boolean (server-level toggle)
└─ disabled_tools: string[] (tool-level deny list)

ToolDiscovery (cached)
├─ server_id: uuid → MCPServer
├─ tool_name: string (internal name from the MCP server)
├─ exposed_name: string (name exposed to AI Agents via the gateway)
├─ description: string
├─ input_schema: JSON
└─ discovered_at: timestamp

AuditLog
├─ id: uuid
├─ timestamp: datetime
├─ profile_id: uuid
├─ server_id: uuid
├─ tool_name: string
├─ arguments: JSON
├─ result: JSON?
├─ error: string?
├─ duration_ms: integer
└─ agent_info: string? (User-Agent or identifier)
```

## API Design (Sidecar HTTP API)

```
# Server Management
GET    /api/servers                    # List all servers
POST   /api/servers                    # Add server
GET    /api/servers/:id                # Get server detail
PUT    /api/servers/:id                # Update server config
DELETE /api/servers/:id                # Remove server
POST   /api/servers/:id/start          # Start server
POST   /api/servers/:id/stop           # Stop server
GET    /api/servers/:id/tools          # Get discovered tools

# Profile Management
GET    /api/profiles                   # List all profiles
POST   /api/profiles                   # Create profile
PUT    /api/profiles/:id               # Update profile
DELETE /api/profiles/:id               # Delete profile
PUT    /api/profiles/:id/activate      # Set as active profile
PUT    /api/profiles/:id/servers/:sid  # Update server toggle + disabled_tools

# Audit Logs
GET    /api/logs                       # Query logs (with filters)
GET    /api/logs/stats                 # Aggregate statistics

# Import
POST   /api/import/scan                # Scan local client configs
POST   /api/import/parse               # Preview pasted JSON import
POST   /api/import/execute             # Execute import
POST   /api/import/convert             # Convert configs between clients

# MCP Gateway (for Agent connections)
ALL    /mcp                            # MCP protocol endpoint (Streamable HTTP)
```

## UI Screens (from Stitch Design)

Based on Stitch project screens + interview decisions:

### 1. Dashboard

- Active profile indicator + quick switch
- Server status overview (running/stopped/error counts)
- Recent audit log entries
- Quick actions: add server, switch profile, view logs

### 2. Server Management

- Server list with status indicators
- Per-server: enable/disable toggle, start/stop button
- Server detail: command preview, environment variables, working directory
- Tool discovery panel (expandable): list of tools with toggle switches
- Add server: auto-import from Claude Code/Cursor + manual entry

### 3. Client Configuration

- Per-client cards: Claude Code, Cursor, Codex, OpenCode
- Each card shows: config snippet, CLI command, one-click copy button
- Status indicator: connected/disconnected (based on recent activity)

### 4. Profiles

- Profile list with active indicator
- Create/edit profile: name + server selection
- Per-server in profile: enable/disable + tool-level toggles (secondary panel)
- Delete profile (with confirmation)

### 5. Audit Logs

- Filterable log table: time, server, tool, status, duration
- Log detail expand: full arguments + result
- Statistics: tool usage frequency, error rate, avg duration

## Non-Goals (Explicitly Excluded from MVP)

- ❌ Real-time safety confirmation / tool interception (deferred)
- ❌ Workspace concept (deferred to post-MVP)
- ❌ URL-based profile routing (/mcp/{profile})
- ❌ Agent auto-detection
- ❌ OAuth 2.0 support
- ❌ Remote deployment / Docker
- ❌ Smart routing (vector semantic search)
- ❌ Rate limiting / caching
- ❌ Config file direct modification
- ❌ Auto-update mechanism
- ❌ Windows / Linux support (macOS only) — _Partially evolved: Windows x64 CI builds are now enabled, though macOS remains the primary target._

## Acceptance Criteria

- [ ] Moor.app can be installed and launched on macOS without pre-installing Node.js.
- [ ] Gateway continues to run after closing the window (tray icon), and Agent can call tools normally.
- [ ] Can automatically scan and import MCP configurations from Claude Code and Cursor.
- [ ] Can manually add MCP servers (both stdio and HTTP/SSE types).
- [ ] Each server can be independently started/stopped, with real-time status display.
- [ ] Profiles can be created, edited, and deleted; global switching is Hot-Swap.
- [ ] Tool-level toggles are operable on the server details page; disabled tools are immediately invisible to the Agent.
- [ ] All tool calls are recorded in the audit log, filterable by server/tool/time.
- [ ] Single endpoint (`http://127.0.0.1:<port>/mcp`) responds normally to MCP protocol.
- [ ] Client configuration page can generate configuration instructions for each Agent and copy with one click.
- [ ] UI follows the Cursor-style design system in DESIGN.md.

## Assumptions Exposed & Resolved

| Assumption                                      | Challenge                                                                              | Resolution                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Real-time safety confirmation popup needed      | Extremely high implementation complexity; requires asynchronously pausing MCP requests | MVP only does audit logs; real-time confirmation deferred |
| Profile and Workspace are two distinct concepts | Increased data model complexity                                                        | MVP only does Profile; Workspace deferred                 |
| Need to support config import from all clients  | Large format differences between clients                                               | MVP only auto-scans Claude Code + Cursor                  |
| Need to directly modify client config files     | File permission and format compatibility risks                                         | Changed to showing instructions + one-click copy          |
| Agents need independent Profiles                | High routing complexity                                                                | MVP uses global Active Profile                            |
| Users have a Node.js environment                | Increases installation barrier                                                         | Rust in-process HTTP server (no Node.js runtime required) |

## Ontology (Key Entities)

| Entity        | Type        | Fields                                                      | Relationships                                      |
| ------------- | ----------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Profile       | Core Domain | id, name, is_active                                         | has many MCPServers via ProfileServer              |
| MCPServer     | Core Domain | id, name, connection_type, command, args, url, env, status  | belongs to many Profiles, has many ToolDiscoveries |
| ProfileServer | Supporting  | profile_id, server_id, enabled, disabled_tools              | joins Profile ↔ MCPServer                          |
| ToolDiscovery | Supporting  | server_id, tool_name, description, input_schema             | belongs to MCPServer                               |
| AuditLog      | Supporting  | timestamp, tool_name, arguments, result, error, duration_ms | references Profile, MCPServer                      |
| ConfigSnippet | Supporting  | client_type, snippet, cli_command                           | generated from active Profile                      |
| AIAgent       | External    | type (Claude Code/Cursor/Codex/OpenCode)                    | connects via /mcp endpoint                         |
| MoorGateway   | Core Domain | port, active_profile                                        | aggregates MCPServers, serves AIAgents             |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability Ratio |
| ----- | ------------ | --- | ------- | ------ | --------------- |
| 1     | 5            | 5   | -       | -      | -               |
| 2     | 6            | 1   | 0       | 5      | 83%             |
| 3     | 5            | 0   | 1       | 5      | 100%            |
| 4     | 5            | 0   | 0       | 5      | 100%            |
| 5     | 6            | 1   | 0       | 5      | 83%             |
| 6     | 6            | 0   | 0       | 6      | 100%            |
| 7     | 7            | 1   | 0       | 6      | 86%             |
| 8     | 7            | 0   | 0       | 7      | 100%            |
| 9     | 7            | 0   | 0       | 7      | 100%            |
| 10    | 8            | 1   | 0       | 7      | 88%             |
| 11    | 8            | 0   | 0       | 8      | 100%            |
| 12    | 8            | 0   | 0       | 8      | 100%            |

## Potential Risks & Mitigations

1. **Node SEA/pkg compatibility**: Node SEA is still relatively new and may have native module compatibility issues → Use `@modelcontextprotocol/sdk` pure JS implementation to avoid native deps.
2. **MCP protocol version changes**: MCP specification is still rapidly iterating → Abstract Protocol Layer, centralize version adaptation.
3. **stdio process management complexity**: Child process crashes, zombie processes, port conflicts → Tauri Rust layer统一管理 sidecar + MCP server processes.
4. **SQLite concurrent writes**: Multiple servers writing logs simultaneously → WAL mode + single writer (sidecar main process).
5. **macOS permissions**: Network listening, file access may trigger system permission popups → Pre-declare in Info.plist + Rust layer requests permissions.

## Interview Transcript

<details>
<summary>Full Q&A (12 rounds)</summary>

### Round 1

**Q:** What role does the Moor gateway play in the MCP protocol?
**A:** B: Smart Aggregator — routing logic + Profile/Workspace filtering + grouped endpoint + built-in logging and security interception
**Ambiguity:** 55% (Goal: 0.60, Constraints: 0.40, Criteria: 0.30)

### Round 2

**Q:** Which MCP server connection methods does Moor need to support?
**A:** B: stdio + HTTP/SSE (Complete) — support both connection methods simultaneously
**Ambiguity:** 50% (Goal: 0.65, Constraints: 0.50, Criteria: 0.30)

### Round 3

**Q:** What is the relationship between Profile and Workspace in the data model?
**A:** D: Profile Only for MVP — MVP only does Profile; Workspace deferred
**Ambiguity:** 48% (Goal: 0.70, Constraints: 0.50, Criteria: 0.30)

### Round 4

**Q:** Should the gateway continue running after the Moor window is closed?
**A:** B: Tray + Background Daemon — minimize to tray on close, gateway continues running
**Ambiguity:** 45% (Goal: 0.70, Constraints: 0.60, Criteria: 0.30)

### Round 5

**Q:** How should Moor determine which tools need "safety confirmation"?
**A:** C: Audit Log Only (MVP) — no real-time interception, only audit logs
**Ambiguity:** 41.2% (Goal: 0.72, Constraints: 0.60, Criteria: 0.40)

### Round 6

**Q:** How should the Tauri WebView and Node sidecar communicate?
**A:** C: Hybrid — system operations go through Rust, business operations go through HTTP directly to Sidecar
**Ambiguity:** 36.4% (Goal: 0.75, Constraints: 0.72, Criteria: 0.40)

### Round 7

**Q:** To what extent should "import existing configuration" be implemented?
**A:** D: Scan Top 2 + Manual (Progressive) — auto-scan Claude Code + Cursor, manually add others
**Ambiguity:** 32.8% (Goal: 0.78, Constraints: 0.72, Criteria: 0.48)

### Round 8

**Q:** How does the Agent determine which Profile to use?
**A:** A: Global Active Profile — all Agents share the currently active Profile
**Ambiguity:** 29.9% (Goal: 0.80, Constraints: 0.75, Criteria: 0.52)

### Round 9

**Q:** How should the UX for tool-level toggles be designed?
**A:** B: Server-Level First, Tool-Level Secondary — main switch at server level, tool level in secondary panel
**Ambiguity:** 27.3% (Goal: 0.82, Constraints: 0.75, Criteria: 0.58)

### Round 10

**Q:** How should "one-click write client configuration" be implemented?
**A:** D: Show Instructions + One-Click Copy — generate configuration instructions and code snippets, one-click copy
**Ambiguity:** 23.1% (Goal: 0.85, Constraints: 0.78, Criteria: 0.65)

### Round 11

**Q:** What happens to connected Agents when the user switches Profiles?
**A:** A: Hot-Swap (No Disconnect) — do not disconnect; next tools/list automatically reflects changes
**Ambiguity:** 20.2% (Goal: 0.87, Constraints: 0.82, Criteria: 0.68)

### Round 12

**Q:** How does the Node/TS sidecar solve runtime dependency issues?
**A:** B: Bundle as Standalone Binary (pkg/SEA) — compile as standalone binary packaged into app
**Ambiguity:** 17.4% (Goal: 0.88, Constraints: 0.88, Criteria: 0.70)

</details>
