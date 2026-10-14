"use client";
import { AnimatedBorder } from "@/components/animated-border";
import Constellation from "@/components/logo";
import { useUser } from "@/features/auth/components/user-context";
import {
  ChatInput,
  ChatInputContainer,
} from "@/features/chat/components/chat-input";
import { useChatSessionCrud } from "@/features/chat/hooks/use-chat-session-crud";
import { BotIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";

export default function AppPage() {
  const user = useUser();
  const searchParams = useSearchParams();
  const { createChatSession } = useChatSessionCrud();
  const main = user.settings.main_agent;
  const modelAvailable = user.settings.models?.some((model) => model.id === user.settings.default_model_id);

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
      <ChatInputContainer className="border-0">
        <AnimatedBorder
          childContainerClassName="rounded-t-none"
          borderComponent={
            <div className="flex flex-col gap-1 p-2">
              <div className="bg-primary/80 text-primary-foreground border-primary/50 flex w-fit items-center justify-start gap-2 rounded-lg border p-0.5">
                <span className="flex items-center gap-1 text-sm font-medium"><BotIcon className="size-4" /> {main.name}</span>
              </div>
              {!modelAvailable && (
                <p className="text-destructive px-2 text-sm" role="alert">
                  Choose an available default model in General settings before starting a chat.
                </p>
              )}
            </div>
          }
        >
          <ChatInput
            className="rounded-t-none!"
            placeholder="Where will your curiosity lead you today?"
            disabled={!modelAvailable}
            requestScope={`${main.id}:${user.settings.default_model_id ?? "none"}:${searchParams.get("project_id") ?? "general"}`}
            onSubmit={({ prompt, files, requestId }) => {
              if (!modelAvailable) return;
              return createChatSession({
                body: {
                  request_id: requestId,
                  project_id: searchParams.get("project_id"),
                  user_prompt: prompt,
                  files,
                },
              });
            }}
          />
        </AnimatedBorder>
      </ChatInputContainer>
    </div>
  );
}
