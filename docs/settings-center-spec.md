# Settings Center — 规格说明

## 概述

Moor 设置中心提供 9 个可配置项，分为 3 个分组：General、Appearance、Advanced。支持浅色/深色主题切换，设置数据持久化到 `~/.moor/settings.json`。

## 配置项

### General（通用）

| 配置项                       | 类型   | 默认值 | 即时生效 | 说明                                                  |
| ---------------------------- | ------ | ------ | -------- | ----------------------------------------------------- |
| Auto-start on Login          | Switch | OFF    | ✅       | 开机自启动，全平台支持（tauri-plugin-autostart）      |
| Auto-start Servers on Launch | Switch | OFF    | ✅       | 启动时自动启动标记为 auto-start 的服务器              |
| Minimize to Tray on Close    | Switch | ON     | ✅       | 关闭窗口时最小化到系统托盘                            |
| Show Window on Launch        | Switch | ON     | ✅       | 启动时显示主窗口（联动：Minimize to Tray OFF 时禁用） |

### Appearance（外观）

| 配置项 | 类型             | 默认值 | 即时生效 | 说明                                  |
| ------ | ---------------- | ------ | -------- | ------------------------------------- |
| Theme  | SegmentedControl | System | ✅       | Light / Dark / System（跟随 OS 偏好） |

### Advanced（高级）

| 配置项               | 类型                 | 默认值   | 即时生效  | 说明                            |
| -------------------- | -------------------- | -------- | --------- | ------------------------------- |
| Log Retention        | Number Input + Apply | 30 天    | ✅        | 日志保留天数（0 = 无限）        |
| Enable Audit Logging | Switch               | ON       | ✅        | 是否记录审计日志                |
| Sidecar Port         | Number Input + Apply | 9223     | ❌ 需重启 | Sidecar API 监听端口            |
| API Token            | 只读 + Copy          | 随机生成 | N/A       | 显示（遮罩/点击切换）+ 一键复制 |
| About Card           | 静态信息             | N/A      | N/A       | 版本号 + GitHub 链接            |

## 存储架构

```
~/.moor/settings.json    ← 真相源（Tauri 启动时直接读取）
~/.moor/moor.db          ← settings 表（运行时缓存，Sidecar 负责读写）
localStorage             ← 前端主题缓存（防止刷新闪烁）
```

### settings.json Schema

```json
{
  "version": 1,
  "general": {
    "autoStartOnLogin": false,
    "autoStartServersOnLaunch": false,
    "minimizeToTrayOnClose": true,
    "showWindowOnLaunch": true
  },
  "appearance": { "theme": "system" },
  "advanced": {
    "logRetentionDays": 30,
    "enableAuditLogging": true,
    "sidecarPort": 9223
  }
}
```

## API 端点

```
GET   /api/settings        → Settings
PATCH /api/settings        → Settings（部分更新）
POST  /api/settings/reset  → Settings（恢复默认）
```

## UI 布局

```
+----------------------------------------------------------+
| Settings                                    [Reset Defaults] |
+----------------------------------------------------------+
| [Pending Restart Banner — 条件显示]                       |
+----------------------------------------------------------+
| General     | SettingRow: Label + Description + Control  |
| Appearance  |                                            |
| Advanced    |                                            |
+----------------------------------------------------------+
```

- 左侧分组导航（44px 宽），右侧内容区
- Switch 类设置即时保存
- 数字输入类需点击 Apply
- 高级设置修改端口后显示橙色重启横幅

## 导航入口

侧边栏底部，Documentation 链接下方，分隔线 + Settings（Cog 图标）。路由 `/settings`。

## 暗色主题

- 冷暖对比风格：深灰底（`#1a1a1a`）+ 橙色强调（`#f54e00`）
- 通过 `[data-theme="dark"]` 覆盖 CSS 变量
- `--fg-XX` 语义化 opacity token 系统适配所有 `rgba()` 值
- 代码块使用 `bg-surface-inverted`（始终深色）
- localStorage 缓存主题偏好，启动时即时应用

## SSE 事件

新增 `settings:changed` 事件，设置更新时推送完整 Settings 对象。

## 日志清理

- Sidecar 启动时执行一次 `DELETE FROM audit_logs WHERE timestamp < (now - retentionDays)`
- 之后每小时定时执行

## 交互规则

- **联动**：Minimize to Tray OFF → Show Window on Launch 禁用（灰色）
- **重启横幅**：端口修改后显示，用户点击 Restart Now 触发 `invoke("restart_sidecar")`
- **重置**：页面顶部 Reset to Defaults 按钮，需 `window.confirm()` 确认

## 文件清单

### 新建文件

- `packages/types/src/settings.ts`
- `sidecar/src/services/settings.ts`
- `sidecar/src/api/settings.ts`
- `src/hooks/useSettings.ts`
- `src/hooks/useTheme.ts`
- `src/pages/Settings.tsx`

### 修改文件

- `packages/types/src/index.ts`、`events.ts`
- `sidecar/src/server.ts`、`index.ts`、`db/index.ts`、`api/events.ts`、`services/audit-logger.ts`
- `src-tauri/Cargo.toml`、`src/lib.rs`、`capabilities/default.json`
- `src/App.tsx`、`main.tsx`、`styles/globals.css`
- `src/components/layout/AppShell.tsx`、`Sidebar.tsx`
- `src/contexts/SSEContext.tsx`
- 所有 UI 组件 + 页面组件（rgba → CSS var 迁移）
