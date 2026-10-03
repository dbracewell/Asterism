import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { client } from "@/lib/api";
import { ErrorDetail, UserFile } from "@/lib/client";
import {
  fileDeleteManyMutation,
  fileGetManyOptions,
  fileUploadMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { isErrorDetail } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createContext,
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useDeferredValue,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

export type View = "list" | "grid";
export type Sort = "name" | "kind" | "date" | "size";
export const PAGE_SIZE = 50;

type FileManagerContext = {
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  sort: Sort;
  setSort: Dispatch<SetStateAction<Sort>>;
  query: string | null;
  setQuery: (query: string | null) => void;
  selectedFiles: string[];
  setSelectedFiles: Dispatch<SetStateAction<string[]>>;
  uploadFiles: (files: FileList | null) => void;
  isUploading: boolean;
  deleteSelectedFiles: () => void;
  isDeleting: boolean;
  lastClicked: number;
  setLastClicked: Dispatch<SetStateAction<number>>;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  files: UserFile[];
  total: number;
  loadError: ErrorDetail | null;
  toggleSelect: (
    filename: string,
    index: number,
    shiftPressed: boolean,
    ctrlPressed: boolean,
  ) => void;
};

export const FileManagerContext = createContext<FileManagerContext | null>(
  null,
);

export const useFileManager = (): FileManagerContext => {
  const ctx = useContext(FileManagerContext);
  if (ctx == null) {
    throw new Error("useFileManager must be used within a FileManagerProvider");
  }
  return ctx;
};

export const FileManagerProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { confirm: confirmDelete, Dialog: DeleteConfirmation } =
    useConfirmationDialog({
      title: "Delete selected files?",
      description:
        "This permanently removes the selected files, every knowledge-base membership, and all derived extractions, captions, and vectors.",
      confirmVariant: "destructive",
    });
  const [view, setView] = useState<View>("list");
  const [lastClicked, setLastClicked] = useState(-1);
  const [sort, setSort] = useState<Sort>("name");
  const [page, setPage] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query?.trim() ?? null);

  const { mutate: addFiles, isPending: isUploading } = useMutation({
    ...fileUploadMutation({ client }),
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

  const { mutate: deleteFileMutation, isPending: isDeleting } = useMutation({
    ...fileDeleteManyMutation({ client }),
    onError: (error) => {
      if (isErrorDetail(error)) {
        toast.error(`Unable to delete files. ${error.detail}`);
      } else {
        toast.error("Unable to delete files");
      }
    },
    onSuccess: () => {
      setSelectedFiles([]);
      setLastClicked(-1);
      setPage(1);
    },
  });

  const deleteSelectedFiles = useCallback(async () => {
    if (selectedFiles.length === 0 || !(await confirmDelete())) return;
    deleteFileMutation({
      body: selectedFiles,
    });
  }, [confirmDelete, deleteFileMutation, selectedFiles]);

  const { data, error } = useQuery({
    ...fileGetManyOptions({
      client,
      query: {
        page,
        page_size: PAGE_SIZE,
        sort_by: sort,
        query: deferredQuery ?? undefined,
      },
    }),
  });

  const files = useMemo(() => {
    return data?.files ?? [];
  }, [data?.files]);

  const toggleSelect = useCallback(
    (
      filename: string,
      index: number,
      shiftPressed: boolean,
      ctrlPressed: boolean,
    ) => {
      if (shiftPressed) {
        const selection = files.slice(
          Math.min(Math.max(0, lastClicked), index),
          Math.max(Math.max(0, lastClicked), index) + 1,
        );
        const selectionFilenames = selection.map((file) => file.filename);
        setSelectedFiles((current) => {
          const newSelection = current.filter(
            (f) => !selectionFilenames.includes(f),
          );
          if (selection.every((file) => current.includes(file.filename))) {
            return newSelection;
          } else {
            return [...newSelection, ...selectionFilenames];
          }
        });
        setLastClicked((prev) => (prev === -1 ? index : prev));
        return;
      }

      if (ctrlPressed) {
        setSelectedFiles((current) =>
          current.includes(filename)
            ? current.filter((f) => f !== filename)
            : [...current, filename],
        );
      } else {
        setSelectedFiles((current) =>
          current.includes(filename) ? [] : [filename],
        );
      }
      setLastClicked(index);
    },
    [setSelectedFiles, files, lastClicked],
  );

  const ctx = useMemo(
    () => ({
      view,
      setView,
      lastClicked,
      setLastClicked,
      sort,
      setSort,
      page,
      setPage,
      selectedFiles,
      setSelectedFiles,
      query,
      setQuery,
      uploadFiles,
      isUploading,
      deleteSelectedFiles,
      isDeleting,
      files,
      loadError: error,
      total: data?.total ?? 0,
      toggleSelect,
    }),
    [
      view,
      lastClicked,
      sort,
      page,
      selectedFiles,
      query,
      uploadFiles,
      isUploading,
      deleteSelectedFiles,
      isDeleting,
      files,
      data?.total,
      error,
      toggleSelect,
    ],
  );

  return (
    <>
      <FileManagerContext.Provider value={{ ...ctx }}>
        {children}
      </FileManagerContext.Provider>
      <DeleteConfirmation />
    </>
  );
};

export default FileManagerProvider;
