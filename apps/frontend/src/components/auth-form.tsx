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
import { cn, formatURL } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface AuthFormProps extends React.ComponentProps<"div"> {
  initialView?: "login" | "signup";
  referer?: string;
}

export function AuthForm({
  className,
  initialView = "login",
  referer,
  ...props
}: AuthFormProps) {
  const [view, setView] = useState<"login" | "signup">(initialView);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (view === "login") {
        await authClient.signIn.email(
          {
            email,
            password,
            callbackURL: referer ?? "/app",
          },
          {
            onSuccess: () => router.push(referer ?? "/app"),
            onRequest: () => setLoading(true),
            onError: (ctx) => setError(ctx.error.message || "Failed to login"),
          },
        );
      } else {
        await authClient.signUp.email(
          {
            email,
            password,
            name: name || email.split("@")[0],
            callbackURL: referer ?? "/app",
          },
          {
            onSuccess: () => router.push(referer ?? "/app"),
            onRequest: () => setLoading(true),
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
              <h1 className="text-xl font-bold">
                ASTERISM
              </h1>
            </div>

            <FieldDescription>
              {view === "login" ? (
                <>
                  Don&apos;t have an account?{" "}
                  <Link
                    href={formatURL("/", { mode: "signup", redirect: referer })}
                    className="font-medium hover:underline"
                  >
                    Sign up
                  </Link>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <Link
                    href={formatURL("/", { mode: "login", redirect: referer })}
                    className="font-medium hover:underline"
                  >
                    Login
                  </Link>
                </>
              )}
            </FieldDescription>
          </div>
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
          {view === "signup" && (
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
