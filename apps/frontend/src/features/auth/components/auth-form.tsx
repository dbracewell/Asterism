"use client";
import { Loader2 } from "lucide-react";

import Constellation from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { installApp } from "@/features/auth/server/actions";

import { sanitizeRedirectPath } from "../redirect";

interface AuthFormProps extends React.ComponentProps<"div"> {
  view: "login" | "install";
  referer?: string;
}

export { sanitizeRedirectPath };

export function AuthForm({
  className,
  view = "login",
  referer,
  ...props
}: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [adminPassKey, setAdminPassKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: "start" });
    }
  }, [error]);
  const showError = (message: string) => {
    setError(message);
    // Repeated identical validation failures still return focus to the summary.
    errorRef.current?.focus();
    errorRef.current?.scrollIntoView({ block: "start" });
  };
  const safeRedirect = sanitizeRedirectPath(referer);

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      showError("Email and password required");
      return;
    }
    if (view === "install" && (!name.trim() || !adminPassKey.trim())) {
      showError("Name and Admin Passkey required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (view === "login") {
        await authClient.signIn.email(
          {
            email: email.trim(),
            password: password.trim(),
            callbackURL: safeRedirect,
          },
          {
            onRequest: () => setLoading(true),
            onSuccess: () => {
              toast.success("Signed in successfully");
              // Hard navigation to ensure server receives the new cookie
              window.location.href = safeRedirect;
            },
            onError: (ctx) => showError(ctx.error.message || "Failed to login"),
          },
        );
      } else {
        try {
          await installApp({
            email: email.trim(),
            password: password.trim(),
            name: name.trim(),
            adminKey: adminPassKey.trim(),
          });
          toast.success("Instance setup complete");
          window.location.href = safeRedirect;
        } catch (error) {
          if (error instanceof Error) {
            showError(error.message || "Failed to install");
          } else {
            showError("Failed to install");
          }
        }
      }
    } catch {
      showError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={cn(
        "bg-card text-card-foreground rounded-overlay shadow-overlay flex w-full min-w-0 flex-col gap-6 border p-5 sm:p-8",
        view === "install" ? "max-w-lg" : "max-w-md",
        className,
      )}
      {...props}
    >
      <form
        onSubmit={handleSubmit}
        aria-label={view === "install" ? "Administrator setup" : "Sign in"}
        aria-describedby={error ? "auth-error" : undefined}
      >
        <FieldGroup>
          <div className="flex min-w-0 flex-col items-center gap-3 text-center">
            <Constellation
              className="text-primary"
              fill="currentColor"
              size={56}
              strokeWidth={10}
            />
            <h1 className="text-title tracking-[0.18em] uppercase">Asterism</h1>
            <FieldDescription className="text-balance">
              {view === "install"
                ? "Set up your Asterism instance"
                : "Where will your curiosity lead you today?"}
            </FieldDescription>
          </div>
          {view === "install" && <SetupSteps />}
          {error && (
            <FieldError
              ref={errorRef}
              id="auth-error"
              tabIndex={-1}
              className="rounded-control scroll-mt-6 wrap-anywhere outline-offset-4 focus-visible:outline-2"
            >
              {error}
            </FieldError>
          )}
          {view === "install" && (
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="m@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              placeholder="*********"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </Field>
          {view === "install" && (
            <Field>
              <FieldLabel htmlFor="adminPasskey">Admin Passkey</FieldLabel>
              <Input
                id="adminPasskey"
                type="password"
                placeholder="*********"
                value={adminPassKey}
                onChange={(e) => setAdminPassKey(e.target.value)}
              />
            </Field>
          )}
          <Field>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {view === "login" ? "Login" : "Sign up"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}

const SETUP_STEPS = [
  {
    title: "Create the administrator account",
    detail: "This account manages providers, tools and users.",
  },
  {
    title: "Add a model provider",
    detail: "Connect a provider and enable a model in Admin settings.",
  },
  {
    title: "Start your first chat",
    detail: "Ask anything from the new-chat page.",
  },
];

/** First-run checklist; the administrator account is the current step. */
function SetupSteps() {
  return (
    <ol
      aria-label="First-run setup"
      className="rounded-surface bg-muted/50 flex min-w-0 flex-col gap-3 p-4 text-left"
    >
      {SETUP_STEPS.map((step, index) => (
        <li
          key={step.title}
          aria-current={index === 0 ? "step" : undefined}
          className="flex min-w-0 gap-3"
        >
          <span
            aria-hidden="true"
            className={cn(
              "rounded-dot text-meta flex size-6 shrink-0 items-center justify-center font-semibold",
              index === 0
                ? "bg-primary text-primary-foreground"
                : "border-border text-muted-foreground border",
            )}
          >
            {index + 1}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 wrap-anywhere">
            <span className="text-body font-medium">
              <span className="sr-only">Step {index + 1}: </span>
              {step.title}
              {index === 0 && <span className="sr-only"> (current)</span>}
            </span>
            <span className="text-meta text-muted-foreground">
              {step.detail}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
