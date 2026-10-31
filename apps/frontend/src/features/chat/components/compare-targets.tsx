"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { client } from "@/lib/api";
import type { ChatModelChoice } from "@/lib/client";
import {
  chatMessageCompareMutation,
  chatModelsListOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ColumnsIcon } from "lucide-react";
import { useId, useState } from "react";
import { MAX_COMPARE, MIN_COMPARE, toggleTarget } from "../lib/comparison";

const modelName = (model: ChatModelChoice) => model.display_name || model.name;

const errorDetail = (error: unknown) =>
  error &&
  typeof error === "object" &&
  "detail" in error &&
  typeof error.detail === "string"
    ? error.detail
    : "The comparison could not be started. Try again.";

/** Available chat models as checkboxes; at most `max` can be chosen. */
function ModelChecklist({
  value,
  onChange,
  max,
  exclude,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  max: number;
  exclude?: string;
}) {
  const id = useId();
  const models = useQuery({
    ...chatModelsListOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const choices = (models.data ?? []).filter(
    (model) => model.available && model.id !== exclude,
  );
  if (models.isPending)
    return <p className="text-muted-foreground">Loading models…</p>;
  if (!choices.length)
    return (
      <p className="text-muted-foreground">
        No other available models to compare with.
      </p>
    );
  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
      {choices.map((model) => {
        const checked = value.includes(model.id);
        return (
          <li key={model.id} className="flex items-center gap-2">
            <Checkbox
              id={`${id}-${model.id}`}
              checked={checked}
              disabled={!checked && value.length >= max}
              onCheckedChange={() =>
                onChange(
                  toggleTarget(value, model.id).slice(0, Math.max(max, 0)),
                )
              }
            />
            <Label htmlFor={`${id}-${model.id}`} className="min-w-0 truncate">
              {modelName(model)}
            </Label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Composer toggle for running the next prompt on two or three models side by
 * side. An empty selection sends normally.
 */
export function CompareModelsPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const active = value.length > 0;
  return (
    <Popover>
      <Hint hint="Compare models side by side">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={active ? "secondary" : "ghost"}
            size={active ? "lg" : "icon-lg"}
            className="rounded-control"
            aria-label={
              active
                ? `Compare models (${value.length} selected)`
                : "Compare models"
            }
            disabled={disabled}
          >
            <ColumnsIcon />
            {active && <span aria-hidden="true">{value.length}</span>}
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Compare models</PopoverTitle>
          <PopoverDescription>
            Send your next message to {MIN_COMPARE} or {MAX_COMPARE} models and
            see the answers side by side. Each answer is its own branch you can
            continue from.
          </PopoverDescription>
        </PopoverHeader>
        <ModelChecklist value={value} onChange={onChange} max={MAX_COMPARE} />
        {value.length === 1 && (
          <p role="status" className="text-muted-foreground">
            Choose one more model to compare.
          </p>
        )}
        {active && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => onChange([])}
          >
            Stop comparing
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The composer's comparison payload, or an error message when only one model is chosen. */
export function comparePayload(models: string[]): {
  compare?: { model_id: string }[];
} {
  if (!models.length) return {};
  if (models.length < MIN_COMPARE)
    throw new Error(
      "Choose at least two models to compare, or stop comparing.",
    );
  return { compare: models.map((model_id) => ({ model_id })) };
}

/**
 * Compares an answered turn with one or two more models. The existing answer
 * becomes the first column; nothing about it changes.
 */
export function CompareMessageDialog({
  chatId,
  messageId,
  currentModelId,
  currentModelName,
  onOpenChange,
  onCompared,
}: {
  chatId: string;
  /** The user turn being compared; `null` closes the dialog. */
  messageId: string | null;
  currentModelId?: string;
  currentModelName?: string;
  onOpenChange: (open: boolean) => void;
  onCompared: () => void | Promise<void>;
}) {
  const [targets, setTargets] = useState<string[]>([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const compare = useMutation(chatMessageCompareMutation({ client }));
  const close = (open: boolean) => {
    if (open) return;
    setTargets([]);
    setRequestId(crypto.randomUUID());
    compare.reset();
    onOpenChange(false);
  };
  return (
    <Dialog open={messageId !== null} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compare with other models</DialogTitle>
          <DialogDescription>
            Run this prompt on one or two more models. The existing answer
            {currentModelName ? ` from ${currentModelName}` : ""} stays as the
            first column.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          {currentModelName && (
            <p className="text-muted-foreground flex items-center gap-2">
              <Badge variant="secondary">Column 1</Badge>
              {currentModelName}
            </p>
          )}
          <ModelChecklist
            value={targets}
            onChange={setTargets}
            max={MAX_COMPARE - 1}
            exclude={currentModelId}
          />
          {compare.error && (
            <p role="alert" className="text-destructive">
              {errorDetail(compare.error)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!targets.length || compare.isPending || !messageId}
            onClick={async () => {
              if (!messageId) return;
              try {
                await compare.mutateAsync({
                  path: { chat_id: chatId, message_id: messageId },
                  body: {
                    request_id: requestId,
                    targets: targets.map((model_id) => ({ model_id })),
                  },
                });
              } catch {
                return; // Shown in the dialog; the same request ID retries safely.
              }
              await onCompared();
              close(false);
            }}
          >
            {compare.isPending ? "Starting…" : "Compare"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
