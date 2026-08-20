export interface ClientSnippet {
  clientId: string;
  client: string;
  description: string;
  snippet: string;
  cliCommand: string;
}

export interface ConvertResult {
  content: string;
  warnings: string[];
  targetPath: string;
  targetClient: string;
}
