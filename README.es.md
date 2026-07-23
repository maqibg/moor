<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Moor" width="128">
</p>

<h1 align="center">Moor</h1>

<p align="center">
  <b>Administrador de Gateway MCP local para Agentes de IA</b><br>
  Agrega múltiples servidores MCP en un solo endpoint, filtra herramientas por Perfil y gestiona todo desde una hermosa UI nativa.
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
  <a href="#install">Instalación</a> ·
  <a href="#quickstart">Inicio rápido</a> ·
  <a href="#features">Características</a> ·
  <a href="#architecture">Arquitectura</a> ·
  <a href="#development">Desarrollo</a> ·
  <a href="#api">API</a>
</p>

<!-- README-I18N:START -->

[English](./README.md) | [汉语](./README.zh.md) | [日本語](./README.ja.md) | **Español**

<!-- README-I18N:END -->

---

> _Los Agentes de IA necesitan herramientas, pero gestionar docenas de servidores MCP entre diferentes clientes es un desastre. Quería una única puerta de enlace que agregue todo, filtre por contexto y siga ejecutándose en segundo plano — todo controlable desde una hermosa UI nativa._
>
> _Moor expone un único endpoint (`http://127.0.0.1:<port>/mcp`) que sirve dinámicamente solo las herramientas que deseas, basado en tu Perfil activo. Cambia perfiles sin desconectar tu Agente, y cada llamada a herramienta es auditada. Por eso lo construí._

<p align="center">
  <img src="./assets/Dashboard%20Page.png" alt="Dashboard" width="800"><br>
  <sub>Dashboard — Vista general del Perfil activo, estado de los servidores y estadísticas de auditoría.</sub>
</p>

<p align="center">
  <img src="./assets/Servers%20Page.png" alt="Servers" width="800"><br>
  <sub>Servers — Gestiona servidores MCP, importa configuraciones y monitoriza el estado.</sub>
</p>

<p align="center">
  <img src="./assets/Profiles%20Page.png" alt="Profiles" width="800"><br>
  <sub>Profiles — Crea perfiles, activa/desactiva servidores y habilita/deshabilita herramientas.</sub>
</p>

<p align="center">
  <img src="./assets/Audit%20Page.png" alt="Audit" width="800"><br>
  <sub>Audit — Inspecciona cada llamada a herramienta con contexto completo y filtros.</sub>
</p>

<a id="install"></a>

## Instalación

### Aplicación macOS

