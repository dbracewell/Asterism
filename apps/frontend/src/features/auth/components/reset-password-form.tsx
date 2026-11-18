"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  AuthHeading,
  authCardClassName,
} from "@/features/auth/components/setup-steps";
import { ResetPasswordSchema } from "@/features/auth/schemas";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const INVALID_LINK =
  "This reset link can't be used. It may have been used already or expired. Ask your administrator for a new one.";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const showError = (message: string) => {
    setError(message);
    queueMicrotask(() => errorRef.current?.focus());
  };

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = ResetPasswordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({
        newPassword: parsed.data.password,
        token,
      });
      if (result.error) {
        showError(
          result.error.code === "INVALID_TOKEN"
            ? INVALID_LINK
            : (result.error.message ?? "Couldn't set the password."),
        );
        return;
      }
      setDone(true);
    } catch {
      showError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className={cn(authCardClassName, "my-auto max-w-md shrink-0")}>
        <AuthHeading description="Your password is set." />
        <FieldDescription className="text-center text-balance">
          You&apos;re signed out on every device. Sign in with your new
          password.
        </FieldDescription>
        <Button asChild className="w-full">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={cn(authCardClassName, "my-auto max-w-md shrink-0")}>
      <form
        onSubmit={handleSubmit}
        aria-label="Set a new password"
        aria-describedby={error ? "reset-error" : undefined}
      >
        <FieldGroup>
          <AuthHeading description="Choose a new password." />
          {error && (
            <FieldError
              ref={errorRef}
              id="reset-error"
              tabIndex={-1}
              className="rounded-control wrap-anywhere outline-offset-4 focus-visible:outline-2"
            >
              {error}
            </FieldError>
          )}
          <Field>
            <FieldLabel htmlFor="reset-password">New password</FieldLabel>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
            />
            <FieldDescription>
              8 to 32 characters, with upper and lower case letters, a digit and
              one of !@#$%^&amp;*.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="reset-confirm">
              Confirm new password
            </FieldLabel>
            <Input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              disabled={loading}
            />
          </Field>
          <Field>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Set password
            </Button>
            <FieldDescription className="text-center">
              This link works once. Setting a password signs you out everywhere.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
