import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

// macOS GUI apps do not inherit interactive shell PATH values, so Moor appends common
// local CLI install locations before spawning stdio MCP servers.
const STDIO_PATH_CANDIDATES = [
  "~/.local/share/mise/shims",
  "~/.local/bin",
  "~/Library/pnpm",
  "~/.cargo/bin",
  "~/.asdf/shims",
  "~/.volta/bin",
  "~/.bun/bin",
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/opt/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

function cleanEnv(env?: Record<string, unknown> | null): Record<string, string> {
  if (!env) return {};
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function splitPathList(value: string | undefined): string[] {
  return value
    ? value
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function uniquePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });
}

function expandHomePath(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  return value;
}

function getDefaultStdioPathEntries(home: string): string[] {
  return STDIO_PATH_CANDIDATES.map((entry) => expandHomePath(entry, home));
}

export function buildStdioEnvironment(
  parentEnv: Record<string, unknown> = process.env,
  serverEnv?: Record<string, unknown> | null,
): Record<string, string> {
  const parent = cleanEnv(parentEnv);
  const server = cleanEnv(serverEnv);
  const env = { ...parent, ...server };
  const home = server.HOME ?? parent.HOME ?? os.homedir();
  env.PATH = uniquePathEntries([
    ...splitPathList(server.PATH),
    ...splitPathList(parent.PATH),
    ...getDefaultStdioPathEntries(home),
  ]).join(path.delimiter);
  return env;
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function executableNames(command: string, env: Record<string, string>): string[] {
  if (process.platform !== "win32" || path.extname(command)) return [command];
  const extensions = splitPathList(
    env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM".replaceAll(";", path.delimiter),
  );
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
}

function canExecute(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findExecutableOnPath(command: string, env: Record<string, string>): string | null {
  if (path.isAbsolute(command)) return canExecute(command) ? command : null;
  if (hasPathSeparator(command)) return null;
  for (const dir of splitPathList(env.PATH)) {
    for (const name of executableNames(command, env)) {
      const candidate = path.join(dir, name);
      if (canExecute(candidate)) return candidate;
    }
  }
  return null;
}

export function assertStdioCommandAvailable(command: string, env: Record<string, string>): void {
  if (path.isAbsolute(command)) {
    if (findExecutableOnPath(command, env)) return;
    throw new Error(
      `Command "${command}" is not executable while starting this stdio server. ` +
        `Check that the absolute path exists and has execute permission.`,
    );
  }
  if (hasPathSeparator(command) || findExecutableOnPath(command, env)) return;
  const searchedPath = env.PATH || "(empty)";
  throw new Error(
    `Command "${command}" was not found on PATH while starting this stdio server. ` +
      `Moor searched PATH: ${searchedPath}. ` +
      `If Moor was launched from Finder or Dock, shell startup files may not be loaded. ` +
      `Install "${command}" into one of these directories, use an absolute command path, ` +
      `or set PATH in this server environment.`,
  );
}
