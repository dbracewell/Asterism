import { client } from "@/lib/api";
import {
  chatSessionCreateMutation,
  chatSessionDeleteMutation,
  chatSessionGetManyQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";

export const useChatSessionCrud = () => {
  const router = useRouter();
  const pathName = usePathname();

  const createChatSession = useMutation({
    ...chatSessionCreateMutation({
      client: client,
    }),
    meta: {
      invalidates: [chatSessionGetManyQueryKey()],
    },
    onSuccess: (data) => {
      // The sidebar query is already mounted when a new chat is created.
      // Refresh it before navigating so the subsequent title-update event has
      // a cache entry to update rather than being discarded.
      router.push(`/c/${data.info.id}`);
    },
    onError: () =>
      toast.error("Failed to create chat session. Please try again."),
  });

  const deleteChatSession = useMutation({
    ...chatSessionDeleteMutation({
      client: client,
    }),
    meta: {
      invalidates: [chatSessionGetManyQueryKey()],
    },
    onMutate: (variables) => {
      if (pathName.endsWith(`/c/${variables.path.chat_id}`)) {
        router.push("/");
      }
    },
    onError: () =>
      toast.error("Failed to delete chat session. Please try again."),
  });

  return useMemo(
    () => ({
      createChatSession: createChatSession.mutateAsync,
      deleteChatSession: deleteChatSession.mutate,
      isCreating: createChatSession.isPending,
      isDeleting: deleteChatSession.isPending,
    }),
    [
      createChatSession.mutateAsync,
      deleteChatSession.mutate,
      createChatSession.isPending,
      deleteChatSession.isPending,
    ],
  );
};