Descarga el `.dmg` desde [Releases](https://github.com/maqibg/moor/releases), arrástralo a Applications, listo. La aplicación incluye el servidor HTTP Rust en proceso — no se requiere Node.js preinstalado.

### Aplicación Windows

Descarga el instalador de Windows desde [Releases](https://github.com/maqibg/moor/releases) y ejecútalo. La aplicación incluye el servidor HTTP Rust en proceso — no se requiere Node.js preinstalado.

### Compilar desde el código fuente

Requiere macOS (Apple Silicon / Intel) o Windows x64, Node.js >= 22, pnpm >= 10 y Rust >= 1.77.

```bash
git clone https://github.com/maqibg/moor.git
cd moor
pnpm install
```

Consulta [Desarrollo](#development) para las instrucciones de compilación.

<a id="quickstart"></a>

## Inicio rápido

### Lanzar la aplicación

Abre **Moor.app**. El Dashboard muestra tu Perfil activo, el estado de los servidores y los registros de auditoría recientes de un vistazo.

### Escanear configuraciones existentes

Moor puede detectar automáticamente los servidores MCP que ya hayas configurado para Claude Code, Codex, OpenCode y Cursor:

1. Ve a **Servers** → **Import**
2. Haz clic en **Scan** — Moor lee `~/.claude/settings.json`, `~/.codex/config.toml`, `~/.config/opencode/opencode.json` / `.jsonc`, y `~/.cursor/mcp.json`
3. Selecciona los servidores que deseas importar

También puedes pegar una configuración MCP en JSON con **Import JSON**. Moor importa servidores stdio y HTTP/SSE, e informa sobre entradas no soportadas como configuraciones OpenAPI sin guardarlas.

### Crear un Perfil

Los Perfiles te permiten agrupar servidores y controlar qué herramientas se exponen a los Agentes:

1. Ve a **Profiles** → **New Profile**
2. Ponle un nombre (p. ej., "Coding", "Research")
3. Activa/desactiva servidores
4. Expande un servidor para habilitar/deshabilitar herramientas individuales
5. Haz clic en **Activate** — el cambio es instantáneo

### Conectar tu Agente

Apunta cualquier cliente compatible con MCP al único endpoint de Moor:

```
http://127.0.0.1:9223/mcp
```

`9223` es el puerto sidecar por defecto. Si ya está en uso, Moor elige el siguiente puerto disponible, lo guarda para futuros inicios y muestra una advertencia con el endpoint real. Cuando esto ocurra, actualiza las configuraciones MCP existentes.

El endpoint `/mcp` es solo para loopback y no requiere `X-Moor-Token`. Moor usa `X-Moor-Token` solo para APIs de gestión local entre el WebView y el sidecar, por lo que no necesitas pegarlo en las configuraciones del agente.

Moor se encarga del resto — agregando `tools/list`, enrutando `tools/call`, y filtrando basado en tu Perfil activo.

<a id="features"></a>

## Características

### Agregación de Gateway MCP

Un único endpoint HTTP (`/mcp`) hace de proxy para todos los servidores MCP backend. Los Agentes ven un catálogo de herramientas unificado — no es necesario configurar múltiples endpoints.

### Soporte multi-transporte

Conecta tanto servidores MCP **stdio** (subproceso) como **HTTP/SSE**. Moor gestiona automáticamente los ciclos de vida de conexión, reinicios y verificaciones de salud.

### Gestión de Perfiles

Crea Perfiles ilimitados para diferentes flujos de trabajo. Cada Perfil almacena:

- Qué servidores están habilitados
- Qué herramientas están deshabilitadas por servidor
- Un estado activo global

Cambia Perfiles con **hot-swap** — los Agentes conectados permanecen conectados, y el siguiente `tools/list` refleja la nueva configuración inmediatamente.

### Conmutadores a nivel de herramienta

Más allá del encendido/apagado a nivel de servidor, profundiza en cualquier servidor para deshabilitar herramientas específicas. Las herramientas deshabilitadas desaparecen del catálogo de herramientas del Agente en tiempo real.

### Importación de configuración

Importación con un solo clic desde:

- **Claude Code**: `~/.claude/settings.json`
- **Codex**: `~/.codex/config.toml`
- **OpenCode**: `~/.config/opencode/opencode.json` / `.jsonc`
- **Cursor**: `~/.cursor/mcp.json`

También se admiten la entrada manual y la importación por lotes mediante JSON pegado para servidores stdio y HTTP/SSE.

### Configuración de cliente

Genera fragmentos de configuración listos para copiar para Claude Code, Codex, OpenCode y Cursor. Los fragmentos contienen solo el endpoint `/mcp`; el `X-Moor-Token` de Moor está reservado para llamadas a la API de gestión interna.

### Registros de auditoría

Cada `tools/call` se registra con:

- Marca de tiempo, Perfil, Servidor, Nombre de herramienta
- Argumentos (con redacción de datos sensibles)
- Resultado o error
- Duración e información del Agente

Filtra por rango de tiempo, servidor o herramienta. Visualiza estadísticas agregadas en el Dashboard.

### Bandeja del sistema

Cierra la ventana — Moor sigue ejecutándose en la barra de menús de macOS o en la bandeja del sistema de Windows. El gateway permanece activo, así que tus Agentes nunca pierden conexión.

### Estado en tiempo real

Los cambios de estado del servidor y los cambios de Perfil se envían a la UI mediante SSE. No es necesario refrescar.

<a id="architecture"></a>

## Arquitectura

<details>
<summary>Diagrama de arquitectura</summary>

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

### Flujo de comunicación

```
AI Agent ──HTTP──▶ POST /mcp ──▶ Moor Gateway ──stdio/HTTP──▶ MCP Servers
                              │
WebView ──IPC──▶ get_sidecar_info ─┐
WebView ──fetch──▶ /api/runtime ───┤ (fallback en modo de desarrollo del navegador)
WebView ──fetch──▶ /api/* ─────────┘
WebView ◀──SSE──── /api/events
```

- **Detección de runtime**: WebView → Tauri IPC (`get_sidecar_info`) → Rust (puerto, token); en modo de desarrollo del navegador recurre a HTTP `GET /api/runtime`
- **Operaciones de negocio**: WebView → HTTP `fetch()` → Servidor Axum en proceso (Rust)
- **Operaciones de sistema**: WebView → Tauri IPC → Rust (bandeja, ventana, auto-inicio)

<a id="development"></a>

## Desarrollo

### Requisitos previos

- macOS (Apple Silicon / Intel) o Windows x64
- [Node.js](https://nodejs.org) >= 22
- [pnpm](https://pnpm.io) >= 10
- [Rust](https://rustup.rs) >= 1.77
- [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/) en macOS

### Instalar dependencias

```bash
pnpm install
```

### Modo de desarrollo

Inicia la aplicación de escritorio completa (Tauri, con la pasarela Rust en proceso):

```bash
pnpm tauri dev
```

- Frontend: http://localhost:1420 (Vite HMR dentro del WebView)

### Compilación de producción

```bash
pnpm tauri build
```

Salidas:

- macOS: `src-tauri/target/release/bundle/macos/Moor.app`
- macOS DMG: `src-tauri/target/release/bundle/dmg/Moor_<version>_aarch64.dmg`
- Windows: `src-tauri/target/release/bundle/nsis/Moor_<version>_x64-setup.exe`

### Calidad de código

```bash
vp check       # formato + lint + comprobación de tipos
vp lint        # solo lint
vp lint --fix  # auto-corrección
vp fmt         # formato
```

### Pruebas

```bash
# Pruebas de la pasarela Rust
cargo test --manifest-path src-tauri/Cargo.toml

# Pruebas de frontend + scripts
vp test
```

<a id="api"></a>

## API

### Gateway MCP

| Método   | Ruta   | Descripción                                     |
| -------- | ------ | ----------------------------------------------- |
| `POST`   | `/mcp` | Envía solicitudes y notificaciones MCP JSON-RPC |
| `GET`    | `/mcp` | Abre el flujo SSE de Streamable HTTP            |
| `DELETE` | `/mcp` | Finaliza una sesión MCP                         |

### Gestión de servidores

| Método   | Ruta                     | Descripción                       |
| -------- | ------------------------ | --------------------------------- |
| `GET`    | `/api/servers`           | Listar todos los servidores       |
| `POST`   | `/api/servers`           | Añadir servidor                   |
| `GET`    | `/api/servers/:id`       | Detalle del servidor              |
| `PUT`    | `/api/servers/:id`       | Actualizar config del servidor    |
| `DELETE` | `/api/servers/:id`       | Eliminar servidor                 |
| `POST`   | `/api/servers/:id/start` | Iniciar servidor                  |
| `POST`   | `/api/servers/:id/stop`  | Detener servidor                  |
| `GET`    | `/api/servers/:id/tools` | Obtener herramientas descubiertas |
| `PUT`    | `/api/servers/order`     | Reordenar servidores              |

### Gestión de Perfiles

| Método   | Ruta                                  | Descripción                                                     |
| -------- | ------------------------------------- | --------------------------------------------------------------- |
| `GET`    | `/api/profiles`                       | Listar todos los perfiles                                       |
| `POST`   | `/api/profiles`                       | Crear perfil                                                    |
| `PUT`    | `/api/profiles/:id`                   | Actualizar perfil                                               |
| `DELETE` | `/api/profiles/:id`                   | Eliminar perfil                                                 |
| `PUT`    | `/api/profiles/:id/activate`          | Establecer como perfil activo                                   |
| `PUT`    | `/api/profiles/:id/servers/:serverId` | Actualizar conmutador de servidor + herramientas deshabilitadas |

### Registros de auditoría

| Método | Ruta              | Descripción                  |
| ------ | ----------------- | ---------------------------- |
| `GET`  | `/api/logs`       | Consultar logs (con filtros) |
| `GET`  | `/api/logs/stats` | Estadísticas agregadas       |

### Gestión de configuración

| Método  | Ruta                  | Descripción                   |
| ------- | --------------------- | ----------------------------- |
| `GET`   | `/api/settings`       | Obtener configuración         |
| `PATCH` | `/api/settings`       | Actualizar config             |
| `POST`  | `/api/settings/reset` | Restaurar valores por defecto |

### Otros

| Método | Ruta                   | Descripción                              |
| ------ | ---------------------- | ---------------------------------------- |
| `GET`  | `/api/health`          | Verificación de salud                    |
| `GET`  | `/api/runtime`         | Info de runtime (puerto, URL)            |
| `GET`  | `/api/events`          | Stream de eventos SSE en tiempo real     |
| `POST` | `/api/import/scan`     | Escanear configs locales de clientes     |
| `POST` | `/api/import/parse`    | Previsualizar importación de JSON pegado |
| `POST` | `/api/import/execute`  | Ejecutar importación                     |
| `GET`  | `/api/import/snippets` | Generar snippets de config de clientes   |
| `POST` | `/api/import/convert`  | Convertir configs entre clientes         |

## Stack tecnológico

| Capa          | Tecnología                                           |
| ------------- | ---------------------------------------------------- |
| Frontend      | React 19, vite-plus, TypeScript 5.7, Tailwind CSS v4 |
| UI Primitives | Radix UI                                             |
| UI Components | shadcn/ui (New York style)                           |
| Desktop       | Tauri 2 (Rust)                                       |
| Gateway       | Rust, Axum, Tokio, rusqlite (en proceso)             |
| Database      | SQLite (rusqlite)                                    |
| MCP Protocol  | Rust nativo (JSON-RPC sobre Streamable HTTP / stdio) |
| Icons         | Lucide React                                         |
| Tooling       | vite-plus (vp CLI), Oxlint, Oxfmt, Vitest            |

## Agradecimientos

Gracias a la comunidad [linuxdo](https://linux.do/) por las discusiones, compartir y retroalimentación.

## ❤️ Patrocinio

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/varandrew)

## 🌟 Historial de estrellas

[![Star History Chart](https://api.star-history.com/svg?repos=maqibg/moor&type=Date)](https://www.star-history.com/#maqibg/moor&Date)

## Licencia

[MIT](LICENSE)
