"use client";

import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { Memory, MemoryCategory } from "@/lib/client";
import {
  memoryCreateMutation,
  memoryUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { errorDetail } from "@/lib/utils";
import { CATEGORY_LABELS, MEMORY_MAX_CHARS, memoryInvalidates } from "../lib";

type Scope = { kind: "user" } | { kind: "project"; projectId: string };

/** Add a memory to a scope, or edit one. Text, category and the sensitive label. */
export function MemoryEditorDialog({
  open,
  onOpenChange,
  scope,
  memory,
  onConflict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Scope;
  memory?: Memory;
  /** Called after a 409, so the list can reload the current memory. */
  onConflict?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <EditorForm
            key={memory?.id ?? "new"}
            scope={scope}
            memory={memory}
            onDone={() => onOpenChange(false)}
            onConflict={onConflict}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({
  scope,
  memory,
  onDone,
  onConflict,
}: {
  scope: Scope;
  memory?: Memory;
  onDone: () => void;
  onConflict?: () => void;
}) {
  const id = useId();
  const isUser = scope.kind === "user";
  const [text, setText] = useState(memory?.text ?? "");
  const [category, setCategory] = useState<MemoryCategory>(
    memory?.category ?? "learning",
  );
  const [sensitive, setSensitive] = useState(memory?.sensitive ?? false);
  const meta = { invalidates: memoryInvalidates() };
  const create = useMutation({ ...memoryCreateMutation({ client }), meta });
  const update = useMutation({ ...memoryUpdateMutation({ client }), meta });
  const saving = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const conflict =
    !!update.error &&
    (update.error as { status?: number; code?: number }).code === 409;
  const accessibility = isUser && category === "accessibility";
  const trimmed = text.trim();
  const tooLong = trimmed.length > MEMORY_MAX_CHARS;

  const save = () => {
    const shared = {
      text: trimmed,
      category: isUser ? category : null,
      sensitive: accessibility || sensitive,
    };
    if (memory) {
      update.mutate(
        {
          path: { memory_id: memory.id },
          body: { ...shared, expected_revision: memory.revision },
        },
        { onSuccess: onDone },
      );
    } else {
      create.mutate(
        {
          body:
            scope.kind === "user"
              ? { ...shared, kind: "user" }
              : { ...shared, kind: "project", project_id: scope.projectId },
        },
        { onSuccess: onDone },
      );
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && !tooLong) save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{memory ? "Edit memory" : "Add a memory"}</DialogTitle>
        <DialogDescription>
          {isUser
            ? "Something about you that helps in every chat and project, such as how you like to learn. Only you can see it."
            : "Something about your work in this project, such as a decision or a convention. It's used only in this project's chats, and only you can see it."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-text`}>Memory</FieldLabel>
          <Textarea
            id={`${id}-text`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-describedby={`${id}-count`}
            aria-invalid={tooLong}
            rows={4}
            required
          />
          <FieldDescription id={`${id}-count`}>
            {trimmed.length} / {MEMORY_MAX_CHARS} characters
          </FieldDescription>
        </Field>
        {isUser && (
          <Field>
            <FieldLabel htmlFor={`${id}-category`}>Category</FieldLabel>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as MemoryCategory)}
            >
              <SelectTrigger id={`${id}-category`} className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field orientation="horizontal">
          <Checkbox
            id={`${id}-sensitive`}
            aria-describedby={`${id}-sensitive-description`}
            checked={accessibility || sensitive}
            disabled={accessibility}
            onCheckedChange={(checked) => setSensitive(checked === true)}
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={`${id}-sensitive`}>Sensitive</FieldLabel>
            <FieldDescription id={`${id}-sensitive-description`}>
              {accessibility
                ? "Accessibility memories are always sensitive. Sensitive memories are labelled and never appear in logs."
                : "Labelled as sensitive, and never in logs."}
            </FieldDescription>
          </div>
        </Field>
      </FieldGroup>
      {error && (
        <div role="alert" className="text-destructive grid gap-2 text-sm">
          <p>
            {conflict
              ? "This memory changed somewhere else. Reload it, then make your change again."
              : errorDetail(error, "The memory could not be saved.")}
          </p>
          {conflict && onConflict && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                onConflict();
                onDone();
              }}
            >
              Reload memory
            </Button>
          )}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !trimmed || tooLong}>
          {saving ? "Saving…" : memory ? "Save memory" : "Add memory"}
        </Button>
      </DialogFooter>
    </form>
  );
}
