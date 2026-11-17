"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { COMPOSER_CHIP } from "@/features/chat/lib/composer-chip";
import { client } from "@/lib/api";
import {
  canvasItemCreateMutation,
  canvasItemGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn, errorDetail } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PanelRightIcon, PlusIcon } from "lucide-react";
import React from "react";
import { kindLabel, type CanvasKindName } from "../lib/canvas";
import { useCanvas } from "./canvas-context";

const KINDS: { value: CanvasKindName; label: string }[] = [
  { value: "document", label: "Document" },
  { value: "code", label: "Code" },
  { value: "html", label: "HTML page" },
];

/**
 * The composer's Canvas chip (US-72.4): every item on the branch being
 * viewed, including ones you started, and "New canvas item".
 */
export function CanvasChip({
  chatId,
  hasMessages,
}: {
  chatId: string;
  /** An item anchors to the last message, so a new chat can't start one. */
  hasMessages: boolean;
}) {
  const canvas = useCanvas();
  const base = canvasItemGetManyOptions({ client, path: { chat_id: chatId } });
  const items = useQuery({
    ...base,
    queryKey: [
      ...base.queryKey,
      canvas?.transcriptKey ?? "",
    ] as unknown as typeof base.queryKey,
    staleTime: 0,
    placeholderData: (previous) => previous,
    retry: false,
  });
  const [open, setOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const list = items.data ?? [];
  if (!canvas || (!canvas.canEdit && !list.length)) return null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(COMPOSER_CHIP)}
            aria-label={`Canvas, ${list.length} ${list.length === 1 ? "item" : "items"}`}
          >
            <PanelRightIcon />
            Canvas{list.length ? ` · ${list.length}` : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-72 p-2">
          <p className="text-muted-foreground px-2 py-1 text-xs font-medium">
            Canvas items
          </p>
          {list.length ? (
            <ul className="flex max-h-64 flex-col overflow-y-auto">
              {list.map((item) => (
                <li key={item.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full justify-start py-1.5 text-left"
                    aria-current={
                      canvas.openItemId === item.id ? "true" : undefined
                    }
                    onClick={() => {
                      canvas.open(item.id);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.title}</span>
                      <span className="text-muted-foreground block text-xs">
                        {kindLabel(item.kind, item.language)} · version{" "}
                        {item.version}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground px-2 py-1 text-xs">
              No canvas items on this branch yet.
            </p>
          )}
          {canvas.canEdit && (
            <div className="mt-1 border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                disabled={!hasMessages}
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
              >
                <PlusIcon />
                New canvas item
              </Button>
              {!hasMessages && (
                <p className="text-muted-foreground px-2 text-xs">
                  Send a message first; items belong to a point in the chat.
                </p>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {/* Mounted only while open, so each item starts from a blank form. */}
      {creating && (
        <NewCanvasItemDialog
          chatId={chatId}
          open
          onOpenChange={setCreating}
          onCreated={(itemId) => {
            setCreating(false);
            canvas.open(itemId);
          }}
        />
      )}
    </>
  );
}

function NewCanvasItemDialog({
  chatId,
  open,
  onOpenChange,
  onCreated,
}: {
  chatId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (itemId: string) => void;
}) {
  const [kind, setKind] = React.useState<CanvasKindName>("document");
  const [title, setTitle] = React.useState("");
  const [language, setLanguage] = React.useState("");
  const create = useMutation(canvasItemCreateMutation({ client }));
  const id = React.useId();
  const ready = title.trim() && (kind !== "code" || language.trim());
  const error = create.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            create.mutate(
              {
                path: { chat_id: chatId },
                body: {
                  kind,
                  title: title.trim(),
                  ...(kind === "code" ? { language: language.trim() } : {}),
                },
              },
              { onSuccess: (version) => onCreated(version.item_id) },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>New canvas item</DialogTitle>
            <DialogDescription>
              Start an empty item beside the chat. The agent sees it on your
              next message.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Label id={`${id}-kind`}>Kind</Label>
              <RadioGroup
                aria-labelledby={`${id}-kind`}
                value={kind}
                onValueChange={(value) => setKind(value as CanvasKindName)}
                className="flex flex-wrap gap-4"
              >
                {KINDS.map((option) => (
                  <div key={option.value} className="flex items-center gap-2">
                    <RadioGroupItem
                      id={`${id}-${option.value}`}
                      value={option.value}
                    />
                    <Label htmlFor={`${id}-${option.value}`}>
                      {option.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel>
              <Input
                id={`${id}-title`}
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
              />
            </Field>
            {kind === "code" && (
              <Field>
                <FieldLabel htmlFor={`${id}-language`}>Language</FieldLabel>
                <Input
                  id={`${id}-language`}
                  value={language}
                  maxLength={32}
                  placeholder="e.g. python or typescript"
                  onChange={(event) => setLanguage(event.target.value)}
                />
              </Field>
            )}
          </FieldGroup>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {errorDetail(error, "Could not create the canvas item.")}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
