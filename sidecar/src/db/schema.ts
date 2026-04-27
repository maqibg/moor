import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  connectionType: text("connection_type", { enum: ["stdio", "http"] }).notNull(),
  command: text("command"),
  args: text("args", { mode: "json" }).$type<string[]>(),
  url: text("url"),
  env: text("env", { mode: "json" }).$type<Record<string, string>>(),
  workingDir: text("working_dir"),
  status: text("status", { enum: ["stopped", "starting", "running", "error"] }).notNull().default("stopped"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const profileServers = sqliteTable("profile_servers", {
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  serverId: text("server_id").notNull().references(() => mcpServers.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  disabledTools: text("disabled_tools", { mode: "json" }).$type<string[]>().notNull().default([]),
});

export const toolDiscoveries = sqliteTable("tool_discoveries", {
  serverId: text("server_id").notNull().references(() => mcpServers.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  description: text("description"),
  inputSchema: text("input_schema", { mode: "json" }),
  discoveredAt: text("discovered_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  timestamp: text("timestamp").notNull().$defaultFn(() => new Date().toISOString()),
  profileId: text("profile_id").references(() => profiles.id),
  serverId: text("server_id").references(() => mcpServers.id),
  toolName: text("tool_name").notNull(),
  arguments: text("arguments", { mode: "json" }),
  result: text("result", { mode: "json" }),
  error: text("error"),
  durationMs: integer("duration_ms"),
  agentInfo: text("agent_info"),
});
