export type KeyValueEntries = Array<[string, string]>;

function entriesToRecord(
  entries: KeyValueEntries,
  normalizeKey: (key: string) => string = (key) => key.trim(),
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of entries) {
    const trimmedKey = normalizeKey(key);
    if (trimmedKey) {
      record[trimmedKey] = value;
    }
  }
  return record;
}

export function entriesToRecordOrUndefined(
  entries: KeyValueEntries,
): Record<string, string> | undefined {
  const record = entriesToRecord(entries);
  return Object.keys(record).length > 0 ? record : undefined;
}

export function entriesToRecordOrNull(entries: KeyValueEntries): Record<string, string> | null {
  const record = entriesToRecord(entries);
  return Object.keys(record).length > 0 ? record : null;
}

export function headerEntriesToRecordOrUndefined(
  entries: KeyValueEntries,
): Record<string, string> | undefined {
  const record = entriesToRecord(entries, (key) => key.trim().toLowerCase());
  return Object.keys(record).length > 0 ? record : undefined;
}

export function headerEntriesToRecordOrNull(
  entries: KeyValueEntries,
): Record<string, string> | null {
  const record = entriesToRecord(entries, (key) => key.trim().toLowerCase());
  return Object.keys(record).length > 0 ? record : null;
}

function argsToArray(args: string): string[] {
  return args
    .split(/\r?\n/)
    .map((arg) => arg.trim())
    .filter(Boolean);
}

export function argsToArrayOrUndefined(args: string): string[] | undefined {
  const parsed = argsToArray(args);
  return parsed.length > 0 ? parsed : undefined;
}

export function argsToArrayOrNull(args: string): string[] | null {
  const parsed = argsToArray(args);
  return parsed.length > 0 ? parsed : null;
}

export function findDuplicateKeys(entries: KeyValueEntries): Set<number> {
  const firstByKey = new Map<string, number>();
  const duplicateIndexes = new Set<number>();

  entries.forEach(([key], index) => {
    const trimmedKey = key.trim();
    if (!trimmedKey) return;

    const firstIndex = firstByKey.get(trimmedKey);
    if (firstIndex === undefined) {
      firstByKey.set(trimmedKey, index);
      return;
    }

    duplicateIndexes.add(firstIndex);
    duplicateIndexes.add(index);
  });

  return duplicateIndexes;
}

export function findDuplicateHeaderKeys(entries: KeyValueEntries): Set<number> {
  const firstByKey = new Map<string, number>();
  const duplicateIndexes = new Set<number>();

  entries.forEach(([key], index) => {
    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey) return;

    const firstIndex = firstByKey.get(normalizedKey);
    if (firstIndex === undefined) {
      firstByKey.set(normalizedKey, index);
      return;
    }

    duplicateIndexes.add(firstIndex);
    duplicateIndexes.add(index);
  });

  return duplicateIndexes;
}
