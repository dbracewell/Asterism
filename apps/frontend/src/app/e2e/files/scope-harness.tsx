"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChatInput,
  ChatInputContainer,
} from "@/features/chat/components/chat-input";
import { RetrievalCitations } from "@/features/chat/components/retrieval-citations";
import { ScopedFileView } from "@/features/chat/components/scoped-file-view";
import { MessageAttachments } from "@/features/chat/components/message-attachments";
import { client } from "@/lib/api";
import {
  chatMessageSendMutation,
  chatSessionGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { Button } from "@/components/ui/button";
export const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const P = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export function ChatFileScopeHarness({
  workspace,
  chat = A,
  file,
}: {
  workspace: string;
  chat?: string;
  file?: string;
}) {
  const [revision, setRevision] = useState(1);
  const [branch, setBranch] = useState(1);
  const session = useQuery(
    chatSessionGetOneOptions({ client, path: { chat_id: chat } }),
  );
  const send = useMutation(chatMessageSendMutation({ client }));
  if (file) return <ScopedFileView chatId={chat} fileId={file} />;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 pt-12">
      <h1>Chat attachment scope verification</h1>
      <p>
        {workspace === "general" ? "General" : "Project Research"} · Chat{" "}
        {chat === B ? "B" : "A"} · Model revision {revision} · Branch {branch}
      </p>
      <div className="flex gap-2">
        <Button onClick={() => setRevision((value) => value + 1)}>
          Switch test model
        </Button>
        <Button onClick={() => setBranch((value) => value + 1)}>
          Switch test branch
        </Button>
      </div>
      {session.data?.messages.map((message) => (
        <section key={message.id} aria-label="Saved message">
          <p>{message.content}</p>
          <MessageAttachments chatId={chat} files={message.files ?? []} />
          <RetrievalCitations
            chatId={chat}
            results={message.tool_call_results ?? []}
          />
        </section>
      ))}
      <ChatInputContainer className="max-w-full">
        <ChatInput
          key={chat}
          chatId={chat}
          projectId={workspace === "general" ? null : P}
          requestScope={`${chat}:${revision}:${branch}`}
          scopeKey={`${branch}:${revision}`}
          scopeLocked={send.isPending}
          disabled={send.isPending}
          onSubmit={async ({ prompt, files, requestId, draftId }) => {
            await send.mutateAsync({
              path: { chat_id: chat },
              body: {
                user_prompt: prompt,
                files,
                request_id: requestId,
                draft_id: draftId,
                expected_model_revision: revision,
                parent_message_id: session.data?.messages.at(-1)?.id ?? null,
              },
            });
          }}
        />
      </ChatInputContainer>
    </main>
  );
}
