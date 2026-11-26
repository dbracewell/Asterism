"use client";

import { Button } from "@/components/ui/button";
import type { ChatInfo } from "@/lib/client";
import { NotebookPenIcon } from "lucide-react";
import { useState } from "react";
import { useReflectionsShown } from "../queries";
import { ReflectDialog } from "./reflect-dialog";

/**
 * Reflect from the chat header (US-111.1), once the chat has an answer and
 * where reflections are offered (`useReflectionsShown`). Icon only on narrow
 * screens; the name is always "Reflect on this session".
 */
export function ReflectButton({
  chat,
  answered,
}: {
  chat: ChatInfo;
  answered: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = useReflectionsShown(chat);
  if (!shown || !answered) return null;
  return (
    <>
      <Button
        variant="ghost"
        aria-label="Reflect on this session"
        title="Reflect on this session"
        className="size-11 shrink-0 md:h-8 md:w-auto md:px-2"
        onClick={() => setOpen(true)}
      >
        <NotebookPenIcon aria-hidden="true" />
        <span aria-hidden="true" className="hidden md:inline">
          Reflect
        </span>
      </Button>
      <ReflectDialog
        chatId={chat.id}
        projectId={chat.project_id ?? null}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
