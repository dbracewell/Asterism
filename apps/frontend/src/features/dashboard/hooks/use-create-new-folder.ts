import { useAppContext } from "@/features/dashboard/components/app-provider";
import { api } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useCreateNewFolder = () => {
  const { user } = useAppContext();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      title,
      parent_folder_id,
    }: {
      title: string;
      parent_folder_id?: string;
    }) => {
      const { data, error } = await api.createFolder({
        body: { title, parent_folder_id },
      });
      if (error || !data) {
        if (typeof error.detail === "string") {
          throw Error(error.detail);
        }
        throw Error("Validation Error");
      }
      return { data };
    },
    onSuccess: async () => {
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
