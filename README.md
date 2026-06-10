<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Moor" width="128">
</p>

<h1 align="center">Moor</h1>

<p align="center">
  <b>Local MCP Gateway Manager for AI Agents</b><br>
  Aggregate multiple MCP servers into a single endpoint, filter tools by Profile, and manage everything from a beautiful native UI.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri" alt="Tauri 2">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/platform-macOS-black?logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/platform-Linux-FCC624?logo=linux&logoColor=black" alt="Linux">
  <img src="https://img.shields.io/badge/pnpm-10+-F69220?logo=pnpm" alt="pnpm">
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#features">Features</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#development">Development</a> ·
  <a href="#api">API</a>
</p>

<!-- README-I18N:START -->

**English** | [汉语](./README.zh.md) | [日本語](./README.ja.md) | [Español](./README.es.md)

<!-- README-I18N:END -->

---

> _AI Agents need tools, but managing dozens of MCP servers across different clients is a mess. I wanted a single gateway that aggregates everything, filters by context, and keeps running in the background — all controllable from a beautiful native UI._
>
> _Moor exposes one endpoint (`http://127.0.0.1:<port>/mcp`) that dynamically serves only the tools you want, based on your active Profile. Switch profiles without disconnecting your Agent, and every tool call is audited. That's why I built it._

<p align="center">
  <img src="./assets/Dashboard%20Page.png" alt="Dashboard" width="800"><br>
  <sub>Dashboard — Overview of active Profile, server status, and audit stats.</sub>
</p>

<p align="center">
  <img src="./assets/Servers%20Page.png" alt="Servers" width="800"><br>
  <sub>Servers — Manage MCP servers, import configs, monitor health.</sub>
</p>

<p align="center">
  <img src="./assets/Profiles%20Page.png" alt="Profiles" width="800"><br>
  <sub>Profiles — Create profiles, toggle servers, enable/disable tools.</sub>
</p>

<p align="center">
  <img src="./assets/Audit%20Page.png" alt="Audit" width="800"><br>
  <sub>Audit — Inspect every tool call with full context and filters.</sub>
</p>

## Install

### macOS App

