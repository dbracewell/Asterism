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
    mutationFn: async ({ folderId }: { folderId?: string }) => {
      const { data, error } = await api.newChatSession({
        body: { folder_id: folderId },
      });
      if (error || !data) {
        if (typeof error.detail === "string") {
          throw Error(error.detail);
        } else {
          throw Error("Bad Request");
        }
      }
      return { data };
    },
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["chat-session-list", user.id],
      });
      if (variables) {
        await queryClient.invalidateQueries({
          queryKey: ["folder-list", user.id],
        });
      }
      router.push(`/app/s/${data.data.id}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  return mutation;
};
