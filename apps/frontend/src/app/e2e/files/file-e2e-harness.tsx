"use client";

import ChatInput from "@/features/chat/components/chat-input";
import { MessageAttachments } from "@/features/chat/components/message-attachments";
import { MessageFileReference } from "@/lib/client";
import { useState } from "react";

export function FileE2EHarness() {
  const [files, setFiles] = useState<MessageFileReference[]>([]);
  const [reply, setReply] = useState("");
  return <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-8">
    <h1 className="text-xl font-bold">File chat verification</h1>
    <ChatInput onSubmit={({ prompt, files: filenames }) => {
      setFiles(filenames.map((filename) => ({
        filename, name: filename, mime_type: filename.endsWith(".png") ? "image/png" : "application/pdf",
        size: 12, kind: filename.endsWith(".png") ? "image" : "document", status: "ready",
      })));
      setReply(`Mocked assistant reply: ${prompt}`);
    }} status="Connected" />
    {files.length > 0 && <section aria-label="Persisted user message"><MessageAttachments files={files} /></section>}
    {reply && <section aria-label="Assistant reply">{reply}</section>}
  </main>;
}
