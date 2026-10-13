import type { Server } from "./server.js";
import type { ToolDetail } from "./tool.js";

export interface Profile {
  id: string;
  name: string;
  isActive: boolean;
  serverCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileServerState {
  enabled: boolean;
  disabledTools: string[];
}

export interface ProfileDetail extends Profile {
  servers: Array<Server & { profileServer: ProfileServerState }>;
}

/** 治理面板分组：某台服务器在该 profile 下的已发现工具与禁用态。 */
export interface ProfileToolGroup {
  serverId: string;
  serverName: string;
  serverEnabled: boolean;
  tools: ToolDetail[];
}

/** 批量治理写入项：enabled 与 disabledTools 是互相独立的可选补丁。 */
export interface ProfileServerUpsertInput {
  serverId: string;
  enabled?: boolean;
  disabledTools?: string[];
}
