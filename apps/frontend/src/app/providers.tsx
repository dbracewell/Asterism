"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import WorkerProvider from "@/features/sse/components/worker-provider";

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000,
    },
  },
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WorkerProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </WorkerProvider>
    </QueryClientProvider>
  );
}
