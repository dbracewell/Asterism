import { Footer } from "@/components/file-manager/footer";
import { client } from "@/lib/api";
import { fileGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { UserFile } from "@/lib/client/types.gen";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  Dispatch,
  useCallback,
  useContext,
  useDeferredValue,
  useMemo,
  useState,
} from "react";

export type View = "list" | "grid";
export type Sort = "name" | "kind" | "date" | "size";
export type Mode = "normal" | "picker";
export const PAGE_SIZE = 50;

type ClickEvent = {
  property: string;
  value: string | null | string[] | number;
};

type QueryParameters = {
  sort: Sort;
  page: number;
  query: string | null;
};

type FileManagerContext = {
  lastClickEvent: ClickEvent | null;
  view: View;
  selectedFiles: string[];
  setSelectedFiles: Dispatch<React.SetStateAction<string[]>>;
  queryParameters: QueryParameters;
  isSearchVisible: boolean;
  totalFiles: number;
  files: UserFile[];
  isMutating: boolean;
  knowledgeBaseId?: string;
  mode: Mode;
  filesLoading: boolean;
  filesError: unknown;
  filesFetching: boolean;
  retryFiles: () => Promise<unknown>;
  isSelectable: (file: UserFile) => boolean;
  setIsMutating: Dispatch<React.SetStateAction<boolean>>;
  setIsSearchVisible: Dispatch<React.SetStateAction<boolean>>;
  dispatch: (event: ClickEvent) => void;
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
  knowledgeBaseId,
  checkKnowledgeBaseId,
  mode = "normal",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isSelectable = (_) => true,
}: {
  children: React.ReactNode;
  knowledgeBaseId?: string;
  checkKnowledgeBaseId?: string;
  mode?: Mode;
  isSelectable?: (file: UserFile) => boolean;
}) => {
  const [queryParameters, setQueryParameters] = useState<QueryParameters>({
    sort: "name",
    page: 1,
    query: null,
  });
  const [view, setView] = useState<View>("grid");
  const [lastClickEvent, setLastClickEvent] = useState<ClickEvent | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [lastFileClickedIndex, setLastFileClickedIndex] = useState(-1);
  const deferredQuery = useDeferredValue(queryParameters.query?.trim() ?? null);

  const dispatch = useCallback((event: ClickEvent) => {
    setLastClickEvent(event);
    switch (event.property.toLocaleLowerCase()) {
      case "view":
        setView(event.value as View);
        break;
      case "sort":
        setQueryParameters((prev) => ({
          ...prev,
          sort: event.value as Sort,
          page: 1,
        }));
        break;
      case "page":
        setQueryParameters((prev) => ({
          ...prev,
          page: event.value as number,
        }));
        break;
      case "query":
        setQueryParameters((prev) => ({
          ...prev,
          query: event.value as string | null,
          page: 1,
        }));
        break;
    }
  }, []);

  const { data, isPending, error, isFetching, refetch } = useQuery({
    ...fileGetManyOptions({
      client,
      query: {
        page: queryParameters.page,
        page_size: PAGE_SIZE,
        sort_by: queryParameters.sort,
        query: deferredQuery ?? undefined,
        knowledge_base_id: knowledgeBaseId,
        check_knowledge_base_id: checkKnowledgeBaseId,
      },
    }),
  });

  const files = useMemo(() => {
    return data?.files ?? [];
  }, [data?.files]);

  const totalFiles = data?.total ?? 0;

  const toggleSelect = useCallback(
    (
      filename: string,
      index: number,
      shiftPressed: boolean,
      ctrlPressed: boolean,
    ) => {
      if (!isSelectable(files[index])) return;
      if (shiftPressed) {
        const selection = files
          .slice(
            Math.min(Math.max(0, lastFileClickedIndex), index),
            Math.max(Math.max(0, lastFileClickedIndex), index) + 1,
          )
          .filter(isSelectable);

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
        setLastFileClickedIndex((prev) => (prev === -1 ? index : prev));
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
      setLastFileClickedIndex(index);
    },
    [setSelectedFiles, files, lastFileClickedIndex, isSelectable],
  );

  const ctx = useMemo(
    () => ({
      queryParameters,
      dispatch,
      view,
      lastClickEvent,
      selectedFiles,
      setSelectedFiles,
      isSearchVisible,
      setIsSearchVisible,
      files,
      isSelectable,
      isMutating,
      setIsMutating,
      toggleSelect,
      knowledgeBaseId,
      totalFiles,
      filesLoading: isPending,
      filesError: error,
      filesFetching: isFetching,
      retryFiles: refetch,
      mode,
    }),
    [
      queryParameters,
      dispatch,
      view,
      lastClickEvent,
      selectedFiles,
      isSearchVisible,
      files,
      isSelectable,
      isMutating,
      knowledgeBaseId,
      setIsMutating,
      toggleSelect,
      totalFiles,
      isPending,
      error,
      isFetching,
      refetch,
      mode,
    ],
  );

  return (
    <>
      <FileManagerContext.Provider value={{ ...ctx }}>
        <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
          {children}
          <Footer />
        </div>
      </FileManagerContext.Provider>
    </>
  );
};

export default FileManagerProvider;
