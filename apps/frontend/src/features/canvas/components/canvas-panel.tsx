"use client";
import MarkdownViewer from "@/components/markdown-viewer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { CanvasItemHistory, CanvasVersion } from "@/lib/client";
import {
  canvasItemGetOneOptions,
  canvasVersionCreateMutation,
  canvasVersionGetOneOptions,
  canvasVersionRestoreMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn, isErrorDetail } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquareTextIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import React from "react";
import { kindLabel, selectionRequest } from "../lib/canvas";
import { useCanvas } from "./canvas-context";
import { CanvasDownloads } from "./canvas-downloads";
import { HtmlPreview } from "./html-preview";

const CanvasEditor = dynamic(() => import("./canvas-editor"), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-64 w-full" />,
});

const errorText = (error: unknown, fallback: string) =>
  isErrorDetail(error) && typeof error.detail === "string"
    ? error.detail
    : fallback;

const authorLabel = (author: string) => (author === "user" ? "You" : "Agent");

/**
 * The open canvas item: its versions on the branch being viewed, an editor
 * for the latest one, a preview, restore for older ones and "ask about
 * selection" (US-72.2).
 */
export function CanvasPanel({
  chatId,
  itemId,
  headerless = false,
}: {
  chatId: string;
  itemId: string;
  /** The mobile sheet supplies its own close button. */
  headerless?: boolean;
}) {
  const canvas = useCanvas();
  const transcriptKey = canvas?.transcriptKey ?? "";
  const base = canvasItemGetOneOptions({
    client,
    path: { chat_id: chatId, item_id: itemId },
  });
  const history = useQuery({
    ...base,
    queryKey: [
      ...base.queryKey,
      transcriptKey,
    ] as unknown as typeof base.queryKey,
    staleTime: 0,
    placeholderData: (previous) => previous,
    retry: false,
  });
  const [selected, setSelected] = React.useState<number | null>(null);

  if (history.isPending) {
    return (
      <div className="flex h-full flex-col gap-3 p-4" aria-busy="true">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-full w-full" />
      </div>
    );
  }
  if (history.error || !history.data.versions.length) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        {!headerless && <PanelClose />}
        <p role="alert" className="text-sm">
          {errorText(
            history.error,
            "This canvas item isn't on the branch you're viewing.",
          )}
        </p>
      </div>
    );
  }
  const latest = history.data.versions.at(-1)!;
  const viewing =
    selected != null &&
    history.data.versions.some((version) => version.number === selected)
      ? selected
      : latest.number;
  return (
    <VersionView
      key={`${itemId}:${viewing}:${latest.number}`}
      chatId={chatId}
      history={history.data}
      viewing={viewing}
      latest={latest.number}
      onView={(number) => setSelected(number === latest.number ? null : number)}
      headerless={headerless}
    />
  );
}

function PanelClose({ onClose }: { onClose?: () => void }) {
  const canvas = useCanvas();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="ml-auto shrink-0"
      aria-label="Close canvas"
      onClick={onClose ?? canvas?.close}
    >
      <XIcon />
    </Button>
  );
}

