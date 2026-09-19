"use client";

import { Button } from "@/components/ui/button";
import { SubAgentActivityPanel } from "@/features/chat/components/sub-agent-activity";
import { useChatWebSocket } from "@/features/chat/hooks/use-chat-websocket";
import {
  SubAgentActivity,
  updateSubAgentActivities,
} from "@/features/chat/types";
import { useState } from "react";

const CHAT_ID = "11111111-1111-4111-8111-111111111111";

export const SubAgentE2EHarness = () => {
  const [activities, setActivities] = useState<SubAgentActivity[]>([]);
  const [parentResponse, setParentResponse] = useState("");
  const { sendJsonMessage } = useChatWebSocket({
    chatId: CHAT_ID,
    jwtToken: "e2e-token",
    onStreamStart: () => {
      setParentResponse("");
    },
    onSubAgentEvent: (event) => {
      setActivities((current) => updateSubAgentActivities(current, event));
    },
    onStreamComplete: (messages) => {
      const assistant = messages.findLast((message) => message.role === "assistant");
      setParentResponse(assistant?.content ?? "");
    },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-8">
      <h1 className="text-xl font-bold">Sub-agent stream verification</h1>
      <Button
        onClick={() => {
          setActivities([]);
          sendJsonMessage({ type: "chat", message: "delegate" });
        }}
      >
        Delegate task
      </Button>
      <SubAgentActivityPanel activities={activities} />
      {parentResponse && (
        <section aria-label="Parent response" className="rounded-xl border p-3">
          {parentResponse}
        </section>
      )}
    </main>
  );
};
