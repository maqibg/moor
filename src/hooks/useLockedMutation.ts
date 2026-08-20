import { useCallback, useRef } from "react";
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";

export interface MutationLock {
  readonly inFlight: boolean;
  run<T>(fn: () => Promise<T>): Promise<T | undefined>;
}

// 互斥单飞锁：执行中再次调用被忽略，而不是重复提交请求。
export function createMutationLock(): MutationLock {
  let inFlight = false;
  return {
    get inFlight() {
      return inFlight;
    },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (inFlight) return undefined;
      inFlight = true;
      try {
        return await fn();
      } finally {
        inFlight = false;
      }
    },
  };
}

export interface LockedMutation<TData, TVars> {
  mutate: (variables: TVars) => Promise<TData | undefined>;
  pending: boolean;
}

// 每 hook 实例一把单飞锁包住 useMutation。错误经 TanStack 的 `onError`
// 选项路由；`mutate` 本身不会 reject，调用点的 `void mutate(...)` 因此无未处理拒绝。
export function useLockedMutation<TData = unknown, TError = Error, TVars = void>(
  mutationFn: (variables: TVars) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, TError, TVars>, "mutationFn">,
): LockedMutation<TData, TVars> {
  const lockRef = useRef<MutationLock | null>(null);
  if (lockRef.current === null) lockRef.current = createMutationLock();
  const mutation = useMutation<TData, TError, TVars>({ ...options, mutationFn });
  const mutateAsyncRef = useRef(mutation.mutateAsync);
  mutateAsyncRef.current = mutation.mutateAsync;

  const mutate = useCallback((variables: TVars) => {
    const lock = lockRef.current;
    if (lock === null) return Promise.resolve(undefined);
    return lock.run(() => mutateAsyncRef.current(variables).catch(() => undefined));
  }, []);

  return { mutate, pending: (lockRef.current?.inFlight ?? false) || mutation.isPending };
}
