# Moor CI/CD 硬化规格说明

> 版本: 1.0 | 日期: 2026-04-29

## 1. 背景与问题

Moor 项目的 GitHub Actions Release workflow 存在以下问题：

1. **macos-13 runner 排队严重**：GitHub 逐步缩减 Intel runner 容量，macos-13 可用实例远少于 macos-latest (ARM64)，高峰期长时间等待
2. **macos-13 未来退役风险**：GitHub 可能弃用 macos-13，届时 x86_64 构建将完全中断
3. **CHANGELOG.md 缺失**：项目配置了 changeset 但从未使用，Release 页面显示 "No CHANGELOG.md found."
4. **缓存 key 冲突风险**：两个 job 使用不同 runner 类型，缓存策略未考虑架构差异

## 2. 设计决策

### 2.1 Runner 策略

**决策**：统一使用 `macos-latest`，通过 Rosetta 2 交叉编译 x86_64

**理由**：

- 消除对 macos-13 的依赖，彻底解决排队问题
- 所有 runner 同一类型，缓存更高效（pnpm store 共享）
- GitHub 持续扩展 ARM runner 容量，可用性优于 Intel runner

**权衡**：x86_64 job 通过 Rosetta 模拟运行，构建时间预计增加 10-20%

### 2.2 Sidecar 交叉编译

**决策**：通过 `setup-node` 的 `architecture: x64` 参数安装 x86_64 Node.js

**技术原理**：

- `setup-node@v4` 原生支持在 ARM64 macOS 上安装 x86_64 Node（通过 Rosetta 透明运行）
- Node SEA 构建依赖 `process.execPath` 拷贝当前 Node 二进制
- x86_64 Node → `process.execPath` 返回 x86_64 二进制 → sidecar 正确为 x86_64
- `process.arch` 返回 `'x64'` → `targetTriple()` 正确生成 `x86_64-apple-darwin`

**构建脚本零修改**：`build-sidecar.mjs` 的所有架构判断逻辑在 Rosetta 环境下自动正确

### 2.3 Changelog 策略

**决策**：保持 `@changesets/cli` 工作流

**冷启动处理**：创建初始 changeset 文件 (`.changeset/initial-release.md`)，确保首次 `pnpm release` 生成 CHANGELOG.md

**Release 流程**：

1. 开发完成后运行 `pnpm changeset` 创建变更记录
2. 运行 `pnpm release` → `changeset version` 生成 CHANGELOG.md → git commit + tag
3. 推送 tag → CI 自动构建并创建 GitHub Release（含完整 changelog）

### 2.4 缓存策略

| 缓存目标     | Key 结构                                 | 隔离策略                           |
| ------------ | ---------------------------------------- | ---------------------------------- |
| pnpm store   | `{runner.os}-pnpm-store-{lockfile hash}` | 共享（tarball 与架构无关）         |
| Rust target/ | `{target}`                               | 按 target 隔离（编译产物架构相关） |

### 2.5 macOS 签名

**决策**：当前不实施签名/公证，保持未签名分发

用户首次启动需右键 → 打开，或运行 `xattr -rd com.apple.quarantine`。`extract-changelog.mjs` 中已包含此提示。

## 3. Workflow 配置规格

### 3.1 触发条件

```yaml
on:
  push:
    tags: ["v*"]
  workflow_dispatch:
```

### 3.2 矩阵定义

```yaml
matrix:
  include:
    - platform: "macos-latest"
      target: "aarch64-apple-darwin"
      node_arch: "arm64"
    - platform: "macos-latest"
      target: "x86_64-apple-darwin"
      node_arch: "x64"
```

### 3.3 构建步骤

| 步骤              | 说明                                    | 关键参数                                |
| ----------------- | --------------------------------------- | --------------------------------------- |
| Checkout          | `actions/checkout@v4`                   | -                                       |
| Setup Node        | `actions/setup-node@v4`                 | `architecture: ${{ matrix.node_arch }}` |
| Install pnpm      | `pnpm/action-setup@v4`                  | `version: 10.33.2`                      |
| pnpm cache        | `actions/cache@v4`                      | key: `{os}-pnpm-store-{lockfile hash}`  |
| Install deps      | `pnpm install --frozen-lockfile`        | -                                       |
| Version check     | `node scripts/sync-version.mjs --check` | -                                       |
| Extract changelog | `node scripts/extract-changelog.mjs`    | 输出到 `steps.changelog.outputs.body`   |
| Install Rust      | `dtolnay/rust-toolchain@stable`         | `targets: ${{ matrix.target }}`         |
| Rust cache        | `Swatinem/rust-cache@v2`                | `key: ${{ matrix.target }}`             |
| Build             | `tauri-apps/tauri-action@v0`            | `args: "--target ${{ matrix.target }}"` |

## 4. 构建链验证

x86_64 job 在 Rosetta 下的完整构建链：

```
setup-node (x64) → pnpm install → tauri-action
                                    └─ beforeBuildCommand: pnpm build
                                       ├─ pnpm --filter moor-sidecar build
                                       │  ├─ esbuild bundle (架构无关)
                                       │  ├─ Node SEA config + blob
                                       │  ├─ copy process.execPath (x86_64 Node)
                                       │  ├─ postject inject blob
                                       │  └─ codesign
                                       ├─ tsc -b
                                       └─ vp build (Vite)
                                    └─ cargo build --target x86_64-apple-darwin
                                       └─ bundles .dmg with sidecar
```

## 5. 版本管理架构

### 5.1 Source of Truth

`moor-sidecar`（`sidecar/package.json`）作为版本号唯一 source of truth。原因：changeset 只能发现 pnpm workspace 成员，而 workspace 仅包含 `sidecar`。

### 5.2 版本同步流程

```
pnpm changeset version
  └─ bumps moor-sidecar version in sidecar/package.json
pnpm version:sync
  ├─ reads sidecar/package.json version (source)
  ├─ syncs → package.json (root)
  ├─ syncs → src-tauri/tauri.conf.json
  └─ syncs → src-tauri/Cargo.toml
```

### 5.3 Changeset 配置变更

- 移除 `fixed` 选项（根包 `moor` 不是 workspace 成员，无法被 changeset 发现）
- `sync-version.mjs` source of truth 从根 `package.json` 改为 `sidecar/package.json`
- targets 从 `[tauri.conf.json, Cargo.toml, sidecar/package.json]` 改为 `[package.json, tauri.conf.json, Cargo.toml]`

## 6. 文件变更清单

| 文件                            | 操作 | 说明                                      |
| ------------------------------- | ---- | ----------------------------------------- |
| `.github/workflows/release.yml` | 重写 | 统一 macos-latest + Rosetta 矩阵          |
| `.changeset/initial-release.md` | 新建 | 初始 changeset，解决 CHANGELOG 冷启动     |
| `.changeset/config.json`        | 修改 | 移除 `fixed` 选项                         |
| `scripts/sync-version.mjs`      | 修改 | source of truth 改为 sidecar/package.json |

## 7. 验证清单

- [ ] YAML 语法正确，CI 能正常解析
- [ ] 两个 job 均在 macos-latest 上启动，无排队
- [ ] x86_64 job 使用 Rosetta Node，sidecar 二进制为 x86_64
- [ ] Rust 缓存 key 按 target 隔离，无冲突
- [ ] pnpm 缓存两个 job 共享
- [ ] Release 页面包含完整 changelog 内容
- [ ] 生成 `_aarch64.dmg` 和 `_x86_64.dmg` 两个产物
- [ ] `pnpm release` 流程正确生成 CHANGELOG.md
