"use client";

import { useSetupDraft } from "@/features/setup/setup-draft";
import { availabilityQueryKey } from "@/features/availability/queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useUser } from "@/features/auth/components/user-context";
import {
  SettingsPane,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import type { StudyChatPolicy } from "@/lib/client";
import {
  groupGetManyOptions,
  studyChatPolicyGetOptions,
  studyChatPolicyGetQueryKey,
  studyChatPolicyUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { errorMessage } from "@/lib/utils";

/** Admin Settings → Study in chat (EPIC-98): on by default, optionally for some groups. */
export function StudyChatPolicySettings() {
  const user = useUser();
  return user.role === "admin" ? (
    <SettingsPane
      title="Study in chat"
      description="Let the assistant draft flashcard decks and practice quizzes in project chats whose Study area is on. People review each draft and choose whether to save it. On by default."
    >
      <StudyChatPolicySection />
    </SettingsPane>
  ) : (
    <p role="alert">
      Administrator access is required to manage study in chat.
    </p>
  );
}

function StudyChatPolicySection() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    ...studyChatPolicyGetOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const groups = useQuery({ ...groupGetManyOptions({ client }), retry: false });
  const [draft, setDraft] = useState<StudyChatPolicy | null>(null);
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    ...studyChatPolicyUpdateMutation({ client }),
    // The policy is written below; the admin
    // switches each person sees (EPIC-96) depend on it.
    meta: {
      invalidates: [availabilityQueryKey()],
    },
    onSuccess(data) {
      queryClient.setQueryData(studyChatPolicyGetQueryKey({ client }), data);
      setDraft(null);
      setSaved(true);
    },
  });
  useSetupDraft({
    dirty: draft !== null,
    save: () =>
      update.mutateAsync({
        body: {
          enabled: draft?.enabled ?? true,
          group_ids: draft?.group_ids ?? null,
        },
      }),
  });

  if (!policy.data)
    return (
      <SettingsSection title="Availability">
        {policy.isError ? (
          <QueryError
            error={policy.error}
            message="The study in chat policy could not be loaded."
            retry={() => policy.refetch()}
            isRetrying={policy.isFetching}
          />
        ) : (
          <Spinner />
        )}
      </SettingsSection>
    );

  const current = draft ?? policy.data;
  const enabled = current.enabled ?? true;
  const limited = current.group_ids != null;
  const chosen = new Set(current.group_ids ?? []);
  const change = (next: StudyChatPolicy) => {
    setDraft(next);
    setSaved(false);
    update.reset();
  };

  return (
    <SettingsSection
      title="Availability"
      description="The assistant only drafts: nothing is added to Study until the person saves it. The tools also need the project's Study area on and a model that supports tools."
      actions={
        <Button
          disabled={!draft || update.isPending}
          onClick={() =>
            update.mutate({
              body: { enabled, group_ids: current.group_ids ?? null },
            })
          }
        >
          {update.isPending ? "Saving…" : "Save availability"}
        </Button>
      }
    >
      <FieldGroup>
        <Field orientation="horizontal">
          <Switch
            id="study-chat-enabled"
            checked={enabled}
            disabled={update.isPending}
            onCheckedChange={(value) => change({ ...current, enabled: value })}
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="study-chat-enabled">
              Enable decks and quizzes from chat
            </FieldLabel>
            <FieldDescription>
              An educator can also turn it off for a course. It works only in
              projects whose Study area is on.
            </FieldDescription>
          </div>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="study-chat-limited"
            checked={limited}
            disabled={update.isPending}
            onCheckedChange={(value) =>
              change({ ...current, group_ids: value ? [] : null })
            }
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="study-chat-limited">
              Limit to selected groups
            </FieldLabel>
            <FieldDescription>Off: every group may use it.</FieldDescription>
          </div>
        </Field>
      </FieldGroup>
      {limited && (
        <ul
          aria-label="Groups allowed to make decks and quizzes from chat"
          className="pl-10"
        >
          {(groups.data ?? []).map((group) => (
            <li key={group.id} className="flex items-center gap-2 py-1">
              <Checkbox
                id={`study-chat-group-${group.id}`}
                checked={chosen.has(group.id)}
                onCheckedChange={(checked) => {
                  const next = new Set(chosen);
                  if (checked) next.add(group.id);
                  else next.delete(group.id);
                  change({ ...current, group_ids: [...next].sort() });
                }}
              />
              <Label htmlFor={`study-chat-group-${group.id}`}>
                {group.name}
              </Label>
            </li>
          ))}
          {groups.isError && (
            <li role="alert" className="text-destructive text-sm">
              Groups could not be loaded.
            </li>
          )}
        </ul>
      )}
      {update.isError && (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage(update.error, "The policy could not be saved.")}
        </p>
      )}
      <p role="status" className="text-muted-foreground text-sm">
        {draft ? (
          <span className="text-foreground font-medium">Unsaved changes</span>
        ) : saved ? (
          "Availability saved."
        ) : null}
      </p>
    </SettingsSection>
  );
}
