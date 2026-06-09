import { useAppContext } from "@/features/dashboard/components/app-provider";
import { api } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useDeleteFolder = () => {
  const { user } = useAppContext();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (folder_id: string) => {
      const { error } = await api.deleteFolder({ path: { folder_id } });
      if (error) {
        if (typeof error.detail === "string") {
          throw Error(error.detail);
        }
        throw Error("Validation Error");
      }
      return { data: "success" };
    },
    onSuccess: async () => {
      toast.success("Successfully deleted folder");
      await queryClient.invalidateQueries({
        queryKey: ["folder-list", user.id],
      });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  return mutation;
};
