<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Moor" width="128">
</p>

<h1 align="center">Moor</h1>

<p align="center">
  <b>本地 MCP 网关管理器，为 AI Agent 提供统一的工具聚合与路由服务</b><br>
  将多个 MCP Server 聚合到单一端点，按 Profile 过滤工具，并通过精美的原生 UI 统一管理。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri" alt="Tauri 2">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/platform-macOS-black?logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/pnpm-10+-F69220?logo=pnpm" alt="pnpm">
</p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能特性">功能特性</a> ·
  <a href="#架构">架构</a> ·
  <a href="#开发">开发</a> ·
  <a href="#api">API</a>
</p>

<!-- README-I18N:START -->

[English](./README.md) | **汉语** | [日本語](./README.ja.md) | [Español](./README.es.md)

<!-- README-I18N:END -->

---

> _AI Agent 需要调用工具，但在不同客户端之间管理十几个 MCP Server 简直是一场灾难。我想要一个统一的网关，能够聚合所有工具、按场景过滤，并在后台持续运行——一切都可以通过一个精美的原生 UI 来掌控。_
>
> _Moor 暴露单一端点（`http://127.0.0.1:<port>/mcp`），根据当前激活的 Profile 动态只提供你需要的工具。切换 Profile 无需断开 Agent 连接，每一次工具调用都有审计记录。这就是我打造 Moor 的原因。_

<p align="center">
  <img src="./assets/Dashboard%20Page.png" alt="Dashboard" width="800"><br>
  <sub>Dashboard — 总览当前 Profile、Server 状态与审计统计。</sub>
</p>

<p align="center">
  <img src="./assets/Servers%20Page.png" alt="Servers" width="800"><br>
  <sub>Servers — 管理 MCP Server、导入配置、监控健康状态。</sub>
</p>

<p align="center">
  <img src="./assets/Profiles%20Page.png" alt="Profiles" width="800"><br>
  <sub>Profiles — 创建 Profile、开关 Server、启用/禁用工具。</sub>
</p>

<p align="center">
  <img src="./assets/Audit%20Page.png" alt="Audit" width="800"><br>
  <sub>Audit — 查看每一次工具调用的完整上下文与筛选。</sub>
</p>

## 安装

### macOS 应用

