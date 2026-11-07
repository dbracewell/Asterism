"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { errorDetail } from "@/features/classes/error-detail";
import { client } from "@/lib/api";
import type { ClassInvite, CreatedClassInvite } from "@/lib/client";
import {
  classInviteCreateMutation,
  classInviteGetManyOptions,
  classInviteRevokeMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

export const MAX_INVITES = 50;
export const MAX_LABEL_LENGTH = 80;

const STATUS_LABEL: Record<ClassInvite["status"], string> = {
  unused: "Not used yet",
  used: "Used",
  expired: "Expired",
  revoked: "Withdrawn",
};

function inviteLink(token: string) {
  return `${window.location.origin}/invite/${token}`;
}

function formatDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

/** One label per non-blank line; null with a reason when it can't be sent. */
export function parseLabels(text: string): {
  labels: string[];
  error: string | null;
} {
  const labels = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (labels.length === 0) {
    return { labels, error: "Add at least one student name." };
  }
  if (labels.length > MAX_INVITES) {
    return {
      labels,
      error: `Create at most ${MAX_INVITES} invites at a time.`,
    };
  }
  const long = labels.find((label) => label.length > MAX_LABEL_LENGTH);
  if (long) {
    return {
      labels,
      error: `Keep each name under ${MAX_LABEL_LENGTH} characters.`,
    };
  }
  return { labels, error: null };
}

function NewLinks({ created }: { created: CreatedClassInvite[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
  };
  return (
    <div
      aria-label="New invite links"
      role="group"
      className="bg-muted rounded-surface grid gap-3 p-4"
    >
      <p className="text-sm font-medium">
        Copy these links now. For security they won&apos;t be shown again.
      </p>
      <ul className="grid gap-2">
        {created.map((invite) => (
          <li
            key={invite.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="min-w-0 wrap-anywhere">
              <span className="font-medium">{invite.label}</span>{" "}
              <span className="text-muted-foreground font-mono">
                {inviteLink(invite.token)}
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Copy link for ${invite.label}`}
              onClick={() => copy(invite.id, inviteLink(invite.token))}
            >
              {copied === invite.id ? "Copied" : "Copy"}
            </Button>
          </li>
        ))}
      </ul>
      {created.length > 1 && (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() =>
            copy(
              "all",
              created
                .map((invite) => `${invite.label}\t${inviteLink(invite.token)}`)
                .join("\n"),
            )
          }
        >
          {copied === "all" ? "All links copied" : "Copy all links"}
        </Button>
      )}
    </div>
  );
}

function InviteRow({
  classId,
  invite,
}: {
  classId: string;
  invite: ClassInvite;
}) {
  const revoke = useMutation(classInviteRevokeMutation({ client }));
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b py-2 text-sm">
      <span className="grid min-w-0 gap-1">
        <span className="wrap-anywhere">
          <span className="font-medium">{invite.label}</span>{" "}
          <Badge variant={invite.status === "unused" ? "secondary" : "outline"}>
            {STATUS_LABEL[invite.status]}
          </Badge>
        </span>
        <span className="text-muted-foreground wrap-anywhere">
          {invite.status === "used" && invite.redeemed_at != null
            ? `${invite.redeemed_name} joined on ${formatDate(invite.redeemed_at)}`
            : invite.status === "unused"
              ? `Expires ${formatDate(invite.expires_at)}`
              : `Created ${formatDate(invite.created_at)}`}
        </span>
      </span>
      {invite.status === "unused" && (
        <Button
          type="button"
          variant="outline"
          aria-label={`Withdraw invite for ${invite.label}`}
          disabled={revoke.isPending}
          onClick={() =>
            revoke.mutate({
              path: { class_id: classId, invite_id: invite.id },
            })
          }
        >
          Withdraw
        </Button>
      )}
      {revoke.error && (
        <p role="alert" className="text-destructive w-full">
          {errorDetail(revoke.error, "Could not withdraw the invite.")}
        </p>
      )}
    </li>
  );
}

/** Single-use links that create an account and join this class (US-60.2). */
export function StudentInvites({ classId }: { classId: string }) {
  const fieldId = useId();
  const [text, setText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const invites = useQuery({
    ...classInviteGetManyOptions({
      client,
      path: { class_id: classId },
      query: { page_size: 100 },
    }),
    retry: false,
  });
  const create = useMutation({
    ...classInviteCreateMutation({ client }),
    onSuccess: () => setText(""),
  });

  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { labels, error } = parseLabels(text);
    setFormError(error);
    if (!error) {
      create.mutate({ path: { class_id: classId }, body: { labels } });
    }
  };
  const error =
    formError ??
    (create.error
      ? errorDetail(create.error, "Could not create invites.")
      : null);

  return (
    <section aria-label="Invites for new students" className="grid gap-3">
      <h2 className="text-lg font-medium">Invites for new students</h2>
      <p className="text-sm">
        Each invite link creates one account and joins this class. It works once
        and expires after 14 days.
      </p>
      <form onSubmit={submit} className="grid gap-3">
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={fieldId}>Student names, one per line</FieldLabel>
          <Textarea
            id={fieldId}
            rows={4}
            value={text}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setText(event.target.value)}
            disabled={create.isPending}
          />
          <FieldDescription>
            Names help you tell the links apart. They don&apos;t limit who can
            use a link, so give each one only to its student.
          </FieldDescription>
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Button type="submit" className="w-fit" disabled={create.isPending}>
          Create invites
        </Button>
      </form>
      {create.data && create.data.items.length > 0 && (
        <NewLinks created={create.data.items} />
      )}
      {invites.isPending && <ListSkeleton label="Loading invites" rows={2} />}
      {invites.error && (
        <QueryError
          error={invites.error}
          message="Could not load invites."
          retry={invites.refetch}
          isRetrying={invites.isFetching}
        />
      )}
      {invites.data && invites.data.items.length > 0 && (
        <ul aria-label="Invites">
          {invites.data.items.map((invite) => (
            <InviteRow key={invite.id} classId={classId} invite={invite} />
          ))}
        </ul>
      )}
      {invites.data && invites.data.total > invites.data.items.length && (
        <p className="text-muted-foreground text-sm">
          Showing the newest {invites.data.items.length} of {invites.data.total}
          .
        </p>
      )}
    </section>
  );
}
