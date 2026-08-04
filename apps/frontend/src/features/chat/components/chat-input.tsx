import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/features/auth/components/user-context";
import { LlmModel } from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  IconArrowUp,
  IconCirclePlus,
  IconPaperclip,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { ClipboardPasteIcon } from "lucide-react";
import Image from "next/image";
import React, {
  Dispatch,
  RefObject,
  SetStateAction,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

interface AttachedFile {
  id: string;
  name: string;
  file: File;
  preview?: string;
}

const toModelValue = (model?: LlmModel | null) => {
  if (!model) return "";
  return `${model.provider_id}::${model.name}`;
};

const ChatInput = React.memo(
  ({
    onSubmit,
    disabled = false,
    displayStatus = true,
    defaultModel,
    placeholder = "",
    setNumberOfLines,
  }: {
    onSubmit?: ({ prompt, model }: { prompt: string; model: LlmModel }) => void;
    disabled?: boolean;
    displayStatus?: boolean;
    placeholder?: string;
    defaultModel?: LlmModel;
    setNumberOfLines?: Dispatch<SetStateAction<number>>;
  }) => {
    const user = useUser();
    const [prompt, setPrompt] = useState("");
    const [isDragOver, setIsDragOver] = useState(false);
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [model, setModel] = useState<string>(
      toModelValue(defaultModel) ?? user.settings.default_model_id!,
    );

    const availableModels = useMemo(
      () =>
        Object.values(user.settings.models ?? {}).map((m) => ({
          label: m.name,
          value: toModelValue(m),
        })),
      [user.settings.models],
    );
    const numberOfLinesRef = React.useRef<number>(1);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    const generateFileId = () => Math.random().toString(36).substring(7);
    const processFiles = useCallback((files: File[]) => {
      for (const file of files) {
        const fileId = generateFileId();
        const attachedFile: AttachedFile = {
          id: fileId,
          name: file.name,
          file,
        };

        if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = () => {
            setAttachedFiles((prev) =>
              prev.map((f) =>
                f.id === fileId
                  ? { ...f, preview: reader.result as string }
                  : f,
              ),
            );
          };
          reader.readAsDataURL(file);
        }

        setAttachedFiles((prev) => [...prev, attachedFile]);
      }
    }, []);
    const submitPrompt = () => {
      if (!disabled && prompt.trim() && onSubmit) {
        const [provider_id, name] = model.split("::");
        onSubmit({
          prompt: prompt.trim(),
          model: {
            provider_id,
            name,
          },
        });
        setPrompt("");
      }
    };
    const handleSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
      e.preventDefault();
      submitPrompt();
    };
    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(true);
    };
    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        processFiles(files);
      }
    };

    const handleTextareaChange = (
      e: React.ChangeEvent<HTMLTextAreaElement>,
    ) => {
      const lines = Math.min(7, e.target.value.split(/\n/).length);
      if (numberOfLinesRef.current != lines) {
        numberOfLinesRef.current = lines;
        setNumberOfLines?.(numberOfLinesRef.current);
      }
      setPrompt(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitPrompt();
      } else {
      }
    };

    const handleFileSelect = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        processFiles(files);

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      },
      [processFiles],
    );

    const handleRemoveFile = (fileId: string) => {
      setAttachedFiles((prev) => prev.filter((file) => file.id !== fileId));
    };

    return (
      <div className="mx-auto flex w-full max-w-[90%] flex-col gap-1 overflow-clip sm:max-w-3xl">
        <div className="bg-input dark:bg-input text-foreground relative flex-col content-center overflow-clip rounded-xl border transition-colors">
          {attachedFiles.length > 0 && (
            <div className="relative flex flex-wrap items-center gap-2 overflow-hidden p-2">
              {attachedFiles.map((file) => (
                <Badge
                  className="group hover:bg-accent hover:text-accent-foreground relative h-6 max-w-30 cursor-pointer overflow-hidden px-0 text-[13px] transition-colors"
                  key={file.id}
                  variant="outline"
                >
                  <span className="flex h-full items-center gap-1.5 overflow-hidden pl-1 font-normal">
                    <div className="relative flex h-4 min-w-4 items-center justify-center">
                      {file.preview ? (
                        <Image
                          alt={file.name}
                          className="absolute inset-0 h-4 w-4 rounded border object-cover"
                          height={16}
                          src={file.preview}
                          width={16}
                        />
                      ) : (
                        <IconPaperclip className="opacity-60" size={12} />
                      )}
                    </div>
                    <span className="inline truncate overflow-hidden pr-1.5">
                      {file.name}
                    </span>
                  </span>
                  <button
                    className="bg-destructive absolute right-1 z-10 shrink-0 rounded-full p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => handleRemoveFile(file.id)}
                    type="button"
                  >
                    <IconX size={12} />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <form
            className="flex w-full flex-1 flex-col items-center justify-between gap-1 overflow-clip rounded-[inherit] px-3 pt-3 pb-1"
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onSubmit={handleSubmit}
          >
            <Textarea
              className={cn(
                "max-h-35 flex-1 resize-none rounded-none border-none bg-transparent! p-0! shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent!",
                prompt.split(/\r?\n/).length == 1 && "h-6! min-h-6!",
              )}
              ref={textAreaRef}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              value={prompt}
            />

            <div className="flex w-full items-center justify-between">
              <FileUpload
                fileInputRef={fileInputRef}
                handleFileSelect={handleFileSelect}
                textAreaRef={textAreaRef}
              />
              <div className="flex flex-1 items-center justify-end gap-3">
                {displayStatus && (
                  <div className={cn("flex items-center gap-1 text-xs")}>
                    <div
                      title={disabled ? "Disconnected" : "Connected"}
                      className={cn(
                        "size-2 rounded-full pt-0.5",
                        disabled
                          ? "border-red-900 bg-red-500"
                          : "border-green-900 bg-green-500",
                      )}
                    />
                    {disabled ? "Disconnected" : "Connected"}
                  </div>
                )}
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="w-40 min-w-0 truncate border-0!">
                    <span className="block w-full truncate text-left">
                      <SelectValue placeholder="Select a model" />
                    </span>
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    align="end"
                    className="max-h-60 max-w-60 overflow-y-auto"
                  >
                    {availableModels?.map((model) => (
                      <SelectItem
                        value={model.value}
                        key={model.value}
                        className="block min-w-0! truncate"
                      >
                        <div className="block w-[95%] truncate">
                          {model.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  aria-label="Send message"
                  className={cn(
                    "shrink-0 rounded-full",
                    !prompt.trim() && "hidden",
                  )}
                  disabled={!prompt.trim()}
                  size="icon"
                  type="submit"
                  variant="default"
                >
                  <IconArrowUp size={16} />
                </Button>
              </div>
            </div>

            <div
              className={cn(
                "border-border bg-muted text-foreground pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border border-dashed text-sm transition-opacity duration-200",
                isDragOver ? "opacity-100" : "opacity-0",
              )}
            >
              <span className="flex w-full items-center justify-center gap-1 font-medium">
                <IconCirclePlus className="min-w-4" size={16} />
                Drop files here to add as attachments
              </span>
            </div>
          </form>
        </div>
      </div>
    );
  },
);

const FileUpload = ({
  fileInputRef,
  handleFileSelect,
  textAreaRef,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  textAreaRef: RefObject<HTMLTextAreaElement | null>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) => {
  return (
    <div>
      <input
        className="sr-only"
        multiple
        onChange={handleFileSelect}
        ref={fileInputRef}
        type="file"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Add attachments"
            className="rounded-full"
            size="icon"
            variant="ghost"
          >
            <IconPlus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-w-xs rounded-2xl p-1.5"
        >
          <DropdownMenuGroup className="space-y-1">
            <DropdownMenuItem
              className="rounded-md text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              <IconPaperclip />
              <span>Attach Files</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="rounded-md text-xs"
              onClick={async () => {
                const content = navigator.clipboard.read();
                if (textAreaRef.current) {
                  textAreaRef.current.value += content;
                  textAreaRef.current.focus();
                }
              }}
            >
              <ClipboardPasteIcon />
              <span>Paste</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
ChatInput.displayName = "ChatInput";

export default ChatInput;
