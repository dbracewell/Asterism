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
import { errorMessage } from "@/lib/utils";
import {
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";

type BooleanPolicy = { enabled?: boolean };

export type BooleanAdminPolicyProps<
  TPolicy extends BooleanPolicy,
  TQueryError,
  TUpdateError,
  TKey extends QueryKey,
> = {
  /** The generated GET query options for the policy. */
  policyOptions: UseQueryOptions<TPolicy, TQueryError, TPolicy, TKey> & {
    queryKey: TKey;
  };
  /** The generated PUT mutation options for the policy. */
  updateOptions: UseMutationOptions<
    TPolicy,
    TUpdateError,
    { body: { enabled: boolean } }
  >;
  /** Lowercase except proper nouns, e.g. "canvas policy". */
  policyName: string;
  accessRequired: string;
  title: string;
  description: string;
  sectionTitle: string;
  sectionDescription: string;
  switchLabel: string;
  switchDescription: ReactNode;
};

const sentence = (text: string) => text[0].toUpperCase() + text.slice(1);

/** An admin settings pane with one on/off policy switch and a save bar. */
export function BooleanAdminPolicySettings<
  TPolicy extends BooleanPolicy,
  TQueryError,
  TUpdateError,
  TKey extends QueryKey,
>(props: BooleanAdminPolicyProps<TPolicy, TQueryError, TUpdateError, TKey>) {
  const user = useUser();
  return user.role === "admin" ? (
    <BooleanAdminPolicyForm key={user.id} {...props} />
  ) : (
    <p role="alert">{props.accessRequired}</p>
  );
}

function BooleanAdminPolicyForm<
  TPolicy extends BooleanPolicy,
  TQueryError,
  TUpdateError,
  TKey extends QueryKey,
>({
  policyOptions,
  updateOptions,
  policyName,
  title,
  description,
  sectionTitle,
  sectionDescription,
  switchLabel,
  switchDescription,
}: BooleanAdminPolicyProps<TPolicy, TQueryError, TUpdateError, TKey>) {
  const switchId = useId();
  const queryClient = useQueryClient();
  const policy = useQuery({ ...policyOptions, staleTime: 0, retry: false });
  const [draft, setDraft] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    ...updateOptions,
    onSuccess(data) {
      queryClient.setQueryData<TPolicy>(policyOptions.queryKey, data);
      setDraft(null);
      setSaved(true);
    },
  });
  const name = sentence(policyName);
  if (!policy.data)
    return policy.isError ? (
      <QueryError
        error={policy.error}
        message={`${name} could not be loaded.`}
        retry={() => policy.refetch()}
        isRetrying={policy.isFetching}
      />
    ) : (
      <Spinner />
    );
  const savedEnabled = policy.data.enabled ?? false;
  const enabled = draft ?? savedEnabled;
  const dirty = enabled !== savedEnabled;
  return (
    <SettingsPane title={title} description={description}>
      {policy.isError && (
        <QueryError
          error={policy.error}
          message={`Could not refresh the ${policyName}. Your selection is kept; retry before saving.`}
          retry={() => policy.refetch()}
          isRetrying={policy.isFetching}
        />
      )}
      <SettingsSection title={sectionTitle} description={sectionDescription}>
        <FieldGroup>
          <Field orientation="horizontal">
            <Switch
              id={switchId}
              checked={enabled}
              disabled={update.isPending}
              onCheckedChange={(value) => {
                setDraft(value);
                setSaved(false);
                update.reset();
              }}
            />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={switchId}>{switchLabel}</FieldLabel>
              <FieldDescription>{switchDescription}</FieldDescription>
            </div>
          </Field>
        </FieldGroup>
      </SettingsSection>
      {update.isError && (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage(
            update.error,
            `${name} could not be saved. Retry when administrator access is available.`,
          )}
        </p>
      )}
      <SettingsSaveBar
        dirty={dirty}
        status={saved ? `${name} saved.` : undefined}
      >
        <Button
          disabled={
            !dirty || update.isPending || policy.isError || policy.isFetching
          }
          onClick={() => update.mutate({ body: { enabled } })}
        >
          {update.isPending ? "Saving…" : `Save ${policyName}`}
        </Button>
      </SettingsSaveBar>
    </SettingsPane>
  );
}
