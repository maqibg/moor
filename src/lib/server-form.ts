export type KeyValueEntries = Array<[string, string]>;

function entriesToRecord(entries: KeyValueEntries): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of entries) {
    const trimmedKey = key.trim();
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

function argsToArray(args: string): string[] {
  return args
    .split("\n")
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
