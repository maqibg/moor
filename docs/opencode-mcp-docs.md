# OpenCode MCP Servers

> 来源：https://opencode.ai/docs/mcp-servers/
> 访问日期：2026-04-30
>
> 说明：本文为外部文档镜像/参考，版权归原站点所有；内容可能过期，请以官方链接为准，引用或再分发时遵循原站点许可。

你可以使用 **Model Context Protocol（MCP）** 为 OpenCode 添加外部工具。OpenCode 同时支持本地和远程服务器。

添加后，MCP 工具会自动与内置工具一起提供给 LLM 使用。

## Caveats

使用 MCP 服务器时会增加上下文消耗，如果工具过多会快速累积。建议谨慎选择使用的 MCP 服务器。

某些 MCP 服务器（如 GitHub MCP server）会添加大量 token，容易超出上下文限制。

## Enable

在 [OpenCode Config](https://opencode.ai/docs/config/) 的 `mcp` 字段中定义 MCP 服务器，每个 MCP 使用唯一名称。你可以在提示时通过名称引用该 MCP。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "name-of-mcp-server": {
      "enabled": true
    },
    "name-of-other-mcp-server": {}
  }
}
```

通过设置 `enabled` 为 `false` 可以禁用服务器，适合临时禁用而不删除配置。

### Overriding Remote Defaults

组织可以通过 `.well-known/opencode` 端点提供默认 MCP 服务器。这些服务器可能默认禁用，允许用户按需启用。

在本地配置中添加 `enabled: true` 来启用特定服务器：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "jira": {
      "type": "remote",
      "url": "https://jira.example.com/mcp",
      "enabled": true
    }
  }
}
```

本地配置值会覆盖远程默认值。

## Local

使用 `type` 设置为 `"local"` 添加本地 MCP 服务器：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-local-mcp-server": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-command"],
      "enabled": true,
      "environment": {
        "MY_ENV_VAR": "my_env_var_value"
      }
    }
  }
}
```

`command` 也可以使用 `["bun", "x", "my-mcp-command"]`。

示例 — 添加测试用的 `@modelcontextprotocol/server-everything`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "mcp_everything": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

使用时在提示中添加 `use the mcp_everything tool`：

```
use the mcp_everything tool to add the number 3 and 4
```

### Local Options

| Option        | Type    | Required | Description                                              |
| ------------- | ------- | -------- | -------------------------------------------------------- |
| `type`        | String  | Y        | 必须为 `"local"`                                         |
| `command`     | Array   | Y        | 启动 MCP 服务器的命令和参数                              |
| `environment` | Object  |          | 运行时设置的环境变量                                     |
| `enabled`     | Boolean |          | 启动时是否启用 MCP 服务器                                |
| `timeout`     | Number  |          | 从 MCP 服务器获取工具的超时时间（ms），默认 5000（5 秒） |

## Remote

设置 `type` 为 `"remote"` 添加远程 MCP 服务器：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-remote-mcp": {
      "type": "remote",
      "url": "https://my-mcp-server.com",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer MY_API_KEY"
      }
    }
  }
}
```

### Remote Options

| Option    | Type    | Required | Description                                              |
| --------- | ------- | -------- | -------------------------------------------------------- |
| `type`    | String  | Y        | 必须为 `"remote"`                                        |
| `url`     | String  | Y        | 远程 MCP 服务器的 URL                                    |
| `enabled` | Boolean |          | 启动时是否启用 MCP 服务器                                |
| `headers` | Object  |          | 随请求发送的 headers                                     |
| `oauth`   | Object  |          | OAuth 认证配置，详见下方 OAuth 章节                      |
| `timeout` | Number  |          | 从 MCP 服务器获取工具的超时时间（ms），默认 5000（5 秒） |

## OAuth

OpenCode 自动处理远程 MCP 服务器的 OAuth 认证。当服务器需要认证时，OpenCode 会：

1. 检测 401 响应并启动 OAuth 流程
2. 如果服务器支持，使用 **Dynamic Client Registration (RFC 7591)**
3. 安全存储 token 以供后续请求使用

### Automatic

大多数启用 OAuth 的 MCP 服务器无需特殊配置：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-oauth-server": {
      "type": "remote",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

如果服务器需要认证，OpenCode 会在首次使用时提示你进行认证。你也可以手动触发：`opencode mcp auth <server-name>`。

### Pre-registered

如果你有 MCP 服务器提供商的客户端凭证，可以预配置：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-oauth-server": {
      "type": "remote",
      "url": "https://mcp.example.com/mcp",
      "oauth": {
        "clientId": "{env:MY_MCP_CLIENT_ID}",
        "clientSecret": "{env:MY_MCP_CLIENT_SECRET}",
        "scope": "tools:read tools:execute"
      }
    }
  }
}
```

### Authenticating

手动触发认证或管理凭证：

```bash
# 对特定 MCP 服务器进行认证
opencode mcp auth my-oauth-server

