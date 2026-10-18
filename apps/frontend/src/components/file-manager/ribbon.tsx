import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { useFileManager } from "@/components/file-manager/context";
import { useUploadFiles } from "@/components/file-manager/hooks";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { client } from "@/lib/api";
import { fileDeleteManyMutation } from "@/lib/client/@tanstack/react-query.gen";
import { isErrorDetail } from "@/lib/utils";
import {
  IconFileUpload,
  IconSelectAll,
  IconSquareOff,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import {
  Grid2X2Icon,
  ListIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { ReactNode, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";

export const Ribbon = ({ children }: { children?: ReactNode }) => {
  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-2">
      <div className="divide-border flex flex-wrap items-center divide-x border-b py-2 pr-0.5">
        <ViewSection />
        <SortSection />
        <SearchSection />
        <SelectionSection />
        {children}
      </div>
      <SearchBar />
    </div>
  );
};

type RibbonSectionProps = {
  children: ReactNode;
  title: string;
};

export const RibbonSection = ({ title, children }: RibbonSectionProps) => {
  return (
    <div className="flex max-w-full min-w-0 flex-col items-center gap-0.5 border-l px-2">
      <div className="text-muted-foreground text-center text-xs">{title}</div>
      <div className="flex max-w-full flex-wrap items-center justify-center gap-1">
        {children}
      </div>
    </div>
  );
};

const SearchBar = () => {
  const { dispatch, isSearchVisible, queryParameters } = useFileManager();
  if (!isSearchVisible) return null;

  return (
    <div className="flex flex-1 items-center gap-1 border-b px-4 pb-2">
      <InputGroup>
        <InputGroupInput
          value={queryParameters.query ?? ""}
          aria-label="Search files"
          onChange={(e) =>
            dispatch({ property: "query", value: e.target.value })
          }
          placeholder="Search files..."
        />
        <InputGroupAddon align="inline-start">
          <SearchIcon className="text-muted-foreground" />
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          <Button
            aria-label="Clear search"
            variant="ghost"
            size="icon"
            onClick={() => dispatch({ property: "query", value: null })}
          >
            <XIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
};

const ViewSection = () => {
  const { dispatch, view } = useFileManager();
  return (
    <RibbonSection title="View">
      <Button
        aria-label="List view"
        onClick={() => dispatch({ property: "view", value: "list" })}
        size="icon"
        variant={view === "list" ? "link" : "ghost"}
      >
        <ListIcon size={16} />
      </Button>
      <Button
        aria-label="Icon view"
        onClick={() => dispatch({ property: "view", value: "grid" })}
        size="icon"
        variant={view === "grid" ? "link" : "ghost"}
      >
        <Grid2X2Icon size={16} />
      </Button>
    </RibbonSection>
  );
};

const SortSection = () => {
  const { dispatch, queryParameters } = useFileManager();
  return (
    <RibbonSection title="Sort">
      <Button
        aria-label="Sort by name"
        onClick={() => dispatch({ property: "sort", value: "name" })}
        size="sm"
        className="h-7!"
        variant={queryParameters.sort === "name" ? "link" : "ghost"}
      >
        Name
      </Button>
      <Button
        aria-label="Sort by kind"
        onClick={() => dispatch({ property: "sort", value: "kind" })}
        size="sm"
        className="h-7!"
        variant={queryParameters.sort === "kind" ? "link" : "ghost"}
      >
        Kind
      </Button>
      <Button
        aria-label="Sort by date"
        onClick={() => dispatch({ property: "sort", value: "date" })}
        size="sm"
        className="h-7!"
        variant={queryParameters.sort === "date" ? "link" : "ghost"}
      >
        Date
      </Button>
      <Button
        aria-label="Sort by size"
        onClick={() => dispatch({ property: "sort", value: "size" })}
        size="sm"
        className="h-7!"
        variant={queryParameters.sort === "size" ? "link" : "ghost"}
      >
        Size
      </Button>
    </RibbonSection>
  );
};

const SearchSection = () => {
  const { isSearchVisible, setIsSearchVisible, queryParameters } =
    useFileManager();
  return (
    <RibbonSection title="Search">
      <Button
        aria-label="Toggle Search"
        onClick={() => setIsSearchVisible((prev) => !prev)}
        size="icon-lg"
        variant={
          isSearchVisible || !!queryParameters.query?.trim() ? "link" : "ghost"
        }
      >
        <SearchIcon />
      </Button>
    </RibbonSection>
  );
};

const SelectionSection = () => {
  const { selectedFiles, setSelectedFiles, isSelectable, files } =
    useFileManager();
  const selectableFiles = useMemo(
    () => files.filter(isSelectable),
    [files, isSelectable],
  );
  return (
    <RibbonSection title="Selection">
      <Hint hint="Select all files" side="top" asChild>
        <Button
          aria-label="Select all files"
          variant="ghost"
          disabled={
            selectableFiles.length === 0 ||
            selectedFiles.length === selectableFiles.length
          }
          size="icon-lg"
          onClick={() =>
            setSelectedFiles(selectableFiles.map((file) => file.filename))
          }
        >
          <IconSelectAll />
        </Button>
      </Hint>
      <Hint hint="Clear selection" side="top" asChild>
        <Button
          aria-label="Clear selection"
          onClick={() => setSelectedFiles([])}
          variant="ghost"
          size="icon-lg"
          disabled={files.length === 0 || selectedFiles.length === 0}
        >
          <IconSquareOff />
        </Button>
      </Hint>
    </RibbonSection>
  );
};

export const DeleteSelectedFilesSection = () => {
  const {
    actions,
    dispatch,
    selectedFiles,
    setSelectedFiles,
    isMutating,
    setIsMutating,
  } = useFileManager();

  const { confirm: confirmDelete, Dialog: DeleteConfirmation } =
    useConfirmationDialog({
      title: "Delete selected files?",
      description:
        "This permanently removes the selected files, every project and chat membership, and all derived extractions, captions, and vectors.",
      confirmVariant: "destructive",
    });

  const { mutate: deleteFileMutation } = useMutation({
    ...fileDeleteManyMutation({ client }),
    onMutate: () => {
      setIsMutating(true);
    },
    onSettled: () => {
      setIsMutating(false);
    },
    onError: (error) => {
      if (isErrorDetail(error)) {
        toast.error(`Unable to delete files. ${error.detail}`);
      } else {
        toast.error("Unable to delete files");
      }
    },
    onSuccess: (data) => {
      setSelectedFiles([]);
      dispatch({ property: "page", value: 1 });
      dispatch({
        property: "deleteSelectedFiles",
        value: data.files.map((f) => f.filename),
      });
    },
  });

  const deleteSelectedFiles = useCallback(async () => {
    if (selectedFiles.length === 0 || !(await confirmDelete())) return;
    deleteFileMutation({
      body: selectedFiles,
    });
  }, [confirmDelete, deleteFileMutation, selectedFiles]);

  if (!actions.delete) return null;
  return (
    <RibbonSection title="Delete">
      <DeleteConfirmation />
      <Hint hint="Delete selected files" side="top" asChild>
        <Button
          aria-label="Delete selected files"
          variant="destructive"
          size="icon-lg"
          disabled={selectedFiles.length === 0 || isMutating}
          onClick={() => deleteSelectedFiles()}
        >
          <Trash2Icon />
        </Button>
      </Hint>
    </RibbonSection>
  );
};

export const UploadFilesSection = () => {
  const { isMutating, actions } = useFileManager();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFiles = useUploadFiles();
  if (!actions.upload) return null;
  return (
    <RibbonSection title="Upload">
      <input
        aria-label="Choose attachments"
        className="sr-only"
        multiple
        onChange={(event) => {
          if (!!event.target.files?.length) {
            uploadFiles(event.target.files);
            event.target.value = "";
          }
        }}
        ref={fileInputRef}
        type="file"
      />
      <Hint hint="Upload files" side="top" asChild>
        <Button
          aria-label="Upload files"
          variant="ghost"
          size="icon-lg"
          disabled={isMutating}
          onClick={() => fileInputRef.current?.click()}
        >
          <IconFileUpload />
        </Button>
      </Hint>
    </RibbonSection>
  );
};
