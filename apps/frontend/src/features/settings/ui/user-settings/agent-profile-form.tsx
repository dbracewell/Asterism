import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { z } from "zod";

import { HelpIcon } from "@/components/help-icon";
import { Required } from "@/components/required";
import { ModelSelector } from "@/components/settings/model-selector";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/features/auth/components/user-context";
import { SubAgentToolWarning } from "@/features/settings/ui/user-settings/sub-agent-tool-warning";
import { agentProfile } from "@/features/settings/schemas";
import { client } from "@/lib/api";
import { AgentProfile } from "@/lib/client";
import {
  agentsUpsertAgentProfileMutation,
  toolsGetActiveOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type AgentProfileFormValues = z.infer<typeof agentProfile>;

export function AgentProfileForm({
  profile,
  completeEditing,
}: {
  profile: AgentProfile | null;
  completeEditing: () => void;
}) {
  const user = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const { data: availableTools } = useQuery({
    ...toolsGetActiveOptions({
      client: client,
    }),
  });

  const upsertAgentProfile = useMutation({
    ...agentsUpsertAgentProfileMutation({
      client: client,
    }),
    onSuccess: (data) => {
      toast.success(
        `Successfully ${profile == null ? "created new" : "updated"} agent ${data.name}`,
      );
      onOpenChange(false);
      router.refresh();
    },
    onError: () =>
      toast.error(
        `Failed to ${profile == null ? "create new" : "update"} agent`,
      ),
  });

  const form = useForm<AgentProfileFormValues>({
    resolver: zodResolver(agentProfile),
    defaultValues: {
      id: profile?.id ?? null,
      name: profile?.name ?? "",
      sub_agent: profile?.sub_agent ?? false,
      description: profile?.description ?? "",
      systemPrompt: profile?.system_prompt,
      maxSteps: profile?.max_steps ?? 5,
      modelId: profile?.model_id ?? user.settings.default_model_id ?? "",
      tools:
        profile?.tools?.map((tool) => ({
          value: tool,
        })) ?? [],
      chatParameters: profile?.chat_parameters ?? {},
    },
  });

  const actsAsSubAgent = useWatch({
    control: form.control,
    name: "sub_agent",
  });

  useEffect(() => {
    form.reset({
      id: profile?.id ?? null,
      name: profile?.name ?? "",
      sub_agent: profile?.sub_agent ?? false,
      description: profile?.description ?? "",
      modelId: profile?.model_id ?? user.settings.default_model_id ?? "",
      systemPrompt: profile?.system_prompt,
      maxSteps: profile?.max_steps ?? 5,
      tools:
        profile?.tools?.map((tool) => ({
          value: tool,
        })) ?? [],
      chatParameters: profile?.chat_parameters ?? {},
    });
    if (profile) {
      setIsOpen(true);
    }
  }, [profile, form, user]);

  const onOpenChange = (value: boolean) => {
    form.reset();
    completeEditing();
    setIsOpen(value);
  };

  const {
    fields: toolsFields,
    append: toolsAppend,
    remove: toolsRemove,
  } = useFieldArray({
    control: form.control,
    name: "tools",
  });

  function onSubmit(data: AgentProfileFormValues) {
    const cp =
      Object.keys(data.chatParameters).length > 0
        ? data.chatParameters
        : undefined;
    upsertAgentProfile.mutate({
      body: {
        id: data?.id ?? undefined,
        sub_agent: data?.sub_agent ?? false,
        description: data.description,
        name: data.name,
        max_steps: data.maxSteps,
        system_prompt: data.systemPrompt,
        tools: data.tools.map((t) => t.value),
        model_id: data.modelId,
        chat_parameters: cp,
      },
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Hint hint="Create new agent" asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              form.reset({
                id: null,
                name: "",
                description: "",
                sub_agent: false,
                systemPrompt: null,
                maxSteps: 5,
                modelId: user.settings.default_model_id ?? "",
                tools: [],
                chatParameters: {},
              });
              setIsOpen(true);
            }}
          >
            <PlusIcon />
          </Button>
        </Hint>
      </DialogTrigger>
      <DialogContent className="bg-card text-card-foreground flex h-full w-full! max-w-full! flex-col overflow-clip! p-0! sm:h-[80%]! md:max-w-250!">
        <DialogHeader className="bg-secondary text-secondary-foreground border-b p-2">
          <DialogTitle className="text-xl font-bold">Agent Editor</DialogTitle>
          <DialogDescription className="text-secondary-foreground">
            {profile == null
              ? "Create a new Agent to help you perform specific tasks."
              : "Modify an existing Agent to help you perform specific tasks."}
          </DialogDescription>
        </DialogHeader>
        <form
          id="agentProfile-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex min-h-0 flex-1 flex-col space-y-6 px-2"
        >
          <Controller
            control={form.control}
            name="id"
            render={({ field }) => (
              <Input type="hidden" {...field} value={field.value ?? ""} />
            )}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Controller
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="form-agentProfile-name">
                        <Required>
                          Name <HelpIcon text="The name of the agent." />
                        </Required>
                      </FieldLabel>
                      <Input
                        autoComplete="off"
                        placeholder="The agent's name"
                        {...field}
                        min={3}
                        max={30}
                        id="form-agentProfile-name"
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  control={form.control}
                  name="description"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="form-agentProfile-description">
                        <Required>
                          Description{" "}
                          <HelpIcon text="Describes what actions the agent performs." />
                        </Required>
                      </FieldLabel>
                      <Input
                        autoComplete="off"
                        className="w-full!"
                        placeholder="Describes what actions the agent performs."
                        {...field}
                        min={3}
                        max={256}
                        id="form-agentProfile-description"
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  control={form.control}
                  name="modelId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="form-agentProfile-model">
                        <Required>
                          Model{" "}
                          <HelpIcon text="The model the agent will use to perform actions." />
                        </Required>
                      </FieldLabel>
                      <ModelSelector
                        id="form-agentProfile-model"
                        defaultModel={field.value}
                        onValueChange={(v) => field.onChange(v)}
                        availableModels={user.settings.models}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="maxSteps"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="form-agentProfile-maxSteps">
                        <Required>
                          Max Steps{" "}
                          <HelpIcon text="The maximum number of steps the agent can take to complete a task." />
                        </Required>{" "}
                      </FieldLabel>
                      <Input
                        type="number"
                        placeholder="Enter maxSteps"
                        {...field}
                        min={1}
                        max={20}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            isFinite(e.target.valueAsNumber)
                              ? e.target.valueAsNumber
                              : "",
                          )
                        }
                        id="form-agentProfile-maxSteps"
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  control={form.control}
                  name="sub_agent"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="form-agentProfile-subAgent"
                          onCheckedChange={field.onChange}
                          checked={field.value ?? false}
                        />
                        <FieldLabel htmlFor="form-agentProfile-subAgent">
                          <Required>
                            Acts as Sub Agent{" "}
                            <HelpIcon text="Can this agent be used as a sub agent?" />
                          </Required>{" "}
                        </FieldLabel>
                      </div>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              </div>

              <Controller
                control={form.control}
                name="systemPrompt"
                render={({ field, fieldState }) => (
                  <Field
                    data-invalid={fieldState.invalid}
                    className="flex min-h-0 flex-col"
                  >
                    <FieldLabel htmlFor="form-agentProfile-systemPrompt">
                      System Prompt
                    </FieldLabel>
                    <Textarea
                      autoComplete="off"
                      placeholder="The system prompt used to guide the agent's actions."
                      {...field}
                      className="h-55! resize-none!"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value || "")}
                      id="form-agentProfile-systemPrompt"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </div>

            <Field className="mt-3 mb-2 flex flex-1 flex-col">
              <FieldLabel>Tools</FieldLabel>
              {actsAsSubAgent && <SubAgentToolWarning />}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
                {availableTools?.items.map((tool) => (
                  <div key={tool.name} className="flex items-center gap-2">
                    <Checkbox
                      checked={
                        toolsFields.find((t) => t.value === tool.name) != null
                      }
                      onCheckedChange={(e) => {
                        if (e) {
                          toolsAppend({ value: tool.name });
                        } else {
                          toolsRemove(
                            toolsFields.findIndex((t) => t.value === tool.name),
                          );
                        }
                      }}
                    />
                    <span className="truncate">{tool.name}</span>{" "}
                    <HelpIcon text={tool.description} />
                  </div>
                ))}
              </div>
            </Field>

            <Controller
              control={form.control}
              name="chatParameters"
              render={({ field, fieldState }) => (
                <Field
                  data-invalid={fieldState.invalid}
                  className="grid grid-cols-[auto_1fr] md:grid-cols-[auto_1fr_auto_1fr]"
                >
                  <Label htmlFor="temperature">Temperature</Label>
                  <Input
                    id="temperature"
                    type="number"
                    value={field.value.temperature ?? ""}
                    onChange={(e) => {
                      form.setValue(
                        "chatParameters.temperature",
                        isFinite(e.target.valueAsNumber)
                          ? e.target.valueAsNumber
                          : undefined,
                        {
                          shouldDirty: true,
                          shouldValidate: true,
                        },
                      );
                    }}
                  />
                  <Label htmlFor="max_tokens">Max Output Tokens</Label>
                  <Input
                    id="max_tokens"
                    type="number"
                    value={field.value.max_tokens ?? ""}
                    onChange={(e) => {
                      form.setValue(
                        "chatParameters.max_tokens",
                        isFinite(e.target.valueAsNumber)
                          ? e.target.valueAsNumber
                          : undefined,
                        {
                          shouldDirty: true,
                          shouldValidate: true,
                        },
                      );
                    }}
                  />
                  <Label htmlFor="thinking_budgent">
                    Thinking Budget Tokens
                  </Label>
                  <Input
                    id="thinking_budgent"
                    type="number"
                    value={field.value.max_tokens ?? ""}
                    onChange={(e) => {
                      form.setValue(
                        "chatParameters.thinking_budget_tokens",
                        isFinite(e.target.valueAsNumber)
                          ? e.target.valueAsNumber
                          : undefined,
                        {
                          shouldDirty: true,
                          shouldValidate: true,
                        },
                      );
                    }}
                  />
                  <Label htmlFor="frequency_penalty">Frequency Penalty</Label>
                  <Input
                    id="frequency_penalty"
                    type="number"
                    value={field.value.frequency_penalty ?? ""}
                    onChange={(e) => {
                      form.setValue(
                        "chatParameters.frequency_penalty",
                        isFinite(e.target.valueAsNumber)
                          ? e.target.valueAsNumber
                          : undefined,
                        {
                          shouldDirty: true,
                          shouldValidate: true,
                        },
                      );
                    }}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </div>
          <div className="flex items-end justify-end gap-2 pb-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">{profile == null ? "Create" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
