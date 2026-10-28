"use client";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AgentTimelineStep,
  ToolStepStatus,
  formatDuration,
  formatPayload,
  summarizeArguments,
} from "@/features/chat/lib/agent-timeline";
import { formatPlural } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  BanIcon,
  BrainIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ListTreeIcon,
  LoaderCircleIcon,
} from "lucide-react";
import React from "react";

type ToolStep = Extract<AgentTimelineStep, { kind: "tool" }>;
type ThinkingStep = Extract<AgentTimelineStep, { kind: "thinking" }>;

const STATUS_LABEL: Record<ToolStepStatus, string> = {
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  denied: "Denied",
  empty: "No result",
};

const triggerClass =
  "hover:text-foreground focus-visible:ring-ring rounded-control flex min-w-0 cursor-pointer items-center gap-1.5 text-left outline-none focus-visible:ring-2";

const chevronClass =
  "size-4 shrink-0 transition-transform motion-reduce:transition-none";

const StatusIcon = ({ status }: { status: ToolStepStatus }) => {
  const className = "size-4 shrink-0";
  switch (status) {
    case "running":
      return (
        <LoaderCircleIcon
          aria-hidden="true"
          className={cn(className, "animate-spin motion-reduce:animate-none")}
        />
      );
    case "succeeded":
      return (
        <CircleCheckIcon
          aria-hidden="true"
          className={cn(className, "text-primary")}
        />
      );
    case "failed":
      return (
        <CircleXIcon
          aria-hidden="true"
          className={cn(className, "text-destructive")}
        />
      );
    case "denied":
      return <BanIcon aria-hidden="true" className={className} />;
    case "empty":
      return <CircleDashedIcon aria-hidden="true" className={className} />;
  }
};

/** A labelled, keyboard-scrollable block of untrusted text. */
const Payload = ({ label, text }: { label: string; text: string }) => (
  <div className="mt-1.5 min-w-0">
    <div className="text-meta font-medium">{label}</div>
    <pre
      role="region"
      aria-label={label}
      tabIndex={0}
      className="bg-muted/60 text-foreground rounded-control focus-visible:ring-ring mt-0.5 max-h-60 overflow-y-auto px-2 py-1.5 font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap outline-none select-text focus-visible:ring-2"
    >
      {text}
    </pre>
  </div>
);

const ThinkingStepItem = ({
  step,
  streaming,
}: {
  step: ThinkingStep;
  streaming: boolean;
}) => {
  const ref = React.useRef<HTMLParagraphElement>(null);
  React.useEffect(() => {
    if (streaming && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [step.text, streaming]);

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 font-medium">
        <BrainIcon aria-hidden="true" className="size-4 shrink-0" />
        Thinking
      </div>
      <p
        ref={ref}
        role="region"
        aria-label="Thinking"
        tabIndex={0}
        className="focus-visible:ring-ring rounded-control mt-1 max-h-50 overflow-y-auto pl-5.5 [overflow-wrap:anywhere] whitespace-pre-wrap outline-none select-text focus-visible:ring-2"
        style={{ overflowAnchor: "auto" }}
      >
        {step.text}
      </p>
    </div>
  );
};

const ToolStepItem = ({ step }: { step: ToolStep }) => {
  const summary = summarizeArguments(step.arguments);
  const status = STATUS_LABEL[step.status];
  return (
    <Collapsible className="group/step min-w-0" data-status={step.status}>
      <CollapsibleTrigger className={cn(triggerClass, "w-full flex-wrap")}>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(chevronClass, "group-data-[state=open]/step:rotate-90")}
        />
        <StatusIcon status={step.status} />
        <span className="text-foreground min-w-0 font-medium [overflow-wrap:anywhere]">
          {step.name}
        </span>
        {summary && (
          <span className="min-w-0 flex-1 basis-24 truncate font-mono text-xs">
            {summary}
          </span>
        )}
        <span
          className={cn(
            "text-meta ml-auto shrink-0 pl-2",
            step.status === "failed" && "text-destructive",
          )}
        >
          {status}
          {step.durationMs != null && ` · ${formatDuration(step.durationMs)}`}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-5.5">
        {step.arguments.trim() && step.arguments.trim() !== "{}" && (
          <Payload label="Arguments" text={formatPayload(step.arguments)} />
        )}
        {step.result != null && (
          <Payload
            label={step.status === "failed" ? "Error" : "Result"}
            text={formatPayload(step.result) || "(empty)"}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

export function timelineSummary(steps: AgentTimelineStep[]): string {
  const tools = steps.filter((step) => step.kind === "tool");
  const running = tools.find((step) => step.status === "running");
  if (running) return `Running ${running.name}`;
  const failed = tools.filter((step) => step.status === "failed").length;
  return [
    steps.some((step) => step.kind === "thinking") && "Thinking",
    tools.length > 0 && formatPlural(tools.length, "tool call"),
    failed > 0 && `${failed} failed`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Collapsible step list of an agent's reasoning and tool calls. Each tool row
 * shows its name, a one-line argument summary, status and duration, and
 * expands to the full arguments and result. Arguments, results and reasoning
 * are untrusted and always render as plain text.
 */
export function AgentTimeline({
  steps,
  defaultOpen = false,
  streaming = false,
  className,
}: {
  steps: AgentTimelineStep[];
  defaultOpen?: boolean;
  /** Keeps the reasoning scrolled to its newest text. */
  streaming?: boolean;
  className?: string;
}) {
  if (steps.length === 0) return null;
  const running = steps.some(
    (step) => step.kind === "tool" && step.status === "running",
  );

  return (
    <Collapsible
      defaultOpen={defaultOpen}
      data-slot="agent-timeline"
      className={cn("group/timeline text-muted-foreground text-sm", className)}
    >
      <CollapsibleTrigger
        className={cn(triggerClass, "max-w-full font-medium")}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            chevronClass,
            "group-data-[state=open]/timeline:rotate-90",
          )}
        />
        {running ? (
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          />
        ) : (
          <ListTreeIcon aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span className="truncate">{timelineSummary(steps)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol
          aria-label="Agent steps"
          className="border-border mt-1.5 ml-2 flex min-w-0 flex-col gap-1.5 border-l pl-3"
        >
          {steps.map((step) => (
            <li key={step.id} className="min-w-0">
              {step.kind === "thinking" ? (
                <ThinkingStepItem step={step} streaming={streaming} />
              ) : (
                <ToolStepItem step={step} />
              )}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
