import { describe, expect, it } from "vite-plus/test";
import { createMutationLock } from "./useLockedMutation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createMutationLock", () => {
  it("ignores a second run while one is in flight", async () => {
    const lock = createMutationLock();
    const gate = deferred<number>();
    let calls = 0;

    const first = lock.run(async () => {
      calls += 1;
      return gate.promise;
    });
    const second = lock.run(async () => {
      calls += 1;
      return 99;
    });

    expect(lock.inFlight).toBe(true);
    gate.resolve(7);
    expect(await first).toBe(7);
    expect(await second).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("releases the lock after success so later runs proceed", async () => {
    const lock = createMutationLock();
    await lock.run(async () => 1);
    expect(lock.inFlight).toBe(false);
    expect(await lock.run(async () => 2)).toBe(2);
  });

  it("releases the lock after failure and propagates the error", async () => {
    const lock = createMutationLock();
    await expect(lock.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(lock.inFlight).toBe(false);
    expect(await lock.run(async () => "recovered")).toBe("recovered");
  });
});
