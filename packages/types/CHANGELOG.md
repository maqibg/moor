# @moor/types

## 0.3.0

### Patch Changes

- Moor v0.3.0 — Settings Center, SSE, React Query 迁移及 Sidecar 全面重构

  **新功能：**
  - Settings Center 设置中心（General / Appearance / Advanced 三分组，9 个配置项）
  - SSE 自动重连机制与实时数据推送
  - React Query 数据层迁移（Dashboard、Profiles、Servers、ServerDetail、ProfileDetail）
  - stdio 传输模式支持
  - 配置转换器（Claude Code / Codex / OpenCode / Cursor）
  - 审计日志服务
  - 服务器生命周期管理与 auto-start
  - Session 管理器

  **前端：**
  - 新增 Settings、AuditLogs 等页面
  - 新增 ConverterPanel、CodeBlock、KeyValueTable、StatCard、DetailPageHeader 等共享组件
  - 引入 6 个 shadcn/ui 组件（Select、Checkbox、Textarea、Label、Separator、Skeleton）
  - SSE Context 与 useSettings / useTheme hooks
  - ServerCard、ScrollArea 等组件优化

  **Sidecar：**
  - Profiles / Settings / Import / Audit Log 等服务层拆分
  - Server Manager 重构为生命周期模式
  - API schemas 层（Zod v4 校验）
  - DB 层增强（server-repository、tool-catalog）
  - 客户端配置扫描器增强（Cursor 支持）

  **Tauri：**
  - Rust 端 lib.rs 大幅增强（286+ 行新增）
  - Settings 持久化与 sidecar 端口管理

  **修复：**
  - Node.js 版本要求更新为 22+
  - 配置导入文档增强
  - 错误/警告消息统一为英文
