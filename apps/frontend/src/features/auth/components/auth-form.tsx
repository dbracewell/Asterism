"use client";
import { Loader2 } from "lucide-react";

import Constellation from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

interface AuthFormProps extends React.ComponentProps<"div"> {
  view: "login" | "install";
  referer?: string;
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
  const safeRedirect = referer && !referer.includes("sign-in") ? referer : "/";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Email and Password Required");
      return;
    }
    if (view === "install" && (!name.trim() || !adminPassKey.trim())) {
      setError("Name and Admin Passkey required");
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
            callbackURL: referer ?? "/",
          },
          {
            onRequest: () => setLoading(true),
            onSuccess: () => {
              toast.success("Signed in successfully");
              // Hard navigation to ensure server receives the new cookie
              window.location.href = safeRedirect ?? "/";
            },
            onError: (ctx) => setError(ctx.error.message || "Failed to login"),
          },
        );
      } else {
        await authClient.signUp.email(
          {
            email: email.trim(),
            password: password.trim(),
            name: name.trim(),
            callbackURL: referer ?? "/",
          },
          {
            query: {
              adminKey: adminPassKey.trim(),
            },
            onRequest: () => setLoading(true),
            onSuccess: () => {
              toast.success("Instance setup complete");
              window.location.href = safeRedirect ?? "/";
            },
            onError: (ctx) =>
              setError(ctx.error.message || "Failed to sign up"),
          },
        );
      }
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  // const handleSubmit = async (e: React.FormEvent) => {
  //   e.preventDefault();
  //   if (!email.trim() || !password.trim()) {
  //     setError("Email and Password Required");
  //     return;
  //   }
  //   if (view === "install" && (!name.trim() || !adminPassKey.trim())) {
  //     setError("Name and Admin Passkey required");
  //     return;
  //   }

  //   setLoading(true);
  //   setError(null);

  //   try {
  //     if (view === "login") {
  //       await authClient.signIn.email(
  //         {
  //           email: email.trim(),
  //           password: password.trim(),
  //           callbackURL: referer ?? "/",
  //         },
  //         {
  //           onSuccess: () => {
  //             toast.success("Signedin");
  //             window.location.href = referer ?? "/";
  //           },
  //           onRequest: () => setLoading(true),
  //           onError: (ctx) => setError(ctx.error.message || "Failed to login"),
  //         },
  //       );
  //     } else {
  //       await authClient.signUp.email(
  //         {
  //           email: email.trim(),
  //           password: password.trim(),
  //           name: name.trim(),
  //           callbackURL: referer ?? "/",
  //         },
  //         {
  //           query: {
  //             adminKey: adminPassKey.trim(),
  //           },
  //           onSuccess: () => {
  //             toast.success("Account created");
  //             window.location.href = referer ?? "/";
  //           },
  //           onRequest: () => setLoading(true),
  //           onError: (ctx) =>
  //             setError(ctx.error.message || "Failed to sign up"),
  //         },
  //       );
  //     }
  //   } catch {
  //     setError("An unexpected error occurred.");
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  return (
    <div
      className={cn("flex w-full max-w-lg flex-col gap-6", className)}
      {...props}
    >
      <form onSubmit={handleSubmit}>
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
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
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
              <FieldLabel htmlFor="name">Admin Passkey</FieldLabel>
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
