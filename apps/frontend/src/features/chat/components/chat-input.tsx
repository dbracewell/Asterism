/* eslint-disable @next/next/no-img-element */
import { LibraryFilePickerDialog } from "@/components/file-manager/library-file-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FieldSet } from "@/components/ui/field";
import { Hint } from "@/components/ui/hint";
import { Textarea } from "@/components/ui/textarea";
import type {
  ActiveSkillState,
  ComparisonTarget,
  SkillSelection,
  TemplateUse,
  UserFile,
} from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  AlertCircleIcon,
  ArrowUpIcon,
  FileTextIcon,
  LayoutTemplateIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useAttachmentDraft } from "../hooks/use-attachment-draft";
import {
  canReadClipboard,
  captureScreenshot,
  isCancelledCapture,
  nameClipboardFile,
  readClipboard,
} from "../lib/capture";
import { HelpTopic } from "@/features/help/components/help-topic";
import { AttachMenu, type AttachAction } from "./attach-menu";
import { ChatFileContext } from "./chat-file-context";
import { SkillComposer, type SkillComposerControl } from "./skill-composer";
import {
  TemplatePickerDialog,
  type AppliedTemplate,
  type TemplateSelection,
} from "@/features/templates/components/template-picker-dialog";
import { levelLabel } from "@/features/templates/lib/levels";
import { beforeAfterTargets, originalBody } from "../lib/comparison";
import {
  PromptCoachButton,
  PromptCoachPanel,
  PromptCoachScope,
  type PromptCoachControl,
} from "@/features/templates/components/prompt-coach";

type UploadState = "queued" | "uploading" | "ready" | "failed";

const uploadErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error &&
    "detail" in error &&
    typeof error.detail === "string"
  )
    return error.detail;
  return "Upload failed. Please retry.";
};

interface AttachedFile {
  id: string;
  name: string;
  file?: File;
  source?: UserFile;
  preview?: string;
  state: UploadState;
  error?: string;
  sourceId?: string;
}

export type ChatInputHandle = {
  /** Replaces the draft message and focuses it; never sends. */
  fill: (text: string) => void;
};

