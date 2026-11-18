"use client";

import { CopyIcon, EllipsisIcon } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  deleteAccount,
  issueResetLink,
  reactivateAccount,
  suspendAccount,
  type LifecycleResult,
} from "@/features/auth/server/account-lifecycle";
import type { UserSummary } from "@/lib/client";

type Confirming = "suspend" | "delete" | null;

/** Turn a returned `{ ok: false }` into a mutation error, so it shows and retries like one. */
async function settle(result: Promise<LifecycleResult>) {
  const outcome = await result;
  if (!outcome.ok) throw new Error(outcome.error);
}

function expiry(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Suspend, reactivate, reset and delete one account (US-86.2). */
export function UserAccountActions({ user }: { user: UserSummary }) {
  const label = user.name ?? user.email ?? user.id;
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(
    null,
  );

  const suspend = useMutation({
    mutationFn: () => settle(suspendAccount(user.id)),
    onSuccess: () => setConfirming(null),
  });
  const reactivate = useMutation({
    mutationFn: () => settle(reactivateAccount(user.id)),
  });
  const remove = useMutation({
    mutationFn: () => settle(deleteAccount(user.id)),
    onSuccess: () => setConfirming(null),
  });
  const reset = useMutation({
    mutationFn: async () => {
      const result = await issueResetLink(user.id);
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    meta: { skipGlobalInvalidation: true },
    onSuccess: (result) =>
      setLink({ url: result.url, expiresAt: result.expiresAt }),
  });
  const failed = [reactivate, reset].find((mutation) => mutation.error);
  const pending =
    suspend.isPending ||
    reactivate.isPending ||
    remove.isPending ||
    reset.isPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Account actions for ${label}`}
            disabled={pending}
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {user.suspended ? (
            <DropdownMenuItem onSelect={() => reactivate.mutate()}>
              Reactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setConfirming("suspend")}>
              Suspend
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => reset.mutate()}>
            Create password reset link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirming("delete")}
          >
            Delete account
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {failed?.error && (
        <span role="alert" className="text-destructive basis-full text-xs">
          {failed.error.message}
        </span>
      )}

      <AlertDialog
        open={confirming === "suspend"}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;re signed out everywhere and can&apos;t sign in. Their
              running chats and file processing stop. Nothing is deleted, and
              you can reactivate the account at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {suspend.error && (
            <p role="alert" className="text-destructive text-sm">
              {suspend.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={suspend.isPending}
              onClick={(event) => {
                event.preventDefault();
                suspend.mutate();
              }}
            >
              Suspend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirming === "delete"}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {label}&apos;s account?</AlertDialogTitle>
            <AlertDialogDescription>
              This can&apos;t be undone. It deletes their sign-in and everything
              they own in Asterism: chats, projects, files and their search
              index, study decks and notes, skills, sub-agents, settings and
              About you. They leave their classes, and any class they teach is
              deleted for everyone in it. To keep their data, suspend the
              account instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {remove.error && (
            <p role="alert" className="text-destructive text-sm">
              {remove.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                remove.mutate();
              }}
            >
              {remove.error ? "Try again" : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={link !== null}
        onOpenChange={(open) => !open && setLink(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password reset link for {label}</DialogTitle>
            <DialogDescription>
              Send this link to them yourself. It works once, until{" "}
              {link && expiry(link.expiresAt)}, and signs them out everywhere.
              It isn&apos;t shown again; create a new one if it&apos;s lost.
            </DialogDescription>
          </DialogHeader>
          <Input
            readOnly
            aria-label="Password reset link"
            value={link?.url ?? ""}
            onFocus={(event) => event.currentTarget.select()}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                link && void navigator.clipboard.writeText(link.url)
              }
            >
              <CopyIcon />
              Copy link
            </Button>
            <Button type="button" onClick={() => setLink(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
