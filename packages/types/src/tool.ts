export interface ToolDetail {
  toolName: string;
  exposedName: string;
  description: string | null;
  inputSchema: unknown;
  disabled: boolean;
}
