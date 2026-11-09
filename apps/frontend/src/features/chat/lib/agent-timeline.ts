import type { Message, ToolResult } from "@/lib/client";

export type ToolStepStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "denied"
  | "empty";

export type AgentTimelineStep =
  | { kind: "thinking"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      arguments: string;
      status: ToolStepStatus;
      /** A plain-language name for the step, e.g. "Loaded skill review-code". */
      label?: string;
      /** Result text shown to the user; for failures, the error message. */
      result?: string;
      durationMs?: number;
    };

/** The internal tool a sub-agent uses to load one of its skills (ADR-0062). */
export const SKILL_TOOL = "load_skill";

const textField = (json: string | undefined, key: string): string | null => {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    const field =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined;
    return typeof field === "string" && field.trim() ? field : null;
  } catch {
    return null;
  }
};

/**
 * "Loaded skill review-code" for a load_skill call: the loaded skill's name
 * when it succeeded, else the name the agent asked for. Undefined for other tools.
 */
export function skillLoadLabel(
  name: string,
  args: string,
  status: ToolStepStatus,
  resultContent?: string,
): string | undefined {
  if (name !== SKILL_TOOL) return undefined;
  const skill =
    (status === "succeeded" ? textField(resultContent, "name") : null) ??
    textField(args, "name") ??
    "a skill";
  if (status === "succeeded") return `Loaded skill ${skill}`;
  if (status === "running") return `Loading skill ${skill}`;
  if (status === "failed" || status === "denied")
    return `Could not load skill ${skill}`;
  return `Load skill ${skill}`;
}

/** Client-observed tool timing; the backend does not persist durations. */
export type ToolTiming = { startedAt: number; endedAt?: number };
export type ToolTimings = Record<string, ToolTiming>;

const SUMMARY_LENGTH = 80;

// The backend encodes a refused call as an empty result with this notice.
const DENIED_NOTICE = "was not authorized for use by the user";

const errorOf = (raw: unknown): string | null =>
  raw != null &&
  typeof raw === "object" &&
  typeof (raw as { error?: unknown }).error === "string"
    ? (raw as { error: string }).error
    : null;

export function toolResultStatus(result: ToolResult): ToolStepStatus {
  if (errorOf(result.raw_result) != null) return "failed";
  if (result.is_empty && result.content.includes(DENIED_NOTICE))
    return "denied";
  if (result.is_empty) return "empty";
  return "succeeded";
}

const compact = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);

const truncate = (text: string) =>
  text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH - 1)}…` : text;

/** One-line `key: value` summary of tool arguments; empty when there are none. */
export function summarizeArguments(args: string): string {
  const trimmed = args.trim();
  if (!trimmed) return "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return truncate(
        Object.entries(parsed)
          .map(([key, value]) => `${key}: ${compact(value)}`)
          .join(", "),
      );
    }
    return truncate(compact(parsed));
  } catch {
    return truncate(trimmed.replace(/\s+/g, " "));
  }
}

/** Pretty-prints JSON text and returns anything else unchanged. */
export function formatPayload(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Timeline steps for one assistant step message: its reasoning (only when the
 * user shows thinking) followed by each tool call in request order.
 */
export function messageTimelineSteps(
  message: Message,
  { showThinking, timings }: { showThinking: boolean; timings?: ToolTimings },
): AgentTimelineStep[] {
  const steps: AgentTimelineStep[] = [];
  if (showThinking && message.thinking?.trim()) {
    steps.push({
      kind: "thinking",
      id: `${message.id}:thinking`,
      text: message.thinking,
    });
  }
  for (const call of message.tool_calls ?? []) {
    const result = message.tool_call_results?.find(
      (candidate) => candidate.tool_call.id === call.id,
    );
    const timing = timings?.[call.id];
    const status: ToolStepStatus = result
      ? toolResultStatus(result)
      : message.status === "pending"
        ? "running"
        : "empty";
    steps.push({
      kind: "tool",
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
      status,
      label: skillLoadLabel(
        call.function.name,
        call.function.arguments,
        status,
        result?.content,
      ),
      result: result
        ? (errorOf(result.raw_result) ?? result.content)
        : undefined,
      durationMs:
        timing?.endedAt != null ? timing.endedAt - timing.startedAt : undefined,
    });
  }
  return steps;
}
