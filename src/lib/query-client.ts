import { MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// 全局兜底：mutation 失败统一可见反馈，页面层无需逐个补 toast
const mutationCache = new MutationCache({
  onError: (error) => {
    toast.error("Request failed", {
      description: error instanceof Error ? error.message : String(error),
    });
  },
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
