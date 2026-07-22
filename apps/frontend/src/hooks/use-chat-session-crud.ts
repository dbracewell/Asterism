import { client } from "@/lib/api";
import {
  chatSessionCreateMutation,
  chatSessionDeleteMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";

export const useChatSessionCrud = () => {
  const router = useRouter();
  const pathName = usePathname();

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
      if (pathName.endsWith(`/c/${variables.path.session_id}`)) {
        router.push("/");
      }
    },
    onSuccess: () => {
      toast.success("Chat session deleted successfully.");
    },
    onError: () =>
      toast.error("Failed to create chat session. Please try again."),
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
