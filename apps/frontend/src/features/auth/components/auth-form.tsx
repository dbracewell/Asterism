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

interface AuthFormProps extends React.ComponentProps<"div"> {
  view: "login" | "install";
  referer?: string;
}

export function sanitizeRedirectPath(referer?: string): string {
  if (!referer) return "/";
  const trimmed = referer.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    trimmed.startsWith("/sign-in")
  ) {
    return "/";
  }
  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (
      parsed.origin !== "http://localhost" ||
      parsed.pathname === "/sign-in" ||
      parsed.pathname.startsWith("/sign-in/")
    ) {
      return "/";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

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
      showError("Email and Password Required");
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
      className={cn("flex w-full max-w-lg min-w-0 flex-col gap-6", className)}
      {...props}
    >
      <form
        onSubmit={handleSubmit}
        aria-label={view === "install" ? "Administrator setup" : "Sign in"}
        aria-describedby={error ? "auth-error" : undefined}
      >
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex items-center justify-center gap-1">
              <Constellation size={50} />
              <h1 className="font-monsterrat text-xl font-bold">ASTERISM</h1>
            </div>

            <FieldDescription>
              {view === "install" && <>Setup your ASTERISM instance </>}
            </FieldDescription>
          </div>
          {error && (
            <FieldError
              ref={errorRef}
              id="auth-error"
              tabIndex={-1}
              className="scroll-mt-6 rounded-md wrap-anywhere outline-offset-4 focus-visible:outline-2"
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
