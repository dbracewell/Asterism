import { useFileManager } from "@/components/file-manager/context";
import { client } from "@/lib/api";
import { fileUploadMutation } from "@/lib/client/@tanstack/react-query.gen";
import { isErrorDetail } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

export const useUploadFiles = () => {
  const { dispatch, setIsMutating } = useFileManager();
  const { mutate: addFiles } = useMutation({
    ...fileUploadMutation({ client }),
    onMutate: () => {
      setIsMutating(true);
    },
    onSettled: () => {
      setIsMutating(false);
    },
    onSuccess: (data) => {
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
      if (!files) return;
      addFiles({
        body: { files: Array.from(files) },
      });
    },
    [addFiles],
  );
  return uploadFiles;
};