export type ChatInputProps = {
  ref?: React.Ref<ChatInputHandle>;
  /** Rendered in the toolbar after the attach menu, e.g. a model selector. */
  modelSelector?: React.ReactNode;
  skillOwner?: string;
  skillScope?: string;
  activeSkills?: ActiveSkillState;
  skillComposer?: SkillComposerControl;
  /** Template dialog state; `undefined` is closed, `null` shows the list. */
  templateSelection?: TemplateSelection | null;
  onTemplateSelectionChange?: (
    selection: TemplateSelection | null | undefined,
  ) => void;
  /**
   * Shows "Review prompt" when the owner turned the coach on (US-51.6);
   * `modelId` is the composer's selected chat model.
   */
  promptCoach?: { modelId?: string | null };
  /** Supplied by the owned input when `promptCoach` is set. */
  coach?: PromptCoachControl;
  /** Compact indicators shown in the toolbar beside the send button. */
  status?: React.ReactNode;
  onSubmit: (data: {
    prompt: string;
    files: string[];
    requestId: string;
    draftId?: string;
    skills?: SkillSelection;
    template?: TemplateUse;
    /** Set for a before/after send: `prompt` is the original (US-51.7). */
    compare?: ComparisonTarget[];
  }) => void | Promise<unknown>;
  requestScope?: string;
  /** Changes when the saved file scope may have changed (branch, model). */
  scopeKey?: string;
  /** Blocks removing saved attachments in the files dialog. */
  scopeLocked?: boolean;
  chatId?: string;
  projectId?: string | null;
  savedFileIds?: string[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onLineNumberChange?: (lines: number) => void;
  isProcessing?: boolean;
  onStop?: () => void;
};

export const ChatInputContainer = ({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) => {
  return (
    <div
      {...props}
      className={cn(
        "border-input focus-within:border-ring focus-within:ring-ring bg-background rounded-overlay shadow-raised focus-within:shadow-overlay mx-auto flex min-h-0 w-full max-w-full min-w-0 flex-col overflow-clip border transition-shadow focus-within:ring-2",
        className,
      )}
    >
      {children}
    </div>
  );
};

export const ChatInput = (props: ChatInputProps) =>
  props.skillOwner ? (
    <OwnedChatInput {...props} skillOwner={props.skillOwner} />
  ) : (
    <ChatInputCore {...props} />
  );

/** Skills and templates are private, so both need a known owner. */
function OwnedChatInput(props: ChatInputProps & { skillOwner: string }) {
  const [templateSelection, setTemplateSelection] = useState<
    TemplateSelection | null | undefined
  >();
  return (
    <SkillComposer
      key={`${props.skillOwner}:${props.skillScope}`}
      owner={props.skillOwner}
      scope={props.skillScope ?? "new"}
      state={props.activeSkills}
      disabled={props.disabled}
      onOpenTemplate={setTemplateSelection}
    >
      {(control) => {
        const input = (coach?: PromptCoachControl) => (
          <ChatInputCore
            {...props}
            skillComposer={control}
            coach={coach}
            templateSelection={templateSelection}
            onTemplateSelectionChange={setTemplateSelection}
          />
        );
        return props.promptCoach ? (
          <PromptCoachScope
            owner={props.skillOwner}
            modelId={props.promptCoach.modelId}
          >
            {input}
          </PromptCoachScope>
        ) : (
          input()
        );
      }}
    </SkillComposer>
  );
}

const ChatInputCore = ({
  ref,
  skillComposer,
  skillOwner,
  templateSelection,
  onTemplateSelectionChange,
  modelSelector,
  coach,
  promptCoach,
  status,
  onSubmit,
  requestScope,
  scopeKey,
  scopeLocked,
  chatId,
  projectId,
  savedFileIds = [],
  disabled,
  onStop,
  onLineNumberChange,
  isProcessing,
  placeholder,
  className,
}: ChatInputProps) => {
  const draft = useAttachmentDraft(chatId);
  const [isStaging, setIsStaging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  // Template labels exist only with an owner, so the composer draft persists them.
  const appliedTemplate = skillComposer?.template ?? null;
  const [localPrompt, setPrompt] = useState("");
  const prompt = skillComposer?.prompt ?? localPrompt;
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const submittingRef = useRef(false);
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const previewUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);
  const numberOfLinesRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addFiles = useCallback((files: File[]) => {
    requestRef.current = null;
    const additions = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      file,
      state: "queued" as const,
      preview: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined,
    }));
    additions.forEach((file) => {
      if (file.preview) previewUrls.current.add(file.preview);
    });
    setAttachedFiles((previous) => [...previous, ...additions]);
  }, []);

  const updateFile = useCallback(
    (id: string, update: Partial<AttachedFile>) =>
      setAttachedFiles((files) =>
        files.map((file) => (file.id === id ? { ...file, ...update } : file)),
      ),
    [],
  );

  const removeFile = useCallback(
    async (id: string) => {
      requestRef.current = null;
      const selected = attachedFiles.find((item) => item.id === id);
      setIsStaging(true);
      try {
        if (selected?.sourceId) await draft.remove(selected.sourceId);
        setAttachedFiles((files) => {
          const file = files.find((item) => item.id === id);
          if (file?.preview) {
            URL.revokeObjectURL(file.preview);
            previewUrls.current.delete(file.preview);
          }
          return files.filter((item) => item.id !== id);
        });
      } catch (error) {
        setSendError(uploadErrorMessage(error));
      } finally {
        setIsStaging(false);
      }
    },
    [attachedFiles, draft],
  );

  function clearAttachments() {
    attachedFiles.forEach((file) => {
      if (file.preview) {
        URL.revokeObjectURL(file.preview);
        previewUrls.current.delete(file.preview);
      }
    });
    setAttachedFiles([]);
    requestRef.current = null;
  }
  async function discardAttachments() {
    setIsStaging(true);
    setSendError(undefined);
    try {
      await draft.discard();
    } catch {
      setSendError(
        "Attachments cleared here. If server cleanup failed, staged references expire automatically; library files remain.",
      );
    } finally {
      clearAttachments();
      setIsStaging(false);
    }
  }

  const stageUploads = async () =>
    Promise.all(
      attachedFiles.map(async (attachment) => {
        if (attachment.sourceId) return attachment.sourceId;
        if (!attachment.file) return null;
        updateFile(attachment.id, { state: "uploading", error: undefined });
        try {
          const data = await draft.upload(attachment.file);
          const uploaded = data.files[0];
          if (!uploaded)
            throw new Error("The server did not return an uploaded file.");
          updateFile(attachment.id, {
            state: "ready",
            sourceId: uploaded.id,
            source: uploaded,
          });
          return uploaded.id;
        } catch (error) {
          const message = uploadErrorMessage(error);
          toast.error(`Upload failed for ${attachment.name}: ${message}`);
          updateFile(attachment.id, {
            state: "failed",
            error: message,
          });
          return null;
        }
      }),
    );
  const pickFiles = async (files: UserFile[]) => {
    requestRef.current = null;
    setIsStaging(true);
    try {
      await draft.add(files.map((file) => file.id));
      setAttachedFiles((current) => [
        ...current,
        ...files
          .filter((file) => !current.some((item) => item.sourceId === file.id))
          .map((source) => ({
            id: source.id,
            sourceId: source.id,
            name: source.original_name,
            source,
            state: "ready" as const,
          })),
      ]);
    } finally {
      setIsStaging(false);
    }
  };

  /**
   * Sends the draft; with `beforeAfter`, sends the coach's original and the
   * improved draft to one model as labelled comparison columns instead.
   */
  const submitPrompt = async (beforeAfter?: {
    original: string;
    modelId: string;
  }) => {
    if (
      disabled ||
      isStaging ||
      submittingRef.current ||
      !onSubmit ||
      (!prompt.trim() && !attachedFiles.length && !skillComposer?.hasSkills)
    )
      return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setSendError(undefined);
    try {
      const prepared = skillComposer
        ? await skillComposer.prepare(prompt)
        : { prompt: prompt.trim() };
      const uploads = await stageUploads();
      const uploadedIds = uploads.filter((id): id is string => id !== null);
      const files = [...new Set(uploadedIds)];
      // Uploads are library sources; no partial message is accepted after an upload failure.
      if (uploadedIds.length !== attachedFiles.length) {
        toast.error("Failed to upload all attachments. Please retry.");
        return;
      }
      const template = appliedTemplate?.use;
      const compare = beforeAfter
        ? beforeAfterTargets(beforeAfter, prepared.prompt)
        : undefined;
      const signature = JSON.stringify({
        prompt: prepared.prompt,
        compare,
        skills: prepared.skills,
        template,
        files,
        draftId: draft.id.current,
        scope: requestScope,
      });
      if (requestRef.current?.signature !== signature) {
        await draft.verify(files);
        requestRef.current = { signature, id: crypto.randomUUID() };
      }
      await onSubmit({
        prompt: compare ? originalBody(beforeAfter!.original) : prepared.prompt,
        ...(compare ? { compare } : {}),
        ...(prepared.skills ? { skills: prepared.skills } : {}),
        ...(template ? { template } : {}),
        files,
        requestId: requestRef.current.id,
        ...(draft.id.current ? { draftId: draft.id.current } : {}),
      });
      draft.consumed();
      clearAttachments();
      coach?.dismiss();
      updatePrompt("");
      skillComposer?.accepted();
      requestRef.current = null;
    } catch (error) {
      setSendError(uploadErrorMessage(error));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const controlsDisabled =
    !!disabled ||
    isSubmitting ||
    isStaging ||
    (skillComposer ? !skillComposer.ready : false);

  const updatePrompt = (value: string, template?: AppliedTemplate) => {
    if (skillComposer) skillComposer.changePrompt(value, template);
    else setPrompt(value);
    const lines = Math.min(8, value.split(/\n/).length);
    if (lines !== numberOfLinesRef.current) {
      numberOfLinesRef.current = lines;
      onLineNumberChange?.(lines);
    }
  };

  useImperativeHandle(ref, () => ({
    fill(text) {
      updatePrompt(text);
      textareaRef.current?.focus();
    },
  }));

  const insertText = (text: string, template?: AppliedTemplate) => {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? prompt.length;
    const end = element?.selectionEnd ?? start;
    updatePrompt(prompt.slice(0, start) + text + prompt.slice(end), template);
    element?.focus();
  };

  const pasteFromClipboard = async () => {
    if (!canReadClipboard()) {
      toast.error("Clipboard access is unavailable. Paste into the message.");
      return;
    }
    try {
      const { files, text } = await readClipboard();
      if (files.length) addFiles(files);
      if (text) insertText(text);
      if (!files.length && !text) toast.info("The clipboard is empty.");
    } catch {
      toast.error("Clipboard access was blocked. Paste into the message.");
    }
  };

  const takeScreenshot = async () => {
    try {
      addFiles([await captureScreenshot()]);
    } catch (error) {
      if (!isCancelledCapture(error))
        toast.error("Could not take a screenshot.");
    }
  };

  const handleAttach = (action: AttachAction) => {
    if (action === "upload") fileInputRef.current?.click();
    else if (action === "library") setLibraryOpen(true);
    else if (action === "context") setContextOpen(true);
    else if (action === "paste") void pasteFromClipboard();
    else void takeScreenshot();
  };

  const hasPrompt = prompt.trim().length > 0 || !!skillComposer?.hasSkills;
  const isDisabled = controlsDisabled || !hasPrompt;

  const retryable = attachedFiles.some(
    (file) => file.state === "queued" || file.state === "failed",
  );

  return (
    <>
      <form
        className={cn(
          "bg-muted/70 text-foreground relative flex min-w-0 shrink-0 flex-col rounded-[inherit]",
          className,
        )}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setIsDragOver(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOver(false);
          if (!controlsDisabled) addFiles(Array.from(event.dataTransfer.files));
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void submitPrompt();
        }}
      >
        <input
          aria-label="Choose attachments"
          className="sr-only"
          multiple
          onChange={(event) => {
            if (!disabled && !submittingRef.current)
              addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
        <div
          className="flex min-w-0 flex-col [overflow-wrap:anywhere]"
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest("button,a,input,[role]"))
              textareaRef.current?.focus();
          }}
        >
          {!!attachedFiles.length && (
            <div
              className="flex min-w-0 flex-wrap items-center gap-2 px-3 pt-3"
              aria-live="polite"
            >
              {attachedFiles.map((file) => (
                <AttachmentChip
                  key={file.id}
                  file={file}
                  disabled={controlsDisabled}
                  onRemove={() => removeFile(file.id)}
                />
              ))}
              <div className="ml-auto flex items-center gap-0.5">
                {retryable && (
                  <Hint hint="Upload now">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Upload / retry attachments"
                      disabled={controlsDisabled}
                      onClick={async () => {
                        setIsStaging(true);
                        try {
                          await stageUploads();
                        } finally {
                          setIsStaging(false);
                        }
                      }}
                    >
                      <RefreshCwIcon />
                    </Button>
                  </Hint>
                )}
                <Hint hint="Discard attachments">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Discard attachments"
                    disabled={controlsDisabled}
                    onClick={discardAttachments}
                  >
                    <Trash2Icon />
                  </Button>
                </Hint>
              </div>
            </div>
          )}
          {attachedFiles
            .filter((file) => file.state === "failed")
            .map((file) => (
              <p
                className="text-destructive flex items-start gap-1.5 px-3 pt-2 text-xs"
                key={`${file.id}-error`}
                role="alert"
              >
                <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
                <span>
                  {file.name}: {file.error}
                </span>
              </p>
            ))}
          {sendError && (
            <p
              role="alert"
              className="text-destructive flex items-start gap-1.5 px-3 pt-2 text-xs"
            >
              <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
              <span>{sendError}</span>
            </p>
          )}
          {skillComposer && (
            <FieldSet disabled={controlsDisabled}>
              {skillComposer.controls}
            </FieldSet>
          )}
          {appliedTemplate && (
            <div className="flex min-w-0 items-center gap-0.5 px-3 pt-2">
              <Badge
                variant="secondary"
                className="max-w-full min-w-0"
                title={`This message records that it was built with ${appliedTemplate.name} at the ${appliedTemplate.use.level} level.`}
              >
                <span className="truncate">
                  Built with {appliedTemplate.name}
                </span>
                <span className="shrink-0">
                  · {levelLabel(appliedTemplate.use.level)}
                </span>
              </Badge>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={controlsDisabled}
                aria-label={`Remove ${appliedTemplate.name} template label`}
                onClick={() => skillComposer?.changeTemplate(null)}
              >
                <XIcon />
              </Button>
            </div>
          )}
          {coach && (
            <PromptCoachPanel
              coach={coach}
              prompt={prompt}
              disabled={controlsDisabled}
              onApply={(text) => {
                updatePrompt(text);
                textareaRef.current?.focus();
              }}
              onRetry={() => coach.run(coach.original ?? prompt)}
              onCompare={
                promptCoach?.modelId && coach.original
                  ? () =>
                      void submitPrompt({
                        original: coach.original!,
                        modelId: promptCoach.modelId!,
                      })
                  : undefined
              }
            />
          )}
          <Textarea
            {...skillComposer?.inputProps}
            role={skillComposer ? "combobox" : undefined}
            aria-haspopup={skillComposer ? "listbox" : undefined}
            disabled={controlsDisabled}
            aria-label="Message"
            data-tour="message"
            ref={textareaRef}
            value={prompt}
            onChange={(event) => updatePrompt(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length && !event.clipboardData.getData("text/plain")) {
                event.preventDefault();
                addFiles(files.map(nameClipboardFile));
              }
            }}
            className={cn(
              "box-border rounded-none! border-0 bg-transparent! px-4! pt-3.5! pb-2! shadow-none ring-0 outline-0",
              "focus-visible:ring-0 focus-visible:outline-0",
              "max-h-48! min-h-14!",
            )}
            onKeyDown={(event) => {
              if (skillComposer?.keyDown(event)) {
                event.preventDefault();
                return;
              }
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                if (!isDisabled) void submitPrompt();
              }
            }}
            placeholder={placeholder}
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1 px-2 pb-2">
          <AttachMenu disabled={controlsDisabled} onAction={handleAttach} />
          {skillOwner && (
            <Hint hint="Prompt templates">
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="rounded-control"
                aria-label="Prompt templates"
                disabled={controlsDisabled}
                onClick={() => onTemplateSelectionChange?.(null)}
              >
                <LayoutTemplateIcon />
              </Button>
            </Hint>
          )}
          {coach && (
            <PromptCoachButton
              coach={coach}
              prompt={prompt}
              disabled={controlsDisabled}
            />
          )}
          {modelSelector}
          <HelpTopic id="composer.controls" />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {status}
            {isProcessing && onStop ? (
              <Button
                type="button"
                variant="destructive"
                size="icon-lg"
                className="rounded-control"
                aria-label="Stop generating"
                onClick={onStop}
              >
                <SquareIcon className="fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-lg"
                className="rounded-control"
                disabled={isDisabled}
                aria-label="Send message"
                onClick={(event) => {
                  event.preventDefault();
                  void submitPrompt();
                }}
              >
                <ArrowUpIcon />
              </Button>
            )}
          </div>
        </div>
        <div
          aria-hidden="true"
          className={cn(
            "border-primary/60 bg-background/85 text-foreground pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed text-sm font-medium backdrop-blur-sm transition-opacity",
            isDragOver ? "opacity-100" : "opacity-0",
          )}
        >
          <UploadCloudIcon className="size-4" />
          Drop files to attach
        </div>
      </form>
      <LibraryFilePickerDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        projectId={projectId}
        excludedIds={[
          ...savedFileIds,
          ...attachedFiles.flatMap((file) =>
            file.sourceId ? [file.sourceId] : [],
          ),
        ]}
        onPick={pickFiles}
      />
      {skillOwner && onTemplateSelectionChange && (
        <TemplatePickerDialog
          owner={skillOwner}
          selection={templateSelection}
          onSelectionChange={onTemplateSelectionChange}
          onUse={(text, applied) => insertText(text, applied)}
          onCloseAutoFocus={(event) => {
            // The composer, not the toolbar button, owns focus after insertion.
            event.preventDefault();
            textareaRef.current?.focus();
          }}
        />
      )}
      <ChatFileContext
        open={contextOpen}
        onOpenChange={setContextOpen}
        chatId={chatId}
        projectId={projectId ?? null}
        scopeKey={scopeKey}
        disabled={scopeLocked}
      />
    </>
  );
};

