"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import {
  reflectionCreateMutation,
  reflectionDraftCreateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { SparklesIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { reflectionMutationInvalidates, reflectionsHref } from "../queries";
import { HelpTopic } from "@/features/help/components/help-topic";
import { errorDetail } from "@/lib/utils";

export const LEARNED_PROMPT = "What did I learn?";
export const UNCLEAR_PROMPT = "What's still unclear?";
export const MAX_REFLECTION_CHARS = 2000;

/**
 * Reflect at the end of a session (US-58.2): two short prompts, an optional
 * suggested draft from the chat that the learner edits, then save. The
 * reflection is filed under the chat's project (`projectId`, null for
 * General), and the saved message says where, with a link (US-111.1).
 */
export function ReflectDialog({
  chatId,
  projectId,
  open,
  onOpenChange,
}: {
  chatId: string;
  projectId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="sm:max-w-xl">
          <ReflectForm
            chatId={chatId}
            projectId={projectId}
            onClose={() => onOpenChange(false)}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ReflectForm({
  chatId,
  projectId,
  onClose,
}: {
  chatId: string;
  projectId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [learned, setLearned] = useState("");
  const [unclear, setUnclear] = useState("");
  const [suggested, setSuggested] = useState(false);
  const suggest = useMutation({
    ...reflectionDraftCreateMutation({ client }),
    // A suggestion is never stored, so nothing needs refreshing.
    meta: { skipGlobalInvalidation: true },
    onSuccess: (draft) => {
      setLearned(draft.learned);
      setUnclear(draft.unclear);
      setSuggested(true);
    },
  });
  const save = useMutation({
    ...reflectionCreateMutation({ client }),
    meta: { invalidates: reflectionMutationInvalidates() },
    onSuccess: () => {
      toast.success("Reflection saved", {
        description: projectId
          ? "It's in this project's Reflections tab."
          : "It's on the General page, under Reflections.",
        action: {
          label: "View reflections",
          onClick: () => router.push(reflectionsHref(projectId)),
        },
      });
      onClose();
    },
  });
  const empty = !learned.trim() && !unclear.trim();
  const replace = useConfirmationDialog({
    title: "Replace what you wrote?",
    description:
      "The suggestion replaces both answers. You can edit it afterwards.",
    confirmText: "Replace with suggestion",
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty)
          save.mutate({ body: { chat_id: chatId, learned, unclear } });
      }}
    >
      {replace.dialog}
      <DialogHeader>
        <div className="flex items-center gap-1">
          <DialogTitle>Reflect on this session</DialogTitle>
          <HelpTopic id="concept.reflection" />
        </div>
        <DialogDescription>
          A few sentences are enough. Your reflection is saved with this
          chat&apos;s project, and only you can see it.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor={`${id}-learned`}>{LEARNED_PROMPT}</FieldLabel>
        <Textarea
          id={`${id}-learned`}
          value={learned}
          maxLength={MAX_REFLECTION_CHARS}
          className="min-h-24"
          disabled={save.isPending}
          onChange={(event) => setLearned(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-unclear`}>{UNCLEAR_PROMPT}</FieldLabel>
        <Textarea
          id={`${id}-unclear`}
          value={unclear}
          maxLength={MAX_REFLECTION_CHARS}
          className="min-h-24"
          disabled={save.isPending}
          onChange={(event) => setUnclear(event.target.value)}
        />
        {suggested && (
          <FieldDescription>
            Suggested from this chat. Edit it so it says what you think before
            saving.
          </FieldDescription>
        )}
      </Field>
      {suggest.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(suggest.error, "Could not suggest a reflection.")}
        </p>
      )}
      {save.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(save.error, "Could not save the reflection. Retry.")}
        </p>
      )}
      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={suggest.isPending || save.isPending}
          onClick={async () => {
            if (empty || (await replace.confirm()))
              suggest.mutate({ body: { chat_id: chatId } });
          }}
        >
          <SparklesIcon />
          {suggest.isPending ? "Suggesting…" : "Suggest a draft"}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={empty || save.isPending}>
            {save.isPending ? "Saving…" : "Save reflection"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
