"use client";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useUser } from "@/features/auth/components/user-context";
import {
  ChatInput,
  ChatInputContainer,
} from "@/features/chat/components/chat-input";
import { MessageItem } from "@/features/chat/components/message/message-item";
import { StreamingIndicator } from "@/features/chat/components/message/streaming-indicator";
import { SubAgentActivityPanel } from "@/features/chat/components/sub-agent-activity";
import { useChatWebSocket } from "@/features/chat/hooks/use-chat-websocket";
import {
  connectionStatusMap,
  StreamingMessage,
  SubAgentActivity,
  updateSubAgentActivities,
} from "@/features/chat/types";
import { ChatWorkspace } from "@/features/projects/components/chat-workspace";
import { personaQueryOptions } from "@/features/settings/persona-queries";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";
import { client } from "@/lib/api";
import { Chat, Message } from "@/lib/client";
import {
  chatFileGetScopeOptions,
  chatMessageSendMutation,
  chatModelsListOptions,
  chatSessionGetOneOptions,
  chatSessionGetOneQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownIcon, XIcon } from "lucide-react";
import React from "react";
import { ExistingChatModelPicker } from "./chat-model-picker";
import {
  ExistingChatPersonaPicker,
  personaAvailable,
} from "./chat-persona-picker";

// Far enough from the bottom to offer "jump to latest" even when idle.
const SCROLL_BOTTOM_THRESHOLD = 200;
// Any scroll further up than this stops following a streaming reply.
const AUTO_SCROLL_LOCK_THRESHOLD = 16;

