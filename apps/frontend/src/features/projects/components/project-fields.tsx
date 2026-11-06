"use client";

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PROJECT_ACCENTS,
  ProjectAccentDot,
  type ProjectAccent,
} from "@/features/projects/project-accent";
import type { ProjectCreate } from "@/lib/client";

const NO_ACCENT = "none";

export function ProjectFields({
  value,
  onChange,
  disabled,
}: {
  value: ProjectCreate;
  onChange: (value: ProjectCreate) => void;
  disabled: boolean;
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="project-name">Name</FieldLabel>
        <Input
          id="project-name"
          required
          data-1p-ignore
          maxLength={255}
          value={value.name}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="project-description">Description</FieldLabel>
        <Textarea
          id="project-description"
          maxLength={10000}
          value={value.description ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, description: event.target.value })
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="project-accent">Sidebar color</FieldLabel>
        <Select
          value={value.accent ?? NO_ACCENT}
          disabled={disabled}
          onValueChange={(accent) =>
            onChange({
              ...value,
              accent: accent === NO_ACCENT ? null : (accent as ProjectAccent),
            })
          }
        >
          <SelectTrigger id="project-accent" className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_ACCENT}>No color</SelectItem>
            {Object.entries(PROJECT_ACCENTS).map(([accent, { label }]) => (
              <SelectItem key={accent} value={accent}>
                <ProjectAccentDot accent={accent as ProjectAccent} />
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="project-goal">Learning goal</FieldLabel>
        <Textarea
          id="project-goal"
          rows={2}
          maxLength={1000}
          value={value.goal ?? ""}
          disabled={disabled}
          aria-describedby="project-goal-help"
          onChange={(event) => onChange({ ...value, goal: event.target.value })}
        />
        <FieldDescription id="project-goal-help">
          What you&apos;re working toward, such as &ldquo;Write a 1,500-word
          essay on the Silk Road&rdquo;. It is shared with a chat only when you
          include it in a message.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="project-goal-date">
          Target date (optional)
        </FieldLabel>
        <Input
          id="project-goal-date"
          type="date"
          className="w-full sm:w-48"
          value={value.goal_target_date ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, goal_target_date: event.target.value || null })
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="project-instructions">
          Project instructions
        </FieldLabel>
        <Textarea
          id="project-instructions"
          rows={8}
          maxLength={100000}
          value={value.system_prompt ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, system_prompt: event.target.value })
          }
        />
        <FieldDescription>
          Applies to later turns in this project. Instructions do not grant
          additional tools or file access.
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}
