"use client";

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectCreate } from "@/lib/client";

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
