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

构建一个运行在 macOS 本地的 MCP 控制台 + 网关应用。Moor 作为 **Smart Aggregator**，聚合多个 MCP server（stdio + HTTP/SSE），按 Profile 过滤 tools，通过单一 HTTP endpoint (`http://127.0.0.1:<port>/mcp`) 暴露给 Claude Code、Codex、Cursor、OpenCode 等 AI Agent。所有操作可观测、可审计、可热切换。

## Core Architecture Decisions (from Interview)

### AD-1: Gateway Role — Smart Aggregator

- **Decision**: Moor 是智能聚合器，不是透明代理
- **Why**: 需要按 Profile 过滤 tools、内置日志、安全审计能力
- **Consequences**: Moor 需要完整实现 MCP server 端 + MCP client 端
  - Server 端：暴露 `tools/list`、`tools/call`、`resources/list` 等给 Agent
  - Client 端：连接后端各 MCP server，聚合并过滤响应

### AD-2: Protocol Support — stdio + HTTP/SSE Complete

- **Decision**: MVP 同时支持 stdio 和 HTTP/SSE 两种 MCP server 连接方式
- **Why**: 覆盖最广的 server 类型，用户无需区分
- **Consequences**: Sidecar 需要管理两类连接生命周期：
  - stdio: spawn 子进程，管理 stdin/stdout pipe
  - HTTP/SSE: 维护长连接，处理重连

### AD-3: Data Model — Profile Only (No Workspace for MVP)

- **Decision**: MVP 只有 Profile 概念，Workspace 延后
- **Why**: 简化数据模型，Profile 已足够覆盖"不同场景使用不同 server 组合"的需求
- **Profile 定义**: 一组 MCP server 配置 + 每个 server 的启用状态 + 每个 tool 的开关状态
- **Consequences**: 数据模型简化为 Profile → Server → Tool 三层

### AD-4: App Lifecycle — Tray + Background Daemon

- **Decision**: 关闭窗口退到 macOS tray，网关继续运行
- **Why**: Agent 可能在任何时候调用 tool，网关需要常驻
- **Consequences**:
  - 需要实现 tray icon + 右键菜单（状态、打开、退出）
  - Node sidecar 进程由 Tauri Rust 层管理生命周期
  - 需要处理 sidecar 崩溃重启逻辑

### AD-5: Safety Model — Audit Log Only for MVP

- **Decision**: MVP 不做实时拦截，只做审计日志
- **Why**: 实时拦截涉及异步暂停 MCP 请求 + 弹窗交互，复杂度高
- **Consequences**:
  - MVP 功能 #6（请求日志）和 #7（安全确认）合并为"请求审计日志"
  - 日志记录：谁调用、哪个 tool、参数、耗时、结果/错误
  - 后续迭代可增加"标记 destructive tool" + "实时确认弹窗"

### AD-6: IPC Architecture — Hybrid

- **Decision**: 系统操作走 Tauri IPC → Rust，业务操作走 WebView → HTTP → Sidecar
- **Why**: Rust 负责系统级能力（Keychain、托盘、文件权限），Sidecar 负责 MCP 协议和业务逻辑
- **Consequences**:
  - Rust 层：macOS Keychain、tray icon、window management、sidecar 进程管理
  - Node sidecar：MCP gateway、server 管理、profile 管理、日志、SQLite 读写
  - Sidecar 暴露本地 HTTP API（如 `http://127.0.0.1:<port>/api/`）
  - WebView 通过 `fetch()` 直接调用 sidecar API

### AD-7: Config Import — Progressive Scan

- **Decision**: MVP 自动扫描 Claude Code + Cursor 配置，手动添加其他
- **Why**: 这两个最常见且有固定配置路径，其他客户端通过手动添加覆盖
- **Scan Paths**:
  - Claude Code: `~/.claude/settings.json` → `mcpServers` 字段
  - Cursor: `.cursor/mcp.json` 或全局 Cursor 设置
  - Manual: 用户输入 command + args + env
- **Consequences**: 需要解析 JSON (Claude Code) 和可能的 JSON (Cursor) 格式

### AD-8: Profile Routing — Global Active Profile

- **Decision**: 同一时刻只有一个 Active Profile，所有 Agent 共享
- **Why**: 最简单的路由模型，单一 endpoint 即可
- **Endpoint**: `http://127.0.0.1:<port>/mcp`（无 URL 路由）
- **Consequences**: Agent 端配置统一为同一个 URL

### AD-9: Tool Toggle — Server-Level First, Tool-Level Secondary

