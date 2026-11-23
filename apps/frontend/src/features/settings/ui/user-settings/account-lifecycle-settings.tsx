"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useUser } from "@/features/auth/components/user-context";
import { SettingsSection } from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  userDeletionRequestCreateMutation,
  userDeletionRequestGetOptions,
  userDeletionRequestWithdrawMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { errorDetail } from "@/lib/utils";

function SignOutEverywhere() {
  const [error, setError] = useState<string | null>(null);
  const signOut = useMutation({
    mutationFn: async () => {
      const result = await authClient.revokeSessions();
      if (result.error) throw new Error(result.error.message);
    },
    meta: { skipGlobalInvalidation: true },
    onSuccess: () => {
      window.location.href = "/sign-in";
    },
    onError: (failure) =>
      setError(failure.message || "Couldn't sign out everywhere."),
  });
  return (
    <div className="grid gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" className="w-fit">
            Sign out everywhere
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out on every device?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends every session, including this one. Open pages stop
              working within 15 minutes. Sign in again with your password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              Sign out everywhere
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function DeletionRequest() {
  const request = useQuery(userDeletionRequestGetOptions({ client }));
  const create = useMutation(userDeletionRequestCreateMutation({ client }));
  const withdraw = useMutation(userDeletionRequestWithdrawMutation({ client }));
  const requestedAt = request.data?.requested_at;
  const failure = create.error ?? withdraw.error ?? request.error;
  if (request.isPending) return null;
  return (
    <div className="grid gap-1">
      {requestedAt != null ? (
        <>
          <p className="text-sm">
            You asked for your account to be deleted on{" "}
            {new Date(requestedAt * 1000).toLocaleDateString(undefined, {
              dateStyle: "medium",
            })}
            . An administrator will decide; until then nothing changes.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate({})}
          >
            Withdraw request
          </Button>
        </>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" className="w-fit">
              Ask to delete my account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Ask to delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                An administrator sees your request and decides. If they delete
                the account, your chats, projects, files, study records, skills,
                memories and settings are deleted for good. Nothing changes
                until then, and you can withdraw the request.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={create.isPending}
                onClick={() => create.mutate({})}
              >
                Send request
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {failure && (
        <p role="alert" className="text-destructive text-xs">
          {errorDetail(failure, "Couldn't update your request.")}
        </p>
      )}
    </div>
  );
}

/** Sessions and the deletion request for the signed-in account (US-86.2). */
export function AccountLifecycleSettings() {
  const user = useUser();
  return (
    <SettingsSection title="Sign-in and account">
      <SignOutEverywhere />
      {user.role !== "admin" && <DeletionRequest />}
    </SettingsSection>
  );
}
