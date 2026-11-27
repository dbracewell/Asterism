"use client";
import { MESSAGE_SEND_INVALIDATES } from "@/features/chat/lib/send-invalidation";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { TranscriptSkeleton } from "@/components/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/features/auth/components/user-context";
import { useFeature } from "@/features/availability/queries";
import {
  ChatInput,
  ChatInputContainer,
} from "@/features/chat/components/chat-input";
import {
  CanvasProvider,
  type CanvasContextValue,
} from "@/features/canvas/components/canvas-context";
import { CanvasChip } from "@/features/canvas/components/canvas-chip";
import { CanvasLayout } from "@/features/canvas/components/canvas-layout";
import { canvasRefs } from "@/features/canvas/lib/canvas";
import { useChatAutoScroll } from "@/features/chat/hooks/use-chat-auto-scroll";
import { useChatStream } from "@/features/chat/hooks/use-chat-stream";
import { connectionStatusMap } from "@/features/chat/types";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";
import { client } from "@/lib/api";
import { Chat, DelegationRecord } from "@/lib/client";
import {
  chatFileGetScopeOptions,
  chatMessageSendMutation,
  chatModelsListOptions,
  chatSessionGetOneOptions,
  imageGenerationAvailabilityOptions,
  chatSessionGetOneQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn, errorDetail } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { ExistingChatModelPicker } from "./chat-model-picker";
import { ComposerStatus } from "./composer-status";
import { ChatSocketError } from "./chat-socket-error";
import { ChatTranscript } from "./chat-transcript";
import { JumpToLatest } from "./jump-to-latest";
import { ForkStepDialog, type ForkSource } from "./fork-step-dialog";
import { CompareMessageDialog, comparePayload } from "./compare-targets";
import { imagePrompts } from "../lib/image-generation";
import { ImageActionsContext } from "@/components/markdown-viewer/inline-files";
import { ExistingChatLearningModePicker } from "./chat-learning-mode-picker";
import { ChatHintControls } from "./chat-hint-controls";
import { ChatRubricPicker, useModeTakesRubric } from "./chat-rubric-picker";
import { ChatGoalToggle, useProjectGoal } from "./chat-goal-toggle";

