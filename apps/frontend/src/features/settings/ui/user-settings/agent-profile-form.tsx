import { AgentKnowledgeAssignments } from "./agent-knowledge-assignments";
import { SubAgentToolWarning } from "./sub-agent-tool-warning";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/features/auth/components/user-context";
import { client } from "@/lib/api";
import {
  MainAgentConfiguration,
  MainAgentUpdate,
  SubAgentDefinition,
} from "@/lib/client";
import {
  mainAgentUpdateMutation,
  subAgentCreateMutation,
  subAgentUpdateMutation,
  toolsGetActiveOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function MainAgentForm({
  configuration,
}: {
  configuration: MainAgentConfiguration;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Edit main configuration</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Main configuration</DialogTitle>
          <DialogDescription>
            Instructions and capabilities shared by your chats. Choose the chat
            model separately in General settings.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ConfigurationForm
            configuration={configuration}
            complete={() => setOpen(false)}
          />
        )}
        {open && (
          <AgentKnowledgeAssignments
            agentId={configuration.id}
            initialIds={
              configuration.knowledge_bases?.map((base) => base.id) ?? []
            }
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
      <DialogTrigger asChild>
        <Button>Create sub-agent</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
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
        {open && profile && (
          <AgentKnowledgeAssignments
            key={profile.id}
            agentId={profile.id}
            initialIds={profile.knowledge_bases?.map((base) => base.id) ?? []}
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
  const user = useUser();
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
  const toolQuery = useQuery(toolsGetActiveOptions({ client }));
  const mainMutation = useMutation(mainAgentUpdateMutation({ client }));
  const createMutation = useMutation(subAgentCreateMutation({ client }));
  const updateMutation = useMutation(subAgentUpdateMutation({ client }));
  const pending =
    mainMutation.isPending ||
    createMutation.isPending ||
    updateMutation.isPending;
  const available = user.settings.models ?? [];
  const selectableTools =
    toolQuery.data?.items.filter((tool) => tool.policy !== "context_managed") ??
    [];
  const missingTools = tools.filter(
    (tool) => !selectableTools.some((item) => item.name === tool),
  );
  const invalidModel =
    subAgent && !available.some((model) => model.id === modelId);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const body: MainAgentUpdate = {
      system_prompt: prompt,
      max_steps: maxSteps,
      tools,
      chat_parameters: {
        ...configuration?.chat_parameters,
        temperature: temperature === "" ? null : Number(temperature),
        max_tokens: maxTokens === "" ? null : Number(maxTokens),
      },
    };
    try {
      if (subAgent) {
        const subBody = { ...body, name, description, model_id: modelId };
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
      toast.error("Could not save configuration");
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {subAgent && <SubAgentToolWarning />}
      {subAgent && (
        <>
          <div>
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="agent-description">Description</Label>
            <Textarea
              id="agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="agent-model">Fixed model</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger id="agent-model">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {available.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name} ({model.provider_name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {invalidModel && (
              <p role="alert" className="text-destructive text-sm">
                Choose an available model. The saved binding remains until you
                save a replacement.
              </p>
            )}
          </div>
        </>
      )}
      <div>
        <Label htmlFor="agent-prompt">Instructions</Label>
        <Textarea
          id="agent-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="agent-steps">Maximum steps</Label>
        <Input
          id="agent-steps"
          type="number"
          min={1}
          max={100}
          required
          value={maxSteps}
          onChange={(event) => setMaxSteps(Number(event.target.value))}
        />
      </div>
      <div>
        <Label htmlFor="agent-temperature">Temperature (optional)</Label>
        <Input
          id="agent-temperature"
          type="number"
          min={0}
          max={2}
          step="any"
          value={temperature}
          onChange={(event) => setTemperature(event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="agent-tokens">Maximum tokens (optional)</Label>
        <Input
          id="agent-tokens"
          type="number"
          min={1}
          value={maxTokens}
          onChange={(event) => setMaxTokens(event.target.value)}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Allowed tools</legend>
        {toolQuery.isPending && <p role="status">Loading tools…</p>}
        {toolQuery.isError && (
          <div role="alert">
            Could not load tools.{" "}
            <Button
              type="button"
              variant="outline"
              onClick={() => void toolQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        )}
        {!toolQuery.isPending &&
          !toolQuery.isError &&
          selectableTools.length === 0 && (
            <p className="text-muted-foreground text-sm">No active tools.</p>
          )}
        {selectableTools.map((tool) => (
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
          </Label>
        ))}
        {missingTools.map((tool) => (
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
      </fieldset>
      <Button
        type="submit"
        disabled={
          pending ||
          toolQuery.isPending ||
          toolQuery.isError ||
          invalidModel ||
          missingTools.length > 0
        }
      >
        {pending ? "Saving…" : "Save configuration"}
      </Button>
    </form>
  );
}
