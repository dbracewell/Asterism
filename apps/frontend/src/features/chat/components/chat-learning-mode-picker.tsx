"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client } from "@/lib/api";
import type { ChatInfo, LearningModeId } from "@/lib/client";
import {
  chatLearningModeUpdateMutation,
  chatSessionGetOneOptions,
  learningModeGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GraduationCapIcon } from "lucide-react";

/** The server-owned catalog only changes with a deployment. */
export function learningModeQueryOptions() {
  return { ...learningModeGetManyOptions({ client }), staleTime: Infinity };
}

export function LearningModePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: LearningModeId;
  onChange: (value: LearningModeId) => void;
  disabled?: boolean;
}) {
  const query = useQuery(learningModeQueryOptions());
  const modes = query.data?.modes;
  const selected = modes?.find((mode) => mode.id === value);
  return (
    <>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as LearningModeId)}
        disabled={disabled || !modes}
      >
        <SelectTrigger
          aria-label="Learning mode"
          className="max-w-full min-w-0 border-0! bg-transparent"
        >
          <GraduationCapIcon className="text-muted-foreground" />
          <SelectValue placeholder="Learning mode" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {!selected && (
              <SelectItem value={value} disabled>
                {query.isPending ? "Loading modes…" : "Unavailable mode"}
              </SelectItem>
            )}
            {modes?.map((mode) => (
              <SelectItem
                key={mode.id}
                value={mode.id}
                title={mode.description}
              >
                {mode.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {query.error && (
        <p
          role="alert"
          className="text-destructive order-last w-full basis-full px-2 text-xs"
        >
          Could not load learning modes.
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry modes
          </Button>
        </p>
      )}
    </>
  );
}

export function ExistingChatLearningModePicker({
  info,
  disabled,
  onSelected,
  onPendingChange,
}: {
  info: ChatInfo;
  disabled: boolean;
  onSelected: (info: ChatInfo) => void;
  onPendingChange: (busy: boolean) => void;
}) {
  const current = useQuery({
    ...chatSessionGetOneOptions({ client, path: { chat_id: info.id } }),
    enabled: false,
    retry: false,
  });
  const mutation = useMutation({
    ...chatLearningModeUpdateMutation({ client }),
    onMutate: () => onPendingChange(true),
    onSettled: () => onPendingChange(false),
    onSuccess: onSelected,
  });
  return (
    <>
      <LearningModePicker
        value={info.learning_mode ?? "standard"}
        disabled={disabled || mutation.isPending || !!mutation.error}
        onChange={(learningMode) =>
          mutation.mutate({
            path: { chat_id: info.id },
            body: {
              learning_mode: learningMode,
              expected_learning_mode_revision: info.learning_mode_revision ?? 1,
            },
          })
        }
      />
      {mutation.error && (
        <p
          role="alert"
          className="text-destructive order-last w-full basis-full px-2 text-xs"
        >
          Could not change the learning mode. Reload the chat and retry when
          generation is idle.
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={current.isFetching}
            onClick={() => {
              void current.refetch({ cancelRefetch: false }).then((result) => {
                if (result.data && !result.isError) {
                  onSelected(result.data.info);
                  mutation.reset();
                }
              });
            }}
          >
            Reload current mode
          </Button>
        </p>
      )}
    </>
  );
}
