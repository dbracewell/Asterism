"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { LucideProvider } from "lucide-react";

// US-41.5: every icon shares one stroke weight; set it here, not per icon.
export const ICON_STROKE_WIDTH = 2;

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
      <LucideProvider strokeWidth={ICON_STROKE_WIDTH}>
        <TooltipProvider>{children}</TooltipProvider>
      </LucideProvider>
    </QueryClientProvider>
  );
}
