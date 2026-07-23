export interface SidecarInfo {
  port: number;
  baseUrl: string;
  apiToken: string;
  portFallbackFrom: number | null;
}