function VersionView({
  chatId,
  history,
  viewing,
  latest,
  onView,
  headerless,
}: {
  chatId: string;
  history: CanvasItemHistory;
  viewing: number;
  latest: number;
  onView: (number: number) => void;
  headerless: boolean;
}) {
  const canvas = useCanvas();
  const path = { chat_id: chatId, item_id: history.id, number: viewing };
  const version = useQuery({
    ...canvasVersionGetOneOptions({ client, path }),
    staleTime: Infinity,
    retry: false,
  });
  const [draft, setDraft] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState("");
  const [confirmClose, setConfirmClose] = React.useState(false);
  const isLatest = viewing === latest;
  const editable = isLatest && !!canvas?.canEdit;
  const dirty = draft != null && draft !== version.data?.content;
  const save = useMutation(canvasVersionCreateMutation({ client }));
  const restore = useMutation(canvasVersionRestoreMutation({ client }));
  const title =
    history.versions.find((entry) => entry.number === viewing)?.title ??
    "Canvas";

  const close = () => (dirty ? setConfirmClose(true) : canvas?.close());

  return (
    <section
      aria-label={`Canvas: ${title}`}
      className="flex h-full min-h-0 flex-col"
    >
      <header
        className={cn(
          "flex flex-wrap items-center gap-2 border-b px-3 py-2",
          headerless && "pr-12",
        )}
      >
        <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
        <Badge variant="secondary">
          {kindLabel(history.kind, history.language)}
        </Badge>
        <Select
          value={String(viewing)}
          onValueChange={(value) => onView(Number(value))}
        >
          <SelectTrigger
            size="sm"
            aria-label="Version"
            className="ml-auto w-auto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...history.versions].reverse().map((entry) => (
              <SelectItem key={entry.number} value={String(entry.number)}>
                Version {entry.number} · {authorLabel(entry.author)}
                {entry.number === latest ? " (latest)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {version.data && (
          <CanvasDownloads chatId={chatId} version={version.data} />
        )}
        {!headerless && <PanelClose onClose={close} />}
      </header>
      {version.error ? (
        <p role="alert" className="p-4 text-sm">
          {errorText(version.error, "Could not load this version.")}
        </p>
      ) : !version.data ? (
        <Skeleton className="m-3 h-full" />
      ) : (
        <VersionBody
          version={version.data}
          value={draft ?? version.data.content}
          onChange={setDraft}
          readOnly={!editable}
          onSelection={setSelection}
        />
      )}
      <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {(save.error || restore.error) && (
          <p role="alert" className="text-destructive w-full text-xs">
            {errorText(
              save.error ?? restore.error,
              "Could not save the canvas.",
            )}
          </p>
        )}
        {isLatest ? (
          <>
            {!canvas?.canEdit && (
              <p className="text-muted-foreground text-xs">
                Turn on canvas in your settings to edit.
              </p>
            )}
            {version.data && canvas?.canEdit && (
              <AskAboutSelection
                version={version.data}
                selection={selection}
                disabledReason={
                  dirty
                    ? "Save or discard your changes first"
                    : !canvas.ask
                      ? "Wait for the agent to finish"
                      : !selection.trim()
                        ? "Select text in the editor first"
                        : null
                }
              />
            )}
            {editable && (
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!dirty || save.isPending}
                  onClick={() => setDraft(null)}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!dirty || save.isPending}
                  onClick={() =>
                    draft != null &&
                    save.mutate({
                      path: { chat_id: chatId, item_id: history.id },
                      body: { base_version: latest, content: draft },
                    })
                  }
                >
                  {save.isPending ? "Saving…" : "Save version"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-xs">
              Viewing version {viewing} of {latest}.
            </p>
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onView(latest)}
              >
                Back to latest
              </Button>
              {canvas?.canEdit && (
                <Button
                  type="button"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.mutate(
                      { path, body: { base_version: latest } },
                      { onSuccess: () => onView(latest) },
                    )
                  }
                >
                  {restore.isPending ? "Restoring…" : "Restore this version"}
                </Button>
              )}
            </div>
          </>
        )}
      </footer>
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits to {title} haven&apos;t been saved as a version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => canvas?.close()}>
              Discard and close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function VersionBody({
  version,
  value,
  onChange,
  readOnly,
  onSelection,
}: {
  version: CanvasVersion;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  onSelection: (text: string) => void;
}) {
  const editor = (mode: "markdown" | "code") => (
    <CanvasEditor
      value={value}
      onChange={onChange}
      mode={mode}
      language={version.language}
      label={`${version.title}, version ${version.number}${readOnly ? " (read only)" : ""}`}
      readOnly={readOnly}
      onSelection={onSelection}
    />
  );
  if (version.kind === "code") {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">{editor("code")}</div>
    );
  }
  const [first, second] =
    version.kind === "html"
      ? (["preview", "source"] as const)
      : (["edit", "preview"] as const);
  const labels = { edit: "Edit", preview: "Preview", source: "Source" };
  const panes = {
    edit: editor("markdown"),
    source: editor("code"),
    preview:
      version.kind === "html" ? (
        <HtmlPreview content={value} title={version.title} />
      ) : (
        <div className="h-full overflow-y-auto p-4">
          <MarkdownViewer content={value} />
        </div>
      ),
  };
  return (
    <Tabs defaultValue={first} className="min-h-0 flex-1 gap-0">
      <TabsList variant="line" className="px-3">
        {[first, second].map((tab) => (
          <TabsTrigger key={tab} value={tab}>
            {labels[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
      {[first, second].map((tab) => (
        <TabsContent key={tab} value={tab} className="min-h-0 overflow-hidden">
          {panes[tab]}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function AskAboutSelection({
  version,
  selection,
  disabledReason,
}: {
  version: CanvasVersion;
  selection: string;
  disabledReason: string | null;
}) {
  const canvas = useCanvas();
  const [open, setOpen] = React.useState(false);
  const [instruction, setInstruction] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Keep the text that was selected when the popover opened.
  const [quoted, setQuoted] = React.useState("");
  const id = React.useId();

  const send = async () => {
    if (!canvas?.ask || !instruction.trim()) return;
    setSending(true);
    setError(null);
    try {
      await canvas.ask(
        selectionRequest({
          title: version.title,
          itemId: version.item_id,
          version: version.number,
          selection: quoted,
          instruction,
        }),
      );
      setInstruction("");
      setOpen(false);
    } catch (cause) {
      setError(errorText(cause, "Could not send the request."));
    } finally {
      setSending(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setQuoted(selection);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabledReason != null}
          title={disabledReason ?? undefined}
        >
          <MessageSquareTextIcon aria-hidden="true" />
          Ask about selection
        </Button>
      </PopoverTrigger>
      {disabledReason && (
        <span className="text-muted-foreground text-xs">{disabledReason}</span>
      )}
      <PopoverContent align="start" className="w-80">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor={id} className="text-xs font-medium">
            What should change in the selected text?
          </label>
          <blockquote className="text-muted-foreground line-clamp-3 border-l-2 pl-2 text-xs whitespace-pre-wrap">
            {quoted}
          </blockquote>
          <Textarea
            id={id}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void send();
              }
            }}
            rows={3}
            placeholder="e.g. Make this shorter"
          />
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={!instruction.trim() || sending || !canvas?.ask}
          >
            {sending ? "Sending…" : "Send to agent"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
