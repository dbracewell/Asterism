"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import {
  isServer,
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { LucideProvider } from "lucide-react";

// US-41.5: every icon shares one stroke weight; set it here, not per icon.
export const ICON_STROKE_WIDTH = 2;

export function makeQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
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
  return queryClient;
}

let browserQueryClient: QueryClient | undefined;

/**
 * One client per server render, so no request sees another's cached data
 * (US-117.2); one for the life of the page in the browser.
 */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <LucideProvider strokeWidth={ICON_STROKE_WIDTH}>
        <TooltipProvider>{children}</TooltipProvider>
      </LucideProvider>
    </QueryClientProvider>
  );
}
