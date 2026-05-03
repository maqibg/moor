function resolveHeaderValue(value: string): string | null {
  let missingEnv = false;
  const resolved = value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const envValue = process.env[name];
    if (envValue == null) {
      missingEnv = true;
      return "";
    }
    return envValue;
  });
  return missingEnv ? null : resolved;
}

export function resolveHttpHeaders(
  headers: Record<string, string> | null,
): HeadersInit | undefined {
  if (!headers) return undefined;
  const resolved = Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [key, resolveHeaderValue(value)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] != null),
  );
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}
