"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FormSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/features/auth/components/user-context";
import { YourMemorySection } from "@/features/memory/components/memory-sections";
import { aboutQueryOptions } from "@/features/settings/about-queries";
import {
  SettingsPane,
  SettingsSaveBar,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { YourUsageSection } from "@/features/settings/ui/user-settings/your-usage-section";
import { client } from "@/lib/api";
import type { AboutYou } from "@/lib/client";
import { userAboutUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { errorDetail } from "@/lib/utils";

/** The backend limit, counted in characters (code points). */
export const ABOUT_MAX_CHARACTERS = 16000;

/**
 * Your Asterism: what Asterism knows about you (About you) and your usage
 * against your group's budget. A Memory section can sit beside them later.
 */
export function YourAsterismSettings() {
  const user = useUser();
  return <OwnedSettings key={user.id} userId={user.id} />;
}

function OwnedSettings({ userId }: { userId: string }) {
  const query = useQuery(aboutQueryOptions(userId));
  return (
    <SettingsPane
      title="Your Asterism"
      description="What Asterism knows and remembers about you, and how much you've used it."
    >
      <YourUsageSection />
      {query.isPending && <FormSkeleton label="Loading About you…" />}
      {query.error && (
        <QueryError
          error={query.error}
          message={
            query.data
              ? "Could not refresh About you. Your draft is kept."
              : "Could not load About you."
          }
          retry={query.refetch}
          isRetrying={query.isFetching}
        />
      )}
      {query.data && (
        <AboutYouSection
          latest={query.data}
          reload={async () => {
            const result = await query.refetch();
            return result.isError ? undefined : result.data;
          }}
        />
      )}
      <YourMemorySection />
    </SettingsPane>
  );
}

function AboutYouSection({
  latest,
  reload,
}: {
  latest: AboutYou;
  reload: () => Promise<AboutYou | undefined>;
}) {
  const [saved, setSaved] = useState(latest);
  const [text, setText] = useState(latest.about_md);
  const [reloading, setReloading] = useState(false);
  const save = useMutation({
    ...userAboutUpdateMutation({ client }),
    onSuccess: (next) => {
      setSaved(next);
      setText(next.about_md);
    },
  });
  const characters = Array.from(text).length;
  const tooLong = characters > ABOUT_MAX_CHARACTERS;
  const dirty = text !== saved.about_md;
  // A newer revision was saved elsewhere, such as another tab.
  const stale = latest.revision > saved.revision;
  const busy = save.isPending || reloading;

  async function reloadSaved() {
    setReloading(true);
    try {
      const next = await reload();
      if (next) {
        setSaved(next);
        setText(next.about_md);
        save.reset();
      }
    } finally {
      setReloading(false);
    }
  }

  return (
    <SettingsSection
      title="About you"
      description="Facts about you that help Asterism pitch its answers: who you are, what you're studying or working on, and what you already know. It doesn't give Asterism any tools, files or permissions."
      className="flex-1"
    >
      <form
        className="flex flex-1 flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            body: { about_md: text, expected_revision: saved.revision },
          });
        }}
      >
        {stale && (
          <p role="status" className="text-muted-foreground text-sm">
            A newer version was saved somewhere else. Your draft is kept here;
            reload to see the saved text.
          </p>
        )}
        <FieldGroup>
          <Field data-invalid={tooLong}>
            <FieldLabel htmlFor="about-you-text">
              What should Asterism know about you?
            </FieldLabel>
            <Textarea
              id="about-you-text"
              rows={10}
              maxLength={ABOUT_MAX_CHARACTERS * 2}
              placeholder={
                "I'm a second-year nursing student.\nI know basic chemistry but not organic chemistry.\nEnglish is my second language."
              }
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
              aria-describedby="about-you-help"
              aria-invalid={tooLong}
            />
            <FieldDescription id="about-you-help">
              To change how Asterism responds, use a learning mode in the chat
              or your main agent&apos;s instructions in Agents.{" "}
              {characters.toLocaleString()} /{" "}
              {ABOUT_MAX_CHARACTERS.toLocaleString()} characters.
            </FieldDescription>
          </Field>
        </FieldGroup>
        {tooLong && (
          <p role="alert" className="text-destructive text-sm">
            About you can be at most {ABOUT_MAX_CHARACTERS.toLocaleString()}{" "}
            characters.
          </p>
        )}
        {save.error && (
          <p role="alert" className="text-destructive text-sm">
            Could not save About you:{" "}
            {errorDetail(save.error, "Please try again.")} Your draft is kept;
            reload the saved text to continue.
          </p>
        )}
        <SettingsSaveBar
          dirty={dirty}
          status={saved.about_md ? "Saved" : "Nothing saved yet"}
        >
          {(stale || save.error) && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void reloadSaved()}
            >
              {reloading ? "Reloading…" : "Reload saved text"}
            </Button>
          )}
          <Button type="submit" disabled={busy || !dirty || tooLong || stale}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </SettingsSaveBar>
      </form>
    </SettingsSection>
  );
}
