"use client";
import { WorkspaceIdentity } from "@/features/projects/components/chat-workspace";
import { projectGetOneOptions } from "@/lib/client/@tanstack/react-query.gen";
import { Badge } from "@/components/ui/badge";
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
  const [chosenModelId, setChosenModelId] = useState(
    user.settings.default_model_id ?? "",
  );
  const models = useQuery({
    ...chatModelsListOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const availableModels = models.data?.filter((model) => model.available);
  // With no explicit choice or default, a lone available model is preselected.
  const modelId =
    chosenModelId ||
    (availableModels?.length === 1 ? availableModels[0].id : "");
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
      <Badge variant="secondary" className="h-6 gap-1.5 px-2.5 text-xs">
        <BotIcon /> {main.name}
      </Badge>
      <div className="flex w-full max-w-4xl flex-col gap-2">
        <ChatInputContainer>
          <ChatInput
            key={projectId ?? "general"}
            projectId={projectId}
            placeholder="Ask anything…"
            disabled={!modelAvailable || !workspaceAvailable}
            requestScope={`${main.id}:${modelId || "none"}:${searchParams.get("project_id") ?? "general"}`}
            modelSelector={
              <ChatModelPicker value={modelId} onChange={setChosenModelId} />
            }
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
        </ChatInputContainer>
        {models.data && !models.error && !modelAvailable && (
          <p className="text-destructive px-2 text-sm" role="alert">
            Choose an available chat model before starting a chat.
          </p>
        )}
      </div>
    </div>
  );
}
