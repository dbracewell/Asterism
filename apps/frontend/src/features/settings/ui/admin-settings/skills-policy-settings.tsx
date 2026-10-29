"use client";

import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useUser } from "@/features/auth/components/user-context";
import {
  SettingsPane,
  SettingsSaveBar,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import {
  skillsPolicyGetOptions,
  skillsPolicyGetQueryKey,
  skillsPolicyUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function SkillsPolicySettings() {
  const user = useUser();
  return user.role === "admin" ? (
    <SkillsPolicyForm key={user.id} />
  ) : (
    <p role="alert">
      Administrator access is required to manage skill activation.
    </p>
  );
}

function SkillsPolicyForm() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    ...skillsPolicyGetOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const [draft, setDraft] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    ...skillsPolicyUpdateMutation({ client }),
    onSuccess(data) {
      queryClient.setQueryData(skillsPolicyGetQueryKey({ client }), data);
      setDraft(null);
      setSaved(true);
    },
  });
  if (!policy.data)
    return policy.isError ? (
      <QueryError
        error={policy.error}
        message="Skill policy could not be loaded."
        retry={() => policy.refetch()}
        isRetrying={policy.isFetching}
      />
    ) : (
      <Spinner />
    );
  const enabled = draft ?? policy.data.enabled;
  const dirty = enabled !== policy.data.enabled;
  const error = update.error;
  const errorText =
    error instanceof Error
      ? error.message
      : error && "detail" in error
        ? String(error.detail)
        : "Skill policy could not be saved. Retry when administrator access is available.";
  return (
    <SettingsPane
      title="Skills"
      description="Control whether users can activate their assigned instruction skills in chat. Disabled by default."
    >
      {policy.isError && (
        <QueryError
          error={policy.error}
          message="Could not refresh skill policy. Your selection is kept; retry before saving."
          retry={() => policy.refetch()}
          isRetrying={policy.isFetching}
        />
      )}
      <SettingsSection
        title="Activation"
        description="Disabling blocks execution and follow-ups that use active skills until those skills are removed. Private documents, assignments, and historical snapshots remain saved."
      >
        <FieldGroup>
          <Field orientation="horizontal">
            <Switch
              id="skills-enabled"
              checked={enabled}
              disabled={update.isPending}
              onCheckedChange={(value) => {
                setDraft(value);
                setSaved(false);
                update.reset();
              }}
            />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="skills-enabled">
                Enable skill activation
              </FieldLabel>
              <FieldDescription>
                Users must still own each skill and assign it to their main
                agent. Enabling this policy grants no tools, files, MCP access,
                or delegation.
              </FieldDescription>
            </div>
          </Field>
        </FieldGroup>
      </SettingsSection>
      {update.isError && (
        <p role="alert" className="text-destructive text-sm">
          {errorText}
        </p>
      )}
      <SettingsSaveBar
        dirty={dirty}
        status={saved ? "Skill policy saved." : undefined}
      >
        <Button
          disabled={
            !dirty || update.isPending || policy.isError || policy.isFetching
          }
          onClick={() => update.mutate({ body: { enabled } })}
        >
          {update.isPending ? "Saving…" : "Save skill policy"}
        </Button>
      </SettingsSaveBar>
    </SettingsPane>
  );
}
