export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCatalogEntry {
  serverId: string;
  serverName: string;
  toolName: string;
  exposedName: string;
  description?: string;
  inputSchema?: MCPTool["inputSchema"];
}