const statusLabel: Record<UploadState, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  ready: "Ready",
  failed: "Failed",
};

const AttachmentChip = ({
  file,
  disabled,
  onRemove,
}: {
  file: AttachedFile;
  disabled: boolean;
  onRemove: () => void;
}) => (
  <div
    className={cn(
      "rounded-surface flex max-w-full min-w-0 items-center gap-2 border p-1 pr-1.5 text-xs",
      file.state === "failed" ? "border-destructive" : "border-border",
    )}
  >
    <span className="bg-background text-foreground rounded-control flex size-8 shrink-0 items-center justify-center overflow-hidden border">
      {file.preview ? (
        <img alt="" className="size-full object-cover" src={file.preview} />
      ) : (
        <FileTextIcon className="size-4" />
      )}
    </span>
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="max-w-40 truncate font-medium sm:max-w-56">
        {file.name}
      </span>
      <span
        className={cn(
          "flex items-center gap-1",
          file.state === "failed"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        {file.state === "uploading" && (
          <LoaderCircleIcon className="size-3 animate-spin" />
        )}
        {statusLabel[file.state]}
      </span>
    </span>
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Remove ${file.name}`}
      className="rounded-control"
      disabled={disabled}
      onClick={onRemove}
      type="button"
    >
      <XIcon />
    </Button>
  </div>
);