# 列出所有 MCP 服务器及其认证状态
opencode mcp list

# 移除已存储的凭证
opencode mcp logout my-oauth-server
```

`mcp auth` 命令会打开浏览器进行授权。授权后，OpenCode 会将 token 安全存储在 `~/.local/share/opencode/mcp-auth.json`。

### Disabling OAuth

要对服务器禁用自动 OAuth（例如使用 API Key 的服务器），设置 `oauth` 为 `false`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-api-key-server": {
      "type": "remote",
      "url": "https://mcp.example.com/mcp",
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:MY_API_KEY}"
      }
    }
  }
}
```

### OAuth Options

| Option         | Type           | Description                                    |
| -------------- | -------------- | ---------------------------------------------- |
| `oauth`        | Object / false | OAuth 配置对象，或 `false` 禁用 OAuth 自动检测 |
| `clientId`     | String         | OAuth client ID，未提供时尝试动态客户端注册    |
| `clientSecret` | String         | OAuth client secret（如授权服务器需要）        |
| `scope`        | String         | 授权期间请求的 OAuth scopes                    |

### Debugging

远程 MCP 服务器认证失败时，使用以下命令诊断：

```bash
# 查看所有 OAuth 服务器认证状态
opencode mcp auth list

# 调试特定服务器的连接和 OAuth 流程
opencode mcp debug my-oauth-server
```

`mcp debug` 命令显示当前认证状态、测试 HTTP 连接，并尝试 OAuth 发现流程。

## Manage

MCP 作为工具在 OpenCode 中可用，与内置工具并列。你可以像管理其他工具一样通过 OpenCode 配置管理它们。

### Global

全局启用或禁用 MCP 工具：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-mcp-foo": {
      "type": "local",
      "command": ["bun", "x", "my-mcp-command-foo"]
    },
    "my-mcp-bar": {
      "type": "local",
      "command": ["bun", "x", "my-mcp-command-bar"]
    }
  },
  "tools": {
    "my-mcp-foo": false
  }
}
```

使用 glob 模式批量禁用：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-mcp-foo": {
      "type": "local",
      "command": ["bun", "x", "my-mcp-command-foo"]
    },
    "my-mcp-bar": {
      "type": "local",
      "command": ["bun", "x", "my-mcp-command-bar"]
    }
  },
  "tools": {
    "my-mcp*": false
  }
}
```

`my-mcp*` 模式会匹配 `my-mcp_search`、`my-mcp_list` 等所有工具。

### Per Agent

MCP 服务器数量多时，可以全局禁用、按 Agent 启用：

1. 全局禁用该工具
2. 在 [agent config](https://opencode.ai/docs/agents/#tools) 中启用

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-mcp": {
      "type": "local",
      "command": ["bun", "x", "my-mcp-command"],
      "enabled": true
    }
  },
  "tools": {
    "my-mcp*": false
  },
  "agent": {
    "my-agent": {
      "tools": {
        "my-mcp*": true
      }
    }
  }
}
```

### Glob Patterns

- `*` 匹配零个或多个任意字符（如 `"my-mcp*"` 匹配 `my-mcp_search`、`my-mcp_list`）
- `?` 匹配恰好一个字符
- 其他字符字面匹配

## Examples

### Sentry

添加 [Sentry MCP server](https://mcp.sentry.dev/) 与 Sentry 项目和问题交互：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sentry": {
      "type": "remote",
      "url": "https://mcp.sentry.dev/mcp",
      "oauth": {}
    }
  }
}
```

添加配置后，使用 Sentry 进行认证：

```bash
opencode mcp auth sentry
```

认证后，可以在提示中使用 Sentry 工具查询问题、项目和错误数据：

```
Show me the latest unresolved issues in my project. use sentry
```

### Context7

添加 [Context7 MCP server](https://github.com/upstash/context7) 搜索文档：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

注册免费账户后可使用 API Key 获得更高速率限制：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"
      }
    }
  }
}
```

在提示中添加 `use context7`，或在 [AGENTS.md](https://opencode.ai/docs/rules/) 中添加规则：

```markdown
When you need to search docs, use `context7` tools.
```

### Grep by Vercel

添加 [Grep by Vercel](https://grep.app/) MCP server 搜索 GitHub 代码片段：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "gh_grep": {
      "type": "remote",
      "url": "https://mcp.grep.app"
    }
  }
}
```

在提示中使用：

```
What's the right way to set a custom domain in an SST Astro component? use the gh_grep tool
```

或在 AGENTS.md 中添加：

```markdown
If you are unsure how to do something, use `gh_grep` to search code examples from GitHub.
```