从 [Releases](https://github.com/yourusername/moor/releases) 下载 `.dmg`，拖拽到 Applications 文件夹即可。应用内嵌 Rust HTTP 服务器——无需预装 Node.js 运行时。

### 从源码构建

需要 macOS（Apple Silicon / Intel）、Node.js >= 22、pnpm >= 10 和 Rust >= 1.77。

```bash
git clone https://github.com/yourusername/moor.git
cd moor
vp install
```

构建说明请参阅[开发](#开发)章节。

## 快速开始

### 启动应用

打开 **Moor.app**。Dashboard 一览展示当前激活的 Profile、Server 运行状态和近期审计日志。

### 扫描现有配置

Moor 可以自动检测你已为 Claude Code、Codex、OpenCode 和 Cursor 配置的 MCP Server：

1. 进入 **Servers** → **Import**
2. 点击 **Scan** — Moor 会读取 `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.config/opencode/opencode.json` / `.jsonc` 以及 `~/.cursor/mcp.json`
3. 选择要导入的 Server

你也可以通过 **Import JSON** 粘贴 JSON MCP 配置。Moor 支持导入 stdio 和 HTTP/SSE Server，对于不支持的条目（例如 OpenAPI 配置）会报告但不会保存。

### 创建 Profile

Profile 让你按场景分组 Server，并控制哪些工具暴露给 Agent：

1. 进入 **Profiles** → **New Profile**
2. 命名（例如 "Coding"、"Research"）
3. 开关 Server
4. 展开某个 Server 以启用/禁用单个工具
5. 点击 **Activate** — 切换即时生效

### 连接你的 Agent

将任意 MCP 兼容客户端指向 Moor 的单一端点：

```
http://127.0.0.1:9223/mcp
```

`9223` 是默认的 Sidecar 端口。如果该端口已被占用，Moor 会自动选择下一个可用端口，并在 Dashboard 和 Client Config 页面显示实际端点。

`/mcp` 端点仅限本地回环访问，不需要 `X-Moor-Token`。Moor 仅在 WebView 与 Sidecar 之间的本地管理 API 中使用 `X-Moor-Token`，因此你无需将它粘贴到 Agent 配置中。

Moor 会处理剩下的一切——聚合 `tools/list`、路由 `tools/call`、并根据激活的 Profile 进行过滤。

## 功能特性

### MCP 网关聚合

单一 HTTP 端点（`/mcp`）代理所有后端 MCP Server。Agent 看到的是统一的工具目录——无需配置多个端点。

### 多传输支持

同时支持 **stdio**（子进程）和 **HTTP/SSE** 两种 MCP Server 连接方式。Moor 自动管理连接生命周期、重启和健康检查。

### Profile 管理

为不同工作流创建无限数量的 Profile。每个 Profile 记录：

- 启用了哪些 Server
- 每个 Server 禁用了哪些工具
- 全局激活状态

支持**热切换**（Hot-Swap）——已连接的 Agent 保持连接，下次 `tools/list` 自动反映新配置。

### 工具级开关

除了 Server 级别的总开关，你还可以深入每个 Server，禁用特定工具。被禁用的工具会实时从 Agent 的工具目录中消失。

### 配置导入

一键导入来自以下客户端的配置：

- **Claude Code**: `~/.claude/settings.json`
- **Codex**: `~/.codex/config.toml`
- **OpenCode**: `~/.config/opencode/opencode.json` / `.jsonc`
- **Cursor**: `~/.cursor/mcp.json`

也支持手动输入和粘贴 JSON 批量导入 stdio 与 HTTP/SSE Server。

### 客户端配置

为 Claude Code、Codex、OpenCode 和 Cursor 生成即拷即用的配置片段。片段仅包含 `/mcp` 端点；Moor 的 `X-Moor-Token` 保留给内部管理 API 使用。

### 审计日志

每一次 `tools/call` 都会被记录，包含：

- 时间戳、Profile、Server、工具名
- 参数（敏感数据已脱敏）
- 结果或错误
- 耗时和 Agent 信息

支持按时间范围、Server 或工具筛选。Dashboard 提供聚合统计视图。

### 系统托盘

关闭窗口——Moor 继续在 macOS 菜单栏中运行。网关保持活跃，Agent 永远不会断开连接。

### 实时状态

Server 状态变更和 Profile 切换通过 SSE 推送到 UI，无需刷新页面。

## 架构

<details>
<summary>架构图</summary>

```
Moor.app
├── UI Layer          React + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui
├── Desktop Layer     Tauri 2 / Rust
│   ├── Window management + tray icon
│   └── In-process HTTP server (Axum)
│       ├── MCP protocol gateway   POST /mcp — init, tools/list, tools/call
│       ├── Server management      stdio spawn + HTTP/SSE client
│       ├── Profile routing        Global active Profile, hot-swap
│       ├── Audit logging          Tool call recording
│       └── SSE push               Real-time status sync to WebView
├── Dev Sidecar      Node.js / TypeScript (Hono — 开发模式 & SEA 独立运行)
└── Storage           SQLite (rusqlite / node:sqlite)
    ├── servers (configs, status)
    ├── profiles (server groups + tool toggles)
    └── audit_logs (tool calls, params, results, errors)
```

</details>

### 通信方式

```
AI Agent ──HTTP──▶ POST /mcp ──▶ Moor Gateway ──stdio/HTTP──▶ MCP Servers
                              │
WebView ──IPC──▶ get_sidecar_info ─┐
WebView ──fetch──▶ /api/* ────────┘
WebView ◀──SSE──── /api/events
```

- **运行时发现**: WebView → Tauri IPC (`get_sidecar_info`) → Rust（端口、token）；浏览器开发模式回退到 `/api/runtime`
- **业务操作**: WebView → HTTP `fetch()` → 进程内 Axum 服务器（Rust）
- **系统操作**: WebView → Tauri IPC → Rust（托盘、窗口、自启动）

## 开发

### 前置要求

- macOS（Apple Silicon / Intel）
- [Node.js](https://nodejs.org) >= 22
- [pnpm](https://pnpm.io) >= 10
- [Rust](https://rustup.rs) >= 1.77
- [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/)

### 安装依赖

```bash
vp install
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
- `src-tauri/target/release/bundle/dmg/Moor_<version>_aarch64.dmg`

### 代码质量

```bash
vp check       # 格式化 + 检查 + 类型检查
vp lint        # 仅检查
vp lint --fix  # 自动修复
vp fmt         # 格式化
```

### 测试

```bash
# Sidecar 测试
pnpm --filter moor-sidecar test

# 前端测试
vp test
```

## API

### MCP 网关

| 方法  | 路径   | 说明                            |
| ----- | ------ | ------------------------------- |
| `ALL` | `/mcp` | MCP 协议端点（Streamable HTTP） |

### Server 管理

| 方法     | 路径                     | 说明             |
| -------- | ------------------------ | ---------------- |
| `GET`    | `/api/servers`           | 列出所有 Server  |
| `POST`   | `/api/servers`           | 添加 Server      |
| `GET`    | `/api/servers/:id`       | Server 详情      |
| `PUT`    | `/api/servers/:id`       | 更新 Server 配置 |
| `DELETE` | `/api/servers/:id`       | 删除 Server      |
| `POST`   | `/api/servers/:id/start` | 启动 Server      |
| `POST`   | `/api/servers/:id/stop`  | 停止 Server      |
| `GET`    | `/api/servers/:id/tools` | 获取已发现工具   |
| `PUT`    | `/api/servers/order`     | 重新排序 Server  |

### Profile 管理

| 方法     | 路径                             | 说明                        |
| -------- | -------------------------------- | --------------------------- |
| `GET`    | `/api/profiles`                  | 列出所有 Profile            |
| `POST`   | `/api/profiles`                  | 创建 Profile                |
| `PUT`    | `/api/profiles/:id`              | 更新 Profile                |
| `DELETE` | `/api/profiles/:id`              | 删除 Profile                |
| `PUT`    | `/api/profiles/:id/activate`     | 激活 Profile                |
| `PUT`    | `/api/profiles/:id/servers/:sid` | 更新 Server 开关 + 禁用工具 |

### 审计日志

| 方法  | 路径              | 说明                 |
| ----- | ----------------- | -------------------- |
| `GET` | `/api/logs`       | 查询日志（支持筛选） |
| `GET` | `/api/logs/stats` | 聚合统计             |

### Settings 管理

| 方法    | 路径                  | 说明         |
| ------- | --------------------- | ------------ |
| `GET`   | `/api/settings`       | 获取设置     |
| `PATCH` | `/api/settings`       | 更新设置     |
| `POST`  | `/api/settings/reset` | 重置为默认值 |

### 其他

| 方法   | 路径                   | 说明                 |
| ------ | ---------------------- | -------------------- |
| `GET`  | `/api/health`          | 健康检查             |
| `GET`  | `/api/runtime`         | 运行时信息           |
| `GET`  | `/api/events`          | SSE 实时事件流       |
| `POST` | `/api/import/scan`     | 扫描本地客户端配置   |
| `POST` | `/api/import/parse`    | 预览粘贴的 JSON 导入 |
| `POST` | `/api/import/execute`  | 执行导入             |
| `GET`  | `/api/import/snippets` | 生成客户端配置片段   |
| `POST` | `/api/import/convert`  | 客户端配置互转       |

## 技术栈

| 层级     | 技术                                              |
| -------- | ------------------------------------------------- |
| 前端     | React 19, Vite 6, TypeScript 5.7, Tailwind CSS v4 |
| UI 基础  | Radix UI                                          |
| UI 组件  | shadcn/ui (New York style)                        |
| 桌面框架 | Tauri 2 (Rust)                                    |
| 网关     | Rust, Axum, Tokio, rusqlite (进程内)              |
| 开发侧车 | Node.js, TypeScript, Hono, @hono/node-server      |
| 数据库   | SQLite (rusqlite / node:sqlite)                   |
| MCP 协议 | @modelcontextprotocol/sdk (stdio + HTTP/SSE)      |
| 图标     | Lucide React                                      |
| 工具链   | Vite+ (vp CLI), Oxlint, Oxfmt, Vitest             |

## 鸣谢

感谢 [linuxdo](https://linux.do/) 社区的讨论、分享与反馈。

## ❤️ 赞助

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/varandrew)

## 🌟 Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=varandrew/moor&type=Date)](https://www.star-history.com/#varandrew/moor&Date)

## 许可证

[MIT](LICENSE)
