"use client";
import {
  ChatInput,
  ChatInputContainer,
} from "@/features/chat/components/chat-input";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ActiveSkillState } from "@/lib/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function SkillChatHarness() {
  const [cache] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  );
  const [branch, setBranch] = useState("general");
  const [owner, setOwner] = useState("alice");
  const [states, setStates] = useState<Record<string, ActiveSkillState>>({});
  const [last, setLast] = useState("");
  const state = states[`${owner}:${branch}`] ?? { revision: 0, skills: [] };
  return (
    <QueryClientProvider client={cache}>
      <TooltipProvider>
        <main className="flex h-dvh min-w-0 flex-col gap-3 overflow-y-auto p-2">
          <div className="flex flex-wrap gap-1">
            <Button onClick={() => setBranch("general")}>General</Button>
            <Button onClick={() => setBranch("project")}>Project</Button>
            <Button
              onClick={() => setOwner(owner === "alice" ? "bob" : "alice")}
            >
              Switch owner
            </Button>
          </div>
          <p>
            {owner} · {branch}
          </p>
          <output aria-label="Last accepted payload" className="break-all">
            {last}
          </output>
          <div className="mt-auto min-w-0">
            <ChatInputContainer>
              <ChatInput
                key={`${owner}:${branch}:${state.revision ?? 0}`}
                skillOwner={owner}
                skillScope={`${branch}:${state.revision ?? 0}`}
                activeSkills={state}
                onSubmit={async (data) => {
                  const response = await fetch("/api/py/test-skill-send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data),
                  });
                  if (!response.ok)
                    throw new Error("Selection rejected; remove or retry.");
                  setLast(JSON.stringify(data));
                  if (data.skills)
                    setStates((prev) => ({
                      ...prev,
                      [`${owner}:${branch}`]: {
                        revision: (state.revision ?? 0) + 1,
                        skills: data.skills!.skill_ids.map((id) => ({
                          id,
                          name: id.endsWith("1") ? "review" : "write",
                          revision: 1,
                          digest: "accepted",
                          available: true,
                        })),
                      },
                    }));
                }}
              />
            </ChatInputContainer>
          </div>
        </main>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
