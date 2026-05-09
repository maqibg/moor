import type { Database } from "./index.js";
import { getDatabase } from "./index.js";

export class SettingsRepository {
  constructor(private db: Database) {}

  get(key: string): string | null {
    const row = this.db.queryOne("SELECT value FROM settings WHERE key = ?", [key]);
    return (row?.value as string) ?? null;
  }

  set(key: string, value: string): void {
    const now = new Date().toISOString();
    this.db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)", [
      key,
      value,
      now,
    ]);
  }

  setMany(entries: Array<[string, string]>): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const [key, value] of entries) {
        this.db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)", [
          key,
          value,
          now,
        ]);
      }
    });
  }

  getAll(): Map<string, string> {
    const rows = this.db.queryAll("SELECT key, value FROM settings", []);
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.key as string, row.value as string);
    }
    return map;
  }
}

export function getSettingsRepository(): SettingsRepository {
  return new SettingsRepository(getDatabase());
}
