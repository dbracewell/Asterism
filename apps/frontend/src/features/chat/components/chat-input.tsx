import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { IconArrowUp, IconCirclePlus, IconPaperclip, IconPlus, IconX } from "@tabler/icons-react";
import Image from "next/image";
import React, { RefObject, useCallback, useRef, useState } from "react";
import { ClipboardPasteIcon } from "lucide-react";

interface AttachedFile {
  id: string;
  name: string;
  file: File;
  preview?: string;
}

export default function ChatInput({
  onSubmit,
  disabled = false,
  displayStatus = true,
}: {
  onSubmit?: (prompt: string) => void;
  disabled?: boolean;
  displayStatus?: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
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
              f.id === fileId ? { ...f, preview: reader.result as string } : f,
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
      onSubmit(prompt.trim());
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
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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

  const isMultiLine =
    prompt.split(/\r?\n/).length > 1 || attachedFiles.length > 0;

  return (
    <div
      className={cn(
        "bg-input dark:bg-input text-foreground relative mx-auto flex w-full max-w-3xl flex-col content-center overflow-clip rounded-full p-2 transition-colors duration-200",
        isMultiLine && "rounded-3xl",
      )}
    >
      {displayStatus && (
        <div
          title={disabled ? "Disconnected" : "Connected"}
          className={cn(
            "absolute top-1/2 right-4 z-100 size-2 -translate-y-1/2 rounded-full",
            isMultiLine && "top-3 right-3",
            disabled
              ? "border-red-900 bg-red-500"
              : "border-green-900 bg-green-500",
          )}
        />
      )}
      {attachedFiles.length > 0 && (
        <div className="relative mb-2 flex w-fit items-center gap-2 overflow-hidden">
          {attachedFiles.map((file) => (
            <Badge
              className="group hover:bg-accent relative h-6 max-w-30 cursor-pointer overflow-hidden px-0 text-[13px] transition-colors"
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
                className="text-muted-foreground focus-visible:bg-accent focus-visible:ring-ring focus-visible:ring-offset-background absolute right-1 z-10 rounded-sm p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
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
        className={cn(
          "relative flex w-full flex-1 items-center justify-between gap-1 overflow-clip rounded-[inherit] p-1",
          isMultiLine && "flex-col",
        )}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onSubmit={handleSubmit}
      >
        {!isMultiLine && (
          <FileUpload
            fileInputRef={fileInputRef}
            handleFileSelect={handleFileSelect}
            textAreaRef={textAreaRef}
          />
        )}

        <Textarea
          className={cn(
            "max-h-50 flex-1 resize-none rounded-none border-none bg-transparent! p-0! shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent!",
            prompt.split(/\r?\n/).length == 1 && "h-6! min-h-6!",
          )}
          ref={textAreaRef}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder="Where will your curiosity lead you today?"
          value={prompt}
        />

        <div
          className={cn(
            "flex items-center justify-start",
            isMultiLine && "w-full justify-between",
          )}
        >
          {isMultiLine && (
            <FileUpload
              fileInputRef={fileInputRef}
              handleFileSelect={handleFileSelect}
              textAreaRef={textAreaRef}
            />
          )}
          <Button
            aria-label="Send message"
            className={cn("rounded-full", !prompt.trim() && "hidden")}
            disabled={!prompt.trim()}
            size="icon-lg"
            type="submit"
            variant="default"
          >
            <IconArrowUp size={16} />
          </Button>
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
  );
}

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
            size="icon-lg"
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
