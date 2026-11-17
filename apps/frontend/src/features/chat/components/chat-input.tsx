import { LibraryFilePickerDialog } from "@/components/file-manager/library-file-picker";
import { Button } from "@/components/ui/button";
import { FieldSet } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type {
  ActiveSkillState,
  ComparisonTarget,
  SkillSelection,
  TemplateUse,
} from "@/lib/client";
import { cn, errorMessage } from "@/lib/utils";
import {
  AlertCircleIcon,
  ArrowUpIcon,
  SquareIcon,
  UploadCloudIcon,
} from "lucide-react";
import { useCallback, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import { useComposerAttachments } from "../hooks/use-composer-attachments";
import { ComposerAttachments } from "./composer-attachments";
import { ImageRequestChip, TemplateLabelChip } from "./composer-label-chips";
import {
  canReadClipboard,
  captureScreenshot,
  isCancelledCapture,
  nameClipboardFile,
  readClipboard,
} from "../lib/capture";
import { HelpTopic } from "@/features/help/components/help-topic";
import { ComposerMenu, type ComposerAction } from "./composer-menu";
import { ComposerNoticeSlot } from "./composer-notice";
import { CompareModelsPicker } from "./compare-targets";
import { ChatFileContext } from "./chat-file-context";
import { SkillComposer, type SkillComposerControl } from "./skill-composer";
import {
  TemplatePickerDialog,
  type AppliedTemplate,
  type TemplateSelection,
} from "@/features/templates/components/template-picker-dialog";
import { beforeAfterTargets, originalBody } from "../lib/comparison";
import {
  PromptCoachPanel,
  PromptCoachScope,
  reviewOffer,
  type PromptCoachControl,
} from "@/features/templates/components/prompt-coach";

export type ChatInputHandle = {
  /** Replaces the draft message and focuses it; never sends. */
  fill: (text: string) => void;
};

export type ChatInputProps = {
  ref?: React.Ref<ChatInputHandle>;
  /**
   * Chips in the top row (US-73.2): the model and learning mode, and
   * options such as goal and rubric when they apply.
   */
  chips?: React.ReactNode;
  /** Models chosen to answer the next message side by side. */
  compare?: {
    value: string[];
    onChange: (value: string[]) => void;
    disabled?: boolean;
  };
  /**
   * Offers "Create image", which makes the next message an image request
   * (ADR-0064). Omit when image generation isn't available to this user.
   */
  createImage?: { disabled?: boolean };
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
  /** The status indicator beside the send button. */
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
    /** The message asks for an image; the text is the description. */
    createImage?: true;
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
  chips,
  compare,
  createImage,
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
  const [isDragOver, setIsDragOver] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [imageRequested, setImageRequested] = useState(false);
  // An image request can't also be a model comparison.
  const imageMode = imageRequested && !!createImage && !compare?.value.length;
  const [helpOpen, setHelpOpen] = useState(false);
  const [noticeSlot, setNoticeSlot] = useState<HTMLDivElement | null>(null);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const focusOptions = () => optionsRef.current?.focus();
  // Template labels exist only with an owner, so the composer draft persists them.
  const appliedTemplate = skillComposer?.template ?? null;
  const [localPrompt, setPrompt] = useState("");
  const prompt = skillComposer?.prompt ?? localPrompt;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const submittingRef = useRef(false);
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const resetRequest = useCallback(() => {
    requestRef.current = null;
  }, []);
  const {
    draft,
    attachedFiles,
    isStaging,
    addFiles,
    removeFile,
    clearAttachments,
    discardAttachments,
    stageUploads,
    retryUploads,
    pickFiles,
  } = useComposerAttachments({
    chatId,
    onChange: resetRequest,
    onError: setSendError,
  });
  const numberOfLinesRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        image: imageMode,
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
        ...(imageMode && !compare ? { createImage: true as const } : {}),
        files,
        requestId: requestRef.current.id,
        ...(draft.id.current ? { draftId: draft.id.current } : {}),
      });
      draft.consumed();
      clearAttachments();
      coach?.dismiss();
      updatePrompt("");
      setImageRequested(false);
      skillComposer?.accepted();
      requestRef.current = null;
    } catch (error) {
      setSendError(errorMessage(error, "Upload failed. Please retry."));
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

  const handleAction = (action: ComposerAction) => {
    if (action === "upload") fileInputRef.current?.click();
    else if (action === "library") setLibraryOpen(true);
    else if (action === "context") setContextOpen(true);
    else if (action === "paste") void pasteFromClipboard();
    else if (action === "screenshot") void takeScreenshot();
    else if (action === "templates") onTemplateSelectionChange?.(null);
    else if (action === "review") coach?.run(prompt);
    else if (action === "skills") {
      skillComposer?.openList();
      requestAnimationFrame(() => textareaRef.current?.focus());
    } else if (action === "compare") setCompareOpen(true);
    else if (action === "image") {
      setImageRequested(true);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } else setHelpOpen(true);
  };

  const hasPrompt = prompt.trim().length > 0 || !!skillComposer?.hasSkills;
  const isDisabled = controlsDisabled || !hasPrompt;

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
          <ComposerAttachments
            files={attachedFiles}
            disabled={controlsDisabled}
            onRemove={removeFile}
            onRetry={retryUploads}
            onDiscard={discardAttachments}
          />
          {sendError && (
            <p
              role="alert"
              className="text-destructive flex items-start gap-1.5 px-3 pt-2 text-xs"
            >
              <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
              <span>{sendError}</span>
            </p>
          )}
          <ComposerNoticeSlot value={noticeSlot}>
            <div className="flex min-w-0 flex-col gap-1.5 px-3 pt-2.5 empty:hidden">
              <div
                role="group"
                aria-label="Message options"
                className="-m-0.5 flex min-w-0 [scrollbar-width:none] items-center gap-1.5 overflow-x-auto p-0.5 empty:hidden sm:flex-wrap sm:overflow-visible"
              >
                {chips}
                {compare && (
                  <CompareModelsPicker
                    value={compare.value}
                    onChange={compare.onChange}
                    disabled={compare.disabled}
                    open={compareOpen}
                    onOpenChange={setCompareOpen}
                    onCloseAutoFocus={(event) => {
                      event.preventDefault();
                      focusOptions();
                    }}
                  />
                )}
                {skillComposer?.hasSkills && (
                  <fieldset disabled={controlsDisabled} className="contents">
                    {skillComposer.chips}
                  </fieldset>
                )}
                {imageMode && (
                  <ImageRequestChip
                    disabled={controlsDisabled}
                    onRemove={() => setImageRequested(false)}
                  />
                )}
                {appliedTemplate && (
                  <TemplateLabelChip
                    template={appliedTemplate}
                    disabled={controlsDisabled}
                    onRemove={() => skillComposer?.changeTemplate(null)}
                  />
                )}
              </div>
              <div
                ref={setNoticeSlot}
                className="flex min-w-0 flex-col gap-1 empty:hidden"
              />
              {skillComposer && (
                <FieldSet disabled={controlsDisabled} className="empty:hidden">
                  {skillComposer.notices}
                </FieldSet>
              )}
            </div>
          </ComposerNoticeSlot>
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
            placeholder={
              imageMode ? "Describe the image to create" : placeholder
            }
          />
        </div>
        <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
          <ComposerMenu
            ref={optionsRef}
            disabled={controlsDisabled}
            templates={
              skillOwner && onTemplateSelectionChange
                ? { disabled: controlsDisabled }
                : undefined
            }
            review={
              coach ? reviewOffer(coach, prompt, controlsDisabled) : undefined
            }
            skills={
              skillComposer
                ? { disabled: controlsDisabled || !skillComposer.canOpenList }
                : undefined
            }
            compare={
              compare ? { disabled: compare.disabled || imageMode } : undefined
            }
            image={
              createImage
                ? compare?.value.length
                  ? {
                      disabled: true,
                      description: "Not while comparing models",
                    }
                  : { disabled: controlsDisabled || createImage.disabled }
                : undefined
            }
            onAction={handleAction}
          />
          <HelpTopic
            id="composer.controls"
            align="start"
            anchor={{
              open: helpOpen,
              onOpenChange: setHelpOpen,
              returnFocus: focusOptions,
            }}
          />
          <div className="ml-auto flex shrink-0 items-center gap-1">
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
