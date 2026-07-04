# Moor

Local MCP Gateway Manager: aggregates multiple MCP servers behind one HTTP endpoint, filters tools by Profile, and audits every call. The business layer is a single Rust in-process gateway (`src-tauri/src/sidecar/`); the legacy Node sidecar is being removed (ADR-0001).

## Language

### Aggregation & routing

**Gateway**:
The Smart Aggregator that exposes one `/mcp` endpoint, proxies `tools/list` and `tools/call`, and filters by the Active Profile.
_Avoid_: proxy, server (it is both an MCP server and client).

**Active Profile**:
The single Profile in effect for all Agents at a time; its server/tool toggles decide what the Gateway exposes.
_Avoid_: current profile, selected profile.

**Hot-Swap**:
Changing the Active Profile without disconnecting Agents; the next `tools/list` reflects the change. Affects exposed Tools only, never a Server's run status.
_Avoid_: reload, switch.

**exposed name**:
The name a Tool is published under to Agents, derived from the server slug and `tool_name`, with a short server-id suffix on collision. Distinct from `tool_name` (the backend MCP server's own name).
_Avoid_: alias, public name.

### Catalog

**Server**:
A configured backend MCP server (stdio or http), with config and a run status (`stopped | starting | running | error`).
_Avoid_: connection, MCP (reserve "MCP" for the protocol).

**Profile**:
A named set of Servers plus per-server enable + per-tool deny list. Exactly one is active.
_Avoid_: workspace, group.

**Tool / ToolDiscovery**:
A Tool is a callable an MCP Server offers. A ToolDiscovery is the cached row (`tool_name`, `exposed_name`, schema) discovered from a Server.
_Avoid_: capability, function.

**ProfileServer**:
The join of a Profile and Server carrying `enabled` and the `disabled_tools` deny list.
_Avoid_: membership, assignment.

### Import & observability

**Config Import**:
Reading MCP server configs from an external client (Scan), pasted text (preview), executing the import, and converting Moor's servers back out to a client format.
_Avoid_: sync, migration.

**Scan**:
Detecting servers from a known client's config file (Claude Code, Codex, OpenCode, Cursor).
_Avoid_: discover (reserve for ToolDiscovery).

**Audit Log**:
The record of every `tools/call`: profile, server, tool, redacted arguments, result/error, duration, agent.
_Avoid_: history, trace.

## Modules (architecture)

Names for deepened modules from the 2026-05-29 architecture review, updated for the single-Rust decision (ADR-0001).

**Server Runtime**:
The one deep module owning a Server's full lifecycle — registry, status state machine, sessions, and tool catalog. Canonical implementation: Rust `server_manager.rs` (already a single deep module). The Node `server-manager` / `server-service` / `server-lifecycle` / `session-manager` split is being removed, not collapsed.
_Avoid_: ServerManager, ServerService (the split).

**Config Import**:
The deep module covering scan / preview / execute / convert. Still fragmented across six files (`scanner`, `import_parser`, `converter`, `formatters`, `clients`, `snippets`) on the surviving Rust side — the open deepening target.
_Avoid_: import pipeline, the loose parts.

**Server Status**:
The pure reducer (frontend) that resolves a Server's displayed status from base query data, optimistic action, SSE `server:status` event, and mutation settle. The interface is its test surface.
_Avoid_: server patch utils, status merge.
