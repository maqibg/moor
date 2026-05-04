export type DbRow = Record<string, unknown>;

export function parseJsonValue(value: unknown, fallback: unknown = null): unknown {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function serializeServer<T extends DbRow>(row: T): T {
  return {
    ...row,
    args: parseJsonValue(row.args, []),
    env: parseJsonValue(row.env, {}),
    headers: parseJsonValue(row.headers, null),
    auto_start: Boolean(row.auto_start),
  };
}

export function serializeProfile<T extends DbRow>(row: T): T {
  return {
    ...row,
    is_active: Boolean(row.is_active),
    server_count: Number(row.server_count ?? 0),
  };
}

export function serializeProfileServer<T extends DbRow>(row: T): T {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    disabled_tools: parseJsonValue(row.disabled_tools, []),
  };
}

export function serializeToolDiscovery<T extends DbRow>(row: T): T {
  return {
    ...row,
    input_schema: parseJsonValue(row.input_schema, undefined),
  };
}

export function serializeAuditLog<T extends DbRow>(row: T): T {
  return {
    ...row,
    arguments: parseJsonValue(row.arguments, null),
    result: parseJsonValue(row.result, null),
  };
}
