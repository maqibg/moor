import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ScannedServer {
  name: string;
  connectionType: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  source: string;
}

export function scanClaudeCodeConfig(): ScannedServer[] {
  const configPath = path.join(os.homedir(), ".claude", "settings.json");
  if (!fs.existsSync(configPath)) return [];

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);
    const servers: ScannedServer[] = [];

    const mcpServers = config.mcpServers || {};
    for (const [name, serverConfig] of Object.entries(mcpServers) as Array<
      [string, Record<string, unknown>]
    >) {
      if (serverConfig.command) {
        servers.push({
          name,
          connectionType: "stdio",
          command: serverConfig.command as string,
          args: serverConfig.args as string[] | undefined,
          env: serverConfig.env as Record<string, string> | undefined,
          source: "claude-code",
        });
      } else if (serverConfig.url) {
        servers.push({
          name,
          connectionType: "http",
          url: serverConfig.url as string,
          source: "claude-code",
        });
      }
    }

    return servers;
  } catch {
    return [];
  }
}

export function scanCursorConfig(): ScannedServer[] {
  const candidates = [
    path.join(os.homedir(), ".cursor", "mcp.json"),
    path.join(process.cwd(), ".cursor", "mcp.json"),
  ];

  for (const configPath of candidates) {
    if (!fs.existsSync(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      const servers: ScannedServer[] = [];

      const mcpServers = config.mcpServers || {};
      for (const [name, serverConfig] of Object.entries(mcpServers) as Array<
        [string, Record<string, unknown>]
      >) {
        if (serverConfig.command) {
          servers.push({
            name,
            connectionType: "stdio",
            command: serverConfig.command as string,
            args: serverConfig.args as string[] | undefined,
            env: serverConfig.env as Record<string, string> | undefined,
            source: "cursor",
          });
        } else if (serverConfig.url) {
          servers.push({
            name,
            connectionType: "http",
            url: serverConfig.url as string,
            source: "cursor",
          });
        }
      }

      return servers;
    } catch {
      continue;
    }
  }

  return [];
}

export function scanAllConfigs(): ScannedServer[] {
  return [...scanClaudeCodeConfig(), ...scanCursorConfig()];
}
