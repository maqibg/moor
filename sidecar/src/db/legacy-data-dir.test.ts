import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { migrateLegacyDataDir } from "./index.js";

let rootDir: string;
let dataDir: string;
let legacyDataDir: string;

function writeLegacyFile(name: string, content: string) {
  mkdirSync(legacyDataDir, { recursive: true });
  writeFileSync(path.join(legacyDataDir, name), content);
}

function readDataFile(name: string) {
  return readFileSync(path.join(dataDir, name), "utf8");
}

describe("legacy data directory migration", () => {
  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "moor-legacy-data-"));
    dataDir = path.join(rootDir, "new");
    legacyDataDir = path.join(rootDir, "legacy");
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("copies the legacy SQLite database files when the new database is absent", () => {
    writeFileSync(path.join(rootDir, "unrelated"), "ignore");
    writeFileSync(path.join(rootDir, "port"), "9223");
    mkdirSync(legacyDataDir, { recursive: true });
    writeFileSync(path.join(legacyDataDir, "port"), "9223");
    writeLegacyFile("moor.db", "legacy-db");
    writeLegacyFile("moor.db-wal", "legacy-wal");
    writeLegacyFile("moor.db-shm", "legacy-shm");

    migrateLegacyDataDir({ dataDir, legacyDataDir });

    expect(readDataFile("moor.db")).toBe("legacy-db");
    expect(readDataFile("moor.db-wal")).toBe("legacy-wal");
    expect(readDataFile("moor.db-shm")).toBe("legacy-shm");
    expect(existsSync(path.join(dataDir, "port"))).toBe(false);
  });

  it("does not overwrite a database that already exists in the new data directory", () => {
    writeLegacyFile("moor.db", "legacy-db");
    writeLegacyFile("moor.db-wal", "legacy-wal");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, "moor.db"), "new-db");

    migrateLegacyDataDir({ dataDir, legacyDataDir });

    expect(readDataFile("moor.db")).toBe("new-db");
    expect(existsSync(path.join(dataDir, "moor.db-wal"))).toBe(false);
  });

  it("skips migration when the legacy database does not exist", () => {
    mkdirSync(legacyDataDir, { recursive: true });
    writeFileSync(path.join(legacyDataDir, "moor.db-wal"), "orphan-wal");

    migrateLegacyDataDir({ dataDir, legacyDataDir });

    expect(existsSync(path.join(dataDir, "moor.db"))).toBe(false);
    expect(existsSync(path.join(dataDir, "moor.db-wal"))).toBe(false);
  });
});
