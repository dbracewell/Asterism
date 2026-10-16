import { useFileManager } from "@/components/file-manager/context";
import { client } from "@/lib/api";
import { fileUploadMutation } from "@/lib/client/@tanstack/react-query.gen";
import { isErrorDetail } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

export const useUploadFiles = () => {
  const { dispatch, setIsMutating, onUploaded, actions, isMutating } =
    useFileManager();
  const { mutate: addFiles } = useMutation({
    ...fileUploadMutation({ client }),
    onMutate: () => {
      setIsMutating(true);
    },
    onSettled: () => {
      setIsMutating(false);
    },
    onSuccess: async (data) => {
      await onUploaded?.(data.files);
      dispatch({ property: "page", value: 1 });
      dispatch({
        property: "uploadedFiles",
        value: data.files.map((f) => f.filename),
      });
    },
    onError: (error) => {
      if (isErrorDetail(error)) {
        toast.error(`Unable to upload files. ${error.detail}`);
      } else {
        toast.error("Unable to upload files");
      }
    },
  });

  const uploadFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !actions.upload || isMutating) return;
      addFiles({
        body: { files: Array.from(files) },
      });
    },
    [addFiles, actions.upload, isMutating],
  );
  return uploadFiles;
};
