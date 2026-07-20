import { client } from "@/lib/api";
import { ChatSessionModel } from "@/lib/client";
import {
  chatSessionCreateMutation,
  chatSessionDeleteMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export const useChatSession = ({
  onSuccess,
}: {
  onSuccess?: (session: ChatSessionModel) => void;
}) => {
  const createChatSession = useMutation({
    ...chatSessionCreateMutation({
      client: client,
    }),
    onSuccess: (data) => {
      onSuccess?.(data);
    },
    onError: () =>
      toast.error("Failed to create chat session. Please try again."),
  });
  const deleteChatSession = useMutation({
    ...chatSessionDeleteMutation({
      client: client,
    }),
    onSuccess: () => toast.success("Chat session deleted successfully."),
    onError: () =>
      toast.error("Failed to create chat session. Please try again."),
  });
  return {
    createChatSession,
    deleteChatSession,
  };
};
