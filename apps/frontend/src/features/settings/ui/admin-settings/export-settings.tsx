"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/api";
import type { SettingsEnvelope } from "@/lib/client";
import { appSettingsExportMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";

// Mirrors the server's passphrase limit (ADR-0052).
const MIN_PASSPHRASE_LENGTH = 12;

function downloadSettings(file: SettingsEnvelope) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `asterism-settings-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Exports every application setting to a passphrase-encrypted file (US-63.1). */
export const ExportSettings = () => {
  const prefix = useId();
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saved, setSaved] = useState(false);
  const exportSettings = useMutation({
    ...appSettingsExportMutation({ client }),
    meta: { skipGlobalInvalidation: true },
    onSuccess: (file) => {
      downloadSettings(file);
      setPassphrase("");
      setConfirmation("");
      setSaved(true);
    },
  });
  const tooShort = passphrase.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = confirmation.length > 0 && confirmation !== passphrase;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    exportSettings.mutate({ body: { passphrase } });
  };

  return (
    <form className="grid max-w-xl gap-4" onSubmit={submit}>
      <div className="grid gap-2 text-sm">
        <p>
          Save every application setting to one file, including providers,
          models, tools and policies. Users, chats and files are not included.
        </p>
        <p role="note" className="bg-muted rounded-surface p-3">
          The file contains your provider and search API keys, encrypted with
          this passphrase. Choose one you don&apos;t use elsewhere and keep it
          safe: without it, the file can&apos;t be opened, and nobody can
          recover it.
        </p>
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${prefix}-passphrase`}>Passphrase</FieldLabel>
          <Input
            id={`${prefix}-passphrase`}
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <p className="text-muted-foreground text-sm">
            At least {MIN_PASSPHRASE_LENGTH} characters.
          </p>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-confirmation`}>
            Confirm passphrase
          </FieldLabel>
          <Input
            id={`${prefix}-confirmation`}
            type="password"
            autoComplete="new-password"
            aria-invalid={mismatch}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {mismatch && (
            <p role="alert" className="text-destructive text-sm">
              The passphrases don&apos;t match.
            </p>
          )}
        </Field>
      </FieldGroup>
      {exportSettings.error && (
        <p role="alert" className="text-destructive text-sm">
          Could not export settings. Reload and retry.
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm">
          Settings exported. Check your downloads.
        </p>
      )}
      <div>
        <Button
          type="submit"
          disabled={
            tooShort || confirmation !== passphrase || exportSettings.isPending
          }
        >
          {exportSettings.isPending ? "Exporting..." : "Export settings"}
        </Button>
      </div>
    </form>
  );
};
