"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client } from "@/lib/api";
import type {
  PackImportRequest,
  PackImportResult,
  PackModelOption,
  PackReview,
  PackSubAgentReview,
} from "@/lib/client";
import {
  teamPackImportMutation,
  teamPackReviewMutation,
  teamPackStarterGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type ReactNode, useId, useState } from "react";

// Mirrors the pack format limit (ADR-0051).
const MAX_PACK_BYTES = 1_048_576;

const REQUIREMENT_LABELS = {
  tools: "tools",
  vision: "vision",
  context_window: "the requested context window",
};

type ItemChoice = { include: boolean; name: string };
type AgentChoice = ItemChoice & { modelId: string; tools: string[] };
type SkillChoice = ItemChoice & { assign: boolean };
type Choices<T> = Record<string, T>;

function errorDetail(error: unknown, fallback: string) {
  return error &&
    typeof error === "object" &&
    "detail" in error &&
    typeof error.detail === "string"
    ? error.detail
    : fallback;
}

function requirementText(agent: PackSubAgentReview) {
  const { tools, vision, min_context_window } = agent.model_requirements ?? {};
  const needs = [
    tools && "tools",
    vision && "vision",
    min_context_window &&
      `${min_context_window.toLocaleString()} token context window`,
  ].filter(Boolean);
  return needs.length ? `Needs ${needs.join(", ")}` : "No model requirements";
}

function initialChoices<T>(
  items: { key: string }[],
  extra: T,
): Choices<ItemChoice & T> {
  return Object.fromEntries(
    items.map((item) => [item.key, { include: true, name: "", ...extra }]),
  );
}

/** Pack text is someone else's: shown as plain text, never as Markdown. */
function PackText({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="grid gap-1">
      <p className="text-muted-foreground text-sm">{label}</p>
      <pre
        tabIndex={0}
        aria-label={label}
        className="bg-muted rounded-surface max-h-48 overflow-auto p-3 text-sm wrap-anywhere whitespace-pre-wrap"
      >
        {text}
      </pre>
    </div>
  );
}

function ItemCard({
  title,
  choice,
  conflict,
  onChange,
  children,
}: {
  title: string;
  choice: ItemChoice;
  conflict: boolean;
  onChange: (change: Partial<ItemChoice>) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Checkbox
            id={id}
            checked={choice.include}
            aria-label={`Import ${title}`}
            onCheckedChange={(checked) =>
              onChange({ include: checked === true })
            }
          />
          <label htmlFor={id} className="wrap-anywhere">
            {title}
          </label>
          {conflict && <Badge variant="destructive">Name already in use</Badge>}
        </CardTitle>
      </CardHeader>
      {choice.include && (
        <CardContent className="grid gap-4">
          {conflict && (
            <Field>
              <FieldLabel htmlFor={`${id}-name`}>
                New name for {title}
              </FieldLabel>
              <Input
                id={`${id}-name`}
                value={choice.name}
                onChange={(event) => onChange({ name: event.target.value })}
              />
            </Field>
          )}
          {children}
        </CardContent>
      )}
    </Card>
  );
}

