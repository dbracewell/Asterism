"use client";

import { useChatWebSocket } from "@/features/chat/hooks/use-chat-websocket";
import {
  type StreamingMessage,
  type SubAgentActivity,
  updateSubAgentActivities,
} from "@/features/chat/types";
import { client } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { SkillDraftStart } from "@/lib/client";
import {
  chatMessageSendMutation,
  chatSessionDeleteMutation,
  skillDraftCreateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ReadyState } from "react-use-websocket";
import { skillDraftOptions } from "../queries";

/** The follow-up that asks the writer to fix a draft that failed validation. */
export const fixPrompt = (error: string) =>
  `The draft didn't pass validation: ${error}\n\nFix it and reply with the complete SKILL.md in a \`\`\`skill block.`;

/** A change request; the user's own edits travel with it so none are lost. */
export function revisionPrompt(request: string, edited: string | null) {
  if (edited === null) return request;
  return `I edited the draft. Start from my version:\n\n\`\`\`\`markdown\n${edited.trimEnd()}\n\`\`\`\`\n\n${request}`;
}

type DraftChat = { id: string; modelRevision: number };

/**
 * A skill drafting run on a hidden chat (ADR-0061): start it, follow its
 * stream (including sub-agents), stop it, revise it, and read the draft.
 */
export function useSkillDraft(owner: string) {
  const [chat, setChat] = useState<DraftChat | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [turn, setTurn] = useState(0);
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null);
  const [activities, setActivities] = useState<SubAgentActivity[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  const token = useQuery({
    queryKey: ["skill-draft-token", owner],
    queryFn: async () => (await authClient.token()).data?.token ?? "",
    enabled: chat !== null,
    staleTime: Infinity,
    retry: false,
  });
  // The socket refreshes a rejected token itself, so a failed read still connects.
  const jwt = token.data ?? (token.isError ? "" : null);
  const draft = useQuery({
    ...skillDraftOptions(owner, chat?.id ?? null, turn),
    enabled: chat !== null && !running,
  });

  const setBusy = (value: boolean) => {
    if (runningRef.current === value) return;
    runningRef.current = value;
    setRunning(value);
    if (!value) {
      setStreaming(null);
      setTurn((current) => current + 1);
    }
  };

  const socket = useChatWebSocket({
    chatId: chat && jwt !== null ? chat.id : null,
    jwtToken: jwt ?? "",
    onStatusChange: setBusy,
    onStreamStart: (message) => {
      setRunError(null);
      setStreaming(message);
    },
    onStreamUpdate: setStreaming,
    onSubAgentEvent: (packet) =>
      setActivities((current) => updateSubAgentActivities(current, packet)),
    onStreamComplete: () => setBusy(false),
    onStreamError: (error) => {
      setRunError(error);
      setBusy(false);
    },
  });

  // Like a chat, an accepted turn runs (or resumes after a reconnect) on resume.
  const open = socket.readyState === ReadyState.OPEN;
  const needsRun = running || draft.data?.status === "pending";
  const { sendJsonMessage } = socket;
  useEffect(() => {
    if (open && needsRun) sendJsonMessage({ type: "resume" });
  }, [open, needsRun, sendJsonMessage]);

  const create = useMutation(skillDraftCreateMutation({ client }));
  const send = useMutation(chatMessageSendMutation({ client }));
  const remove = useMutation(chatSessionDeleteMutation({ client }));

  const begin = () => {
    setActivities([]);
    setRunError(null);
    runningRef.current = true;
    setRunning(true);
  };

  return {
    chat,
    running: needsRun,
    streaming,
    activities,
    runError,
    draft,
    connection: socket.readyState,
    starting: create,
    sending: send,
    async start(body: Omit<SkillDraftStart, "request_id">) {
      const created = await create.mutateAsync({
        body: { ...body, request_id: crypto.randomUUID() },
      });
      begin();
      setChat({
        id: created.info.id,
        modelRevision: created.info.model_revision ?? 1,
      });
    },
    /** Sends a follow-up after the latest finished reply. */
    async revise(prompt: string) {
      const parent = draft.data?.message_id;
      if (!chat || !parent) return;
      await send.mutateAsync({
        path: { chat_id: chat.id },
        body: {
          request_id: crypto.randomUUID(),
          expected_model_revision: chat.modelRevision,
          user_prompt: prompt,
          parent_message_id: parent,
        },
      });
      begin();
    },
    stop() {
      sendJsonMessage({ type: "cancel" });
    },
    /** Stops the run and deletes its hidden chat; nothing was saved as a skill. */
    async discard() {
      if (!chat) return;
      if (runningRef.current) sendJsonMessage({ type: "cancel" });
      const id = chat.id;
      runningRef.current = false;
      setRunning(false);
      setChat(null);
      setStreaming(null);
      setActivities([]);
      setRunError(null);
      create.reset();
      send.reset();
      try {
        await remove.mutateAsync({ path: { chat_id: id } });
      } catch {
        // The hidden chat stays owner data and is removed with the account.
      }
    },
  };
}

export type SkillDraftRun = ReturnType<typeof useSkillDraft>;
