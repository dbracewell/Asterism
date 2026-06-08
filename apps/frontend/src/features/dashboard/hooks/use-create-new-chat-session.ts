import { useAppContext } from "@/features/dashboard/components/app-provider";
import { api } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export const useCreateNewChatSession = () => {
  const { user } = useAppContext();
  const queryClient = useQueryClient();
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.newChatSession();
      if (error || !data) {
        throw Error(error.detail);
      }
      return { data };
    },
    onSuccess: async ({ data }) => {
      await queryClient.invalidateQueries({
        queryKey: ["chat-session-list", user.id],
      });
      router.push(`/app/s/${data.id}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  return mutation;
};
