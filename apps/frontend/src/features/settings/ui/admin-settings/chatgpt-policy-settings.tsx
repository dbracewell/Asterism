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
  chatgptPolicyGetOptions,
  chatgptPolicyGetQueryKey,
  chatgptPolicyUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function ChatGptPolicySettings() {
  const user = useUser();
  return user.role === "admin" ? (
    <ChatGptPolicyForm key={user.id} />
  ) : (
    <p role="alert">
      Administrator access is required to manage ChatGPT plan connections.
    </p>
  );
}

function ChatGptPolicyForm() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    ...chatgptPolicyGetOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const [draft, setDraft] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    ...chatgptPolicyUpdateMutation({ client }),
    onSuccess(data) {
      queryClient.setQueryData(chatgptPolicyGetQueryKey({ client }), data);
      setDraft(null);
      setSaved(true);
    },
  });
  if (!policy.data)
    return policy.isError ? (
      <QueryError
        error={policy.error}
        message="ChatGPT plan policy could not be loaded."
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
        : "ChatGPT plan policy could not be saved. Retry when administrator access is available.";
  return (
    <SettingsPane
      title="ChatGPT plans"
      description="Control whether users can connect their own ChatGPT plan and run chats on it. Disabled by default."
    >
      {policy.isError && (
        <QueryError
          error={policy.error}
          message="Could not refresh the ChatGPT plan policy. Your selection is kept; retry before saving."
          retry={() => policy.refetch()}
          isRetrying={policy.isFetching}
        />
      )}
      <SettingsSection
        title="Plan connections"
        description="Disabling makes plan models unavailable and blocks new connections. Existing connections, chats and sub-agent bindings are kept and are never moved to another model."
      >
        <FieldGroup>
          <Field orientation="horizontal">
            <Switch
              id="chatgpt-plan-enabled"
              checked={enabled}
              disabled={update.isPending}
              onCheckedChange={(value) => {
                setDraft(value);
                setSaved(false);
                update.reset();
              }}
            />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="chatgpt-plan-enabled">
                Allow ChatGPT plan connections
              </FieldLabel>
              <FieldDescription>
                Each user signs in with their own ChatGPT account. Plan usage
                runs only on that user&apos;s connection and never falls back to
                another billing source. Sign-in requires the browser to run on
                the Asterism machine.
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
        status={saved ? "ChatGPT plan policy saved." : undefined}
      >
        <Button
          disabled={
            !dirty || update.isPending || policy.isError || policy.isFetching
          }
          onClick={() => update.mutate({ body: { enabled } })}
        >
          {update.isPending ? "Saving…" : "Save ChatGPT plan policy"}
        </Button>
      </SettingsSaveBar>
    </SettingsPane>
  );
}
