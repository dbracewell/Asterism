"use client";

import { Loader2 } from "lucide-react";
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
import { signUpWithInvite } from "@/features/auth/server/actions";
import { cn } from "@/lib/utils";

type InviteSignupFormProps = {
  token: string;
  courseName: string;
  educatorName: string;
};

export function InviteSignupForm({
  token,
  courseName,
  educatorName,
}: InviteSignupFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const showError = (message: string) => {
    setError(message);
    // Focus after render, including when the same message repeats.
    queueMicrotask(() => errorRef.current?.focus());
  };

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) {
      showError("Name, email and password are required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await signUpWithInvite({
        token,
        name: name.trim(),
        email: email.trim(),
        password: password.trim(),
      });
      if (!result.ok) {
        showError(result.error);
        return;
      }
      // Hard navigation so the server sees the new session cookie.
      window.location.href = "/classes";
    } catch {
      showError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn(authCardClassName, "my-auto max-w-md shrink-0")}>
      <form
        onSubmit={handleSubmit}
        aria-label="Create your account"
        aria-describedby={error ? "invite-error" : undefined}
      >
        <FieldGroup>
          <AuthHeading
            description={`You're invited to join ${courseName} with ${educatorName}.`}
          />
          {error && (
            <FieldError
              ref={errorRef}
              id="invite-error"
              tabIndex={-1}
              className="rounded-control wrap-anywhere outline-offset-4 focus-visible:outline-2"
            >
              {error}
            </FieldError>
          )}
          <Field>
            <FieldLabel htmlFor="invite-name">Your name</FieldLabel>
            <Input
              id="invite-name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={loading}
            />
            <FieldDescription>
              Your educator sees this name. They can&apos;t see your chats.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={loading}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-password">Password</FieldLabel>
            <Input
              id="invite-password"
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
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create account and join
            </Button>
            <FieldDescription className="text-center">
              This invite works once. Already have an account? Ask your educator
              for the class code instead.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
