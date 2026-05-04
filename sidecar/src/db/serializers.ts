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

export function keysToCamelCase<T extends DbRow>(row: T): DbRow {
  const result: DbRow = {};
  for (const [key, value] of Object.entries(row)) {
    result[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return result;
}

export function serializeServer<T extends DbRow>(row: T): DbRow {
  return keysToCamelCase({
    ...row,
    args: parseJsonValue(row.args, []),
    env: parseJsonValue(row.env, {}),
    headers: parseJsonValue(row.headers, null),
    auto_start: Boolean(row.auto_start),
  });
}

export function serializeProfile<T extends DbRow>(row: T): DbRow {
  return keysToCamelCase({
    ...row,
    is_active: Boolean(row.is_active),
    server_count: Number(row.server_count ?? 0),
  });
}

export function serializeProfileServer<T extends DbRow>(row: T): DbRow {
  return keysToCamelCase({
    ...row,
    enabled: Boolean(row.enabled),
    disabled_tools: parseJsonValue(row.disabled_tools, []),
  });
}

export function serializeToolDiscovery<T extends DbRow>(row: T): DbRow {
  const inputSchema =
    "inputSchema" in row ? row.inputSchema : parseJsonValue(row.input_schema, undefined);
  return keysToCamelCase({
    ...row,
    input_schema: inputSchema,
  });
}

export function serializeAuditLog<T extends DbRow>(row: T): DbRow {
  return keysToCamelCase({
    ...row,
    arguments: parseJsonValue(row.arguments, null),
    result: parseJsonValue(row.result, null),
  });
}
