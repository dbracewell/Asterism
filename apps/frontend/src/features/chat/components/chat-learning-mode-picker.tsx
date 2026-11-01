"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import React from "react";
import {
  DelayedConfirmAction,
  LOCK_OVERRIDE_DELAY_SECONDS,
} from "./delayed-confirm-action";

/** The server-owned catalog only changes with a deployment. */
export function learningModeQueryOptions() {
  return { ...learningModeGetManyOptions({ client }), staleTime: Infinity };
}

/** The learning mode's display name from the server catalog. */
export function useLearningModeName(mode: ChatInfo["learning_mode"]) {
  const catalog = useQuery(learningModeQueryOptions());
  return catalog.data?.modes.find((item) => item.id === mode)?.name;
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
  // Leaving a locked mode for Standard waits for a delayed confirmation.
  const [confirmStandard, setConfirmStandard] = React.useState(false);
  const mode = info.learning_mode ?? "standard";
  const modeName = useLearningModeName(mode) ?? "this learning mode";
  const select = (learningMode: LearningModeId, overrideLock = false) =>
    mutation.mutate({
      path: { chat_id: info.id },
      body: {
        learning_mode: learningMode,
        expected_learning_mode_revision: info.learning_mode_revision ?? 1,
        ...(overrideLock ? { override_lock: true } : {}),
      },
    });
  return (
    <>
      <LearningModePicker
        value={mode}
        disabled={disabled || mutation.isPending || !!mutation.error}
        onChange={(learningMode) => {
          if (learningMode === "standard" && info.learning_mode_locked)
            setConfirmStandard(true);
          else select(learningMode);
        }}
      />
      <AlertDialog open={confirmStandard} onOpenChange={setConfirmStandard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {modeName} mode?</AlertDialogTitle>
            <AlertDialogDescription>
              You locked this chat to keep working it out yourself. Switching to
              Standard unlocks it, and the assistant will answer directly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay in {modeName}</AlertDialogCancel>
            <DelayedConfirmAction
              delaySeconds={LOCK_OVERRIDE_DELAY_SECONDS}
              onConfirm={() => select("standard", true)}
            >
              Switch to Standard
            </DelayedConfirmAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
