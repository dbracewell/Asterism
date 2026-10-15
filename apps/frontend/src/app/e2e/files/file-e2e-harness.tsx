"use client";

import { ChatInput } from "@/features/chat/components/chat-input";
import { MessageAttachments } from "@/features/chat/components/message-attachments";
import { client } from "@/lib/api";
import { MessageFileReference } from "@/lib/client";
import { chatMessageSendMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export function FileE2EHarness() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [files, setFiles] = useState<MessageFileReference[]>([]);
  const [reply, setReply] = useState("");
  const send = useMutation(chatMessageSendMutation({ client }));
  if (!ready) return null;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-8">
      <h1 className="text-xl font-bold">File chat verification</h1>
      <ChatInput
        onSubmit={async ({ prompt, files: fileIds, requestId }) => {
          const accepted = await send.mutateAsync({
            path: { chat_id: "22222222-2222-4222-8222-222222222222" },
            body: {
              user_prompt: prompt,
              expected_model_revision: 1,
              files: fileIds,
              request_id: requestId,
              parent_message_id: null,
            },
          });
          setFiles(accepted.files ?? []);
          setReply(`Mocked assistant reply: ${prompt}`);
        }}
      />
      {files.length > 0 && (
        <section aria-label="Persisted user message">
          <MessageAttachments
            chatId="22222222-2222-4222-8222-222222222222"
            files={files}
          />
        </section>
      )}
      {reply && <section aria-label="Assistant reply">{reply}</section>}
    </main>
  );
}
