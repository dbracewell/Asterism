"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client } from "@/lib/api";
import type { ChatInfo, PersonaCollection } from "@/lib/client";
import {
  chatPersonaUpdateMutation,
  chatSessionGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useUser } from "@/features/auth/components/user-context";
import { personaQueryOptions } from "@/features/settings/persona-queries";
import { useMutation, useQuery } from "@tanstack/react-query";

export function personaAvailable(
  collection: PersonaCollection | undefined,
  value: string | null,
) {
  return !!collection?.profiles.some(
    (profile) => profile.id === (value ?? collection.default_persona_id),
  );
}

export function ChatPersonaPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const user = useUser();
  const query = useQuery(personaQueryOptions(user.id));
  const current = query.data?.profiles.find((profile) => profile.id === value);
  const defaultName = query.data?.profiles.find(
    (profile) => profile.id === query.data?.default_persona_id,
  )?.name;
  return (
    <>
      <Select
        value={value ?? "default"}
        onValueChange={(next) => onChange(next === "default" ? null : next)}
        disabled={disabled || !query.data}
      >
        <SelectTrigger
          aria-label="Chat persona"
          aria-invalid={!!query.data && !personaAvailable(query.data, value)}
          className="max-w-full min-w-0"
        >
          <SelectValue placeholder="Choose persona" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="default" disabled={!defaultName}>
              Use my default{defaultName ? ` (${defaultName})` : ""}
            </SelectItem>
            {value && !current && (
              <SelectItem value={value} disabled>
                {query.isPending
                  ? "Loading persona…"
                  : query.data
                    ? "Unavailable persona"
                    : "Saved persona"}
              </SelectItem>
            )}
            {query.data?.profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {query.isPending && (
        <p role="status" className="sr-only">
          Loading personas…
        </p>
      )}
      {query.error && (
        <p
          role="alert"
          className="text-destructive order-last w-full basis-full px-2 text-xs"
        >
          {query.data
            ? "Could not refresh personas. Showing cached choices."
            : "Could not load personas."}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry personas
          </Button>
        </p>
      )}
      {query.data && !personaAvailable(query.data, value) && (
        <p
          role="alert"
          className="text-destructive order-last w-full basis-full px-2 text-xs"
        >
          Selected persona is unavailable. Choose an available persona.
        </p>
      )}
    </>
  );
}

export function ExistingChatPersonaPicker({
  info,
  disabled,
  onSelected,
  onPendingChange,
}: {
  info: ChatInfo;
  disabled: boolean;
  onSelected: (info: ChatInfo) => void;
  onPendingChange: (busy: boolean) => void;
}) {
  const current = useQuery({
    ...chatSessionGetOneOptions({ client, path: { chat_id: info.id } }),
    enabled: false,
    retry: false,
  });
  const mutation = useMutation({
    ...chatPersonaUpdateMutation({ client }),
    onMutate: () => onPendingChange(true),
    onSettled: () => onPendingChange(false),
    onSuccess: onSelected,
  });
  return (
    <>
      <ChatPersonaPicker
        value={info.persona_id ?? null}
        disabled={disabled || mutation.isPending || !!mutation.error}
        onChange={(personaId) =>
          mutation.mutate({
            path: { chat_id: info.id },
            body: {
              persona_id: personaId,
              expected_persona_revision: info.persona_revision ?? 1,
            },
          })
        }
      />
      {mutation.error && (
        <p
          role="alert"
          className="text-destructive order-last w-full basis-full px-2 text-xs"
        >
          Could not change persona. Reload the chat and retry when generation is
          idle.
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={current.isFetching}
            onClick={() => {
              void current.refetch({ cancelRefetch: false }).then((result) => {
                if (result.data && !result.isError) {
                  onSelected(result.data.info);
                  mutation.reset();
                }
              });
            }}
          >
            Reload current persona
          </Button>
        </p>
      )}
    </>
  );
}
