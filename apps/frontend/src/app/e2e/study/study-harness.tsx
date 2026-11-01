"use client";
import UserProvider from "@/features/auth/components/user-context";
import type { User } from "@/features/auth/types";
import { CardDraftReview } from "@/features/study/components/card-draft-review";
import { ReviewSession } from "@/features/study/components/review-session";
import { StudyDeckPage } from "@/features/study/components/study-deck-page";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";
import { handleMutationSuccess } from "@/lib/mutation-cache";

export const STUDY_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const STUDY_DECK_ID = "22222222-2222-4222-8222-222222222222";
const TEST_USER: User = {
  id: "test",
  name: "Study tester",
  email: "study@example.test",
  role: "user",
  timezone: "UTC",
  settings: {
    main_agent: {
      id: "main",
      name: "Main",
      description: "",
      system_prompt: "",
      tools: [],
    },
    show_thinking: true,
  },
};

function createTestCache() {
  const cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        handleMutationSuccess(cache, mutation);
      },
    }),
    defaultOptions: { queries: { retry: false } },
  });
  return cache;
}

export function StudyHarness({ view }: { view: string }) {
  const [cache] = useState(createTestCache);
  return (
    <QueryClientProvider client={cache}>
      <UserProvider user={TEST_USER}>
        {view === "review" ? (
          <ReviewSession projectId={STUDY_PROJECT_ID} deckId={STUDY_DECK_ID} />
        ) : view === "drafts" ? (
          <CardDraftReview
            projectId={STUDY_PROJECT_ID}
            deckId={STUDY_DECK_ID}
          />
        ) : (
          <StudyDeckPage projectId={STUDY_PROJECT_ID} deckId={STUDY_DECK_ID} />
        )}
      </UserProvider>
    </QueryClientProvider>
  );
}
