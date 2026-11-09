"use client";

import { COMPOSER_CHIP } from "../lib/composer-chip";
import { ComposerNotice } from "./composer-notice";
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
import type { ChatInfo, CourseModePolicy, LearningModeId } from "@/lib/client";
import {
  chatLearningModeUpdateMutation,
  chatSessionGetOneOptions,
  learningModeGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GraduationCapIcon, LockIcon } from "lucide-react";
import React from "react";
import { CoursePolicyNotice, useCourseModePolicy } from "./course-mode-policy";
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
  policy = null,
}: {
  value: LearningModeId;
  onChange: (value: LearningModeId) => void;
  disabled?: boolean;
  /** A class policy; modes it doesn't allow are shown but can't be chosen. */
  policy?: CourseModePolicy | null;
}) {
  const allowedModes = policy?.allowed_modes ?? null;
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
          data-tour="learning-mode"
          aria-description={
            policy ? "Limited by your class's policy" : undefined
          }
          className={COMPOSER_CHIP}
        >
          <GraduationCapIcon className="text-muted-foreground" />
          <SelectValue placeholder="Learning mode" />
          {policy && (
            <LockIcon aria-hidden="true" className="text-muted-foreground" />
          )}
        </SelectTrigger>
        <SelectContent className="max-w-[min(18rem,calc(100vw-1rem))]">
          {policy && (
            <CoursePolicyNotice policy={policy} className="px-2 py-1.5" />
          )}
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
                disabled={!!allowedModes && !allowedModes.includes(mode.id)}
                description={
                  allowedModes && !allowedModes.includes(mode.id)
                    ? "Not allowed in this course"
                    : mode.description
                }
              >
                {mode.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {query.error && (
        <ComposerNotice role="alert" className="text-destructive">
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
        </ComposerNotice>
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
  const policy = useCourseModePolicy(info.project_id);
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
        policy={policy}
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
        <ComposerNotice role="alert" className="text-destructive">
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
        </ComposerNotice>
      )}
    </>
  );
}
