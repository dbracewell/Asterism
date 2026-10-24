"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { PersonaCollection, PersonaProfile } from "@/lib/client";
import {
  userPersonaCreateMutation,
  userPersonaDeleteMutation,
  userPersonaSetDefaultMutation,
  userPersonaUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useUser } from "@/features/auth/components/user-context";
import { personaQueryOptions } from "@/features/settings/persona-queries";

function Failure({ title, error }: { title: string; error: unknown }) {
  const detail =
    error &&
    typeof error === "object" &&
    "detail" in error &&
    typeof error.detail === "string"
      ? error.detail
      : "Please retry after checking your changes.";
  return (
    <p role="alert" className="text-destructive text-sm">
      {title}: {detail}
    </p>
  );
}

export function PersonaSettings() {
  const user = useUser();
  return <OwnedPersonaSettings key={user.id} userId={user.id} />;
}

function OwnedPersonaSettings({ userId }: { userId: string }) {
  const query = useQuery(personaQueryOptions(userId));
  const newNameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<PersonaProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const focusCreation = useRef(false);
  useEffect(() => {
    if (
      focusCreation.current &&
      !busy &&
      editing === null &&
      newNameInput.current &&
      !newNameInput.current.disabled
    ) {
      focusCreation.current = false;
      newNameInput.current?.focus();
    }
  }, [busy, editing, query.data?.profiles.length]);
  const create = useMutation({
    ...userPersonaCreateMutation({ client }),
    onSuccess: (profile) => {
      setEditing(profile);
      setName("");
    },
  });
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-base font-bold">Personas</h1>
        <p className="text-muted-foreground text-sm">
          A persona holds your background and response preferences in USER.md.
          It does not change tools, files, permissions or memory.
        </p>
      </div>
      {query.isPending && <p role="status">Loading personas…</p>}
      {query.error && (
        <QueryError
          error={query.error}
          message={
            query.data
              ? "Could not refresh personas. Your draft is retained."
              : "Could not load personas."
          }
          retry={query.refetch}
          isRetrying={query.isFetching}
        />
      )}
      {query.data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Your personas</CardTitle>
              <CardDescription>
                Use your default for new messages, or choose a fixed persona in
                a chat. You can keep up to 20 personas.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap gap-2" aria-label="Your personas">
                {query.data.profiles.map((profile) => (
                  <Button
                    key={profile.id}
                    aria-label={`Edit persona ${profile.name}`}
                    variant={
                      editing?.id === profile.id ? "secondary" : "outline"
                    }
                    className="h-auto max-w-full whitespace-normal"
                    disabled={busy || create.isPending}
                    onClick={() => setEditing(profile)}
                  >
                    <span className="min-w-0 wrap-anywhere">
                      {profile.name}
                    </span>
                    {profile.is_default && (
                      <Badge variant="secondary">Default</Badge>
                    )}
                  </Button>
                ))}
              </div>
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  create.mutate({ body: { name: name.trim(), user_md: "" } });
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="new-persona-name">
                      New persona name
                    </FieldLabel>
                    <Input
                      id="new-persona-name"
                      ref={newNameInput}
                      maxLength={80}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      disabled={
                        busy ||
                        create.isPending ||
                        query.data.profiles.length >= 20
                      }
                    />
                  </Field>
                </FieldGroup>
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      create.isPending ||
                      !name.trim() ||
                      query.data.profiles.length >= 20
                    }
                  >
                    {create.isPending ? "Creating…" : "Create persona"}
                  </Button>
                </div>
              </form>
              {create.error && (
                <Failure
                  title="Could not create persona"
                  error={create.error}
                />
              )}
            </CardContent>
          </Card>
          {editing && (
            <PersonaEditor
              key={editing.id}
              profile={editing}
              collection={query.data}
              refreshing={query.isFetching}
              disabled={create.isPending}
              onBusy={setBusy}
              onDeleted={() => {
                focusCreation.current = true;
                setEditing(null);
              }}
              reload={async () => {
                const result = await query.refetch();
                if (result.isError) return undefined;
                return result.data?.profiles.find(
                  (profile) => profile.id === editing.id,
                );
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function PersonaEditor({
  profile,
  collection,
  refreshing,
  disabled,
  onBusy,
  onDeleted,
  reload,
}: {
  profile: PersonaProfile;
  collection: PersonaCollection;
  refreshing: boolean;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onDeleted: () => void;
  reload: () => Promise<PersonaProfile | undefined>;
}) {
  const [saved, setSaved] = useState(profile);
  const [name, setName] = useState(profile.name);
  const [userMd, setUserMd] = useState(profile.user_md);
  const [reloading, setReloading] = useState(false);
  const current = collection.profiles.find((item) => item.id === profile.id);
  const available = !!current || refreshing;
  const dirty = name !== saved.name || userMd !== saved.user_md;
  const stale = !!current && current.revision > saved.revision;
  const isDefault = collection.default_persona_id === profile.id;
  const characters = Array.from(userMd).length;
  const confirmation = useConfirmationDialog({
    title: "Delete persona?",
    description:
      "This removes the persona. Existing messages keep their recorded instructions. Waiting responses may need regeneration. Switch chats that select this persona and choose another default first.",
    confirmVariant: "destructive",
    confirmText: "Delete persona",
  });
  const lifecycle = {
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
  };
  const save = useMutation({
    ...userPersonaUpdateMutation({ client }),
    ...lifecycle,
    onSuccess: (next) => {
      setSaved(next);
      setName(next.name);
      setUserMd(next.user_md);
    },
  });
  const makeDefault = useMutation({
    ...userPersonaSetDefaultMutation({ client }),
    ...lifecycle,
  });
  const remove = useMutation({
    ...userPersonaDeleteMutation({ client }),
    ...lifecycle,
    onSuccess: onDeleted,
  });
  const busy =
    save.isPending ||
    makeDefault.isPending ||
    remove.isPending ||
    reloading ||
    disabled;
  const error = save.error || makeDefault.error || remove.error;
  async function reloadSaved() {
    setReloading(true);
    try {
      const latest = await reload();
      if (latest) {
        setSaved(latest);
        setName(latest.name);
        setUserMd(latest.user_md);
        save.reset();
        makeDefault.reset();
        remove.reset();
      }
    } finally {
      setReloading(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit persona</CardTitle>
        <CardDescription>
          Changes apply to new messages. A response already waiting or running
          keeps the instructions it started with.
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            path: { persona_id: profile.id },
            body: {
              name: name.trim(),
              user_md: userMd,
              expected_revision: saved.revision,
            },
          });
        }}
      >
        <CardContent className="flex flex-col gap-4">
          {!available && (
            <p role="alert" className="text-destructive text-sm">
              Persona unavailable: Your draft is retained here. Choose another
              persona to continue.
            </p>
          )}
          {stale && (
            <p role="status" className="text-muted-foreground text-sm">
              Persona changed: A newer version is saved. Your draft is retained;
              reload the saved persona before making it your default.
            </p>
          )}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="persona-name">Persona name</FieldLabel>
              <Input
                id="persona-name"
                autoFocus
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </Field>
            <Field data-invalid={characters > 16000}>
              <FieldLabel htmlFor="persona-user-md">
                USER.md instructions
              </FieldLabel>
              <Textarea
                id="persona-user-md"
                rows={10}
                maxLength={32000}
                className="font-mono"
                value={userMd}
                onChange={(event) => setUserMd(event.target.value)}
                disabled={busy}
                aria-describedby="persona-document-help"
                aria-invalid={characters > 16000}
              />
              <FieldDescription id="persona-document-help">
                Write your background and response preferences.{" "}
                {characters.toLocaleString()} / 16,000 characters.
              </FieldDescription>
            </Field>
          </FieldGroup>
          {characters > 16000 && (
            <p role="alert">USER.md must contain at most 16,000 characters.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {isDefault ? (
              <Badge>Default persona</Badge>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={busy || dirty || stale || !available || !!save.error}
                onClick={() =>
                  makeDefault.mutate({
                    body: {
                      persona_id: profile.id,
                      expected_default_revision: collection.default_revision,
                    },
                  })
                }
              >
                {makeDefault.isPending ? "Updating default…" : "Make default"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void reloadSaved()}
            >
              {reloading ? "Reloading…" : "Reload saved persona"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || isDefault || !available}
              onClick={async () => {
                if (await confirmation.confirm())
                  remove.mutate({
                    path: { persona_id: profile.id },
                    query: { expected_revision: saved.revision },
                  });
              }}
            >
              Delete persona
            </Button>
          </div>
          {dirty && !isDefault && (
            <p className="text-muted-foreground text-sm">
              Save your changes before making this persona the default.
            </p>
          )}
          {error && <Failure title="Could not update persona" error={error} />}
          <p className="text-muted-foreground text-sm" role="status">
            Saved revision {saved.revision}
          </p>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="submit"
            disabled={
              busy || !available || !dirty || !name.trim() || characters > 16000
            }
          >
            {save.isPending ? "Saving…" : "Save persona"}
          </Button>
        </CardFooter>
      </form>
      {confirmation.dialog}
    </Card>
  );
}
