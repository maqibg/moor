import { describe, expect, it, vi } from "vite-plus/test";
import {
  createGracefulShutdown,
  parseParentPid,
  shouldExitForMissingParent,
  startParentWatchdog,
} from "./runtime-lifecycle.js";

describe("sidecar runtime lifecycle", () => {
  it("parses a valid parent pid and ignores invalid values", () => {
    expect(parseParentPid("12345")).toBe(12345);
    expect(parseParentPid("0")).toBeUndefined();
    expect(parseParentPid("-1")).toBeUndefined();
    expect(parseParentPid("abc")).toBeUndefined();
    expect(parseParentPid(undefined)).toBeUndefined();
  });

  it("keeps running while the recorded parent process is still alive", () => {
    expect(
      shouldExitForMissingParent({
        parentPid: 123,
        currentParentPid: 123,
        parentAlive: true,
      }),
    ).toBe(false);
  });

  it("detects an orphaned sidecar when the current parent pid changes", () => {
    expect(
      shouldExitForMissingParent({
        parentPid: 123,
        currentParentPid: 1,
        parentAlive: true,
      }),
    ).toBe(true);
  });

  it("runs the parent watchdog callback when the sidecar becomes orphaned", () => {
    const onParentGone = vi.fn();
    const intervalCallbacks: (() => void)[] = [];
    const clearIntervalFn = vi.fn();

    startParentWatchdog({
      parentPid: 123,
      getCurrentParentPid: () => 1,
      isProcessAlive: () => true,
      onParentGone,
      setIntervalFn: (callback) => {
        intervalCallbacks.push(callback);
        return "timer";
      },
      clearIntervalFn,
      intervalMs: 10,
    });

    intervalCallbacks[0]?.();
    intervalCallbacks[0]?.();

    expect(onParentGone).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledWith("timer");
  });

  it("does not start a watchdog without a parent pid", () => {
    const setIntervalFn = vi.fn();

    const stop = startParentWatchdog({
      parentPid: undefined,
      getCurrentParentPid: () => 1,
      isProcessAlive: () => false,
      onParentGone: vi.fn(),
      setIntervalFn,
      clearIntervalFn: vi.fn(),
      intervalMs: 10,
    });

    stop();
    expect(setIntervalFn).not.toHaveBeenCalled();
  });

  it("stops services, drains audit logs, closes the database, removes runtime files, and exits", async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
      runtimeFiles: ["/tmp/moor-port", "/tmp/moor-pid"],
      stopAll: async () => {
        calls.push("stopAll");
      },
      drainAudit: async () => {
        calls.push("drainAudit");
      },
      stopLogCleanupInterval: () => {
        calls.push("stopLogCleanupInterval");
      },
      closeDb: () => {
        calls.push("closeDb");
      },
      unlinkFile: (filePath) => {
        calls.push(`unlink:${filePath}`);
      },
      exit: (code) => {
        calls.push(`exit:${code}`);
      },
      log: () => undefined,
      warn: () => undefined,
    });

    await shutdown("PARENT_EXITED");
    await shutdown("SIGTERM");

    expect(calls).toEqual([
      "stopAll",
      "drainAudit",
      "stopLogCleanupInterval",
      "closeDb",
      "unlink:/tmp/moor-port",
      "unlink:/tmp/moor-pid",
      "exit:0",
    ]);
  });
});
