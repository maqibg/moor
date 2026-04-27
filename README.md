# Moor

本地 MCP 网关管理器，为 AI Agent 提供统一的工具聚合与路由服务。

Moor 聚合多个 MCP Server（stdio / HTTP），按 Profile 过滤工具，通过单一 HTTP 端点暴露给 Claude Code、Cursor、Codex、OpenCode 等 AI Agent。

## 架构

```
Moor.app
├── UI Layer          React + Vite + TypeScript + Tailwind v4
├── Desktop Layer     Tauri 2 / Rust（托盘、窗口管理、Sidecar 生命周期）
├── Gateway Daemon    Node.js / TypeScript Sidecar（Hono HTTP 服务器）
│   ├── MCP 协议网关   POST /mcp — 初始化、工具列表、工具调用
│   ├── Server 管理    stdio spawn + HTTP/SSE 客户端
│   ├── Profile 路由   全局 Active Profile，Hot-Swap 切换
│   ├── 审计日志       异步批量写入，500ms / 50 条刷盘
│   └── SSE 推送       实时状态同步到 WebView
└── Storage           SQLite (sql.js WASM)
```

### 通信方式

```
AI Agent ──HTTP──▶ POST /mcp ──▶ Moor Gateway ──stdio/HTTP──▶ MCP Servers
                              │
WebView ──fetch──▶ /api/* ────┘
WebView ◀──SSE──── /api/events
```

## 功能

- **MCP 网关聚合** — 单一端点 (`http://127.0.0.1:<port>/mcp`) 代理所有 MCP Server
- **多传输支持** — stdio（子进程）和 HTTP/SSE 两种 MCP 连接方式
- **Profile 管理** — 创建、编辑、删除 Profile，全局 Active Profile Hot-Swap
- **工具级开关** — Server 级别主开关 + Tool 级别二级开关，禁用后 Agent 立即不可见
- **配置导入** — 自动扫描 Claude Code (`~/.claude/settings.json`) 和 Cursor (`.cursor/mcp.json`) 配置
- **客户端配置** — 生成各 Agent 配置片段，一键复制
- **审计日志** — 记录所有工具调用的调用者、参数、结果、耗时，可按 Server / Tool / 时间筛选
- **系统托盘** — 关闭窗口退到托盘，网关继续运行
- **实时状态** — SSE 推送 Server 状态变更和 Profile 切换事件

## 快速开始

### 前置要求

- macOS (Apple Silicon / Intel)
- [Node.js](https://nodejs.org) >= 20
- [pnpm](https://pnpm.io) >= 9
- [Rust](https://rustup.rs) >= 1.77
- [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/)

### 安装依赖

```bash
pnpm install
```

### 开发模式

同时启动前端和 Sidecar：

```bash
pnpm dev:all
```

- 前端: http://localhost:1420
- Sidecar API: http://localhost:9223

启动完整桌面应用（Tauri）：

```bash
pnpm tauri dev
```

### 生产构建

```bash
pnpm tauri build
```

输出：
- `src-tauri/target/release/bundle/macos/Moor.app`
- `src-tauri/target/release/bundle/dmg/Moor_0.1.0_aarch64.dmg`

## 项目结构

```
moor/
├── src/                          # 前端 (React + Vite)
│   ├── pages/                    # 页面组件
│   │   ├── Dashboard.tsx         # 状态总览
│   │   ├── Servers.tsx           # Server 列表 + 添加
│   │   ├── ServerDetail.tsx      # Server 详情 + Tool 开关
│   │   ├── Profiles.tsx          # Profile 列表
│   │   ├── ProfileDetail.tsx     # Profile 编辑 + Server 选择
│   │   ├── ClientConfig.tsx      # 客户端配置片段
│   │   └── AuditLogs.tsx         # 审计日志
│   ├── components/
│   │   ├── layout/               # AppShell + Sidebar + Header
│   │   ├── shared/               # StatusBadge, ServerCard, CopyButton
│   │   └── ui/                   # 基础 UI 组件 (shadcn/ui 风格)
│   ├── hooks/                    # useApi, useSSE, useServers, useProfiles, useLogs
│   ├── lib/                      # api.ts, utils.ts
│   └── styles/globals.css        # Tailwind v4 主题 (DESIGN.md)
├── sidecar/                      # Node.js Sidecar (Hono HTTP)
│   └── src/
│       ├── index.ts              # 入口：DB 初始化 → 迁移 → HTTP 服务
│       ├── server.ts             # Hono 路由注册
│       ├── db/                   # SQLite (sql.js) + 迁移 + Schema
│       ├── services/             # Server 管理, 审计日志, 事件总线
│       ├── api/                  # REST API 端点
│       ├── mcp/                  # MCP 协议实现
│       │   ├── gateway.ts        # POST /mcp 处理
│       │   ├── aggregator.ts     # 工具聚合 + Profile 过滤
│       │   └── transports/       # stdio + HTTP 传输层
│       └── config/               # 配置扫描 + 片段生成
├── src-tauri/                    # Tauri 2 (Rust)
│   ├── src/
│   │   ├── main.rs               # 入口
│   │   └── lib.rs                # 托盘 + 窗口生命周期
│   ├── Cargo.toml
│   └── tauri.conf.json
├── DESIGN.md                     # UI 设计系统规范
└── package.json
```

## API 端点

### MCP 网关

| 方法 | 路径 | 说明 |
|------|------|------|
| `ALL` | `/mcp` | MCP 协议端点（Streamable HTTP） |

### Server 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/servers` | 列出所有 Server |
| `POST` | `/api/servers` | 添加 Server |
| `GET` | `/api/servers/:id` | Server 详情 |
| `PUT` | `/api/servers/:id` | 更新 Server 配置 |
| `DELETE` | `/api/servers/:id` | 删除 Server |
| `POST` | `/api/servers/:id/start` | 启动 Server |
| `POST` | `/api/servers/:id/stop` | 停止 Server |
| `GET` | `/api/servers/:id/tools` | 获取已发现工具 |

### Profile 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/profiles` | 列出所有 Profile |
| `POST` | `/api/profiles` | 创建 Profile |
| `PUT` | `/api/profiles/:id` | 更新 Profile |
| `DELETE` | `/api/profiles/:id` | 删除 Profile |
| `PUT` | `/api/profiles/:id/activate` | 激活 Profile |
| `PUT` | `/api/profiles/:id/servers/:sid` | 更新 Server 开关 + 禁用工具 |

### 审计日志

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/logs` | 查询日志（支持筛选） |
| `GET` | `/api/logs/stats` | 聚合统计 |

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/events` | SSE 实时事件流 |
| `POST` | `/api/import/scan` | 扫描本地客户端配置 |
| `POST` | `/api/import/execute` | 执行导入 |

## 数据模型

```
Profile          ← ProfileServer → MCPServer
  id                                  id
  name                                name
  is_active                           connection_type (stdio | http)
                                      command / args / url / env
                                      status
                                        │
                                        └── ToolDiscovery
                                              tool_name
                                              description
                                              input_schema

AuditLog
  timestamp, profile_id, server_id
  tool_name, arguments, result, error
  duration_ms, agent_info
```

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19, Vite 6, TypeScript 5.7, Tailwind CSS v4 |
| UI 组件 | shadcn/ui (new-york style) |
| 桌面框架 | Tauri 2 (Rust) |
| Sidecar | Node.js, TypeScript, Hono, @hono/node-server |
| 数据库 | SQLite (sql.js WASM) |
| MCP 协议 | @modelcontextprotocol/sdk (stdio + HTTP/SSE) |
| 图标 | Lucide React |

## License

MIT
