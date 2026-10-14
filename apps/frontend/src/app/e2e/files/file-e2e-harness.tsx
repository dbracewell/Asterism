"use client";

import { ChatInput } from "@/features/chat/components/chat-input";
import { MessageAttachments } from "@/features/chat/components/message-attachments";
import { MessageFileReference } from "@/lib/client";
import { useState } from "react";

export function FileE2EHarness() {
  const [files, setFiles] = useState<MessageFileReference[]>([]);
  const [reply, setReply] = useState("");
  return <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-8">
    <h1 className="text-xl font-bold">File chat verification</h1>
    <ChatInput onSubmit={({ prompt, files: fileIds }) => {
      setFiles(fileIds.map((file_id) => ({
        file_id, filename: "report.pdf", name: "report.pdf", mime_type: "application/pdf",
        size: 12, kind: "document", status: "ready",
      })));
      setReply(`Mocked assistant reply: ${prompt}`);
    }} />
    {files.length > 0 && <section aria-label="Persisted user message"><MessageAttachments chatId="22222222-2222-4222-8222-222222222222" files={files} /></section>}
    {reply && <section aria-label="Assistant reply">{reply}</section>}
  </main>;
}
