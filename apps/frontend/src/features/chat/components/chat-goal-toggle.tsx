"use client";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { client } from "@/lib/api";
import { projectGetOneOptions } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { TargetIcon } from "lucide-react";

/** The project's learning goal, or null outside a project or without one. */
export function useProjectGoal(projectId: string | null | undefined) {
  const project = useQuery({
    ...projectGetOneOptions({ client, path: { project_id: projectId ?? "" } }),
    enabled: !!projectId,
    retry: false,
  });
  const goal = projectId ? project.data?.goal.trim() : "";
  return goal || null;
}

/**
 * Includes the project's learning goal in the next message (US-58.1). The goal
 * reaches the chat only while this is on, and the message records it.
 */
export function ChatGoalToggle({
  goal,
  value,
  onChange,
  disabled = false,
}: {
  goal: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Hint
      hint={
        value ? `Including your goal: ${goal}` : "Include your project goal"
      }
    >
      <Button
        type="button"
        variant={value ? "secondary" : "ghost"}
        size="lg"
        className={cn("rounded-control", !value && "text-muted-foreground")}
        aria-pressed={value}
        aria-label="Include learning goal"
        disabled={disabled}
        onClick={() => onChange(!value)}
      >
        <TargetIcon />
        <span className="hidden sm:inline">Goal</span>
      </Button>
    </Hint>
  );
}
