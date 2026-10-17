"use client";
import { ChatFileContext } from "@/features/chat/components/chat-file-context";
import { WorkspaceIdentity } from "@/features/projects/components/chat-workspace";
import { projectGetOneOptions } from "@/lib/client/@tanstack/react-query.gen";
import { AnimatedBorder } from "@/components/animated-border";
import Constellation from "@/components/logo";
import { useUser } from "@/features/auth/components/user-context";
import {
  ChatInput,
  ChatInputContainer,
} from "@/features/chat/components/chat-input";
import { ChatModelPicker } from "@/features/chat/components/chat-model-picker";
import { useChatSessionCrud } from "@/features/chat/hooks/use-chat-session-crud";
import { client } from "@/lib/api";
import { chatModelsListOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { BotIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export default function AppPage() {
  const user = useUser();
  const searchParams = useSearchParams();
  const { createChatSession } = useChatSessionCrud();
  const projectId = searchParams.get("project_id");
  const project = useQuery({
    ...projectGetOneOptions({ client, path: { project_id: projectId ?? "" } }),
    enabled: !!projectId,
    retry: false,
  });
  const workspaceAvailable = !projectId || (!!project.data && !project.error);
  const main = user.settings.main_agent;
  const [modelId, setModelId] = useState(user.settings.default_model_id ?? "");
  const models = useQuery({
    ...chatModelsListOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const modelAvailable =
    !models.error &&
    models.data?.some((model) => model.id === modelId && model.available);

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
      <WorkspaceIdentity projectId={projectId} />
      <ChatInputContainer className="border-0">
        <AnimatedBorder
          childContainerClassName="rounded-t-none"
          borderComponent={
            <div className="flex flex-col gap-1 p-2">
              <div className="bg-primary/80 text-primary-foreground border-primary/50 flex w-fit items-center justify-start gap-2 rounded-lg border p-0.5">
                <span className="flex items-center gap-1 text-sm font-medium">
                  <BotIcon className="size-4" /> {main.name}
                </span>
              </div>
              <ChatModelPicker value={modelId} onChange={setModelId} />
              {models.data && !models.error && !modelAvailable && (
                <p className="text-destructive px-2 text-sm" role="alert">
                  Choose an available chat model before starting a chat.
                </p>
              )}
            </div>
          }
        >
          <ChatFileContext projectId={projectId} />
          <ChatInput
            key={projectId ?? "general"}
            projectId={projectId}
            className="rounded-t-none!"
            placeholder="Where will your curiosity lead you today?"
            disabled={!modelAvailable || !workspaceAvailable}
            requestScope={`${main.id}:${modelId || "none"}:${searchParams.get("project_id") ?? "general"}`}
            onSubmit={({ prompt, files, requestId, draftId }) => {
              if (!modelAvailable || !workspaceAvailable)
                throw new Error(
                  "Choose an available model and workspace before sending.",
                );
              return createChatSession({
                body: {
                  request_id: requestId,
                  model_id: modelId,
                  project_id: projectId,
                  user_prompt: prompt,
                  files,
                  ...(draftId ? { draft_id: draftId } : {}),
                },
              });
            }}
          />
        </AnimatedBorder>
      </ChatInputContainer>
    </div>
  );
}
