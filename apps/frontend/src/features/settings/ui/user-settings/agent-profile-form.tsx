"use client";
import { HelpIcon } from "@/components/help-icon";
import { Required } from "@/components/required";
import { ModelSelector } from "@/components/settings/model-selector";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import {
  Field,
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldLabel as Label,
} from "@/components/ui/field";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import {
  MainAgentConfiguration,
  MainAgentUpdate,
  SubAgentDefinition,
} from "@/lib/client";
import {
  chatModelsListOptions,
  mainAgentUpdateMutation,
  subAgentCreateMutation,
  subAgentUpdateMutation,
  toolsGetActiveOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PencilIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SubAgentToolWarning } from "./sub-agent-tool-warning";

export function MainAgentForm({
  configuration,
}: {
  configuration: MainAgentConfiguration;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Hint hint="Edit the main agent configuration" asChild>
        <DialogTrigger
          aria-label="Edit main configuration"
          className={buttonVariants({ variant: "ghost" })}
        >
          <PencilIcon />
        </DialogTrigger>
      </Hint>
      <DialogContent className="@container/agent sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Main configuration</DialogTitle>
          <DialogDescription>
            Instructions and capabilities shared by your chats. Choose the model
            separately for each chat.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ConfigurationForm
            configuration={configuration}
            complete={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AgentProfileForm({
  profile,
  completeEditing,
}: {
  profile: SubAgentDefinition | null;
  completeEditing: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const open = creating || profile !== null;
  const close = () => {
    setCreating(false);
    completeEditing();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
        else setCreating(true);
      }}
    >
      <Hint hint="Create a new sub-agent" asChild>
        <DialogTrigger
          aria-label="Create sub-agent"
          className={buttonVariants({ variant: "ghost" })}
        >
          <PlusIcon />
        </DialogTrigger>
      </Hint>
      <DialogContent className="@container/agent sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {profile ? "Edit sub-agent" : "Create sub-agent"}
          </DialogTitle>
          <DialogDescription>
            Each delegated worker uses its own fixed model.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ConfigurationForm
            key={profile?.id ?? "new"}
            configuration={profile}
            subAgent
            complete={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConfigurationForm({
  configuration,
  subAgent = false,
  complete,
}: {
  configuration: MainAgentConfiguration | SubAgentDefinition | null;
  subAgent?: boolean;
  complete: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(configuration?.name ?? "");
  const [description, setDescription] = useState(
    configuration?.description ?? "",
  );
  const [modelId, setModelId] = useState(
    configuration && "model_id" in configuration ? configuration.model_id : "",
  );
  const [prompt, setPrompt] = useState(configuration?.system_prompt ?? "");
  const [maxSteps, setMaxSteps] = useState(configuration?.max_steps ?? 5);
  const [tools, setTools] = useState(configuration?.tools ?? []);
  const [temperature, setTemperature] = useState(
    configuration?.chat_parameters?.temperature?.toString() ?? "",
  );
  const [maxTokens, setMaxTokens] = useState(
    configuration?.chat_parameters?.max_tokens?.toString() ?? "",
  );
  const toolQuery = useQuery({
    ...toolsGetActiveOptions({ client }),
    staleTime: 0,
  });
  const mainMutation = useMutation(mainAgentUpdateMutation({ client }));
  const createMutation = useMutation(subAgentCreateMutation({ client }));
  const updateMutation = useMutation(subAgentUpdateMutation({ client }));
  const pending =
    mainMutation.isPending ||
    createMutation.isPending ||
    updateMutation.isPending;
  const modelQuery = useQuery({
    ...chatModelsListOptions({ client }),
    enabled: subAgent,
    staleTime: 0,
  });
  const available = modelQuery.data ?? [];
  const [saveError, setSaveError] = useState(false);
  const [defaults, setDefaults] = useState({
    top_p: configuration?.chat_parameters?.top_p?.toString() ?? "",
    presence_penalty:
      configuration?.chat_parameters?.presence_penalty?.toString() ?? "",
    frequency_penalty:
      configuration?.chat_parameters?.frequency_penalty?.toString() ?? "",
    seed: configuration?.chat_parameters?.seed?.toString() ?? "",
  });
  const selectableTools =
    toolQuery.data?.items.filter((tool) => tool.policy !== "context_managed") ??
    [];
  const internalTools =
    toolQuery.data?.items
      .filter((tool) => tool.policy === "context_managed")
      .map((tool) => tool.name) ?? [];
  const ordinaryTools = tools.filter((tool) => !internalTools.includes(tool));
  const missingTools = ordinaryTools.filter(
    (tool) => !selectableTools.some((item) => item.name === tool),
  );
  const invalidModel =
    subAgent &&
    (!available.some((model) => model.id === modelId && model.available) ||
      modelQuery.isPending ||
      modelQuery.isError);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      pending ||
      invalidModel ||
      toolQuery.isPending ||
      toolQuery.isError ||
      missingTools.length ||
      (subAgent && !name.trim())
    )
      return;
    setSaveError(false);
    const body: MainAgentUpdate = {
      system_prompt: prompt,
      max_steps: maxSteps,
      tools: ordinaryTools,
      chat_parameters: {
        ...configuration?.chat_parameters,
        ...Object.fromEntries(
          Object.entries(defaults)
            .filter(
              ([key, value]) =>
                value !== "" ||
                configuration?.chat_parameters?.[
                  key as keyof typeof defaults
                ] != null,
            )
            .map(([key, value]) => [key, value === "" ? null : Number(value)]),
        ),
        temperature: temperature === "" ? null : Number(temperature),
        max_tokens: maxTokens === "" ? null : Number(maxTokens),
      },
    };
    try {
      if (subAgent) {
        const subBody = {
          ...body,
          name: name.trim(),
          description,
          model_id: modelId,
        };
        if (configuration)
          await updateMutation.mutateAsync({
            path: { agent_id: configuration.id },
            body: subBody,
          });
        else await createMutation.mutateAsync({ body: subBody });
      } else await mainMutation.mutateAsync({ body });
      toast.success("Configuration saved");
      router.refresh();
      complete();
    } catch {
      setSaveError(true);
      toast.error("Could not save configuration");
    }
  };
  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <FieldGroup className="flex min-w-0 flex-1 flex-col">
        <FieldSet disabled={pending} className="flex flex-1 flex-col gap-4">
          <FieldGroup>
            {subAgent && <SubAgentToolWarning />}
            {subAgent && (
              <>
                <Field>
                  <Required>
                    <Label htmlFor="agent-name">Name</Label>
                  </Required>
                  <Input
                    id="agent-name"
                    required
                    data-1p-ignore
                    maxLength={200}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field>
                  <Label htmlFor="agent-description">Description</Label>
                  <Textarea
                    id="agent-description"
                    data-1p-ignore
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
                <Field>
                  <Required>
                    <Label htmlFor="agent-model">Model</Label>
                  </Required>
                  <ModelSelector
                    id="agent-model"
                    onValueChange={setModelId}
                    value={modelId}
                    availableModels={available.filter((c) => c.available)}
                    disabled={modelQuery.isPending || modelQuery.isError}
                  />

                  {modelQuery.isPending && <p role="status">Loading models…</p>}
                  {modelQuery.isError && (
                    <Empty role="alert" className="flex-none p-3">
                      <EmptyDescription>
                        Could not {modelQuery.data ? "refresh" : "load"} models.{" "}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void modelQuery.refetch()}
                        >
                          Retry models
                        </Button>
                      </EmptyDescription>
                    </Empty>
                  )}
                  {modelQuery.data &&
                    !available.some((model) => model.available) && (
                      <p>
                        No available models. Ask an administrator to enable one.
                      </p>
                    )}
                  {invalidModel &&
                    !modelQuery.isPending &&
                    !modelQuery.isError && (
                      <p role="alert" className="text-destructive text-sm">
                        Choose an available model. The saved binding remains
                        until you save a replacement.
                      </p>
                    )}
                </Field>
              </>
            )}
            <Field>
              <Label htmlFor="agent-prompt">Instructions</Label>
              <Textarea
                id="agent-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="agent-steps">
                Maximum steps{" "}
                <HelpIcon text="The maximum number of turns the agent can take before outputting a reply" />
              </Label>
              <Input
                id="agent-steps"
                type="number"
                min={1}
                max={100}
                required
                value={maxSteps}
                onChange={(event) => setMaxSteps(Number(event.target.value))}
              />
            </Field>
            <div className="flex flex-col gap-3">
              <h1 className="text-muted-foreground text-sm">
                Generation Settings
              </h1>
              <FieldSet className="grid grid-cols-1 gap-2 @xl/agent:grid-cols-2 @4xl/agent:grid-cols-3">
                <Field>
                  <Label htmlFor="agent-temperature">Temperature</Label>
                  <Input
                    id="agent-temperature"
                    type="number"
                    min={0}
                    max={2}
                    step="any"
                    value={temperature}
                    onChange={(event) => setTemperature(event.target.value)}
                  />
                </Field>
                <Field>
                  <Label htmlFor="agent-tokens">Maximum tokens</Label>
                  <Input
                    id="agent-tokens"
                    type="number"
                    min={1}
                    value={maxTokens}
                    onChange={(event) => setMaxTokens(event.target.value)}
                  />
                </Field>
                {(
                  [
                    ["top_p", "Top P ", 0, 1, "any"],
                    ["presence_penalty", "Presence penalty ", -2, 2, "any"],
                    ["frequency_penalty", "Frequency penalty ", -2, 2, "any"],
                    ["seed", "Seed ", undefined, undefined, "1"],
                  ] as const
                ).map(([key, label, min, max, step]) => (
                  <Field key={key}>
                    <Label htmlFor={`agent-${key}`}>{label}</Label>
                    <Input
                      id={`agent-${key}`}
                      type="number"
                      min={min}
                      max={max}
                      step={step}
                      value={defaults[key]}
                      onChange={(event) =>
                        setDefaults({ ...defaults, [key]: event.target.value })
                      }
                    />
                  </Field>
                ))}
              </FieldSet>
            </div>
            <FieldSet className="grid grid-cols-1 gap-2 @xl/agent:grid-cols-2 @4xl/agent:grid-cols-3 @6xl/agent:grid-cols-4">
              <FieldLegend>Allowed tools</FieldLegend>
              {toolQuery.isPending && <p role="status">Loading tools…</p>}
              {toolQuery.isError && (
                <Empty role="alert" className="flex-none p-3">
                  <EmptyDescription>
                    Could not load tools.{" "}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void toolQuery.refetch()}
                    >
                      Retry
                    </Button>
                  </EmptyDescription>
                </Empty>
              )}
              {!toolQuery.isPending &&
                !toolQuery.isError &&
                selectableTools.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    No active tools.
                  </p>
                )}
              {!toolQuery.isError &&
                selectableTools.map((tool) => (
                  <Label key={tool.name} className="flex items-center gap-2">
                    <Checkbox
                      checked={tools.includes(tool.name)}
                      onCheckedChange={(checked) =>
                        setTools(
                          checked
                            ? [...tools, tool.name]
                            : tools.filter((value) => value !== tool.name),
                        )
                      }
                    />
                    {tool.name}
                    <HelpIcon text={tool.description} />
                  </Label>
                ))}
              {!toolQuery.isPending &&
                !toolQuery.isError &&
                missingTools.map((tool) => (
                  <Label key={tool} className="flex items-center gap-2">
                    <Checkbox
                      checked
                      onCheckedChange={() =>
                        setTools(tools.filter((value) => value !== tool))
                      }
                    />
                    {tool} (unavailable; remove to save)
                  </Label>
                ))}
            </FieldSet>
          </FieldGroup>
        </FieldSet>
        {saveError && (
          <Empty role="alert" className="flex-none p-3">
            <EmptyDescription>
              Could not save configuration. Your edits are retained. Check the
              model and tool availability, then try again.
            </EmptyDescription>
          </Empty>
        )}
        <Button
          type="submit"
          disabled={
            pending ||
            toolQuery.isPending ||
            toolQuery.isError ||
            invalidModel ||
            (subAgent && !name.trim()) ||
            missingTools.length > 0
          }
        >
          {pending ? "Saving…" : "Save configuration"}
        </Button>
      </FieldGroup>
    </form>
  );
}
