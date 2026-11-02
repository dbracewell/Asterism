"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { PendingStatus } from "@/features/study/components/pending-status";
import {
  StudyModelField,
  useStudyModel,
} from "@/features/study/components/source-fields";
import { studyErrorDetail } from "@/features/study/lib/error-detail";
import type { StreamingMessage } from "@/features/chat/types";
import { client } from "@/lib/api";
import { chatMessageVerifyMutation } from "@/lib/client/@tanstack/react-query.gen";
import { formatPlural } from "@/lib/formatters";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";

/** Claims checked per pass; mirrors the server limit (MAX_VERIFY_CLAIMS). */
export const VERIFY_CLAIM_LIMIT = 12;

/** The files an answer could use, as recorded when it ran. */
export const verifiableFileCount = (message: StreamingMessage) =>
  message.role === "assistant" &&
  message.status === "completed" &&
  !!message.content.trim()
    ? (message.execution?.context?.allowed_file_ids.length ?? 0)
    : 0;

/**
 * Starts an on-demand verify pass for one answer (US-55.2). The pass checks
 * the answer's claims against the files it could use, with a chosen model;
 * its result replaces the message's previous verification.
 */
export function VerifyAction({
  chatId,
  message,
  disabled,
}: {
  chatId: string;
  message: StreamingMessage;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const files = verifiableFileCount(message);
  if (!files) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <Hint hint="Verify against sources">
        <DialogTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-control"
            aria-label="Verify against sources"
            disabled={disabled}
          >
            <ShieldCheckIcon />
          </Button>
        </DialogTrigger>
      </Hint>
      <DialogContent>
        {/* Mounted only while open, so answers do not load models up front. */}
        <VerifyForm
          chatId={chatId}
          message={message}
          files={files}
          onBusyChange={setBusy}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function VerifyForm({
  chatId,
  message,
  files,
  onBusyChange,
  onDone,
}: {
  chatId: string;
  message: StreamingMessage;
  files: number;
  onBusyChange: (busy: boolean) => void;
  onDone: () => void;
}) {
  const choice = useStudyModel(message.execution?.model.id);
  const verify = useMutation({
    ...chatMessageVerifyMutation({ client }),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: onDone,
  });
  const again = !!message.verification;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!choice.model) return;
        verify.mutate({
          path: { chat_id: chatId, message_id: message.id },
          body: { model_id: choice.model },
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Verify this answer</DialogTitle>
        <DialogDescription>
          Checks up to {VERIFY_CLAIM_LIMIT} factual claims against the{" "}
          {formatPlural(files, "file")} this answer could use. Each claim is
          labelled supported, unsupported or contradicted, with the passages
          used. The answer itself is not changed.
          {again && " This replaces the previous verification."}
        </DialogDescription>
      </DialogHeader>
      <StudyModelField
        id={`verify-model-${message.id}`}
        label="Model"
        description="The model that reads the claims and passages. Its usage is shown with the result."
        disabled={verify.isPending}
        choice={choice}
      />
      {verify.isPending && (
        <PendingStatus>
          Verifying. This can take up to two minutes.
        </PendingStatus>
      )}
      {verify.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(verify.error, "Could not verify. Try again.")}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={!choice.model || verify.isPending}>
          {again ? "Verify again" : "Verify"}
        </Button>
      </DialogFooter>
    </form>
  );
}
