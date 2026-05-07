import fs from "node:fs";

const DEFAULT_PARENT_WATCHDOG_INTERVAL_MS = 1_000;

type ShutdownStep = () => void | Promise<void>;

interface ParentStatus {
  parentPid?: number;
  currentParentPid: number;
  parentAlive: boolean;
}

interface WatchdogTimer {
  unref?: () => void;
}

interface ParentWatchdogOptions<TTimer> {
  parentPid?: number;
  intervalMs?: number;
  getCurrentParentPid?: () => number;
  isProcessAlive?: (pid: number) => boolean;
  onParentGone: () => void | Promise<void>;
  setIntervalFn?: (callback: () => void, intervalMs: number) => TTimer;
  clearIntervalFn?: (timer: TTimer) => void;
}

export interface GracefulShutdownOptions {
  runtimeFiles: string[];
  stopAll: ShutdownStep;
  drainAudit: ShutdownStep;
  stopLogCleanupInterval: ShutdownStep;
  closeDb: ShutdownStep;
  unlinkFile?: (filePath: string) => void;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export function parseParentPid(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

export function shouldExitForMissingParent(status: ParentStatus): boolean {
  if (!status.parentPid) return false;
  return status.currentParentPid !== status.parentPid || !status.parentAlive;
}

export function startParentWatchdog<TTimer = ReturnType<typeof setInterval>>(
  options: ParentWatchdogOptions<TTimer>,
): () => void {
  if (!options.parentPid) return () => undefined;

  const parentPid = options.parentPid;
  const getCurrentParentPid = options.getCurrentParentPid ?? (() => process.ppid);
  const isAlive = options.isProcessAlive ?? isProcessAlive;
  const setIntervalFn =
    options.setIntervalFn ??
    ((callback: () => void, intervalMs: number) => setInterval(callback, intervalMs) as TTimer);
  const clearIntervalFn =
    options.clearIntervalFn ??
    ((timer: TTimer) => clearInterval(timer as ReturnType<typeof setInterval>));
  const intervalMs = options.intervalMs ?? DEFAULT_PARENT_WATCHDOG_INTERVAL_MS;
  let stopped = false;

  const timer = setIntervalFn(() => {
    if (stopped) return;
    const parentAlive = isAlive(parentPid);
    if (
      shouldExitForMissingParent({
        parentPid,
        currentParentPid: getCurrentParentPid(),
        parentAlive,
      })
    ) {
      stop();
      void options.onParentGone();
    }
  }, intervalMs);

  (timer as WatchdogTimer).unref?.();

  function stop() {
    if (stopped) return;
    stopped = true;
    clearIntervalFn(timer);
  }

  return stop;
}

async function runShutdownStep(step: ShutdownStep, warn: (message: string) => void, label: string) {
  try {
    await step();
  } catch (err) {
    warn(`Failed during ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function createGracefulShutdown(options: GracefulShutdownOptions) {
  const unlinkFile = options.unlinkFile ?? fs.unlinkSync;
  const exit = options.exit ?? process.exit;
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;
  let shuttingDown = false;

  return async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log(`\nReceived ${signal}, shutting down gracefully...`);
    await runShutdownStep(options.stopAll, warn, "server shutdown");
    await runShutdownStep(options.drainAudit, warn, "audit drain");
    await runShutdownStep(options.stopLogCleanupInterval, warn, "settings cleanup stop");
    await runShutdownStep(options.closeDb, warn, "database close");

    for (const runtimeFile of options.runtimeFiles) {
      try {
        unlinkFile(runtimeFile);
      } catch {
        warn(`Runtime file already removed: ${runtimeFile}`);
      }
    }

    exit(0);
  };
}
