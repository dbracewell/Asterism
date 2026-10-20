"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      handleMutationSuccess(queryClient, mutation);
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
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
