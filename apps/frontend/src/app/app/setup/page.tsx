"use client";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export default function SetupPage() {
  const router = useRouter();
  const [setupToken, setSetupToken] = useState("");
  const [requiresSetup, setRequiresSetup] = useState<boolean | null>(null);
  const [isCurrentUserAdmin, setIsCurrentUserAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadStatus = async () => {
      const { data, error } = await api.getSetupStatus();
      if (error || !data) {
        setError("Failed to load setup status");
        setRequiresSetup(false);
        return;
      }

      setRequiresSetup(data.requires_setup);
      setIsCurrentUserAdmin(data.is_current_user_admin);
    };

    loadStatus();
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { data, error } = await api.bootstrapAdmin({
      body: { setup_token: setupToken },
    });

    if (error || !data) {
      const errorDetail =
        typeof error?.detail === "string"
          ? error.detail
          : "Failed to bootstrap admin";
      setError(errorDetail);
      setIsSubmitting(false);
      return;
    }

    router.replace("/app");
    router.refresh();
  };

  if (requiresSetup === null) {
    return <div className="p-6 text-sm">Checking setup status...</div>;
  }

  if (!requiresSetup) {
    return (
      <div className="p-6">
        <h2 className="mb-2 text-lg font-semibold">Setup already completed</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          An admin user is already configured for this instance.
        </p>
        {isCurrentUserAdmin ? (
          <p className="text-sm">You are an admin.</p>
        ) : (
          <p className="text-sm">Your user is not an admin.</p>
        )}
        <Link href="/app" className="text-sm underline">
          Return to app
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl p-6">
      <h2 className="mb-2 text-lg font-semibold">Initial admin setup</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        This instance has no admin yet. Enter the bootstrap setup token provided
        by your operator to promote your signed-in account to admin.
      </p>

      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="setup-token">Setup token</FieldLabel>
            <Input
              id="setup-token"
              type="password"
              autoComplete="off"
              value={setupToken}
              onChange={(event) => setSetupToken(event.target.value)}
              required
            />
          </Field>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <Field>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Applying..." : "Become admin"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
