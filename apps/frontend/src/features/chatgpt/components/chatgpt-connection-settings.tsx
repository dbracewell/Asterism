"use client";

import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useUser } from "@/features/auth/components/user-context";
import { chatgptConnectionOptions } from "@/features/chatgpt/queries";
import {
  SettingsPane,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { useReadWriteSearchParams } from "@/hooks/use-read-write-search-params";
import { client } from "@/lib/api";
import {
  chatgptConnectionAuthorizeMutation,
  chatgptConnectionDisconnectMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import type { ChatGptConnection } from "@/lib/client/types.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

// Outcomes the OAuth callback reports back through `?chatgpt=`.
const CALLBACK_MESSAGES: Record<string, { text: string; error: boolean }> = {
  connected: { text: "Your ChatGPT plan is connected.", error: false },
  plan_usage_disabled: {
    text: "You signed in, but ChatGPT did not allow plan usage. Continue with ChatGPT to allow it.",
    error: true,
  },
  denied: { text: "ChatGPT sign-in was cancelled.", error: true },
  expired: {
    text: "That sign-in expired or was already used. Continue with ChatGPT to try again.",
    error: true,
  },
  account_mismatch: {
    text: "You signed in with a different ChatGPT account. Choose Use a different account to switch accounts.",
    error: true,
  },
  policy_disabled: {
    text: "Your administrator turned off ChatGPT plan connections before sign-in finished.",
    error: true,
  },
  failed: {
    text: "ChatGPT sign-in could not be completed. Try again.",
    error: true,
  },
};

type PendingDisconnect = "disconnect" | "forget" | null;

export function ChatGptConnectionSettings() {
  const user = useUser();
  return <ChatGptConnectionPane key={user.id} owner={user.id} />;
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "detail" in error)
    return String(error.detail);
  return fallback;
}

function ChatGptConnectionPane({ owner }: { owner: string }) {
  const connection = useQuery(chatgptConnectionOptions(owner));
  const { getSearchParam } = useReadWriteSearchParams();
  const callback = CALLBACK_MESSAGES[getSearchParam("chatgpt") ?? ""];
  const [pending, setPending] = useState<PendingDisconnect>(null);
  const authorize = useMutation({
    ...chatgptConnectionAuthorizeMutation({ client }),
    onSuccess(data) {
      window.location.assign(data.authorization_url);
    },
  });
  const disconnect = useMutation(
    chatgptConnectionDisconnectMutation({ client }),
  );

  if (!connection.data)
    return connection.isError ? (
      <QueryError
        error={connection.error}
        message="ChatGPT connection could not be loaded."
        retry={() => connection.refetch()}
        isRetrying={connection.isFetching}
      />
    ) : (
      <Spinner />
    );

  const data = connection.data;
  const registered = data.status != null && data.status !== "disconnected";
  const busy = authorize.isPending || disconnect.isPending;

  return (
    <SettingsPane
      title="ChatGPT"
      description="Run your chats on your own ChatGPT Plus or Pro plan. Only you can use your connection."
    >
      {callback && !authorize.isPending && (
        <p
          role={callback.error ? "alert" : "status"}
          className={
            callback.error ? "text-destructive text-sm" : "text-sm font-medium"
          }
        >
          {callback.text}
        </p>
      )}
      {!data.policy_enabled && (
        <p role="status" className="text-muted-foreground text-sm">
          Your administrator has turned off ChatGPT plan connections.
          {registered &&
            " Your connection is kept and works again if they turn it back on."}
        </p>
      )}
      <SettingsSection
        title="Connection"
        description="Sign-in opens ChatGPT in this browser and returns to 127.0.0.1, so this browser must run on the same machine as Asterism."
        actions={
          <ConnectionActions
            data={data}
            busy={busy}
            onConnect={() => authorize.mutate({})}
            onDisconnect={setPending}
          />
        }
      >
        <ConnectionStatus data={data} />
      </SettingsSection>
      {authorize.isError && (
        <p role="alert" className="text-destructive text-sm">
          {errorText(
            authorize.error,
            "ChatGPT sign-in could not start. Try again.",
          )}
        </p>
      )}
      {disconnect.isError && (
        <p role="alert" className="text-destructive text-sm">
          {errorText(
            disconnect.error,
            "ChatGPT could not be disconnected. Try again.",
          )}
        </p>
      )}
      {disconnect.data && (
        <p
          role={disconnect.data.revocation_confirmed ? "status" : "alert"}
          className="text-sm"
        >
          {disconnect.data.revocation_confirmed
            ? "ChatGPT is disconnected and its session has ended."
            : "Your tokens were removed, but ChatGPT did not confirm the session ended. Disconnect Asterism in ChatGPT Settings to be sure."}
        </p>
      )}
      <ConfirmationDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending === "forget"
            ? "Use a different ChatGPT account?"
            : "Disconnect ChatGPT?"
        }
        description={
          pending === "forget"
            ? "This signs out and forgets this ChatGPT account, so your next sign-in can choose another one. Chats and sub-agents bound to plan models become unavailable until you connect again."
            : "This signs out and removes your tokens. Chats and sub-agents bound to plan models become unavailable until you connect again."
        }
        confirmVariant="destructive"
        confirmText={pending === "forget" ? "Forget account" : "Disconnect"}
        onConfirm={() => {
          if (pending)
            disconnect.mutate({ body: { forget: pending === "forget" } });
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </SettingsPane>
  );
}

function ConnectionStatus({ data }: { data: ChatGptConnection }) {
  switch (data.status) {
    case "connected":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Connected as {data.email ?? "your ChatGPT account"}</span>
          <Badge variant="secondary">Plan usage on</Badge>
        </div>
      );
    case "plan_usage_disabled":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Signed in as {data.email ?? "your ChatGPT account"}</span>
          <Badge variant="outline">Plan usage disabled</Badge>
          <span className="text-muted-foreground">
            ChatGPT did not allow plan usage. Continue with ChatGPT to allow it.
          </span>
        </div>
      );
    case "reauthorization_required":
      return (
        <p className="text-sm">
          Your ChatGPT session ended. Sign in again to keep using your plan.
        </p>
      );
    default:
      return <p className="text-muted-foreground text-sm">Not connected.</p>;
  }
}

function ConnectionActions({
  data,
  busy,
  onConnect,
  onDisconnect,
}: {
  data: ChatGptConnection;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: (pending: PendingDisconnect) => void;
}) {
  const signedIn =
    data.status === "connected" || data.status === "plan_usage_disabled";
  return (
    <>
      {data.status !== "connected" && (
        <Button disabled={busy || !data.policy_enabled} onClick={onConnect}>
          {busy ? "Opening ChatGPT…" : "Continue with ChatGPT"}
        </Button>
      )}
      {signedIn && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onDisconnect("disconnect")}
        >
          Disconnect
        </Button>
      )}
      {data.status != null && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => onDisconnect("forget")}
        >
          Use a different account
        </Button>
      )}
    </>
  );
}
