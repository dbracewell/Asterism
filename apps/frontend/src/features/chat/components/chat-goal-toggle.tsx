"use client";

import { COMPOSER_CHIP } from "../lib/composer-chip";
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
        variant="outline"
        size="sm"
        className={cn(
          COMPOSER_CHIP,
          value &&
            "bg-accent text-accent-foreground hover:bg-accent/80 border-transparent",
        )}
        aria-pressed={value}
        aria-label="Include learning goal"
        disabled={disabled}
        onClick={() => onChange(!value)}
      >
        <TargetIcon />
        Goal
      </Button>
    </Hint>
  );
}