Download the `.dmg` from [Releases](https://github.com/varandrew/moor/releases), drag to Applications, done. The app bundles the HTTP server as an in-process Rust binary — no pre-installed Node.js runtime required.

### Windows App

Download the Windows installer from [Releases](https://github.com/varandrew/moor/releases) and run it. The app bundles the HTTP server as an in-process Rust binary — no pre-installed Node.js runtime required.

### Linux App

Download the `.deb`, `.rpm`, or `.AppImage` from [Releases](https://github.com/varandrew/moor/releases) (x86_64 and aarch64 builds are produced by CI). The app bundles the HTTP server as an in-process Rust binary — no pre-installed Node.js runtime required. macOS remains the primary target; Linux builds are produced by CI but less extensively tested.

### Build from Source

Requires macOS (Apple Silicon / Intel), Windows x64, or Linux (x86_64 / aarch64), Node.js >= 22 (CI uses 24), pnpm >= 10, and Rust >= 1.77.

```bash
git clone https://github.com/varandrew/moor.git
cd moor
pnpm install
```

See [Development](#development) for build instructions.

## Quickstart

### Launch the App

Open **Moor.app**. The Dashboard shows your active Profile, server status, and recent audit logs at a glance.

### Scan Existing Configs

Moor can automatically detect MCP servers you've already configured for Claude Code, Codex, OpenCode, and Cursor:

1. Go to **Servers** → **Import**
2. Click **Scan** — Moor reads `~/.claude/settings.json`, `~/.codex/config.toml`, `~/.config/opencode/opencode.json` / `.jsonc`, and `~/.cursor/mcp.json`
3. Select the servers you want to import

You can also paste a JSON MCP configuration with **Import JSON**. Moor imports stdio and HTTP/SSE servers, and reports unsupported entries such as OpenAPI configs without saving them.

### Create a Profile

Profiles let you group servers and control which tools are exposed to Agents:

1. Go to **Profiles** → **New Profile**
2. Name it (e.g., "Coding", "Research")
3. Toggle servers on/off
4. Expand a server to enable/disable individual tools
5. Click **Activate** — the change is instant

### Connect Your Agent

Point any MCP-compatible client to Moor's single endpoint:

```
http://127.0.0.1:9223/mcp
```

`9223` is the default gateway port. If it is already in use, Moor picks the next available port and shows the actual endpoint in the Dashboard and Client Config pages.

The `/mcp` endpoint is loopback-only and does not require `X-Moor-Token`. Moor uses `X-Moor-Token` only for local management APIs between the WebView and gateway, so you do not need to paste it into agent configs.

Moor handles the rest — aggregating `tools/list`, routing `tools/call`, and filtering based on your active Profile.

## Features

### MCP Gateway Aggregation

A single HTTP endpoint (`/mcp`) proxies all backend MCP servers. Agents see a unified tool catalog — no need to configure multiple endpoints.

### Multi-Transport Support

Connect to both **stdio** (subprocess) and **HTTP/SSE** MCP servers. Moor manages connection lifecycles, restarts, and health checks automatically.

### Profile Management

Create unlimited Profiles for different workflows. Each Profile stores:

- Which servers are enabled
- Which tools are disabled per server
- A global active state

Switch Profiles with **hot-swap** — connected Agents stay connected, and the next `tools/list` reflects the new configuration immediately.

### Tool-Level Toggles

Beyond server-level on/off, drill into any server to disable specific tools. Disabled tools disappear from the Agent's tool catalog in real time.

### Config Import

One-click import from:

- **Claude Code**: `~/.claude/settings.json`
- **Codex**: `~/.codex/config.toml`
- **OpenCode**: `~/.config/opencode/opencode.json` / `.jsonc`
- **Cursor**: `~/.cursor/mcp.json`

Manual entry and pasted JSON batch import are also supported for stdio and HTTP/SSE servers.

### Client Configuration

Generate ready-to-copy configuration snippets for Claude Code, Codex, OpenCode, and Cursor. The snippets contain only the `/mcp` endpoint; Moor's `X-Moor-Token` is reserved for internal management API calls.

### Audit Logs

Every `tools/call` is recorded with:

- Timestamp, Profile, Server, Tool name
- Arguments (with sensitive data redaction)
- Result or error
- Duration and Agent info

Filter by time range, server, or tool. View aggregate statistics on the Dashboard.

### System Tray

Close the window — Moor keeps running in the macOS menu bar or Windows system tray. The gateway stays alive, so your Agents never lose connection.

### Real-Time Status

Server status changes and Profile switches are pushed to the UI via SSE. No refresh needed.

## Architecture

<details>
<summary>Architecture Diagram</summary>

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
└── Storage           SQLite (rusqlite)
    ├── servers (configs, status)
    ├── profiles (server groups + tool toggles)
    └── audit_logs (tool calls, params, results, errors)
```

</details>

### Communication Flow

```
AI Agent ──HTTP──▶ POST /mcp ──▶ Moor Gateway ──stdio/HTTP──▶ MCP Servers
                              │
WebView ──IPC──▶ get_sidecar_info ─┐
WebView ──fetch──▶ /api/runtime ───┤ (fallback in browser dev mode)
WebView ──fetch──▶ /api/* ─────────┘
WebView ◀──SSE──── /api/events
```

- **Runtime discovery**: WebView → Tauri IPC (`get_sidecar_info`) → Rust (port, token); falls back to HTTP `GET /api/runtime` in browser dev mode
- **Business operations**: WebView → HTTP `fetch()` → In-process Axum server (Rust)
- **System operations**: WebView → Tauri IPC → Rust (tray, window, auto-start)

## Development

### Prerequisites

- macOS (Apple Silicon / Intel), Windows x64, or Linux (x86_64 / aarch64)
- [Node.js](https://nodejs.org) >= 22 (CI uses 24)
- [pnpm](https://pnpm.io) >= 10
- [Rust](https://rustup.rs) >= 1.77
- [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/) on macOS

### Install Dependencies

```bash
pnpm install
```

### Development Mode

Start the full desktop app (Tauri, with the in-process Rust gateway):

```bash
pnpm tauri dev
```

- Frontend dev server: http://localhost:1420 (Vite HMR runs inside the WebView)

### Production Build

```bash
pnpm tauri build
```

Outputs:

- macOS: `src-tauri/target/release/bundle/macos/Moor.app`
- macOS DMG: `src-tauri/target/release/bundle/dmg/Moor_<version>_aarch64.dmg`
- Windows: `src-tauri/target/release/bundle/nsis/Moor_<version>_x64-setup.exe`

### Code Quality

```bash
vp check       # format + lint + type check
vp lint        # lint only
vp lint --fix  # auto-fix
vp fmt         # format
```

### Testing

```bash
# Rust gateway tests
cargo test --manifest-path src-tauri/Cargo.toml

# Frontend + scripts tests
vp test
```

## API

### MCP Gateway

| Method | Path   | Description                             |
| ------ | ------ | --------------------------------------- |
| `ALL`  | `/mcp` | MCP protocol endpoint (Streamable HTTP) |

### Server Management

| Method   | Path                     | Description                                                |
| -------- | ------------------------ | ---------------------------------------------------------- |
| `GET`    | `/api/servers`           | List all servers                                           |
| `POST`   | `/api/servers`           | Add server                                                 |
| `GET`    | `/api/servers/:id`       | Server detail                                              |
| `PUT`    | `/api/servers/:id`       | Update server config                                       |
| `DELETE` | `/api/servers/:id`       | Remove server                                              |
| `POST`   | `/api/servers/:id/start` | Start server                                               |
| `POST`   | `/api/servers/:id/stop`  | Stop server                                                |
| `GET`    | `/api/servers/:id/tools` | Get discovered tools (optionally filter by `?profile_id=`) |
| `PUT`    | `/api/servers/order`     | Reorder servers                                            |

### Profile Management

| Method   | Path                                  | Description                           |
| -------- | ------------------------------------- | ------------------------------------- |
| `GET`    | `/api/profiles`                       | List all profiles                     |
| `POST`   | `/api/profiles`                       | Create profile                        |
| `GET`    | `/api/profiles/:id`                   | Get profile detail (with servers)     |
| `PUT`    | `/api/profiles/:id`                   | Update profile                        |
| `DELETE` | `/api/profiles/:id`                   | Delete profile                        |
| `PUT`    | `/api/profiles/:id/activate`          | Set as active profile                 |
| `GET`    | `/api/profiles/:id/servers/:serverId` | Get server toggle + disabled tools    |
| `PUT`    | `/api/profiles/:id/servers/:serverId` | Update server toggle + disabled tools |

### Audit Logs

| Method | Path              | Description               |
| ------ | ----------------- | ------------------------- |
| `GET`  | `/api/logs`       | Query logs (with filters) |
| `GET`  | `/api/logs/stats` | Aggregate statistics      |

### Settings Management

| Method  | Path                  | Description       |
| ------- | --------------------- | ----------------- |
| `GET`   | `/api/settings`       | Get settings      |
| `PATCH` | `/api/settings`       | Update settings   |
| `POST`  | `/api/settings/reset` | Reset to defaults |

### Other

| Method | Path                   | Description                     |
| ------ | ---------------------- | ------------------------------- |
| `GET`  | `/api/health`          | Health check                    |
| `GET`  | `/api/runtime`         | Runtime info (port, URL)        |
| `GET`  | `/api/events`          | SSE real-time event stream      |
| `POST` | `/api/import/scan`     | Scan local client configs       |
| `POST` | `/api/import/parse`    | Preview pasted JSON import      |
| `POST` | `/api/import/execute`  | Execute import                  |
| `GET`  | `/api/import/snippets` | Generate client config snippets |
| `POST` | `/api/import/convert`  | Convert configs between clients |

## Tech Stack

| Layer         | Technology                                           |
| ------------- | ---------------------------------------------------- |
| Frontend      | React 19, vite-plus, TypeScript 5.7, Tailwind CSS v4 |
| UI Primitives | Radix UI                                             |
| UI Components | shadcn/ui (New York style)                           |
| Desktop       | Tauri 2 (Rust)                                       |
| Gateway       | Rust, Axum, Tokio, rusqlite (in-process)             |
| Database      | SQLite (rusqlite)                                    |
| MCP Protocol  | Rust 自实现 (JSON-RPC over Streamable HTTP / stdio)  |
| Icons         | Lucide React                                         |
| Tooling       | vite-plus (vp CLI), Oxlint, Oxfmt, Vitest            |

## Acknowledgements

Thanks to the [linuxdo](https://linux.do/) community for discussion, sharing, and feedback.

## ❤️ Sponsor

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/varandrew)

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=varandrew/moor&type=Date)](https://www.star-history.com/#varandrew/moor&Date)

## License

[MIT](LICENSE)