function ModelPicker({
  agent,
  choice,
  onChange,
}: {
  agent: PackSubAgentReview;
  choice: AgentChoice;
  onChange: (change: Partial<AgentChoice>) => void;
}) {
  const selected = agent.model_options.find(
    (option) => option.id === choice.modelId,
  );
  const unmet = selected?.unmet_requirements ?? [];
  return (
    <Field>
      <FieldLabel>Model for {agent.name}</FieldLabel>
      <p className="text-muted-foreground text-sm">{requirementText(agent)}</p>
      {agent.model_options.length === 0 ? (
        <p role="alert" className="text-destructive text-sm">
          No models are available. Skip this sub-agent or ask your administrator
          to enable one.
        </p>
      ) : (
        <Select
          value={choice.modelId}
          onValueChange={(modelId) => onChange({ modelId })}
        >
          <SelectTrigger aria-label={`Model for ${agent.name}`}>
            <SelectValue placeholder="Choose a model" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {agent.model_options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {modelLabel(option)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      {unmet.length > 0 && (
        <p className="text-muted-foreground text-sm">
          This model doesn&apos;t confirm{" "}
          {unmet.map((item) => REQUIREMENT_LABELS[item]).join(", ")}. The
          sub-agent may not work as the pack intends.
        </p>
      )}
    </Field>
  );
}

function modelLabel(option: PackModelOption) {
  return `${option.name} (${option.provider_name})`;
}

function ToolApprovals({
  agent,
  choice,
  onChange,
}: {
  agent: PackSubAgentReview;
  choice: AgentChoice;
  onChange: (change: Partial<AgentChoice>) => void;
}) {
  const prefix = useId();
  if (agent.requested_tools.length === 0) {
    return <p className="text-sm">Requests no tools.</p>;
  }
  return (
    <FieldGroup className="gap-2">
      <p className="text-sm font-medium">Requested tools</p>
      {agent.requested_tools.map((tool) => (
        <div key={tool.name} className="flex items-center gap-2 text-sm">
          <Checkbox
            id={`${prefix}-${tool.name}`}
            disabled={!tool.available}
            checked={choice.tools.includes(tool.name)}
            onCheckedChange={(checked) =>
              onChange({
                tools:
                  checked === true
                    ? [...choice.tools, tool.name]
                    : choice.tools.filter((name) => name !== tool.name),
              })
            }
          />
          <label htmlFor={`${prefix}-${tool.name}`}>
            Allow {tool.name}
            {!tool.available && " (not available here)"}
          </label>
        </div>
      ))}
    </FieldGroup>
  );
}

function needsToolModel(agent: PackSubAgentReview, choice: AgentChoice) {
  return (
    choice.tools.length > 0 &&
    agent.model_options
      .find((option) => option.id === choice.modelId)
      ?.unmet_requirements.includes("tools") === true
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

function PackReviewForm({
  review,
  source,
  onImported,
}: {
  review: PackReview;
  source: string;
  onImported: (result: PackImportResult) => void;
}) {
  const [agents, setAgents] = useState<Choices<AgentChoice>>(() =>
    initialChoices(review.sub_agents, {
      modelId: "",
      tools: [] as string[],
    }),
  );
  const [skills, setSkills] = useState<Choices<SkillChoice>>(() =>
    initialChoices(review.skills, { assign: false }),
  );
  const [templates, setTemplates] = useState<Choices<ItemChoice>>(() =>
    initialChoices(review.templates, {}),
  );
  const [rubrics, setRubrics] = useState<Choices<ItemChoice>>(() =>
    initialChoices(review.rubrics, {}),
  );
  const [project, setProject] = useState<ItemChoice>({
    include: review.project !== null,
    name: "",
  });
  const importPack = useMutation({
    ...teamPackImportMutation({ client }),
    onSuccess: onImported,
  });

  const unresolved = (
    items: { key: string; name_conflict: boolean }[],
    choices: Choices<ItemChoice>,
  ) =>
    items.some(
      (item) =>
        item.name_conflict &&
        choices[item.key].include &&
        !choices[item.key].name.trim(),
    );
  const count =
    [agents, skills, templates, rubrics]
      .flatMap((choices) => Object.values(choices))
      .filter((choice) => choice.include).length +
    (review.project && project.include ? 1 : 0);
  const blocked =
    count === 0 ||
    unresolved(review.sub_agents, agents) ||
    unresolved(review.skills, skills) ||
    unresolved(review.templates, templates) ||
    unresolved(review.rubrics, rubrics) ||
    (review.project?.name_conflict === true &&
      project.include &&
      !project.name.trim()) ||
    review.sub_agents.some((agent) => {
      const choice = agents[agent.key];
      return (
        choice.include && (!choice.modelId || needsToolModel(agent, choice))
      );
    });

  const decision = (key: string, choice: ItemChoice) => ({
    key,
    include: choice.include,
    name: choice.include && choice.name.trim() ? choice.name.trim() : null,
  });
  const submit = () => {
    const body: PackImportRequest = {
      source,
      sub_agents: review.sub_agents.map(({ key }) => ({
        ...decision(key, agents[key]),
        model_id: agents[key].include ? agents[key].modelId : null,
        approved_tools: agents[key].include ? agents[key].tools : [],
      })),
      skills: review.skills.map(({ key }) => ({
        ...decision(key, skills[key]),
        assign_to_main_agent: skills[key].include && skills[key].assign,
      })),
      templates: review.templates.map(({ key }) =>
        decision(key, templates[key]),
      ),
      rubrics: review.rubrics.map(({ key }) => decision(key, rubrics[key])),
      project: review.project
        ? {
            include: project.include,
            name:
              project.include && project.name.trim()
                ? project.name.trim()
                : null,
          }
        : null,
    };
    importPack.mutate({ body });
  };
  const update =
    <T,>(set: (change: (current: Choices<T>) => Choices<T>) => void) =>
    (key: string, change: Partial<T>) =>
      set((current) => ({
        ...current,
        [key]: { ...current[key], ...change },
      }));
  const updateAgent = update<AgentChoice>(setAgents);
  const updateSkill = update<SkillChoice>(setSkills);
  const updateTemplate = update<ItemChoice>(setTemplates);
  const updateRubric = update<ItemChoice>(setRubrics);
  const agentNames = new Map(
    review.sub_agents.map((agent) => [agent.key, agent.name]),
  );

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="font-medium wrap-anywhere">
          {review.pack.name} {review.pack.version}
        </p>
        {review.pack.author && (
          <p className="text-muted-foreground text-sm wrap-anywhere">
            Pack author: {review.pack.author} (as stated by the pack)
          </p>
        )}
        <PackText
          label="Pack description"
          text={review.pack.description ?? ""}
        />
      </div>
      <p role="note" className="bg-muted rounded-surface p-3 text-sm">
        Nothing is created until you confirm. Everything below was written by
        the pack&apos;s author, so read it first: instructions you import shape
        how your agents behave. Importing grants only what you approve here.
      </p>

      {review.sub_agents.length > 0 && (
        <Section title="Sub-agents">
          {review.sub_agents.map((agent) => (
            <ItemCard
              key={agent.key}
              title={agent.name}
              choice={agents[agent.key]}
              conflict={agent.name_conflict}
              onChange={(change) => updateAgent(agent.key, change)}
            >
              <PackText
                label={`Description of ${agent.name}`}
                text={agent.description}
              />
              <PackText
                label={`Instructions for ${agent.name}`}
                text={agent.instructions}
              />
              <p className="text-sm">Up to {agent.max_steps} steps per run.</p>
              <ModelPicker
                agent={agent}
                choice={agents[agent.key]}
                onChange={(change) => updateAgent(agent.key, change)}
              />
              <ToolApprovals
                agent={agent}
                choice={agents[agent.key]}
                onChange={(change) => updateAgent(agent.key, change)}
              />
              {needsToolModel(agent, agents[agent.key]) && (
                <p role="alert" className="text-destructive text-sm">
                  Choose a model that supports tools, or remove the tools you
                  allowed.
                </p>
              )}
            </ItemCard>
          ))}
        </Section>
      )}

      {review.skills.length > 0 && (
        <Section title="Skills">
          {review.skills.map((skill) => (
            <ItemCard
              key={skill.key}
              title={skill.name}
              choice={skills[skill.key]}
              conflict={skill.name_conflict}
              onChange={(change) => updateSkill(skill.key, change)}
            >
              <PackText
                label={`Skill document for ${skill.name}`}
                text={skill.content}
              />
              {skill.assignment_requested && (
                <SkillAssignment
                  name={skill.name}
                  allowed={skill.assignment_allowed}
                  checked={skills[skill.key].assign}
                  onChange={(assign) => updateSkill(skill.key, { assign })}
                />
              )}
            </ItemCard>
          ))}
        </Section>
      )}

      {review.templates.length > 0 && (
        <Section title="Templates">
          {review.templates.map((template) => (
            <ItemCard
              key={template.key}
              title={template.name}
              choice={templates[template.key]}
              conflict={template.name_conflict}
              onChange={(change) => updateTemplate(template.key, change)}
            >
              <PackText
                label={`Template ${template.name}`}
                text={JSON.stringify(template.document, null, 2)}
              />
            </ItemCard>
          ))}
        </Section>
      )}

      {review.rubrics.length > 0 && (
        <Section title="Rubrics">
          {review.rubrics.map((rubric) => (
            <ItemCard
              key={rubric.key}
              title={rubric.name}
              choice={rubrics[rubric.key]}
              conflict={rubric.name_conflict}
              onChange={(change) => updateRubric(rubric.key, change)}
            >
              <PackText
                label={`Rubric ${rubric.name}`}
                text={JSON.stringify(rubric.document, null, 2)}
              />
            </ItemCard>
          ))}
        </Section>
      )}

      {review.project && (
        <Section title="Project">
          <ItemCard
            title={review.project.name}
            choice={project}
            conflict={review.project.name_conflict}
            onChange={(change) =>
              setProject((current) => ({ ...current, ...change }))
            }
          >
            <PackText
              label="Project description"
              text={review.project.description ?? ""}
            />
            <PackText
              label="Project instructions"
              text={review.project.system_prompt ?? ""}
            />
            <PackText label="Project goal" text={review.project.goal ?? ""} />
            <p className="text-sm wrap-anywhere">
              {review.project.sub_agents?.length
                ? `Selects these sub-agents, if you import them: ${review.project.sub_agents
                    .map((key) => agentNames.get(key))
                    .join(", ")}.`
                : "Selects no sub-agents."}
            </p>
          </ItemCard>
        </Section>
      )}

      {importPack.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(
            importPack.error,
            "Could not import the pack. Nothing was created.",
          )}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          disabled={blocked || importPack.isPending}
          onClick={submit}
          type="button"
        >
          {importPack.isPending
            ? "Importing..."
            : `Import ${count} ${count === 1 ? "item" : "items"}`}
        </Button>
      </div>
    </div>
  );
}

function SkillAssignment({
  name,
  allowed,
  checked,
  onChange,
}: {
  name: string;
  allowed: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-sm">
      <Checkbox
        id={id}
        disabled={!allowed}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label htmlFor={id}>
        Assign {name} to my main agent
        {!allowed && " (skills are turned off by your administrator)"}
      </label>
    </div>
  );
}

function StarterPacks({
  onReview,
  disabled,
}: {
  onReview: (source: string) => void;
  disabled: boolean;
}) {
  const starters = useQuery({
    ...teamPackStarterGetManyOptions({ client }),
    retry: false,
  });
  return (
    <Section title="Starter packs">
      {starters.isPending && (
        <ListSkeleton label="Loading starter packs" rows={3} detail />
      )}
      {starters.error && (
        <QueryError
          error={starters.error}
          message="Could not load starter packs."
          retry={starters.refetch}
          isRetrying={starters.isFetching}
        />
      )}
      {starters.data?.items.map((starter) => (
        <Card key={starter.id}>
          <CardHeader>
            <CardTitle className="text-base">{starter.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              {starter.description}
            </p>
            <Button
              aria-label={`Review ${starter.name}`}
              disabled={disabled}
              onClick={() => onReview(starter.source)}
              type="button"
              variant="outline"
            >
              Review
            </Button>
          </CardContent>
        </Card>
      ))}
    </Section>
  );
}

/**
 * Imports a team pack (US-59.3): read a file or pick a starter (US-59.4), review
 * it, then confirm. Starters take the same path, so they earn no extra trust.
 */
export function ImportPack() {
  const router = useRouter();
  const inputId = useId();
  const [source, setSource] = useState("");
  const [fileError, setFileError] = useState("");
  const [imported, setImported] = useState<PackImportResult | null>(null);
  const reviewPack = useMutation({
    ...teamPackReviewMutation({ client }),
    meta: { skipGlobalInvalidation: true },
  });

  const clear = () => {
    reviewPack.reset();
    setImported(null);
    setFileError("");
    setSource("");
  };
  const review = (text: string) => {
    clear();
    setSource(text);
    reviewPack.mutate({ body: { source: text } });
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    clear();
    if (!file) return;
    if (file.size > MAX_PACK_BYTES) {
      setFileError("This file is larger than the 1 MiB pack limit.");
      return;
    }
    review(await file.text());
  };

  const finish = (result: PackImportResult) => {
    if (result.project_id) router.push(`/projects/${result.project_id}`);
    else setImported(result);
  };

  return (
    <PageLayout>
      <PageHeader
        title="Import team pack"
        description="See exactly what a pack asks for before anything is added."
      />
      <StarterPacks onReview={review} disabled={reviewPack.isPending} />
      <Field>
        <FieldLabel htmlFor={inputId}>Team pack file</FieldLabel>
        <Input
          id={inputId}
          type="file"
          accept=".json,application/json"
          onChange={chooseFile}
        />
      </Field>
      {fileError && (
        <p role="alert" className="text-destructive text-sm">
          {fileError}
        </p>
      )}
      {reviewPack.isPending && <p className="text-sm">Reading the pack...</p>}
      {reviewPack.error && (
        <p role="alert" className="text-destructive text-sm wrap-anywhere">
          {errorDetail(reviewPack.error, "Could not read this pack.")}
        </p>
      )}
      {imported ? (
        <div role="status" className="grid gap-2 text-sm">
          <p>Pack imported.</p>
          <p>
            Find the new items in{" "}
            <Link className="underline" href="/settings">
              Settings
            </Link>
            .
          </p>
        </div>
      ) : (
        reviewPack.data && (
          <PackReviewForm
            key={source}
            review={reviewPack.data}
            source={source}
            onImported={finish}
          />
        )
      )}
    </PageLayout>
  );
}
