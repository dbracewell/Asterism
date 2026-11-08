"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { client } from "@/lib/api";
import type { ProjectAreas } from "@/lib/client";
import { projectSubAgentGetManyOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";

export const ALL_AREAS: ProjectAreas = {
  study: true,
  reflections: true,
  goal: true,
  sub_agents: true,
};

const AREAS: { key: keyof ProjectAreas; label: string; description: string }[] =
  [
    {
      key: "study",
      label: "Study",
      description:
        "The Study tab: flashcards, quizzes, notes, weak spots and topic mastery.",
    },
    {
      key: "reflections",
      label: "Reflections",
      description: "The Reflections tab for writing about your work.",
    },
    {
      key: "goal",
      label: "Goal",
      description:
        "A learning goal and target date, shown on Overview and edited here.",
    },
    {
      key: "sub_agents",
      label: "Sub-agents",
      description:
        "The Sub-agents tab, where you choose who chats here can delegate to.",
    },
  ];

/**
 * One switch per optional area (US-65.2). Areas only change what the page
 * shows: hidden data is kept, and nothing is granted or taken away.
 */
export function ProjectAreaSwitches({
  projectId,
  value,
  onChange,
  disabled,
}: {
  /** Absent before the project exists, when nothing can be selected yet. */
  projectId?: string;
  value: ProjectAreas;
  onChange: (value: ProjectAreas) => void;
  disabled: boolean;
}) {
  return (
    <FieldSet>
      <FieldLegend>Feature areas</FieldLegend>
      <FieldDescription>
        Turn off the parts of this project you don&apos;t use. Overview, Chats,
        Files and Settings are always shown. Turning an area off hides it but
        keeps its data, and changes nothing about what chats can do. You can
        change these later in Settings.
      </FieldDescription>
      <FieldGroup>
        {AREAS.map((area) => (
          <Field key={area.key} orientation="horizontal">
            <Switch
              id={`project-area-${area.key}`}
              checked={value[area.key]}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange({ ...value, [area.key]: checked })
              }
            />
            <FieldContent>
              <FieldLabel htmlFor={`project-area-${area.key}`}>
                {area.label}
              </FieldLabel>
              <FieldDescription>{area.description}</FieldDescription>
              {area.key === "sub_agents" && projectId && (
                <SelectedSubAgents projectId={projectId} />
              )}
            </FieldContent>
          </Field>
        ))}
      </FieldGroup>
    </FieldSet>
  );
}

/** Hiding the tab never deselects sub-agents, so say how many stay in use. */
function SelectedSubAgents({ projectId }: { projectId: string }) {
  const selected = useQuery(
    projectSubAgentGetManyOptions({
      client,
      path: { project_id: projectId },
      query: { page: 1, page_size: 1 },
    }),
  );
  const total = selected.data?.total;
  if (!total) return null;
  return (
    <FieldDescription>
      {total === 1
        ? "1 sub-agent is selected."
        : `${total} sub-agents are selected.`}{" "}
      Hiding this tab keeps them selected, and chats can still delegate to them.
    </FieldDescription>
  );
}
