"use client";
import { QueryError } from "@/components/query-error";
import { useUser } from "@/features/auth/components/user-context";
import {
  ChatInput,
  ChatInputContainer,
  type ChatInputHandle,
} from "@/features/chat/components/chat-input";
import { ChatModelPicker } from "@/features/chat/components/chat-model-picker";
import {
  ChatPersonaPicker,
  personaAvailable,
} from "@/features/chat/components/chat-persona-picker";
import {
  HeroMark,
  HeroSuggestions,
} from "@/features/chat/components/new-chat-hero";
import { useChatSessionCrud } from "@/features/chat/hooks/use-chat-session-crud";
import { heroSuggestions } from "@/features/chat/lib/hero-suggestions";
import { personaQueryOptions } from "@/features/settings/persona-queries";
import { eligibleSkillOptions } from "@/features/skills/queries";
import { client } from "@/lib/api";
import {
  chatModelsListOptions,
  projectGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

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
  const [personaId, setPersonaId] = useState<string | null>(null);
  const personas = useQuery(personaQueryOptions(user.id));
  const hasPersona =
    !personas.error && personaAvailable(personas.data, personaId);
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
  // Disabled skill policy or no assignments simply yields no skill suggestions.
  const skills = useQuery(eligibleSkillOptions(user.id));
  const suggestions = heroSuggestions({
    project: projectId ? project.data : null,
    skills: skills.error ? [] : skills.data?.items,
  });
  const composer = useRef<ChatInputHandle>(null);
  const sendBlocked = !modelAvailable || !workspaceAvailable || !hasPersona;

  return (
    <div className="flex min-h-fit flex-1 shrink-0 flex-col items-center p-2 pt-12">
      <div className="mt-auto flex flex-col items-center gap-3 text-center">
        <HeroMark />
        <h1 className="text-display">What should we work on?</h1>
        <p className="text-muted-foreground text-body">
          {projectId ? (
            project.data ? (
              <>
                New chat in{" "}
                <Link
                  className="text-foreground font-medium underline-offset-4 hover:underline"
                  href={`/projects/${project.data.id}`}
                >
                  {project.data.name}
                </Link>
              </>
            ) : (
              "New project chat"
            )
          ) : (
            "New chat in General"
          )}
        </p>
        {project.error && (
          <QueryError
            error={project.error}
            message="This project couldn't be loaded."
            retry={project.refetch}
            isRetrying={project.isFetching}
          />
        )}
      </div>
      <div className="mt-6 mb-auto flex w-full max-w-4xl flex-col gap-3">
        <ChatInputContainer>
          <ChatInput
            ref={composer}
            key={projectId ?? "general"}
            skillOwner={user.id}
            skillScope={`new:${projectId ?? "general"}`}
            projectId={projectId}
            placeholder="Ask anything…"
            disabled={sendBlocked}
            requestScope={`${main.id}:${modelId || "none"}:${personaId ?? "default"}:${searchParams.get("project_id") ?? "general"}`}
            modelSelector={
              <>
                <ChatModelPicker value={modelId} onChange={setChosenModelId} />
                <ChatPersonaPicker value={personaId} onChange={setPersonaId} />
              </>
            }
            onSubmit={({ prompt, files, requestId, draftId, skills }) => {
              if (sendBlocked)
                throw new Error(
                  "Choose an available model and workspace before sending.",
                );
              return createChatSession({
                body: {
                  request_id: requestId,
                  model_id: modelId,
                  persona_id: personaId,
                  project_id: projectId,
                  user_prompt: prompt,
                  files,
                  ...(skills ? { skills } : {}),
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
        <HeroSuggestions
          suggestions={suggestions}
          disabled={sendBlocked}
          onChoose={(suggestion) => composer.current?.fill(suggestion.prompt)}
        />
      </div>
    </div>
  );
}
