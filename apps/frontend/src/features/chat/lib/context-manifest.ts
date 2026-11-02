import type {
  ContextChunk,
  ContextFile,
  ContextLayer,
  ContextOmission,
  Message,
  MessageExecution,
  TemplateProvenance,
  ToolResult,
} from "@/lib/client";

/**
 * Context inspection (US-54.3): what each agent in a turn was given. Every
 * value comes from the manifests recorded when the steps ran. Layer text is
 * fetched separately and only for the owner; retrieved excerpts come from the
 * steps' persisted tool results and are untrusted.
 */

export type InspectedChunk = ContextChunk & {
  /** Untrusted retrieved text; absent when the tool result is unavailable. */
  excerpt: string | null;
};

export type AgentContext = {
  /** "main", or the delegation's execution id. */
  id: string;
  name: string;
  isSubAgent: boolean;
  depth: number;
  layers: ContextLayer[];
  template: TemplateProvenance | null;
  files: ContextFile[];
  chunks: InspectedChunk[];
  omissions: ContextOmission[];
};

export type TurnContext = {
  /** The assistant step whose recorded layer text can be read; main agent only. */
  layerMessageId: string | null;
  agents: AgentContext[];
};

const layerNames: Record<ContextLayer["kind"], string> = {
  platform: "Platform rules",
  agent: "Agent instructions",
  profile: "Persona",
  mode: "Learning mode",
  project: "Project instructions",
  skills: "Skills",
  runtime: "Runtime details",
};

/** A readable name for a layer, using the run's recorded persona and skills. */
export function layerLabel(
  layer: ContextLayer,
  execution: MessageExecution | null | undefined,
  isSubAgent = false,
): string {
  if (layer.kind === "agent") {
    return isSubAgent ? "Sub-agent instructions" : "Main-agent instructions";
  }
  if (layer.kind === "profile" && execution?.persona) {
    return `Persona: ${execution.persona.name}`;
  }
  if (layer.kind === "skills" && execution?.skills?.length) {
    return `Skills: ${execution.skills.map((skill) => skill.name).join(", ")}`;
  }
  return layerNames[layer.kind];
}

const excerptKey = (toolCallId: string, chunkId: string) =>
  `${toolCallId}\u0000${chunkId}`;

/** Excerpts from persisted search_knowledge results, keyed by call and chunk. */
function excerptsFrom(results: ToolResult[]): Map<string, string> {
  const excerpts = new Map<string, string>();
  for (const result of results) {
    if (result.tool_call.function.name !== "search_knowledge") continue;
    const raw = result.raw_result as { results?: unknown } | null;
    if (!raw || !Array.isArray(raw.results)) continue;
    for (const hit of raw.results as {
      chunk_id?: unknown;
      excerpt?: unknown;
    }[]) {
      if (typeof hit.chunk_id === "string" && typeof hit.excerpt === "string") {
        excerpts.set(
          excerptKey(result.tool_call.id, hit.chunk_id),
          hit.excerpt,
        );
      }
    }
  }
  return excerpts;
}

const withExcerpts = (
  chunks: ContextChunk[],
  excerpts: Map<string, string>,
): InspectedChunk[] =>
  chunks.map((chunk) => ({
    ...chunk,
    excerpt:
      excerpts.get(excerptKey(chunk.tool_call_id, chunk.chunk_id)) ?? null,
  }));

const omissionKey = (omission: ContextOmission) =>
  [omission.kind, omission.subject ?? "", omission.reason].join("\u0000");

/** Steps repeat the run's fixed omissions; keep each one once. */
function uniqueOmissions(omissions: ContextOmission[]): ContextOmission[] {
  const seen = new Map<string, ContextOmission>();
  for (const omission of omissions) seen.set(omissionKey(omission), omission);
  return [...seen.values()];
}

/**
 * The recorded context of one turn: the main agent (layers, template and
 * files from its first recorded step; chunks and omissions across all steps),
 * then each sub-agent that recorded a manifest. Null when nothing was recorded.
 */
export function turnContext(steps: Message[]): TurnContext | null {
  const assistant = steps.filter(
    (step) => step.role === "assistant" && step.context,
  );
  const agents: AgentContext[] = [];
  const first = assistant[0];
  if (first?.context) {
    const excerpts = excerptsFrom(
      assistant.flatMap((step) => step.tool_call_results ?? []),
    );
    agents.push({
      id: "main",
      name: "Main agent",
      isSubAgent: false,
      depth: 0,
      layers: first.context.layers ?? [],
      template: first.context.template ?? null,
      files: first.context.files ?? [],
      chunks: withExcerpts(
        assistant.flatMap((step) => step.context?.chunks ?? []),
        excerpts,
      ),
      omissions: uniqueOmissions(
        assistant.flatMap((step) => step.context?.omissions ?? []),
      ),
    });
  }
  for (const step of steps.filter((step) => step.role === "assistant")) {
    for (const record of step.delegations ?? []) {
      if (!record.context) continue;
      agents.push({
        id: record.execution_id,
        name: record.name,
        isSubAgent: true,
        depth: record.depth,
        layers: record.context.layers ?? [],
        template: null,
        files: record.context.files ?? [],
        chunks: withExcerpts(
          record.context.chunks ?? [],
          excerptsFrom(record.tool_results ?? []),
        ),
        omissions: uniqueOmissions(record.context.omissions ?? []),
      });
    }
  }
  if (agents.length === 0) return null;
  return { layerMessageId: first?.id ?? null, agents };
}
