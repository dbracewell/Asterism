"use client";

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
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import type { ChatInfo, ChatLearningModeUpdate } from "@/lib/client";
import { chatLearningModeUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { LockIcon, LockOpenIcon } from "lucide-react";
import React from "react";
import { useLearningModeName } from "./chat-learning-mode-picker";
import {
  DelayedConfirmAction,
  LOCK_OVERRIDE_DELAY_SECONDS,
} from "./delayed-confirm-action";

/**
 * The chat header's lock control: lock the current learning mode, or see that
 * it is locked and unlock it after a deliberate, delayed confirmation.
 */
export function ChatModeLock({ info }: { info: ChatInfo }) {
  const mode = info.learning_mode ?? "standard";
  const locked = !!info.learning_mode_locked;
  const name = useLearningModeName(mode) ?? "Learning";
  const [open, setOpen] = React.useState(false);
  const mutation = useMutation({
    ...chatLearningModeUpdateMutation({ client }),
    onSuccess: () => setOpen(false),
  });
  if (mode === "standard") return null;

  const update = (body: Omit<ChatLearningModeUpdate, "learning_mode">) =>
    mutation.mutate({
      path: { chat_id: info.id },
      body: { learning_mode: mode, ...body },
    });
  const revision = info.learning_mode_revision ?? 1;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) mutation.reset();
      }}
    >
      <Button
        type="button"
        size="sm"
        variant={locked ? "secondary" : "ghost"}
        className="h-8 shrink-0 gap-1 text-xs"
        aria-label={
          locked ? `${name} mode locked. Unlock` : `Lock ${name} mode`
        }
        title={
          locked
            ? "Leaving this mode or revealing answers needs a confirmation"
            : "Commit to this learning mode"
        }
        data-locked={locked}
        onClick={() => setOpen(true)}
      >
        {locked ? <LockIcon aria-hidden /> : <LockOpenIcon aria-hidden />}
        <span className="hidden sm:inline">
          {locked ? `${name} locked` : "Lock mode"}
        </span>
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {locked ? `Unlock ${name} mode?` : `Lock ${name} mode?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {locked
              ? "You locked this chat to keep yourself working it out. Unlocking lets you switch to Standard or reveal answers without the extra wait."
              : "While locked, switching to Standard or revealing an answer asks you to confirm and wait a few seconds. You can still change between learning modes, and you can unlock at any time."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.error && (
          <p role="alert" className="text-destructive text-sm">
            Could not {locked ? "unlock" : "lock"} the mode. Reload the chat and
            retry when generation is idle.
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>
            {locked ? "Stay locked" : "Cancel"}
          </AlertDialogCancel>
          {locked ? (
            <DelayedConfirmAction
              delaySeconds={LOCK_OVERRIDE_DELAY_SECONDS}
              disabled={mutation.isPending}
              onConfirm={(event) => {
                event.preventDefault();
                update({
                  expected_learning_mode_revision: revision,
                  locked: false,
                  override_lock: true,
                });
              }}
            >
              Unlock
            </DelayedConfirmAction>
          ) : (
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                update({
                  expected_learning_mode_revision: revision,
                  locked: true,
                });
              }}
            >
              Lock mode
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
