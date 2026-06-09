import { useAppContext } from "@/features/dashboard/components/app-provider";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export const useFolderList = () => {
  const { user } = useAppContext();
  const { data, error, isLoading } = useQuery({
    queryKey: ["folder-list", user.id],
    queryFn: async () => {
      const { data, error } = await api.listFolders();
      if (error || !data) {
        throw Error(error.detail);
      }
      return { folders: data };
    },
  });
  return {
    folderList: data?.folders,
    errorLoadingFolderList: error,
    isFolderListLoading: isLoading,
  };
};
