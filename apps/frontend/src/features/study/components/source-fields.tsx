"use client";

import { QueryError } from "@/components/query-error";
import { ModelSelector } from "@/components/settings/model-selector";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useUser } from "@/features/auth/components/user-context";
import { client } from "@/lib/api";
import {
  chatModelsListOptions,
  projectFileGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export const MAX_SOURCE_FILES = 10;

type Scope = "all" | "choose";

/** Source-file choice for study generation: the whole project (up to 10) or chosen files. */
export function useSourceFiles(projectId: string) {
  const [scope, setScope] = useState<Scope>("all");
  const [chosen, setChosen] = useState<string[]>([]);
  const files = useQuery({
    ...projectFileGetManyOptions({
      client,
      path: { project_id: projectId },
      query: { page: 1, page_size: 100, sort_by: "name" },
    }),
    retry: false,
  });
  const projectFiles = files.data?.files ?? [];
  const valid =
    scope === "all"
      ? projectFiles.length > 0 && projectFiles.length <= MAX_SOURCE_FILES
      : chosen.length > 0;
  return {
    scope,
    setScope,
    chosen,
    setChosen,
    files,
    valid,
    /** `null` asks the server for the whole project scope. */
    fileIds: scope === "all" ? null : chosen,
  };
}

export function SourceFilesFieldset({
  idPrefix,
  disabled,
  source,
}: {
  idPrefix: string;
  disabled: boolean;
  source: ReturnType<typeof useSourceFiles>;
}) {
  const { scope, setScope, chosen, setChosen, files } = source;
  const projectFiles = files.data?.files ?? [];
  return (
    <FieldSet>
      <FieldLegend variant="label">Source files</FieldLegend>
      <RadioGroup
        value={scope}
        onValueChange={(value) => setScope(value as Scope)}
        disabled={disabled}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="all" id={`${idPrefix}-scope-all`} />
          <Label htmlFor={`${idPrefix}-scope-all`}>
            All project files (up to {MAX_SOURCE_FILES})
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="choose" id={`${idPrefix}-scope-choose`} />
          <Label htmlFor={`${idPrefix}-scope-choose`}>Choose files</Label>
        </div>
      </RadioGroup>
      {files.error && (
        <QueryError
          error={files.error}
          message="Could not load project files."
          retry={files.refetch}
          isRetrying={files.isFetching}
        />
      )}
      {files.data && projectFiles.length === 0 && (
        <FieldDescription>
          This project has no files yet. Add files on the project page first.
        </FieldDescription>
      )}
      {scope === "all" && projectFiles.length > MAX_SOURCE_FILES && (
        <FieldDescription>
          This project has more than {MAX_SOURCE_FILES} files. Choose the files
          to use.
        </FieldDescription>
      )}
      {scope === "choose" && projectFiles.length > 0 && (
        <ul
          aria-label="Project files"
          className="flex max-h-64 flex-col gap-2 overflow-y-auto"
        >
          {projectFiles.map((file) => {
            const checked = chosen.includes(file.id);
            const id = `${idPrefix}-file-${file.id}`;
            return (
              <li key={file.id} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={
                    disabled || (!checked && chosen.length >= MAX_SOURCE_FILES)
                  }
                  onCheckedChange={(next) =>
                    setChosen(
                      next
                        ? [...chosen, file.id]
                        : chosen.filter((item) => item !== file.id),
                    )
                  }
                />
                <Label htmlFor={id} className="min-w-0 truncate">
                  {file.filename}
                </Label>
              </li>
            );
          })}
        </ul>
      )}
      {scope === "choose" && (
        <FieldDescription>
          {chosen.length} of up to {MAX_SOURCE_FILES} files chosen.
        </FieldDescription>
      )}
    </FieldSet>
  );
}

/**
 * The learner's model choice among available chat models. Falls back to
 * `preferredId` (when available), then the user's default, then the first.
 */
export function useStudyModel(preferredId?: string | null) {
  const user = useUser();
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const models = useQuery({
    ...chatModelsListOptions({ client }),
    retry: false,
  });
  const availableModels = (models.data ?? []).filter(
    (model) => model.available,
  );
  const has = (id: string | null | undefined) =>
    !!id && availableModels.some((model) => model.id === id);
  const model = has(modelId)
    ? modelId
    : has(preferredId)
      ? (preferredId ?? undefined)
      : has(user.settings.default_model_id)
        ? (user.settings.default_model_id ?? undefined)
        : availableModels[0]?.id;
  return { models, availableModels, model, setModelId };
}

export function StudyModelField({
  id,
  label = "Model",
  description,
  disabled,
  choice,
}: {
  id: string;
  label?: string;
  description?: string;
  disabled: boolean;
  choice: ReturnType<typeof useStudyModel>;
}) {
  const { models, availableModels, model, setModelId } = choice;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <ModelSelector
        id={id}
        value={model}
        onValueChange={setModelId}
        availableModels={availableModels}
        disabled={disabled || models.isPending || !!models.error}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      {models.error && (
        <QueryError
          error={models.error}
          message="Could not load models."
          retry={models.refetch}
          isRetrying={models.isFetching}
        />
      )}
      {models.data && availableModels.length === 0 && (
        <FieldDescription>
          No models are available. Ask an administrator to enable one.
        </FieldDescription>
      )}
    </Field>
  );
}
