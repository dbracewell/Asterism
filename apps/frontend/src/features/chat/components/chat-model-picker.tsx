"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client } from "@/lib/api";
import { ChatInfo, MessageExecution } from "@/lib/client";
import {
  chatModelsListOptions,
  chatModelUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export function ChatModelPicker({
  value,
  onChange,
  disabled = false,
  savedLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  savedLabel?: string;
}) {
  const query = useQuery({
    ...chatModelsListOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const choices = query.data ?? [];
  const selected = choices.find((choice) => choice.id === value);
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="chat-model">Chat model</Label>
      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled || !query.data}
      >
        <SelectTrigger id="chat-model" aria-label="Chat model">
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          {value && !selected && (
            <SelectItem value={value} disabled>
              {savedLabel ?? value} (unavailable)
            </SelectItem>
          )}
          {choices.map((choice) => (
            <SelectItem
              key={choice.id}
              value={choice.id}
              disabled={!choice.available}
            >
              {choice.name} ({choice.provider_name})
              {!choice.available ? " — unavailable" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {query.isPending && <p role="status">Loading models…</p>}
      {query.isError && (
        <p role="alert">
          {query.data
            ? "Could not refresh models. Showing cached choices."
            : "Could not load models."}{" "}
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </p>
      )}
      {query.data && !choices.some((choice) => choice.available) && (
        <p role="status">
          No available models. Ask an administrator to enable one.
        </p>
      )}
      {value && query.data && !selected?.available && (
        <p role="alert">
          Selected model is unavailable. Choose an available replacement.
        </p>
      )}
    </div>
  );
}

export function ExistingChatModelPicker({
  info,
  disabled,
  onSelected,
}: {
  info: ChatInfo;
  disabled: boolean;
  onSelected: (info: ChatInfo) => void;
}) {
  const mutation = useMutation({
    ...chatModelUpdateMutation({ client }),
    onSuccess: onSelected,
    onError: () =>
      toast.error(
        "Could not change model. Reload the chat and retry when generation is idle.",
      ),
  });
  return (
    <ChatModelPicker
      value={info.selected_model_id ?? ""}
      savedLabel={info.selected_model?.name}
      disabled={disabled || mutation.isPending}
      onChange={(model_id) =>
        mutation.mutate({
          path: { chat_id: info.id },
          body: { model_id, expected_model_revision: info.model_revision ?? 1 },
        })
      }
    />
  );
}

export function ExecutionLabel({
  execution,
}: {
  execution?: MessageExecution | null;
}) {
  if (!execution) return null;
  return (
    <p className="text-muted-foreground text-xs" aria-label="Executed model">
      {execution.model.name} · {execution.model.provider_name} · configuration{" "}
      {execution.configuration.config_revision}
    </p>
  );
}
