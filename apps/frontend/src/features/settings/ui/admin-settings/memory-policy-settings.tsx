"use client";

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
import type { MemoryPolicy } from "@/lib/client";
import {
  groupGetManyOptions,
  memoryAvailabilityQueryKey,
  memoryPolicyGetOptions,
  memoryPolicyGetQueryKey,
  memoryPolicyUpdateMutation,
  userSettingsGetQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { errorMessage } from "@/lib/utils";

/** Admin Settings → Memory (ADR-0078): off by default, optionally for some groups. */
export function MemoryPolicySettings() {
  const user = useUser();
  return user.role === "admin" ? (
    <SettingsPane
      title="Memory"
      description="Let Asterism keep in mind what helps it work with each person, such as how they learn best, across their chats and projects. Off by default."
    >
      <MemoryPolicySection />
    </SettingsPane>
  ) : (
    <p role="alert">Administrator access is required to manage memory.</p>
  );
}

function MemoryPolicySection() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    ...memoryPolicyGetOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const groups = useQuery({ ...groupGetManyOptions({ client }), retry: false });
  const [draft, setDraft] = useState<MemoryPolicy | null>(null);
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    ...memoryPolicyUpdateMutation({ client }),
    // The policy is written below; availability and each person's "allowed" flag depend on it.
    meta: {
      invalidates: [
        memoryAvailabilityQueryKey({ client }),
        userSettingsGetQueryKey({ client }),
      ],
    },
    onSuccess(data) {
      queryClient.setQueryData(memoryPolicyGetQueryKey({ client }), data);
      setDraft(null);
      setSaved(true);
    },
  });

  if (!policy.data)
    return (
      <SettingsSection title="Availability">
        {policy.isError ? (
          <QueryError
            error={policy.error}
            message="The memory policy could not be loaded."
            retry={() => policy.refetch()}
            isRetrying={policy.isFetching}
          />
        ) : (
          <Spinner />
        )}
      </SettingsSection>
    );

  const current = draft ?? policy.data;
  const enabled = current.enabled ?? false;
  const limited = current.group_ids != null;
  const chosen = new Set(current.group_ids ?? []);
  const change = (next: MemoryPolicy) => {
    setDraft(next);
    setSaved(false);
    update.reset();
  };

  return (
    <SettingsSection
      title="Availability"
      description="Memories are private: only the person they belong to can see them, not educators and not administrators. People can still see and delete their memories while memory is off."
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
            id="memory-enabled"
            checked={enabled}
            disabled={update.isPending}
            onCheckedChange={(value) => change({ ...current, enabled: value })}
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="memory-enabled">Enable memory</FieldLabel>
            <FieldDescription>
              Each person can also turn memory off for themselves, and an
              educator can turn it off for a course.
            </FieldDescription>
          </div>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="memory-limited"
            checked={limited}
            disabled={update.isPending}
            onCheckedChange={(value) =>
              change({ ...current, group_ids: value ? [] : null })
            }
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="memory-limited">
              Limit to selected groups
            </FieldLabel>
            <FieldDescription>
              Off: every group may use memory.
            </FieldDescription>
          </div>
        </Field>
      </FieldGroup>
      {limited && (
        <ul aria-label="Groups allowed to use memory" className="pl-10">
          {(groups.data ?? []).map((group) => (
            <li key={group.id} className="flex items-center gap-2 py-1">
              <Checkbox
                id={`memory-group-${group.id}`}
                checked={chosen.has(group.id)}
                onCheckedChange={(checked) => {
                  const next = new Set(chosen);
                  if (checked) next.add(group.id);
                  else next.delete(group.id);
                  change({ ...current, group_ids: [...next].sort() });
                }}
              />
              <Label htmlFor={`memory-group-${group.id}`}>{group.name}</Label>
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
