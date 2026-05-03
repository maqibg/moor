import type { ScannedServer } from "./import-parser.js";
import { ALL_CLIENTS, resolveConfigPaths } from "./clients.js";
import { FORMATTERS } from "./formatters.js";

interface ClientSnippet {
  client: string;
  description: string;
  snippet: string;
  cliCommand: string;
}

export function generateSnippets(mcpUrl: string): ClientSnippet[] {
  const moorServer: ScannedServer = {
    name: "moor",
    connectionType: "http",
    url: mcpUrl,
    source: "moor",
  };

  return ALL_CLIENTS.map((client) => {
    const formatter = FORMATTERS[client.id];
    const result = formatter([moorServer], client);
    return {
      client: client.name,
      description: client.description,
      snippet: result.content,
      cliCommand: `# Edit ${resolveConfigPaths(client)[0]} and add the ${client.topLevelKey}.moor entry above.`,
    };
  });
}