export const ChatSession = ({
  chatId,
  jwtToken,
}: {
  chatId: string;
  jwtToken: string;
}) => {
  const queryClient = useQueryClient();
  const user = useUser();
  const {
    data: session,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useQuery({
    ...chatSessionGetOneOptions({
      client: client,
      path: { chat_id: chatId },
    }),
    staleTime: 60 * 1000,
  });

  const fileScope = useQuery({
    ...chatFileGetScopeOptions({ client, path: { chat_id: chatId } }),
    enabled: !!session,
    staleTime: 0,
  });

  const models = useQuery({
    ...chatModelsListOptions({ client }),
    enabled: !!session,
    staleTime: 0,
    retry: false,
  });
  const [isChangingModel, setIsChangingModel] = React.useState(false);
  const [isChangingPersona, setIsChangingPersona] = React.useState(false);
  const personas = useQuery({
    ...personaQueryOptions(user.id),
    enabled: !!session,
  });
  const hasPersona =
    !personas.error &&
    personaAvailable(personas.data, session?.info.persona_id ?? null);
  const queryKey = chatSessionGetOneQueryKey({
    path: { chat_id: chatId },
  });

  const loadedSessionIdRef = React.useRef<string | null>(null);
  const messageListRef = React.useRef<HTMLDivElement | null>(null);
  const [incomingMessage, setIncomingMessage] =
    React.useState<StreamingMessage | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [subAgentActivities, setSubAgentActivities] = React.useState<
    SubAgentActivity[]
  >([]);
  const preventAutoScrollRef = React.useRef(false);
  const [isScrollable, setIsScrollable] = React.useState(false);
  const [isScrolledAway, setIsScrolledAway] = React.useState(false);
  const [socketError, setSocketError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!session) return;
    if (loadedSessionIdRef.current !== session.info.id) {
      loadedSessionIdRef.current = session.info.id;
      messageListRef.current?.scrollIntoView({ behavior: "instant" });
      setIncomingMessage(null);
    }
  }, [session]);

  React.useEffect(() => {
    return () => {
      loadedSessionIdRef.current = null;
    };
  }, [chatId]);

  useSubscribeEvent({
    type: "chat-session:update",
    handler: (payload) => {
      if (payload.session_id !== chatId || !payload.title) return;

      // Keep the source query synchronized.
      // Otherwise a later refetch can replace the just-received title with
      // the stale null value returned when the chat was first created.
      queryClient.setQueryData(queryKey, (previous?: Chat) =>
        previous
          ? {
              ...previous,
              info: { ...previous.info, title: payload.title },
            }
          : previous,
      );
    },
  });

  React.useEffect(() => {
    if (preventAutoScrollRef.current || !incomingMessage) return;
    messageListRef.current?.scrollIntoView({ behavior: "instant" });
  }, [incomingMessage]);

  const { sendJsonMessage, readyState, toolTimings } = useChatWebSocket({
    chatId,
    jwtToken,
    onStatusChange: (isProcessing) => {
      setIsProcessing(isProcessing);
    },
    onStreamStart: (pendingMessage) => {
      preventAutoScrollRef.current = false;
      setIncomingMessage(pendingMessage);
      queryClient.setQueryData(queryKey, (prev?: Chat) => {
        if (!prev || prev.messages.length === 0) return prev;
        const last = prev.messages[prev.messages.length - 1];
        if (last.status === "completed") return prev;
        return {
          ...prev,
          messages: [
            ...prev.messages.slice(0, -1),
            { ...last, status: "completed" },
          ],
        };
      });
    },
    onStreamError: (error) => {
      setIsProcessing(false);
      setIncomingMessage(null);
      setSocketError(error);
    },
    onRegenerate: () => {
      refetch();
    },
    onStreamUpdate: (nextIncomingMessage) => {
      setIncomingMessage(nextIncomingMessage);
    },
    onSubAgentEvent: (packet) => {
      setSubAgentActivities((activities) =>
        updateSubAgentActivities(activities, packet),
      );
    },
    onStreamComplete: (updatedMessages) => {
      setIsProcessing(false);
      setIncomingMessage(null);
      if (!updatedMessages.length) return;
      setSubAgentActivities([]);
      queryClient.invalidateQueries({ queryKey });
      queryClient.setQueryData(queryKey, (prev?: Chat) => {
        if (!prev) return;
        const index = prev.messages.findLastIndex((m) => {
          return m.id === updatedMessages[0].id;
        });
        let new_messages: Message[];
        if (index >= 0) {
          new_messages = [...prev.messages.slice(0, index), ...updatedMessages];
        } else {
          new_messages = [...prev.messages, ...updatedMessages];
        }

        return { ...prev, messages: new_messages };
      });
    },
  });

  const sendMessage = useMutation(chatMessageSendMutation({ client }));
  const pendingSend = React.useRef<{
    requestId: string;
    parentId: string | null;
    modelRevision: number;
  } | null>(null);
  const addUserMessage = async ({
    prompt,
    files,
    requestId,
    draftId,
    skills,
  }: {
    prompt: string;
    files: string[];
    requestId: string;
    draftId?: string;
    skills?: import("@/lib/client").SkillSelection;
  }) => {
    if (!session) throw new Error("Chat is not loaded. Please retry.");
    setSocketError(null);
    if (pendingSend.current?.requestId !== requestId) {
      pendingSend.current = {
        requestId,
        parentId: session.messages.at(-1)?.id ?? null,
        modelRevision: session.info.model_revision ?? 1,
      };
    }
    await sendMessage.mutateAsync({
      path: { chat_id: chatId },
      body: {
        request_id: requestId,
        expected_model_revision: pendingSend.current.modelRevision,
        user_prompt: prompt,
        ...(skills ? { skills } : {}),
        files,
        ...(draftId ? { draft_id: draftId } : {}),
        parent_message_id: pendingSend.current.parentId,
      },
    });
    // Read the authoritative accepted branch state, including its allocated skill revision.
    await queryClient.fetchQuery({
      ...chatSessionGetOneOptions({ client, path: { chat_id: chatId } }),
      staleTime: 0,
    });
    setSubAgentActivities([]);
    setIsProcessing(true);
    // Persistence acknowledgement precedes generation; reconnect can resume this same pending turn.
    sendJsonMessage({ type: "resume" });
  };

  const connectionStatus = React.useMemo(
    () => connectionStatusMap[readyState],
    [readyState],
  );

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading conversation"
        className="flex min-h-0 min-w-0 flex-1 items-center justify-center"
      >
        <Spinner loadingMessage />
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto wrap-anywhere">
        <QueryError
          error={error}
          message="Could not load conversation."
          retry={refetch}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  if (session == null) {
    return <Spinner />;
  }

  const selectedModelAvailable =
    !models.error &&
    !!models.data?.some(
      (model) => model.id === session.info.selected_model_id && model.available,
    );
  const interactionBusy =
    isProcessing ||
    sendMessage.isPending ||
    isChangingModel ||
    isChangingPersona;
  const promptPersona =
    session.info.pending_persona ??
    personas.data?.profiles.find(
      (profile) =>
        profile.id ===
        (session.info.persona_id ?? personas.data?.default_persona_id),
    );
  const pendingRequestId =
    session.info.pending_execution?.request_message_id ??
    session.messages.findLast(
      (message) => message.role === "user" && message.status === "pending",
    )?.id;
  function requestRegeneration(parentId?: string | null) {
    if (
      !selectedModelAvailable ||
      !hasPersona ||
      interactionBusy ||
      connectionStatus !== "Connected"
    )
      return;
    setIsProcessing(true);
    sendJsonMessage({ type: "regenerate", parent_message_id: parentId });
  }
  const generating = isProcessing || !!incomingMessage;
  // Idle: only when well away from the end. Streaming: as soon as the user
  // stops following the reply.
  const showJump = isScrollable || (generating && isScrolledAway);
  // A reply is owed but nothing has streamed yet.
  const lastMessage = session.messages.at(-1);
  const awaitingReply =
    !incomingMessage &&
    !session.info.resume_error &&
    (isProcessing ||
      (lastMessage?.role === "user" && lastMessage.status === "pending"));
  const contextWindow =
    session.info.context_model?.context_window ??
    user.settings.models?.find(
      (model) => model.id === session.info.selected_model_id,
    )?.context_window ??
    null;

  return (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-slot="chat-session"
    >
      <section
        aria-label="Conversation history"
        className={cn(
          "bg-background relative mx-auto flex min-h-0 w-full min-w-0 flex-1 scroll-p-3 flex-col overflow-y-auto px-3 py-4 wrap-anywhere *:shrink-0",
          // Keep scrolled-to and focused content clear of the floating pill.
          showJump && "scroll-pb-14",
        )}
        style={{ overflowAnchor: "auto" }}
        onScroll={(e) => {
          const scrollPosition =
            e.currentTarget.scrollHeight -
            (e.currentTarget.scrollTop + e.currentTarget.clientHeight);

          const isLocked = scrollPosition > AUTO_SCROLL_LOCK_THRESHOLD;
          preventAutoScrollRef.current = isLocked;
          if (isLocked !== isScrolledAway) setIsScrolledAway(isLocked);

          const isNowScrollable = scrollPosition > SCROLL_BOTTOM_THRESHOLD;
          if (isNowScrollable !== isScrollable) {
            setIsScrollable(isNowScrollable);
          }
        }}
      >
        {error && (
          <QueryError
            error={error}
            message="Could not refresh conversation. Showing saved messages."
            retry={refetch}
            isRetrying={isFetching}
          />
        )}
        {!session.messages.length && (
          <p role="status" className="text-muted-foreground py-4">
            No messages yet. Write a message to begin.
          </p>
        )}
        <ChatWorkspace
          info={session.info}
          disabled={isProcessing || sendMessage.isPending}
        />
        {session.info.pending_persona && (
          <p
            className="text-muted-foreground text-sm"
            aria-label="Saved turn persona"
          >
            This response uses {session.info.pending_persona.name} (persona
            revision {session.info.pending_persona.revision}).
          </p>
        )}
        {session.info.resume_error && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert">{session.info.resume_error}</p>
            {pendingRequestId && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  interactionBusy ||
                  !hasPersona ||
                  !selectedModelAvailable ||
                  connectionStatus !== "Connected"
                }
                onClick={() => requestRegeneration(pendingRequestId)}
              >
                Regenerate with current settings
              </Button>
            )}
          </div>
        )}
        {models.data && !models.error && !selectedModelAvailable && (
          <p role="alert">
            Choose an available model to continue. Historical messages keep
            their original model.
          </p>
        )}
        <div className="mx-auto w-full max-w-5xl">
          {session.messages.map((message, index) => (
            <MessageItem
              chatId={chatId}
              key={message.id}
              message={message}
              startsTurn={session.messages[index - 1]?.role !== "assistant"}
              isProcessing={interactionBusy}
              canRegenerate={
                selectedModelAvailable && connectionStatus === "Connected"
              }
              onRegenerate={requestRegeneration}
              toolTimings={toolTimings}
              sendJsonMessage={sendJsonMessage}
            />
          ))}

          {awaitingReply &&
            (lastMessage?.role === "assistant" ? (
              // Between agent steps: trail the turn under its existing marker.
              <div className="mb-5 pl-10">
                <StreamingIndicator />
              </div>
            ) : (
              <StreamingIndicator variant="turn" />
            ))}
          <SubAgentActivityPanel
            activities={subAgentActivities}
            mainModel={session.info.selected_model?.name}
          />
          {incomingMessage && (
            <MessageItem
              chatId={chatId}
              message={incomingMessage}
              startsTurn={session.messages.at(-1)?.role !== "assistant"}
              isProcessing={interactionBusy}
              canRegenerate={false}
              onRegenerate={requestRegeneration}
              streaming
              toolTimings={toolTimings}
              sendJsonMessage={sendJsonMessage}
            />
          )}
        </div>
        <div
          ref={messageListRef}
          className="shrink-0"
          style={{
            overflowAnchor: "auto",
            width: "100%",
            height: "1px",
          }}
        />
      </section>
      <div
        data-slot="chat-composer"
        className="relative flex max-h-[60%] min-h-0 shrink-0 flex-col gap-2 bg-transparent p-2"
      >
        {showJump && (
          <Button
            variant="outline"
            size="sm"
            data-slot="jump-to-latest"
            className="rounded-dot shadow-overlay bg-background absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2"
            aria-label="Jump to latest message"
            onClick={() => {
              preventAutoScrollRef.current = false;
              setIsScrollable(false);
              setIsScrolledAway(false);
              messageListRef.current?.scrollIntoView({ behavior: "instant" });
            }}
          >
            {generating ? (
              <span
                aria-hidden="true"
                className="bg-primary rounded-dot size-1.5 animate-pulse motion-reduce:animate-none"
              />
            ) : (
              <ArrowDownIcon />
            )}
            Jump to latest
          </Button>
        )}
        {socketError && (
          <div
            role="alert"
            className="bg-destructive/10 border-destructive text-destructive rounded-surface mx-auto mb-2 flex w-full max-w-5xl items-center justify-between gap-2 border px-3 py-2 text-sm"
          >
            <p className="min-w-0 flex-1">{socketError}</p>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSocketError(null)}
              aria-label="Dismiss error"
              className="text-destructive hover:bg-destructive/20 h-6 w-6 shrink-0"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        )}
        <ChatInputContainer className="max-w-5xl scroll-p-2 overflow-y-auto overscroll-contain">
          <ChatInput
            key={`${user.id}:${chatId}:${session.messages.at(-1)?.id ?? "root"}`}
            skillOwner={user.id}
            skillScope={`${chatId}:${session.messages.at(-1)?.id ?? "root"}`}
            activeSkills={session.info.active_skills}
            chatId={chatId}
            projectId={session.info.project_id}
            savedFileIds={
              fileScope.isFetching || fileScope.error
                ? []
                : fileScope.data?.allowed_file_ids
            }
            disabled={
              interactionBusy ||
              connectionStatus !== "Connected" ||
              !selectedModelAvailable ||
              !hasPersona
            }
            isProcessing={isProcessing}
            onStop={() => sendJsonMessage({ type: "cancel" })}
            requestScope={`${session.info.id}:${session.info.model_revision ?? 1}:${session.info.persona_revision ?? 1}`}
            scopeKey={`${session.info.model_revision}:${session.info.persona_revision}:${promptPersona?.id}:${promptPersona?.revision}:${session.info.project_id}:${session.messages.map((message) => message.id).join()}`}
            scopeLocked={isProcessing || sendMessage.isPending}
            onSubmit={addUserMessage}
            modelSelector={
              <>
                <ExistingChatModelPicker
                  info={session.info}
                  disabled={interactionBusy}
                  onPendingChange={setIsChangingModel}
                  onSelected={(info) =>
                    queryClient.setQueryData(queryKey, (previous?: Chat) =>
                      previous
                        ? { ...previous, info: { ...previous.info, ...info } }
                        : previous,
                    )
                  }
                />
                <ExistingChatPersonaPicker
                  info={session.info}
                  disabled={interactionBusy}
                  onPendingChange={setIsChangingPersona}
                  onSelected={(info) =>
                    queryClient.setQueryData(queryKey, (previous?: Chat) =>
                      previous
                        ? { ...previous, info: { ...previous.info, ...info } }
                        : previous,
                    )
                  }
                />
              </>
            }
            status={
              <>
                <ContextUsageProgress
                  usage={isFetching ? null : session.context_usage}
                  contextWindow={contextWindow}
                />
                <ConnectionIndicator status={connectionStatus} />
              </>
            }
          />
        </ChatInputContainer>
      </div>
    </div>
  );
};

export const ContextUsageProgress = ({
  usage,
  contextWindow,
}: {
  usage: Chat["context_usage"];
  contextWindow: number | null;
}) => {
  if (!usage || !contextWindow) return null;

  const percent = Math.min(
    100,
    Math.round((usage.total_tokens / contextWindow) * 100),
  );

  return (
    <div
      className="flex items-center gap-1.5"
      aria-label="Estimated saved conversation context"
      title={`Saved context: ${percent}%`}
    >
      <Progress
        value={percent}
        max={100}
        className="bg-background h-2.5 w-10"
      />
      <span className="text-muted-foreground text-xs tabular-nums select-none">
        {percent}%
      </span>
    </div>
  );
};

const ConnectionIndicator = ({ status }: { status?: string }) => {
  if (!status) return null;
  const connected = status === "Connected";
  return (
    <div
      role="status"
      title={status}
      className="flex items-center gap-1.5 text-xs"
    >
      <span
        aria-hidden="true"
        className={cn(
          "rounded-dot size-2",
          connected ? "bg-primary" : "bg-destructive",
        )}
      />
      <span className={connected ? "sr-only" : "text-muted-foreground"}>
        {status}
      </span>
    </div>
  );
};
