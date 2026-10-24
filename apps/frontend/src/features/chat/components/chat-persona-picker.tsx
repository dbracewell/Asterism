"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/hint";
import { useUser } from "@/features/auth/components/user-context";
import { personaQueryOptions } from "@/features/settings/persona-queries";
import { client } from "@/lib/api";
import type { ChatInfo, PersonaCollection } from "@/lib/client";
import {
  chatPersonaUpdateMutation,
  chatSessionGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { IconUserHeart } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";

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
  const defaultId = query.data?.profiles.find(
    (profile) => profile.id === query.data?.default_persona_id,
  )?.id;
  return (
    <>
      <DropdownMenu>
        <Hint asChild hint="User Persona">
          <DropdownMenuTrigger value={value ?? defaultId ?? "default"}>
            <IconUserHeart className="text-muted-foreground size-5" />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            {query.data?.profiles.map((profile) => (
              <DropdownMenuItem
                key={profile.id}
                className="flex items-center justify-between"
              >
                {profile.name}{" "}
                {(value === profile.id ||
                  (value == null && profile.is_default)) && <CheckIcon />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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