export const ChatSession = ({
  chatId,
  jwtToken,
}: {
  chatId: string;
  jwtToken: string;
}) => {
  const queryClient = useQueryClient();
  const user = useUser();
  const canvasAllowed = useFeature("canvas").available;
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

  // Whether "Create image" is offered: the policy, the user's group and the generator (ADR-0064).
  const imageAvailability = useQuery({
    ...imageGenerationAvailabilityOptions({ client }),
    staleTime: 60 * 1000,
    retry: false,
  });
  const canCreateImage = !!imageAvailability.data?.available;
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
  const [isChangingMode, setIsChangingMode] = React.useState(false);
  // "New problem" resets the branch hint level with the next sent message.
  const [resetHints, setResetHints] = React.useState(false);
  const queryKey = chatSessionGetOneQueryKey({
    path: { chat_id: chatId },
  });

  const loadedSessionIdRef = React.useRef<string | null>(null);
  const [compareModels, setCompareModels] = React.useState<string[]>([]);
  // `undefined` follows the latest turn's rubric; the learner's choice sticks.
  const [rubricChoice, setRubricChoice] = React.useState<
    import("@/lib/client").RubricUse | null | undefined
  >(undefined);
  const takesRubric = useModeTakesRubric(session?.info.learning_mode);
  const latestRubric = session?.messages.findLast(
    (message) => message.role === "user" && message.rubric,
  )?.rubric;
  const rubric =
    rubricChoice !== undefined
      ? rubricChoice
      : latestRubric
        ? { source: latestRubric.source, id: latestRubric.id }
        : null;
  const sentRubric = takesRubric ? rubric : null;
  // Like the rubric, the goal choice follows the latest turn until changed.
  const [goalChoice, setGoalChoice] = React.useState<boolean | undefined>();
  const projectGoal = useProjectGoal(session?.info.project_id);
  const latestTurn = session?.messages.findLast(
    (message) => message.role === "user",
  );
  const includeGoal = !!projectGoal && (goalChoice ?? latestTurn?.goal != null);
  const [compareSource, setCompareSource] = React.useState<{
    messageId: string;
    modelId?: string;
    modelName?: string;
  } | null>(null);
  // US-54.5: the delegation being forked, with the step that ran it.
  const [forkSource, setForkSource] = React.useState<ForkSource | null>(null);
  const [openCanvasItem, setOpenCanvasItem] = React.useState<string | null>(
    null,
  );
  const stream = useChatStream({
    chatId,
    jwtToken,
    refetch,
    onStreamStart: () => follow(),
  });
  const {
    sendJsonMessage,
    readyState,
    toolTimings,
    toolProgress,
    incomingMessage,
    setIncomingMessage,
    isProcessing,
    setIsProcessing,
    comparisonStream,
    subAgentActivities,
    isCompacting,
    setIsCompacting,
    socketError,
    setSocketError,
  } = stream;
  const {
    messageListRef,
    isScrollable,
    isScrolledAway,
    onScroll,
    follow,
    jumpToLatest,
  } = useChatAutoScroll({
    messages: session?.messages,
    incomingMessage,
    comparisonStream,
    subAgentActivities,
    isProcessing,
  });

  React.useEffect(() => {
    if (!session) return;
    if (loadedSessionIdRef.current !== session.info.id) {
      loadedSessionIdRef.current = session.info.id;
      messageListRef.current?.scrollIntoView({ behavior: "instant" });
      setIncomingMessage(null);
    }
  }, [session, messageListRef, setIncomingMessage]);

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

  const sendMessage = useMutation({
    ...chatMessageSendMutation({ client }),
    meta: { invalidates: MESSAGE_SEND_INVALIDATES },
  });
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
    template,
    compare,
    hint,
    createImage,
  }: {
    prompt: string;
    files: string[];
    requestId: string;
    draftId?: string;
    skills?: import("@/lib/client").SkillSelection;
    template?: import("@/lib/client").TemplateUse;
    compare?: import("@/lib/client").ComparisonTarget[];
    hint?: import("@/lib/client").HintRequest;
    createImage?: true;
  }) => {
    if (!session) throw new Error("Chat is not loaded. Please retry.");
    setSocketError(null);
    // Sending returns to the conversation's end, wherever the user had read to.
    follow();
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
        ...(template ? { template } : {}),
        ...(sentRubric ? { rubric: sentRubric } : {}),
        ...(includeGoal ? { include_goal: true } : {}),
        ...(createImage ? { create_image: true } : {}),
        ...(hint
          ? { hint }
          : resetHints
            ? { hint: { level: "none" as const } }
            : {}),
        files,
        ...(draftId ? { draft_id: draftId } : {}),
        parent_message_id: pendingSend.current.parentId,
        ...(compare
          ? { compare }
          : createImage
            ? {}
            : comparePayload(compareModels)),
      },
    });
    setCompareModels([]);
    setResetHints(false);
    // Read the authoritative accepted branch state, including its allocated skill revision.
    await stream.resume();
  };

  // The prompt behind each generated image, for "More like this".
  const promptsByImage = React.useMemo(
    () => imagePrompts(session?.messages ?? []),
    [session?.messages],
  );
  const connectionStatus = React.useMemo(
    () => connectionStatusMap[readyState],
    [readyState],
  );

  if (isLoading) return <ChatSessionSkeleton />;

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

  if (session == null) return <ChatSessionSkeleton />;

  const selectedModelAvailable =
    !models.error &&
    !!models.data?.some(
      (model) => model.id === session.info.selected_model_id && model.available,
    );
  const interactionBusy =
    isProcessing ||
    isCompacting ||
    sendMessage.isPending ||
    isChangingModel ||
    isChangingMode;
  const pendingRequestId =
    session.info.pending_execution?.request_message_id ??
    session.messages.findLast(
      (message) => message.role === "user" && message.status === "pending",
    )?.id;
  function requestRegeneration(parentId?: string | null) {
    if (
      !selectedModelAvailable ||
      interactionBusy ||
      connectionStatus !== "Connected"
    )
      return;
    setIsProcessing(true);
    sendJsonMessage({ type: "regenerate", parent_message_id: parentId });
  }
  function requestCompaction() {
    if (interactionBusy || connectionStatus !== "Connected") return;
    setSocketError(null);
    setIsCompacting(true);
    sendJsonMessage({ type: "compact" });
  }
  /** Comparing is offered on a turn's first answer, once that turn is settled. */
  const compareAction = (index: number) => {
    const message = session.messages[index];
    const turn = session.messages[index - 1];
    if (
      message.role !== "assistant" ||
      turn?.role !== "user" ||
      turn.comparison_id ||
      message.status !== "completed" ||
      message.tool_calls
    )
      return undefined;
    return () =>
      setCompareSource({
        messageId: turn.id,
        modelId: message.execution?.model.id,
        modelName: message.execution?.model.name,
      });
  };
  /** Forking is offered on a settled step's delegations while the chat is idle. */
  const forkAction = (index: number) => {
    const message = session.messages[index];
    if (
      message.role !== "assistant" ||
      message.status !== "completed" ||
      !message.delegations?.length ||
      interactionBusy ||
      connectionStatus !== "Connected"
    )
      return undefined;
    return (record: DelegationRecord) =>
      setForkSource({ messageId: message.id, record });
  };
  const generating = isProcessing || !!incomingMessage || !!comparisonStream;
  // Idle: only when well away from the end. Streaming: as soon as the user
  // stops following the reply.
  const showJump = isScrollable || (generating && isScrolledAway);
  // A reply is owed but nothing has streamed yet.
  const lastMessage = session.messages.at(-1);
  const awaitingReply =
    !incomingMessage &&
    !comparisonStream &&
    !lastMessage?.comparison_id &&
    !session.info.resume_error &&
    (isProcessing ||
      (lastMessage?.role === "user" && lastMessage.status === "pending"));
  const contextWindow =
    session.info.context_model?.context_window ??
    user.settings.models?.find(
      (model) => model.id === session.info.selected_model_id,
    )?.context_window ??
    null;

  const canAsk =
    !interactionBusy &&
    connectionStatus === "Connected" &&
    selectedModelAvailable &&
    !pendingRequestId;
  const imageActions = {
    moreLikeThis: (fileId: string) => {
      const prompt = promptsByImage.get(fileId);
      if (
        !prompt ||
        !canCreateImage ||
        interactionBusy ||
        connectionStatus !== "Connected"
      )
        return undefined;
      // The same description again; the generator picks a new seed.
      return () => {
        addUserMessage({
          prompt,
          files: [],
          requestId: crypto.randomUUID(),
          createImage: true,
        }).catch((error: unknown) =>
          setSocketError({
            message: errorDetail(
              error,
              "Could not request another image. Reload the chat and retry.",
            ),
          }),
        );
      };
    },
  };
  /** A picker's saved change, merged into the cached chat. */
  const mergeInfo = (info: Partial<Chat["info"]>) =>
    queryClient.setQueryData(queryKey, (previous?: Chat) =>
      previous
        ? { ...previous, info: { ...previous.info, ...info } }
        : previous,
    );
  const canvas: CanvasContextValue = {
    openItemId: openCanvasItem,
    open: setOpenCanvasItem,
    close: () => setOpenCanvasItem(null),
    // Refetch canvas reads as the branch changes or a run writes a version.
    transcriptKey: `${session.messages.map((message) => `${message.id}:${message.status}`).join()}|${canvasRefs(
      incomingMessage?.tool_call_results,
    )
      .map((ref) => `${ref.itemId}:${ref.version}`)
      .join()}`,
    ask: canAsk
      ? (prompt) =>
          addUserMessage({ prompt, files: [], requestId: crypto.randomUUID() })
      : null,
    canEdit: !!(user.settings.canvas_enabled && canvasAllowed),
  };

  return (
    <CanvasProvider value={canvas}>
      <ImageActionsContext.Provider value={imageActions}>
        <CanvasLayout chatId={chatId}>
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
              onScroll={onScroll}
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
                <EmptyState
                  role="status"
                  className="flex-none"
                  title="No messages yet"
                  description="Write a message below to begin."
                />
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
                  Choose an available model to continue. Historical messages
                  keep their original model.
                </p>
              )}
              <ChatTranscript
                chatId={chatId}
                session={session}
                incomingMessage={incomingMessage}
                comparisonStream={comparisonStream}
                subAgentActivities={subAgentActivities}
                isProcessing={isProcessing}
                isCompacting={isCompacting}
                awaitingReply={awaitingReply}
                interactionBusy={interactionBusy}
                canRegenerate={
                  selectedModelAvailable && connectionStatus === "Connected"
                }
                onRegenerate={requestRegeneration}
                compareAction={compareAction}
                forkAction={forkAction}
                toolTimings={toolTimings}
                toolProgress={toolProgress}
                sendJsonMessage={sendJsonMessage}
              />
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
                <JumpToLatest generating={generating} onClick={jumpToLatest} />
              )}
              {socketError && (
                <ChatSocketError
                  error={socketError}
                  onDismiss={() => setSocketError(null)}
                />
              )}
              <ChatInputContainer className="max-w-5xl scroll-p-2 overflow-y-auto overscroll-contain">
                {session.messages.length > 0 && (
                  <ChatHintControls
                    info={session.info}
                    disabled={
                      interactionBusy ||
                      connectionStatus !== "Connected" ||
                      !selectedModelAvailable ||
                      !!pendingRequestId
                    }
                    resetPending={resetHints}
                    onResetChange={setResetHints}
                    onRaise={(hint, prompt) => {
                      addUserMessage({
                        prompt,
                        files: [],
                        requestId: crypto.randomUUID(),
                        hint,
                      }).catch((error: unknown) =>
                        setSocketError({
                          message: errorDetail(
                            error,
                            "Could not request help. Reload the chat and retry.",
                          ),
                        }),
                      );
                    }}
                  />
                )}
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
                    !selectedModelAvailable
                  }
                  isProcessing={isProcessing}
                  onStop={() => sendJsonMessage({ type: "cancel" })}
                  requestScope={`${session.info.id}:${session.info.model_revision ?? 1}:${session.info.learning_mode_revision ?? 1}:${compareModels.join(",")}:${sentRubric ? `${sentRubric.source}:${sentRubric.id}` : "none"}:${includeGoal ? "goal" : ""}`}
                  scopeKey={`${session.info.model_revision}:${session.info.learning_mode_revision}:${session.info.project_id}:${session.messages.map((message) => message.id).join()}`}
                  scopeLocked={isProcessing || sendMessage.isPending}
                  onSubmit={addUserMessage}
                  createImage={
                    canCreateImage && session.info.purpose !== "skill_draft"
                      ? {}
                      : undefined
                  }
                  promptCoach={
                    user.settings.prompt_coach_enabled
                      ? { modelId: session.info.selected_model_id }
                      : undefined
                  }
                  compare={{
                    value: compareModels,
                    onChange: setCompareModels,
                    disabled: interactionBusy,
                  }}
                  chips={
                    <>
                      <ExistingChatModelPicker
                        info={session.info}
                        disabled={interactionBusy}
                        onPendingChange={setIsChangingModel}
                        onSelected={mergeInfo}
                      />
                      <ExistingChatLearningModePicker
                        info={session.info}
                        disabled={interactionBusy}
                        onPendingChange={setIsChangingMode}
                        onSelected={mergeInfo}
                      />
                      <CanvasChip
                        chatId={chatId}
                        hasMessages={session.messages.length > 0}
                      />
                      {projectGoal && (
                        <ChatGoalToggle
                          goal={projectGoal}
                          value={includeGoal}
                          onChange={setGoalChoice}
                          disabled={interactionBusy}
                        />
                      )}
                      {takesRubric && (
                        <ChatRubricPicker
                          owner={user.id}
                          value={rubric}
                          onChange={setRubricChoice}
                          disabled={interactionBusy}
                        />
                      )}
                    </>
                  }
                  status={
                    <ComposerStatus
                      usage={isFetching ? null : session.context_usage}
                      contextWindow={contextWindow}
                      onCompact={requestCompaction}
                      canCompact={
                        !interactionBusy &&
                        connectionStatus === "Connected" &&
                        selectedModelAvailable &&
                        !session.info.resume_error
                      }
                      compacting={isCompacting}
                      connection={connectionStatus}
                      modelId={session.info.selected_model_id}
                      general={!session.info.project_id}
                    />
                  }
                />
              </ChatInputContainer>
              <ForkStepDialog
                chatId={chatId}
                source={forkSource}
                onOpenChange={(open) => {
                  if (!open) setForkSource(null);
                }}
                onForked={async () => {
                  setSocketError(null);
                  // The fork step is pending; resuming replays it on the new branch.
                  await stream.resume();
                }}
              />
              <CompareMessageDialog
                chatId={chatId}
                messageId={compareSource?.messageId ?? null}
                currentModelId={compareSource?.modelId}
                currentModelName={compareSource?.modelName}
                onOpenChange={(open) => {
                  if (!open) setCompareSource(null);
                }}
                onCompared={async () => {
                  setSocketError(null);
                  // The new columns are pending; the job answers them one after another.
                  await stream.resume();
                }}
              />
            </div>
          </div>
        </CanvasLayout>
      </ImageActionsContext.Provider>
    </CanvasProvider>
  );
};

/** The transcript and composer while a conversation loads. */
const ChatSessionSkeleton = () => (
  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <TranscriptSkeleton
      label="Loading conversation"
      className="min-h-0 flex-1 overflow-hidden"
    />
    <div aria-hidden="true" className="mx-auto w-full max-w-4xl p-2">
      <Skeleton className="rounded-overlay h-28 w-full" />
    </div>
  </div>
);
