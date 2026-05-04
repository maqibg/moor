# Moor 版本管理规格说明

## 概述

Moor 使用 `@changesets/cli` 实现自动版本号管理和 changelog 生成。版本号以 `sidecar/package.json` 为唯一来源（Single Source of Truth，因为它是 changeset 直接管理的 workspace 成员），构建时自动同步到所有目标文件。

## 版本号分布

版本号以 `sidecar/package.json` 为唯一来源（changeset 直接管理的 workspace 成员），通过 `sync-version.mjs` 同步到以下位置：

| 文件                          | 同步方式                       |
| ----------------------------- | ------------------------------ |
| `package.json`（根目录）      | 脚本写入 `version` 字段        |
| `packages/types/package.json` | 脚本写入 `version` 字段        |
| `src-tauri/tauri.conf.json`   | 脚本写入 `version` 字段        |
| `src-tauri/Cargo.toml`        | 脚本正则替换 `version = "..."` |

运行时版本号通过构建时注入获取：

| 位置                                             | 注入方式                               |
| ------------------------------------------------ | -------------------------------------- |
| `sidecar/src/mcp/gateway.ts`                     | esbuild `define` → `APP_VERSION` 常量  |
| `sidecar/src/services/server-manager.ts`（2 处） | esbuild `define` → `APP_VERSION` 常量  |
| `src/components/layout/Sidebar.tsx`              | Vite `define` → `__APP_VERSION__` 常量 |

## 日常开发工作流

### 添加变更记录

每次完成一个有意义的变更后，添加 changeset：

```bash
pnpm changeset
```

交互式选择：

1. 变更类型：`patch`（修复）/ `minor`（功能）/ `major`（破坏性）
2. 变更描述（Markdown 格式，会出现在 changelog 中）

生成文件：`.changeset/<random-name>.md`

### 发版

```bash
pnpm release
```

自动执行：

1. `changeset version` — 消费 pending changesets，更新 `package.json` 版本号和 `CHANGELOG.md`
2. `version:sync` — 同步版本号到 `package.json` / `packages/types/package.json` / `tauri.conf.json` / `Cargo.toml`
3. `git add -A && git commit` — 提交所有版本相关文件
4. `git tag v<version>` — 创建版本 tag

推送触发 CI：

```bash
git push --follow-tags origin main
```

### Pre-release 版本

```bash
# 进入 beta 模式并发布
pnpm release:beta

# 进入 rc 模式并发布
pnpm release:rc

# 退出 pre-release 模式
pnpm release:exit
```

## 版本同步机制

### 同步脚本

`scripts/sync-version.mjs` 负责版本号同步：

- 读取 `sidecar/package.json` 的 `version` 作为 source of truth
- 同步到根 `package.json`、`tauri.conf.json`、`Cargo.toml`
- `--check` 模式：仅校验一致性，不写入（CI 使用）

### 构建时自动同步

`src-tauri/tauri.conf.json` 中的 `beforeBuildCommand` 和 `beforeDevCommand` 已添加 `pnpm version:sync &&` 前缀，确保每次构建前版本号一致。

### CI 校验

GitHub Actions Release 工作流在构建前执行 `node scripts/sync-version.mjs --check`，版本不一致则构建失败。

## Changelog

- `@changesets/cli` 自动维护根目录 `CHANGELOG.md`
- 变更按类型分类：Minor（功能）、Patch（修复）、Major（破坏性）
- CI 自动从 `CHANGELOG.md` 提取最新版本内容作为 GitHub Release Notes

## 配置

### changesets 配置（`.changeset/config.json`）

- **版本同步**：通过 `sync-version.mjs` 将 `sidecar/package.json` 版本号同步到根 `package.json`、`tauri.conf.json`、`Cargo.toml`
- **不发布 npm**：`privatePackages: { version: true, tag: false }`
- **不自动 commit**：`commit: false`（由 release 脚本控制）

### CI Release 工作流

- 触发方式：推送 `v*` tag 或手动触发
- 构建目标：macOS Apple Silicon + Intel
- 发布方式：Draft Release（需人工审核后发布）
- Pre-release 检测：tag 包含 `-beta.` / `-rc.` / `-alpha.` 时自动标记为 prerelease

## 命令速查

| 命令                        | 用途                                      |
| --------------------------- | ----------------------------------------- |
| `pnpm changeset`            | 添加变更记录                              |
| `pnpm release`              | 执行发版（version + sync + commit + tag） |
| `pnpm release:beta`         | 发布 beta 版本                            |
| `pnpm release:rc`           | 发布 rc 版本                              |
| `pnpm release:exit`         | 退出 pre-release 模式                     |
| `pnpm version:sync`         | 手动同步版本号                            |
| `pnpm version:sync --check` | 校验版本一致性（CI）                      |