- **Decision**: 主开关在 server 级别，tool 级别在 server 详情页的二级面板
- **Why**: 大多数用户只需要开关整个 server，tool 级别是高级需求
- **Implementation**: Moor 在返回 `tools/list` 给 Agent 时，过滤掉被禁用的 tools
- **Consequences**: Server 详情页需要一个可展开的 tool 列表面板

### AD-10: Config Write-Back — Show Instructions + One-Click Copy

- **Decision**: Moor 不直接修改客户端配置文件，而是生成配置指令和代码片段
- **Why**: 零侵入，无文件权限风险，无格式兼容问题
- **Implementation**: 每个客户端一个卡片，显示 CLI 命令 + JSON 片段 + 复制按钮
- **Consequences**: 更安全但需要用户手动操作一步

### AD-11: Profile Switching — Hot-Swap (No Disconnect)

- **Decision**: 切换 Profile 不断开 Agent 连接，下次 `tools/list` 自动反映变化
- **Why**: 最平滑的 UX，不中断 Agent 工作流
- **Consequences**: 如果 Agent 正在使用被移除的 tool，下次 `tools/call` 返回错误

### AD-12: Sidecar Packaging — Bundle as Standalone Binary (pkg/SEA)

- **Decision**: Node sidecar 编译为独立二进制，打包进 Moor.app
- **Why**: 用户无需预装 Node.js，开箱即用
- **Implementation**: 使用 `pkg` 或 Node.js SEA (Single Executable Application) 编译
- **Consequences**: App 体积增加约 50-80MB，但安装体验最优

## Tech Stack (Confirmed)

```
Moor.app
├─ UI Layer: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
├─ Desktop Layer: Tauri 2 / Rust
│   ├─ Window management + tray icon
│   ├─ macOS Keychain access
│   ├─ Sidecar process lifecycle management
│   └─ File permissions
├─ Gateway Daemon: Node.js / TypeScript sidecar (bundled as standalone binary)
│   ├─ MCP protocol: @modelcontextprotocol/sdk
│   ├─ Server management (stdio spawn + HTTP/SSE client)
│   ├─ Profile management + tool filtering
│   ├─ Request audit logging
│   └─ SQLite storage
├─ Local Storage: SQLite
│   ├─ servers (configs, status)
│   ├─ profiles (server groups + tool toggles)
│   └─ audit_logs (tool calls, params, results, errors)
├─ IPC: WebView ↔ HTTP ↔ Sidecar (business), WebView ↔ Tauri IPC ↔ Rust (system)
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
├─ working_dir: string?
├─ status: "stopped" | "starting" | "running" | "error"
├─ created_at: timestamp
└─ updated_at: timestamp

ProfileServer (join table)
├─ profile_id: uuid → Profile
├─ server_id: uuid → MCPServer
├─ enabled: boolean (server-level toggle)
└─ disabled_tools: string[] (tool-level deny list)

ToolDiscovery (cached)
├─ server_id: uuid → MCPServer
├─ tool_name: string
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
POST   /api/import/execute             # Execute import

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
- ❌ Windows / Linux support (macOS only)

## Acceptance Criteria

- [ ] Moor.app 可在 macOS 上安装并启动，无需预装 Node.js
- [ ] 关闭窗口后网关继续运行（tray icon），Agent 可正常调用 tools
- [ ] 可自动扫描并导入 Claude Code 和 Cursor 的 MCP 配置
- [ ] 可手动添加 MCP server（stdio 和 HTTP/SSE 两种类型）
- [ ] 每个 server 可独立启停，状态实时显示
- [ ] Profile 可创建、编辑、删除，全局切换为 Hot-Swap
- [ ] 工具级开关在 server 详情页可操作，禁用后 Agent 立即不可见
- [ ] 所有 tool 调用记录在审计日志中，可按 server/tool/时间筛选
- [ ] 单一 endpoint (`http://127.0.0.1:<port>/mcp`) 正常响应 MCP 协议
- [ ] 客户端配置页面可生成各 Agent 的配置指令并一键复制
- [ ] UI 遵循 DESIGN.md 的 Cursor 风格设计系统

## Assumptions Exposed & Resolved

| Assumption                      | Challenge                             | Resolution                          |
| ------------------------------- | ------------------------------------- | ----------------------------------- |
| 需要实时安全确认弹窗            | 实现复杂度极高，需要异步暂停 MCP 请求 | MVP 只做审计日志，实时确认延后      |
| Profile 和 Workspace 是两个概念 | 数据模型复杂度增加                    | MVP 只做 Profile，Workspace 延后    |
| 需要支持所有客户端配置导入      | 各客户端格式差异大                    | MVP 只自动扫描 Claude Code + Cursor |
| 需要直接修改客户端配置文件      | 文件权限和格式兼容风险                | 改为显示指令 + 一键复制             |
| Agent 需要各自独立的 Profile    | 路由复杂度高                          | MVP 用全局 Active Profile           |
| 用户有 Node.js 环境             | 增加安装门槛                          | Sidecar 编译为独立二进制打包        |

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

