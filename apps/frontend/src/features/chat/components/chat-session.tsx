"use client";
import { CopyButton } from "@/components/copy-button";
import MarkdownViewer from "@/components/markdown-viewer";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useUser } from "@/features/auth/components/user-context";
import {
  ChatInput,
  ChatInputContainer,
} from "@/features/chat/components/chat-input";
import { MessageAttachments } from "@/features/chat/components/message-attachments";
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
  messageUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { formatPlural } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCwIcon,
  XIcon,
  BrainIcon,
} from "lucide-react";
import React from "react";
import { SendJsonMessage } from "react-use-websocket/dist/lib/types";
import { ExistingChatModelPicker } from "./chat-model-picker";
import {
  ExistingChatPersonaPicker,
  personaAvailable,
} from "./chat-persona-picker";
import { RetrievalCitations } from "./retrieval-citations";

const SCROLL_BOTTOM_THRESHOLD = 200;
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

  const { sendJsonMessage, readyState } = useChatWebSocket({
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
        className="bg-background relative mx-auto flex min-h-0 w-full min-w-0 flex-1 scroll-p-3 flex-col overflow-y-auto px-3 py-4 wrap-anywhere *:shrink-0"
        style={{ overflowAnchor: "auto" }}
        onScroll={(e) => {
          const scrollPosition =
            e.currentTarget.scrollHeight -
            (e.currentTarget.scrollTop + e.currentTarget.clientHeight);

          preventAutoScrollRef.current =
            scrollPosition > AUTO_SCROLL_LOCK_THRESHOLD;

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
          {session.messages.map((message) => (
            <MessageItem
              chatId={chatId}
              key={message.id}
              message={message}
              isProcessing={interactionBusy}
              canRegenerate={
                selectedModelAvailable && connectionStatus === "Connected"
              }
              onRegenerate={requestRegeneration}
              sendJsonMessage={sendJsonMessage}
            />
          ))}

          {!incomingMessage &&
            session.messages.length > 0 &&
            session.messages[0].status === "pending" && <Loading />}
          <SubAgentActivityPanel activities={subAgentActivities} />
          {incomingMessage && (
            <MessageItem
              chatId={chatId}
              message={incomingMessage}
              isProcessing={interactionBusy}
              canRegenerate={false}
              onRegenerate={requestRegeneration}
              defaultShowThinking={user.settings.show_thinking ?? false}
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
        className="flex max-h-[60%] min-h-0 shrink-0 flex-col gap-2 bg-transparent p-2"
      >
        {isScrollable && (
          <Button
            className="rounded-control mx-auto shrink-0"
            aria-label="Jump to latest message"
            onClick={() => {
              preventAutoScrollRef.current = false;
              setIsScrollable(false);
              messageListRef.current?.scrollIntoView({ behavior: "instant" });
            }}
          >
            <ArrowDownIcon /> Scroll Down
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

const MessageItem = React.memo(
  ({
    chatId,
    isProcessing,
    message,
    defaultShowThinking = false,
    canRegenerate,
    onRegenerate,
    sendJsonMessage,
  }: {
    chatId: string;
    isProcessing: boolean;
    message: StreamingMessage;
    defaultShowThinking?: boolean;
    canRegenerate: boolean;
    onRegenerate: (parentId?: string | null) => void;
    sendJsonMessage: SendJsonMessage;
  }) => {
    const user = useUser();
    const userShowThinking = user.settings.show_thinking ?? false;
    const [showThinking, setShowThinking] = React.useState(defaultShowThinking);
    const thinkingRef = React.useRef<HTMLParagraphElement>(null);
    React.useEffect(() => {
      if (defaultShowThinking && thinkingRef.current) {
        thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
      }
    }, [message.thinking, defaultShowThinking]);

    const nodeIndex = message.current_sibling_index ?? 1;
    const nodeCount = message.sibling_count ?? 1;
    const prevSiblingId = message.previous_sibling_id ?? null;
    const nextSiblingId = message.next_sibling_id ?? null;

    const updateMessage = useMutation({
      ...messageUpdateMutation({
        client,
      }),
    });
    return (
      <div
        className={cn(
          "mb-5 flex min-w-0 flex-col gap-1 wrap-anywhere",
          !!message.tool_calls && "mb-0!",
        )}
      >
        {userShowThinking && (
          <Collapsible
            open={showThinking}
            onOpenChange={setShowThinking}
            className={cn(
              "text-muted-foreground rounded-surface p-2 text-sm",
              !message.thinking && "hidden",
            )}
          >
            <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between text-left font-medium">
              <span>
                <BrainIcon className="inline-block size-5" /> Thinking{" "}
                {message.tool_calls && (
                  <>({formatPlural(message.tool_calls.length, "tool call")})</>
                )}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <p
                ref={thinkingRef}
                className="max-h-50 overflow-y-auto whitespace-pre-wrap select-text"
                style={{ overflowAnchor: "auto" }}
              >
                {message.thinking ?? ""}
              </p>
              {message.tool_calls && message.tool_calls.length > 0 && (
                <h4 className="mt-0.5 font-bold">Tools</h4>
              )}
              {message.tool_calls?.map((tc) => (
                <div key={tc.id}>
                  • {tc.function.name}{" "}
                  {tc.function.arguments !== "{}" && tc.function.arguments}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
        {message.needsPermission &&
          message.needsPermission.map((t) => (
            <div key={t.id}>
              {t.name} {t.arguments}{" "}
              <Button
                onClick={() =>
                  sendJsonMessage({
                    type: "tool_approval",
                    tool_id: t.id,
                    approved: true,
                  })
                }
              >
                Approve
              </Button>
            </div>
          ))}
        {!!message.skills?.length && (
          <div
            className="flex max-w-full flex-wrap gap-1"
            aria-label="Message skills"
          >
            {message.skills.map((skill) => (
              <Badge
                key={skill.id}
                variant="outline"
                className="max-w-full"
                title={skill.name}
              >
                <span className="truncate">
                  /{skill.name} · r{skill.revision}
                </span>
              </Badge>
            ))}
          </div>
        )}
        <MarkdownViewer
          content={message.content}
          className={cn(
            "flex w-full min-w-0 flex-1 flex-col",
            message.role === "user" &&
              "bg-accent text-accent-foreground rounded-surface ml-auto w-fit max-w-full px-3 py-2 sm:max-w-125 md:max-w-150 xl:max-w-250",
          )}
        />
        {!!message.tool_call_results?.length && (
          <RetrievalCitations
            chatId={chatId}
            results={message.tool_call_results}
          />
        )}
        {message.role === "user" && message.files && (
          <MessageAttachments chatId={chatId} files={message.files} />
        )}
        {message.role === "assistant" && message.status === "pending" && (
          <Loading />
        )}
        {message.tool_calls == null &&
          (message.status === "completed" ||
            message.status === "cancelled") && (
            <div
              className={cn(
                "text-muted-foreground flex w-fit max-w-full flex-wrap items-center gap-1 text-xs",
                message.role === "user" && "ml-auto",
              )}
            >
              {message.role !== "user" && (
                <span className="mr-1">
                  {message.status === "cancelled" && "Stopped · "}
                  {new Date(message.created_at * 1000).toLocaleString()}
                  {(message.output_tokens ?? 0) > 0 &&
                  (message.generation_duration_ms ?? 0) > 0
                    ? ` · ${((message.output_tokens ?? 0) / ((message.generation_duration_ms ?? 1) / 1000)).toFixed(1)} tok/s`
                    : ""}
                </span>
              )}

              {nodeCount > 1 && (
                <div className="flex items-center px-2">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      updateMessage.mutate({
                        path: {
                          chat_id: chatId,
                          message_id: message.parent_message_id!,
                        },
                        body: {
                          active_child_id: prevSiblingId,
                        },
                      });
                    }}
                    aria-label="Previous response version"
                    disabled={prevSiblingId == null || isProcessing}
                  >
                    <ChevronLeftIcon />
                  </Button>
                  {nodeIndex} / {nodeCount}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      updateMessage.mutate({
                        path: {
                          chat_id: chatId,
                          message_id: message.parent_message_id!,
                        },
                        body: {
                          active_child_id: nextSiblingId,
                        },
                      });
                    }}
                    aria-label="Next response version"
                    disabled={nextSiblingId == null || isProcessing}
                  >
                    <ChevronRightIcon />
                  </Button>
                </div>
              )}

              {message.role !== "user" && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="rounded-control"
                  aria-label="Regenerate response"
                  disabled={isProcessing || !canRegenerate}
                  onClick={() => onRegenerate(message.parent_message_id)}
                >
                  <RotateCwIcon />
                </Button>
              )}
              <CopyButton
                text={message.content}
                size="icon-sm"
                className="rounded-control"
              />
            </div>
          )}
      </div>
    );
  },
);
MessageItem.displayName = "MessageItem";

const Loading = () => {
  return (
    <div className="mt-3 flex items-center space-x-1 px-4">
      <span className="sr-only">Processing...</span>
      <div className="bg-primary rounded-dot size-2 animate-bounce [animation-delay:-0.3s]"></div>
      <div className="bg-primary rounded-dot size-2 animate-bounce [animation-delay:-0.15s]"></div>
      <div className="bg-primary rounded-dot size-2 animate-bounce"></div>
    </div>
  );
};
