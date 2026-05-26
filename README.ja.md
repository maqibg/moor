<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Moor" width="128">
</p>

<h1 align="center">Moor</h1>

<p align="center">
  <b>AI Agent 向けローカル MCP ゲートウェイマネージャー</b><br>
  複数の MCP Server を単一エンドポイントに集約し、Profile によるツールフィルタリングを行い、美しいネイティブ UI ですべてを管理します。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri" alt="Tauri 2">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/platform-macOS-black?logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows" alt="Windows">
  <img src="https://img.shields.io/badge/pnpm-10+-F69220?logo=pnpm" alt="pnpm">
</p>

<p align="center">
  <a href="#install">インストール</a> ·
  <a href="#quickstart">クイックスタート</a> ·
  <a href="#features">機能</a> ·
  <a href="#architecture">アーキテクチャ</a> ·
  <a href="#development">開発</a> ·
  <a href="#api">API</a>
</p>

<!-- README-I18N:START -->

[English](./README.md) | [汉语](./README.zh.md) | **日本語** | [Español](./README.es.md)

<!-- README-I18N:END -->

---

> _AI Agent はツールを必要としますが、異なるクライアント間で多数の MCP Server を管理するのは面倒です。私はすべてを集約し、コンテキストでフィルタリングし、バックグラウンドで継続的に実行できる単一のゲートウェイが欲しかったのです——すべては美しいネイティブ UI から制御できます。_
>
> _Moor は単一エンドポイント（`http://127.0.0.1:<port>/mcp`）を公開し、アクティブな Profile に基づいて必要なツールのみを動的に提供します。Agent を切断することなく Profile を切り替えられ、すべてのツール呼び出しが監査されます。これが私が Moor を作った理由です。_

<p align="center">
  <img src="./assets/Dashboard%20Page.png" alt="Dashboard" width="800"><br>
  <sub>Dashboard — アクティブな Profile、Server の状態、監査統計を一覧表示。</sub>
</p>

<p align="center">
  <img src="./assets/Servers%20Page.png" alt="Servers" width="800"><br>
  <sub>Servers — MCP Server の管理、設定のインポート、健全性の監視。</sub>
</p>

<p align="center">
  <img src="./assets/Profiles%20Page.png" alt="Profiles" width="800"><br>
  <sub>Profiles — Profile の作成、Server のオン/オフ、ツールの有効/無効化。</sub>
</p>

<p align="center">
  <img src="./assets/Audit%20Page.png" alt="Audit" width="800"><br>
  <sub>Audit — ツール呼び出しの全文脈とフィルタで詳細を確認。</sub>
</p>

<a id="install"></a>

## インストール

### macOS アプリ

