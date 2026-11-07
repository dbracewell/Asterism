"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/api";
import type { SettingsImportSummary } from "@/lib/client";
import {
  appSettingsImportMutation,
  appSettingsImportPreviewMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useId, useState } from "react";

// Mirrors the server's file limit (ADR-0052).
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function errorDetail(error: unknown, fallback: string) {
  return error &&
    typeof error === "object" &&
    "detail" in error &&
    typeof error.detail === "string"
    ? error.detail
    : fallback;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function Preview({ summary }: { summary: SettingsImportSummary }) {
  return (
    <section aria-label="Changes" className="grid gap-3 text-sm">
      <p>
        Exported{" "}
        {new Date(summary.exported_at * 1000).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
        .
      </p>
      {summary.providers.length > 0 && (
        <div className="grid gap-1">
          <p className="font-medium">Providers</p>
          <ul className="list-disc pl-5">
            {summary.providers.map((provider) => (
              <li key={provider.name} className="wrap-anywhere">
                {provider.action === "add" ? "Add" : "Update"} {provider.name} (
                {plural(provider.models_added, "new model")},{" "}
                {plural(provider.models_updated, "updated model")})
                {provider.action === "update" && ", replacing its API key"}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-1">
        <p className="font-medium">Settings</p>
        {summary.changed_settings.length > 0 ? (
          <ul className="list-disc pl-5">
            {summary.changed_settings.map((setting) => (
              <li key={setting}>{setting}</li>
            ))}
          </ul>
        ) : (
          <p>No settings change.</p>
        )}
      </div>
      {summary.kept_providers.length > 0 && (
        <p className="wrap-anywhere">
          Staying as they are: {summary.kept_providers.join(", ")}.
        </p>
      )}
    </section>
  );
}

/**
 * Imports a settings file (US-63.2): open it with the passphrase, see what will
 * change, then confirm. Nothing changes before confirmation.
 */
export function ImportSettings({ onImported }: { onImported?: () => void }) {
  const prefix = useId();
  const [source, setSource] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [fileError, setFileError] = useState("");
  const [done, setDone] = useState(false);
  const preview = useMutation({
    ...appSettingsImportPreviewMutation({ client }),
    meta: { skipGlobalInvalidation: true },
  });
  const importSettings = useMutation({
    ...appSettingsImportMutation({ client }),
    onSuccess: () => {
      setSource("");
      setPassphrase("");
      setDone(true);
      preview.reset();
      onImported?.();
    },
  });

  const restart = () => {
    preview.reset();
    importSettings.reset();
    setDone(false);
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    restart();
    setFileError("");
    setSource("");
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError("This file is larger than the 8 MiB limit.");
      return;
    }
    setSource(await file.text());
  };

  const open = (event: FormEvent) => {
    event.preventDefault();
    preview.mutate({ body: { source, passphrase } });
  };

  return (
    <form className="grid max-w-xl gap-4" onSubmit={open}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${prefix}-file`}>Settings file</FieldLabel>
          <Input
            id={`${prefix}-file`}
            type="file"
            accept=".json,application/json"
            onChange={chooseFile}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-passphrase`}>
            File passphrase
          </FieldLabel>
          <Input
            id={`${prefix}-passphrase`}
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(event) => {
              restart();
              setPassphrase(event.target.value);
            }}
          />
        </Field>
      </FieldGroup>
      {fileError && (
        <p role="alert" className="text-destructive text-sm">
          {fileError}
        </p>
      )}
      {preview.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(preview.error, "Could not open this file.")}
        </p>
      )}
      {!preview.data && (
        <div>
          <Button
            type="submit"
            variant="outline"
            disabled={!source || !passphrase || preview.isPending}
          >
            {preview.isPending ? "Opening..." : "Preview import"}
          </Button>
        </div>
      )}
      {preview.data && (
        <>
          <Preview summary={preview.data} />
          {importSettings.error && (
            <p role="alert" className="text-destructive text-sm">
              {errorDetail(
                importSettings.error,
                "Could not import. Nothing was changed.",
              )}
            </p>
          )}
          <div>
            <Button
              type="button"
              disabled={importSettings.isPending}
              onClick={() =>
                importSettings.mutate({ body: { source, passphrase } })
              }
            >
              {importSettings.isPending ? "Importing..." : "Import settings"}
            </Button>
          </div>
        </>
      )}
      {done && (
        <p role="status" className="text-sm">
          Settings imported.
        </p>
      )}
    </form>
  );
}