1. **Node SEA/pkg 兼容性**: Node SEA 仍较新，可能有 native module 兼容问题 → 使用 `@modelcontextprotocol/sdk` 纯 JS 实现避免 native deps
2. **MCP 协议版本变化**: MCP 规范仍在快速迭代 → 抽象 Protocol Layer，版本适配集中处理
3. **stdio 进程管理复杂度**: 子进程崩溃、僵尸进程、端口占用 → Tauri Rust 层统一管理 sidecar + MCP server 进程
4. **SQLite 并发写入**: 多个 server 同时写日志 → WAL mode + 单 writer（sidecar 主进程）
5. **macOS 权限**: 网络监听、文件访问可能触发系统权限弹窗 → Info.plist 预声明 + Rust 层请求权限

## Interview Transcript

<details>
<summary>Full Q&A (12 rounds)</summary>

### Round 1

**Q:** Moor 网关在 MCP 协议中扮演什么角色？
**A:** B: Smart Aggregator — 路由逻辑 + Profile/Workspace 过滤 + 分组 endpoint + 内置日志和安全拦截
**Ambiguity:** 55% (Goal: 0.60, Constraints: 0.40, Criteria: 0.30)

### Round 2

**Q:** Moor 需要支持哪些 MCP server 连接方式？
**A:** B: stdio + HTTP/SSE (Complete) — 同时支持两种连接方式
**Ambiguity:** 50% (Goal: 0.65, Constraints: 0.50, Criteria: 0.30)

### Round 3

**Q:** Profile 和 Workspace 在数据模型中是什么关系？
**A:** D: Profile Only for MVP — MVP 只做 Profile，Workspace 延后
**Ambiguity:** 48% (Goal: 0.70, Constraints: 0.50, Criteria: 0.30)

### Round 4

**Q:** Moor 窗口关闭后，网关应该继续运行吗？
**A:** B: Tray + Background Daemon — 关闭窗口退到 tray，网关继续运行
**Ambiguity:** 45% (Goal: 0.70, Constraints: 0.60, Criteria: 0.30)

### Round 5

**Q:** Moor 如何判断哪些 tool 需要"安全确认"？
**A:** C: Audit Log Only (MVP) — 不做实时拦截，只做审计日志
**Ambiguity:** 41.2% (Goal: 0.72, Constraints: 0.60, Criteria: 0.40)

### Round 6

**Q:** Tauri WebView 和 Node sidecar 之间如何通信？
**A:** C: Hybrid — 系统操作走 Rust，业务操作走 HTTP 直连 Sidecar
**Ambiguity:** 36.4% (Goal: 0.75, Constraints: 0.72, Criteria: 0.40)

### Round 7

**Q:** "导入现有配置"应该做到什么程度？
**A:** D: Scan Top 2 + Manual (Progressive) — 自动扫描 Claude Code + Cursor，手动添加其他
**Ambiguity:** 32.8% (Goal: 0.78, Constraints: 0.72, Criteria: 0.48)

### Round 8

**Q:** Agent 如何确定使用哪个 Profile？
**A:** A: Global Active Profile — 所有 Agent 共享当前激活的 Profile
**Ambiguity:** 29.9% (Goal: 0.80, Constraints: 0.75, Criteria: 0.52)

### Round 9

**Q:** 工具级开关的 UX 应该怎么设计？
**A:** B: Server-Level First, Tool-Level Secondary — 主开关在 server 级别，tool 级别在二级面板
**Ambiguity:** 27.3% (Goal: 0.82, Constraints: 0.75, Criteria: 0.58)

### Round 10

**Q:** "一键写入客户端配置"应该怎么做？
**A:** D: Show Instructions + One-Click Copy — 生成配置指令和代码片段，一键复制
**Ambiguity:** 23.1% (Goal: 0.85, Constraints: 0.78, Criteria: 0.65)

### Round 11

**Q:** 用户切换 Profile 时，已连接的 Agent 会发生什么？
**A:** A: Hot-Swap (No Disconnect) — 不断开连接，下次 tools/list 自动反映变化
**Ambiguity:** 20.2% (Goal: 0.87, Constraints: 0.82, Criteria: 0.68)

### Round 12

**Q:** Node/TS sidecar 如何解决运行时依赖问题？
**A:** B: Bundle as Standalone Binary (pkg/SEA) — 编译为独立二进制打包进 app
**Ambiguity:** 17.4% (Goal: 0.88, Constraints: 0.88, Criteria: 0.70)

</details>
