# Codex MCP 配置指南

> 来源：https://developers.openai.com/codex/mcp
> 访问日期：2026-04-30
>
> 说明：本文为外部文档镜像/参考，版权归原站点所有；内容可能过期，请以官方链接为准，引用或再分发时遵循原站点许可。

Model Context Protocol (MCP) 连接模型与工具和上下文。使用 MCP 为 Codex 提供第三方文档访问，或让其与浏览器、Figma 等开发者工具交互。

Codex 在 CLI 和 IDE 扩展中均支持 MCP Server。

## Server 类型

- **STDIO Server**：作为本地进程运行（通过命令启动）
  - 支持环境变量
- **Streamable HTTP Server**：通过地址访问
  - Bearer Token 认证
  - OAuth 认证（运行 `codex mcp login <server-name>`）

## 配置文件位置

Codex 将 MCP 配置存储在 `config.toml` 中，与其他 Codex 配置共存。默认位置为 `~/.codex/config.toml`，也可将 MCP Server 限定到项目中（`.codex/config.toml`，仅限受信任项目）。

CLI 和 IDE 扩展共享此配置。配置好 MCP Server 后，可在两个 Codex 客户端间切换，无需重新设置。

配置方式二选一：

1. **使用 CLI**：运行 `codex mcp` 添加和管理 Server
2. **编辑 `config.toml`**：直接编辑 `~/.codex/config.toml`（或项目范围的 `.codex/config.toml`）

## 使用 CLI 配置

### 添加 MCP Server

```bash
codex mcp add <server-name> --env VAR1=VALUE1 --env VAR2=VALUE2 -- <stdio server-command>
```

示例 — 添加 Context7（免费 MCP Server，提供开发者文档）：

```bash
codex mcp add context7 -- npx -y @upstash/context7-mcp
```

### 其他 CLI 命令

查看所有可用 MCP 命令：

```bash
codex mcp --help
```

### Terminal UI (TUI)

在 `codex` TUI 中，使用 `/mcp` 查看活跃的 MCP Server。

## 使用 config.toml 配置

如需更细粒度的控制，编辑 `~/.codex/config.toml`（或项目范围的 `.codex/config.toml`）。在 IDE 扩展中，从齿轮菜单选择 **MCP settings** > **Open config.toml**。

在配置文件中用 `[mcp_servers.<server-name>]` 表配置每个 MCP Server。

### STDIO Server 配置

| 字段                       | 必需 | 说明                                                      |
| -------------------------- | ---- | --------------------------------------------------------- |
| `command`                  | 是   | 启动 Server 的命令                                        |
| `args`                     | 否   | 传递给 Server 的参数                                      |
| `env`                      | 否   | 为 Server 设置的环境变量                                  |
| `env_vars`                 | 否   | 允许并转发的环境变量                                      |
| `cwd`                      | 否   | Server 启动的工作目录                                     |
| `experimental_environment` | 否   | 设为 `remote` 可在有远程执行环境时通过其启动 stdio Server |

`env_vars` 可包含纯变量名或带 source 的对象：

```toml
env_vars = ["LOCAL_TOKEN", { name = "REMOTE_TOKEN", source = "remote" }]
```

字符串条目和 `source = "local"` 从 Codex 的本地环境读取。`source = "remote"` 从远程执行环境读取，需要远程 MCP stdio。

### Streamable HTTP Server 配置

| 字段                   | 必需 | 说明                                                     |
| ---------------------- | ---- | -------------------------------------------------------- |
| `url`                  | 是   | Server 地址                                              |
| `bearer_token_env_var` | 否   | Bearer Token 所在的环境变量名，发送到 `Authorization` 头 |
| `http_headers`         | 否   | Header 名称到静态值的映射                                |
| `env_http_headers`     | 否   | Header 名称到环境变量名的映射（值从环境读取）            |

### 通用配置选项

| 字段                  | 默认值 | 说明                                             |
| --------------------- | ------ | ------------------------------------------------ |
| `startup_timeout_sec` | `10`   | Server 启动超时（秒）                            |
| `tool_timeout_sec`    | `60`   | 工具执行超时（秒）                               |
| `enabled`             | —      | 设为 `false` 可禁用 Server 而不删除              |
| `required`            | —      | 设为 `true` 则该 Server 初始化失败时导致启动失败 |
| `enabled_tools`       | —      | 工具白名单                                       |
| `disabled_tools`      | —      | 工具黑名单（在 `enabled_tools` 之后应用）        |

### OAuth 回调配置

如果 OAuth 提供方需要固定回调端口，在 `config.toml` 顶层设置：

```toml
mcp_oauth_callback_port = 5555
mcp_oauth_callback_url = "https://devbox.example.internal/callback"
```

- 未设置 `mcp_oauth_callback_port` 时，Codex 绑定临时端口
- `mcp_oauth_callback_url` 作为 OAuth `redirect_uri`，同时仍用 `mcp_oauth_callback_port` 作为回调监听端口
- 本地回调 URL（如 `localhost`）绑定到本地接口；非本地 URL 绑定到 `0.0.0.0` 以便回调可达

如果 MCP Server 声明了 `scopes_supported`，Codex 在 OAuth 登录时优先使用 Server 广播的 scopes，否则回退到 `config.toml` 中配置的 scopes。

## config.toml 完整示例

### Context7（STDIO）

```toml
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
env_vars = ["LOCAL_TOKEN"]

[mcp_servers.context7.env]
MY_ENV_VAR = "MY_ENV_VALUE"
```

### OAuth 回调覆盖

```toml
# 可选的 MCP OAuth 回调覆盖（用于 `codex mcp login`）
mcp_oauth_callback_port = 5555
mcp_oauth_callback_url = "https://devbox.example.internal/callback"
```

### Figma（HTTP + Bearer Token）

```toml
[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"
http_headers = { "X-Figma-Region" = "us-east-1" }
```

### Chrome DevTools（工具过滤）

```toml
[mcp_servers.chrome_devtools]
url = "http://localhost:3000/mcp"
enabled_tools = ["open", "screenshot"]
disabled_tools = ["screenshot"] # 在 enabled_tools 之后应用
startup_timeout_sec = 20
tool_timeout_sec = 45
enabled = true
```

## 常用 MCP Server

| Server                                                                                                                                                                                  | 说明                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [OpenAI Docs MCP](https://developers.openai.com/learn/docs-mcp)                                                                                                                         | 搜索和阅读 OpenAI 开发者文档     |
| [Context7](https://github.com/upstash/context7)                                                                                                                                         | 连接最新开发者文档               |
| [Figma Local](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/) / [Remote](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) | 访问 Figma 设计                  |
| [Playwright](https://www.npmjs.com/package/@playwright/mcp)                                                                                                                             | 使用 Playwright 控制和检查浏览器 |
| [Chrome Developer Tools](https://github.com/ChromeDevTools/chrome-devtools-mcp/)                                                                                                        | 控制和检查 Chrome                |
| [Sentry](https://docs.sentry.io/product/sentry-mcp/#codex)                                                                                                                              | 访问 Sentry 日志                 |
| [GitHub](https://github.com/github/github-mcp-server)                                                                                                                                   | 管理 GitHub（PR、Issue 等）      |
