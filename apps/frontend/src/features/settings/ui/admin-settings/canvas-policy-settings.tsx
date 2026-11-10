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
  canvasPolicyGetOptions,
  canvasPolicyGetQueryKey,
  canvasPolicyUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function CanvasPolicySettings() {
  const user = useUser();
  return user.role === "admin" ? (
    <CanvasPolicyForm key={user.id} />
  ) : (
    <p role="alert">Administrator access is required to manage the canvas.</p>
  );
}

function CanvasPolicyForm() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    ...canvasPolicyGetOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const [draft, setDraft] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    ...canvasPolicyUpdateMutation({ client }),
    onSuccess(data) {
      queryClient.setQueryData(canvasPolicyGetQueryKey({ client }), data);
      setDraft(null);
      setSaved(true);
    },
  });
  if (!policy.data)
    return policy.isError ? (
      <QueryError
        error={policy.error}
        message="Canvas policy could not be loaded."
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
        : "Canvas policy could not be saved. Retry when administrator access is available.";
  return (
    <SettingsPane
      title="Canvas"
      description="Control whether the main agent can write documents, code and web pages in a canvas beside the chat. Disabled by default."
    >
      {policy.isError && (
        <QueryError
          error={policy.error}
          message="Could not refresh canvas policy. Your selection is kept; retry before saving."
          retry={() => policy.refetch()}
          isRetrying={policy.isFetching}
        />
      )}
      <SettingsSection
        title="Availability"
        description="Turning the canvas off stops agent and user writes immediately, even during a run. Existing canvas items stay readable and downloadable."
      >
        <FieldGroup>
          <Field orientation="horizontal">
            <Switch
              id="canvas-enabled"
              checked={enabled}
              disabled={update.isPending}
              onCheckedChange={(value) => {
                setDraft(value);
                setSaved(false);
                update.reset();
              }}
            />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="canvas-enabled">Enable canvas</FieldLabel>
              <FieldDescription>
                Each user must also turn the canvas on in their own settings,
                and the chat&apos;s model must support tools. Canvas content
                grants no tools, files or delegation.
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
        status={saved ? "Canvas policy saved." : undefined}
      >
        <Button
          disabled={
            !dirty || update.isPending || policy.isError || policy.isFetching
          }
          onClick={() => update.mutate({ body: { enabled } })}
        >
          {update.isPending ? "Saving…" : "Save canvas policy"}
        </Button>
      </SettingsSaveBar>
    </SettingsPane>
  );
}
