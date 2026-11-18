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
import type {
  ChatInfo,
  ChatLearningModeUpdate,
  LearningModeId,
  ModePolicy,
  ModePolicySource,
} from "@/lib/client";
import {
  chatLearningModeUpdateMutation,
  chatModePolicyGetOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GraduationCapIcon, LockIcon, LockOpenIcon } from "lucide-react";
import React from "react";
import {
  learningModeQueryOptions,
  useLearningModeName,
} from "./chat-learning-mode-picker";
import {
  DelayedConfirmAction,
  LOCK_OVERRIDE_DELAY_SECONDS,
} from "./delayed-confirm-action";

type PolicyLike = ModePolicy | null | undefined;

function source(policy: PolicyLike, kind: ModePolicySource["kind"]) {
  return policy?.sources?.find((item) => item.kind === kind) ?? null;
}

/** The learner's own lock, if this chat has one (ADR-0068). */
export function learnerSource(policy: PolicyLike) {
  return source(policy, "learner");
}

/** The educator's course limit, if this project has one. */
export function courseSource(policy: PolicyLike) {
  return source(policy, "course");
}

/**
 * Whether the picker may choose a mode. Only sources the learner can't lift
 * disable it: choosing Standard in a locked chat asks to release the lock.
 */
export function modeSelectable(policy: PolicyLike, mode: LearningModeId) {
  return (policy?.sources ?? []).every(
    (item) => item.learner_can_lift || item.allowed_modes.includes(mode),
  );
}

/** The policy a new chat in this project starts under (null in General). */
export function useNewChatModePolicy(projectId: string | null | undefined) {
  const policy = useQuery({
    ...chatModePolicyGetOptions({
      client,
      query: { project_id: projectId ?? undefined },
    }),
    enabled: !!projectId,
    retry: false,
  });
  return projectId ? (policy.data ?? null) : null;
}

function orList(items: string[]) {
  return items.length > 1
    ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`
    : (items[0] ?? "no");
}

function useCourseLine(course: ModePolicySource | null) {
  const catalog = useQuery(learningModeQueryOptions());
  if (!course) return null;
  const modes = catalog.data?.modes ?? [];
  // A course that allows the whole catalog limits only reveals.
  const limited = !catalog.data || course.allowed_modes.length < modes.length;
  const names = course.allowed_modes.map(
    (mode) => modes.find((item) => item.id === mode)?.name ?? mode,
  );
  const limits = [
    limited && `${orList(names)} ${names.length === 1 ? "mode" : "modes"} only`,
    course.reveal === "forbidden" && "answers can't be revealed",
  ].filter(Boolean);
  return `${course.class_name}: ${limits.join(", ")}. Set by ${course.set_by}.`;
}

/** Each source restricting this chat or project, and who set it. */
export function ModePolicyNotice({
  policy,
  className,
}: {
  policy: PolicyLike;
  className?: string;
}) {
  const course = courseSource(policy);
  const learner = learnerSource(policy);
  const courseLine = useCourseLine(course);
  if (!course && !learner) return null;
  return (
    <div
      aria-label="Mode policy"
      className={cn("text-muted-foreground space-y-1 text-xs", className)}
    >
      {courseLine && (
        <p
          aria-label="Course policy"
          className="flex items-start gap-1.5"
          data-source="course"
        >
          <GraduationCapIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="wrap-anywhere">{courseLine}</span>
        </p>
      )}
      {learner && (
        <p className="flex items-start gap-1.5" data-source="learner">
          <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="wrap-anywhere">
            You locked this chat: switching to Standard or revealing an answer
            asks you to confirm and wait.
          </span>
        </p>
      )}
      {learner && !policy?.allowed_modes.length && (
        <p role="alert" className="text-destructive">
          No mode is left while this chat is locked. Unlock it to continue.
        </p>
      )}
    </div>
  );
}

/**
 * The chat header's policy control: lock the current learning mode, or see
 * every limit in force and unlock the learner's own after a delayed confirm.
 */
export function ModePolicyControl({ info }: { info: ChatInfo }) {
  const mode = info.learning_mode ?? "standard";
  const policy = info.mode_policy;
  const locked = !!learnerSource(policy);
  const course = courseSource(policy);
  const name = useLearningModeName(mode) ?? "Learning";
  const [open, setOpen] = React.useState(false);
  const mutation = useMutation({
    ...chatLearningModeUpdateMutation({ client }),
    onSuccess: () => setOpen(false),
  });
  if (mode === "standard" && !course) return null;
  const canLock =
    mode !== "standard" &&
    (!policy || policy.allowed_modes.some((item) => item !== "standard"));

  const update = (body: Omit<ChatLearningModeUpdate, "learning_mode">) =>
    mutation.mutate({
      path: { chat_id: info.id },
      body: { learning_mode: mode, ...body },
    });
  const revision = info.learning_mode_revision ?? 1;
  const label = locked
    ? `${name} mode locked. Unlock`
    : mode === "standard"
      ? "Course mode policy"
      : `Lock ${name} mode`;
  const title = locked
    ? `Unlock ${name} mode?`
    : mode === "standard"
      ? "Course mode policy"
      : `Lock ${name} mode?`;

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
        aria-label={label}
        title={
          locked
            ? "Leaving this mode or revealing answers needs a confirmation"
            : mode === "standard"
              ? "Limits your class set"
              : "Commit to this learning mode"
        }
        data-locked={locked}
        onClick={() => setOpen(true)}
      >
        {locked ? (
          <LockIcon aria-hidden />
        ) : mode === "standard" ? (
          <GraduationCapIcon aria-hidden />
        ) : (
          <LockOpenIcon aria-hidden />
        )}
        <span className="hidden sm:inline">
          {locked
            ? `${name} locked`
            : mode === "standard"
              ? "Course limits"
              : "Lock mode"}
        </span>
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {locked
              ? "You locked this chat to keep yourself working it out. Unlocking lets you switch to Standard or reveal answers without the extra wait. Your class's limits stay."
              : mode === "standard"
                ? "Your educator set these limits for this course project. Only they can change them."
                : "While locked, switching to Standard or revealing an answer asks you to confirm and wait a few seconds. You can still change between learning modes, and you can unlock at any time."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ModePolicyNotice policy={policy} />
        {!locked && mode !== "standard" && !canLock && (
          <p className="text-muted-foreground text-sm">
            Locking would leave no learning mode this course allows.
          </p>
        )}
        {mutation.error && (
          <p role="alert" className="text-destructive text-sm">
            Could not {locked ? "unlock" : "lock"} the mode. Reload the chat and
            retry when generation is idle.
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>
            {locked ? "Stay locked" : mode === "standard" ? "Close" : "Cancel"}
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
            mode !== "standard" && (
              <AlertDialogAction
                disabled={mutation.isPending || !canLock}
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
            )
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
