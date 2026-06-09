import { useAppContext } from "@/features/dashboard/components/app-provider";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export const useChatSessionList = () => {
  const { user } = useAppContext();
  const { data, error, isLoading } = useQuery({
    queryKey: ["chat-session-list", user.id],
    queryFn: async () => {
      const { data, error } = await api.listChatSessions();
      if (error || !data) {
        throw Error(error.detail);
      }
      return { sessions: data };
    },
  });
  return {
    sessionList: data?.sessions,
    errorLoadingSessionList: error,
    isSessionListLoading: isLoading,
  };
};
