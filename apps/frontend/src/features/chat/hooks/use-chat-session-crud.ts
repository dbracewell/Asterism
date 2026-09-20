import { client } from "@/lib/api";
import {
  chatSessionCreateMutation,
  chatSessionDeleteMutation,
  chatSessionGetManyQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";

export const useChatSessionCrud = () => {
  const router = useRouter();
  const pathName = usePathname();
  const queryClient = useQueryClient();

  const createChatSession = useMutation({
    ...chatSessionCreateMutation({
      client: client,
    }),
    onSuccess: (data) => {
      router.push(`/c/${data.info.id}`);
    },
    onError: () =>
      toast.error("Failed to create chat session. Please try again."),
  });

  const deleteChatSession = useMutation({
    ...chatSessionDeleteMutation({
      client: client,
    }),
    onMutate: (variables) => {
      if (pathName.endsWith(`/c/${variables.path.chat_id}`)) {
        router.push("/");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: chatSessionGetManyQueryKey() });
    },
    onError: () => toast.error("Failed to delete chat session. Please try again."),
  });

  return useMemo(
    () => ({
      createChatSession: createChatSession.mutate,
      deleteChatSession: deleteChatSession.mutate,
      isCreating: createChatSession.isPending,
      isDeleting: deleteChatSession.isPending,
    }),
    [
      createChatSession.mutate,
      deleteChatSession.mutate,
      createChatSession.isPending,
      deleteChatSession.isPending,
    ],
  );
};
