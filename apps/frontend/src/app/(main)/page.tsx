"use client";
import Constellation from "@/components/logo";
import { useUser } from "@/features/auth/components/user-context";
import ChatInput from "@/features/chat/components/chat-input";
import { useChatSessionCrud } from "@/hooks/use-chat-session-crud";
import { useSearchParams } from "next/navigation";

export default function AppPage() {
  const user = useUser();
  const searchParams = useSearchParams();
  const { createChatSession } = useChatSessionCrud();
  return (
    <div className="from-primary/5 via-primary/15 relative flex flex-1 flex-col items-center justify-center gap-6 bg-radial-[at_50%_50%] via-5% to-transparent to-60% p-2 pt-12">
      <Constellation
        className="repeat-[1] fill-mode-[forwards] absolute -z-10 animate-ping opacity-100 duration-500"
        fill="var(--color-secondary)"
        size={250}
      />
      <h1 className="z-1 text-4xl font-bold">
        Welcome <span className="text-primary">{user.name.split(" ")[0]}</span>
      </h1>
      <ChatInput
        disabled={false}
        displayStatus={false}
        placeholder="Where will your curiosity lead you today?"
        onSubmit={({ prompt, model }) => {
          createChatSession({
            body: {
              folder_id: searchParams.get("folder_id"),
              user_prompt: prompt,
              model,
            },
          });
        }}
      />
    </div>
  );
}