[Releases](https://github.com/varandrew/moor/releases) から `.dmg` をダウンロードし、Applications フォルダにドラッグするだけです。アプリには Rust インプロセス HTTP サーバーがバンドルされているため、Node.js ランタイムの事前インストールは不要です。

### Windows アプリ

[Releases](https://github.com/varandrew/moor/releases) から Windows インストーラーをダウンロードして実行します。アプリには Rust インプロセス HTTP サーバーがバンドルされているため、Node.js ランタイムの事前インストールは不要です。

### ソースからビルド

macOS（Apple Silicon / Intel）または Windows x64、Node.js >= 22、pnpm >= 10、Rust >= 1.77 が必要です。

```bash
git clone https://github.com/varandrew/moor.git
cd moor
pnpm install
```

ビルド手順については [開発](#development) セクションを参照してください。

<a id="quickstart"></a>

## クイックスタート

### アプリを起動する

**Moor.app** を開きます。Dashboard では、アクティブな Profile、Server の状態、最近の監査ログが一目で確認できます。

### 既存設定をスキャンする

Moor は、Claude Code、Codex、OpenCode、Cursor 用に既に設定済みの MCP Server を自動検出できます：

1. **Servers** → **Import** に移動
2. **Scan** をクリック — Moor は `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.config/opencode/opencode.json` / `.jsonc`、`~/.cursor/mcp.json` を読み取ります
3. インポートしたい Server を選択

**Import JSON** を使用して JSON MCP 設定を貼り付けることもできます。Moor は stdio および HTTP/SSE Server をインポートし、OpenAPI 設定などのサポートされていないエントリは保存せずに報告します。

### プロファイルを作成する

Profile を使用すると、Server をグループ化し、Agent に公開するツールを制御できます：

1. **Profiles** → **New Profile** に移動
2. 名前を付ける（例："Coding"、"Research"）
3. Server のオン/オフを切り替える
4. Server を展開して個別のツールを有効/無効化
5. **Activate** をクリック — 変更は即座に反映されます

### エージェントを接続する

MCP 互換の任意のクライアントを Moor の単一エンドポイントに向けます：

```
http://127.0.0.1:9223/mcp
```

`9223` はデフォルトの Sidecar ポートです。既に使用されている場合、Moor は次に利用可能なポートを選択し、Dashboard と Client Config ページに実際のエンドポイントを表示します。

`/mcp` エンドポイントはループバックのみであり、`X-Moor-Token` は不要です。Moor は WebView と Sidecar 間のローカル管理 API にのみ `X-Moor-Token` を使用するため、Agent の設定に貼り付ける必要はありません。

Moor は残りのすべてを処理します — `tools/list` の集約、`tools/call` のルーティング、アクティブな Profile に基づくフィルタリング。

<a id="features"></a>

## 機能

### MCP ゲートウェイの集約

単一の HTTP エンドポイント（`/mcp`）がすべてのバックエンド MCP Server をプロキシします。Agent は統一されたツールカタログを見ることができ — 複数のエンドポイントを設定する必要はありません。

### マルチトランスポート対応

**stdio**（サブプロセス）と **HTTP/SSE** の両方の MCP Server に接続できます。Moor は接続のライフサイクル、再起動、ヘルスチェックを自動的に管理します。

### プロファイル管理

異なるワークフロー向けに無制限の Profile を作成できます。各 Profile は以下を保存します：

- どの Server が有効か
- 各 Server でどのツールが無効か
- グローバルアクティブ状態

Profile を **ホットスワップ** で切り替え — 接続中の Agent は接続を維持し、次の `tools/list` で新しい設定が即座に反映されます。

### ツール単位の切り替え

Server レベルのオン/オフに加えて、任意の Server を展開して特定のツールを無効化できます。無効化されたツールは Agent のツールカタログからリアルタイムに消えます。

### 設定のインポート

以下からワンクリックでインポート：

- **Claude Code**: `~/.claude/settings.json`
- **Codex**: `~/.codex/config.toml`
- **OpenCode**: `~/.config/opencode/opencode.json` / `.jsonc`
- **Cursor**: `~/.cursor/mcp.json`

stdio および HTTP/SSE Server の手動入力と JSON 貼り付けによるバッチインポートもサポートされています。

### クライアント設定

Claude Code、Codex、OpenCode、Cursor 向けにコピーするだけで使える設定スニペットを生成します。スニペットには `/mcp` エンドポイントのみが含まれます。Moor の `X-Moor-Token` は内部管理 API 用に予約されています。

### 監査ログ

すべての `tools/call` は以下と共に記録されます：

- タイムスタンプ、Profile、Server、ツール名
- 引数（機密データはマスキング済み）
- 結果またはエラー
- 所要時間と Agent 情報

時間範囲、Server、またはツールでフィルタリングできます。Dashboard で集計統計を確認できます。

### システムトレイ

ウィンドウを閉じても — Moor は macOS メニューバーまたは Windows システムトレイで実行を続けます。ゲートウェイはアクティブなままなので、Agent は接続を失いません。

### リアルタイムステータス

Server の状態変更と Profile の切り替えは SSE を介して UI にプッシュされます。ページの更新は不要です。

<a id="architecture"></a>

## アーキテクチャ

<details>
<summary>アーキテクチャ図</summary>

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
├── Dev Sidecar      Node.js / TypeScript (Hono — 開発モード & SEA スタンドアロン)
└── Storage           SQLite (rusqlite / node:sqlite)
    ├── servers (configs, status)
    ├── profiles (server groups + tool toggles)
    └── audit_logs (tool calls, params, results, errors)
```

</details>

### 通信フロー

```
AI Agent ──HTTP──▶ POST /mcp ──▶ Moor Gateway ──stdio/HTTP──▶ MCP Servers
                              │
WebView ──IPC──▶ get_sidecar_info ─┐
WebView ──fetch──▶ /api/* ────────┘
WebView ◀──SSE──── /api/events
```

- **ランタイム検出**: WebView → Tauri IPC (`get_sidecar_info`) → Rust（ポート、トークン）；ブラウザ開発モードでは `/api/runtime` にフォールバック
- **業務操作**: WebView → HTTP `fetch()` → インプロセス Axum サーバー（Rust）
- **システム操作**: WebView → Tauri IPC → Rust（トレイ、ウィンドウ、自動起動）

<a id="development"></a>

## 開発

### 前提条件

- macOS（Apple Silicon / Intel）または Windows x64
- [Node.js](https://nodejs.org) >= 22
- [pnpm](https://pnpm.io) >= 10
- [Rust](https://rustup.rs) >= 1.77
- macOS では [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/) も必要です

### 依存関係のインストール

```bash
pnpm install
```

### 開発モード

フロントエンドと Sidecar を同時に起動：

```bash
pnpm dev:all
```

- フロントエンド: http://localhost:1420
- Sidecar API: http://localhost:9223

完全なデスクトップアプリ（Tauri）を起動：

```bash
pnpm tauri dev
```

### プロダクションビルド

```bash
pnpm tauri build
```

出力：

- macOS: `src-tauri/target/release/bundle/macos/Moor.app`
- macOS DMG: `src-tauri/target/release/bundle/dmg/Moor_<version>_aarch64.dmg`
- Windows: `src-tauri/target/release/bundle/nsis/Moor_<version>_x64-setup.exe`

### コード品質

```bash
vp check       # フォーマット + リント + 型チェック
vp lint        # リントのみ
vp lint --fix  # 自動修正
vp fmt         # フォーマット
```

### テスト

```bash
# Sidecar テスト
cd sidecar && vp test run

# フロントエンドテスト
vp test
```

<a id="api"></a>

## API

### MCP ゲートウェイ

| メソッド | パス   | 説明                                            |
| -------- | ------ | ----------------------------------------------- |
| `ALL`    | `/mcp` | MCP プロトコルエンドポイント（Streamable HTTP） |

### Server 管理

| メソッド | パス                     | 説明                   |
| -------- | ------------------------ | ---------------------- |
| `GET`    | `/api/servers`           | すべての Server を一覧 |
| `POST`   | `/api/servers`           | Server を追加          |
| `GET`    | `/api/servers/:id`       | Server 詳細            |
| `PUT`    | `/api/servers/:id`       | Server 設定を更新      |
| `DELETE` | `/api/servers/:id`       | Server を削除          |
| `POST`   | `/api/servers/:id/start` | Server を起動          |
| `POST`   | `/api/servers/:id/stop`  | Server を停止          |
| `GET`    | `/api/servers/:id/tools` | 検出済みツールを取得   |
| `PUT`    | `/api/servers/order`     | Server の並べ替え      |

### プロファイル管理

| メソッド | パス                             | 説明                               |
| -------- | -------------------------------- | ---------------------------------- |
| `GET`    | `/api/profiles`                  | すべての Profile を一覧            |
| `POST`   | `/api/profiles`                  | Profile を作成                     |
| `PUT`    | `/api/profiles/:id`              | Profile を更新                     |
| `DELETE` | `/api/profiles/:id`              | Profile を削除                     |
| `PUT`    | `/api/profiles/:id/activate`     | アクティブ Profile に設定          |
| `PUT`    | `/api/profiles/:id/servers/:sid` | Server 切り替え + 無効ツールを更新 |

### 監査ログ

| メソッド | パス              | 説明                         |
| -------- | ----------------- | ---------------------------- |
| `GET`    | `/api/logs`       | ログをクエリ（フィルタ対応） |
| `GET`    | `/api/logs/stats` | 集計統計                     |

### 設定管理

| メソッド | パス                  | 説明                 |
| -------- | --------------------- | -------------------- |
| `GET`    | `/api/settings`       | 設定を取得           |
| `PATCH`  | `/api/settings`       | 設定を更新           |
| `POST`   | `/api/settings/reset` | デフォルトにリセット |

### その他

| メソッド | パス                   | 説明                                   |
| -------- | ---------------------- | -------------------------------------- |
| `GET`    | `/api/health`          | ヘルスチェック                         |
| `GET`    | `/api/runtime`         | ランタイム情報                         |
| `GET`    | `/api/events`          | SSE リアルタイムイベントストリーム     |
| `POST`   | `/api/import/scan`     | ローカルクライアント設定をスキャン     |
| `POST`   | `/api/import/parse`    | 貼り付けた JSON インポートをプレビュー |
| `POST`   | `/api/import/execute`  | インポートを実行                       |
| `GET`    | `/api/import/snippets` | クライアント設定スニペットを生成       |
| `POST`   | `/api/import/convert`  | クライアント間で設定を変換             |

## 技術スタック

| レイヤー          | 技術                                                    |
| ----------------- | ------------------------------------------------------- |
| フロントエンド    | React 19, vite-plus, TypeScript 5.7, Tailwind CSS v4    |
| UI プリミティブ   | Radix UI                                                |
| UI コンポーネント | shadcn/ui (New York style)                              |
| デスクトップ      | Tauri 2 (Rust)                                          |
| ゲートウェイ      | Rust, Axum, Tokio, rusqlite (インプロセス)              |
| 開発 Sidecar      | Node.js, TypeScript, Hono, @hono/node-server, @hono/mcp |
| データベース      | SQLite (rusqlite / node:sqlite)                         |
| MCP プロトコル    | @modelcontextprotocol/sdk (stdio + HTTP/SSE)            |
| アイコン          | Lucide React                                            |
| ツールチェーン    | vite-plus (vp CLI), Oxlint, Oxfmt, Vitest               |

## 謝辞

[linuxdo](https://linux.do/) コミュニティの議論、共有、フィードバックに感謝します。

## ❤️ スポンサー

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/varandrew)

## 🌟 Star 履歴

[![Star History Chart](https://api.star-history.com/svg?repos=varandrew/moor&type=Date)](https://www.star-history.com/#varandrew/moor&Date)

## ライセンス

[MIT](LICENSE)
