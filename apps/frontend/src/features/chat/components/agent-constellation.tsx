"use client";

import MarkdownViewer from "@/components/markdown-viewer";
import { AgentTimeline } from "@/features/chat/components/agent-timeline";
import {
  COLUMN_WIDTH,
  ConstellationNode,
  ConstellationNodeState,
  fitLabel,
  layoutConstellation,
  MAIN_NODE_ID,
} from "@/features/chat/lib/constellation-layout";
import { activitySteps } from "@/features/chat/lib/delegations";
import { SubAgentActivity } from "@/features/chat/types";
import { cn } from "@/lib/utils";
import React from "react";

// Before the first measurement: the narrowest supported pane.
const INITIAL_WIDTH = 320;

const stateLabel: Record<ConstellationNodeState, string> = {
  running: "Running",
  completed: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

const coreFill: Record<ConstellationNodeState, string> = {
  running: "fill-flare",
  completed: "fill-primary",
  error: "fill-destructive",
  cancelled: "fill-muted-foreground",
};

const edgeStroke: Record<ConstellationNodeState, string> = {
  running: "stroke-flare",
  completed: "stroke-border",
  error: "stroke-destructive/60",
  cancelled: "stroke-border",
};

const nodeTitle = (node: ConstellationNode) =>
  node.kind === "overflow"
    ? `${node.hidden} more agents${node.hiddenRunning ? `, ${node.hiddenRunning} running` : ""}`
    : [node.name, node.model, stateLabel[node.state]]
        .filter(Boolean)
        .join(" · ");

const starRadius = (node: ConstellationNode) => (node.kind === "main" ? 10 : 7);
const hasSubtitle = (node: ConstellationNode) =>
  !!node.model || node.kind === "overflow";
// Lines leave below the parent's labels and stop short of the child's glow.
const lineStart = (node: ConstellationNode) =>
  node.y + starRadius(node) + (hasSubtitle(node) ? 36 : 22);
const lineEnd = (node: ConstellationNode) => node.y - starRadius(node) - 8;

const Star = ({ node }: { node: ConstellationNode }) => {
  const radius = starRadius(node);
  const live = node.state === "running";
  return (
    <g
      data-slot="constellation-node"
      data-node-id={node.id}
      data-kind={node.kind}
      data-state={node.state}
      transform={`translate(${node.x} ${node.y})`}
    >
      <title>{nodeTitle(node)}</title>
      {node.kind === "overflow" ? (
        <circle
          r={radius}
          className={cn(
            "fill-background stroke-muted-foreground",
            live && "stroke-flare",
          )}
          strokeWidth={1.5}
          strokeDasharray="3 2"
        />
      ) : (
        <>
          {live && (
            <circle
              r={radius + 6}
              className="fill-flare/25 animate-pulse motion-reduce:animate-none"
            />
          )}
          <circle
            r={radius}
            className={cn(coreFill[node.state], "stroke-background")}
            strokeWidth={2}
          />
          {node.state === "error" && (
            <path
              d="M-2.5-2.5L2.5 2.5M2.5-2.5L-2.5 2.5"
              className="stroke-background"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          )}
        </>
      )}
      <text
        y={radius + 16}
        textAnchor="middle"
        className="fill-foreground text-[12px] font-medium"
      >
        {fitLabel(node.name)}
      </text>
      {hasSubtitle(node) && (
        <text
          y={radius + 30}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          {node.kind === "overflow"
            ? node.hiddenRunning
              ? `${node.hiddenRunning} running`
              : "settled"
            : fitLabel(node.model!, 17)}
        </text>
      )}
    </g>
  );
};

/** Spoken name of a node: who, which model, its state and who delegated it. */
export const nodeLabel = (
  node: ConstellationNode,
  parentName: string | undefined,
) => {
  if (node.kind === "overflow") return nodeTitle(node);
  return [
    node.name,
    node.model,
    stateLabel[node.state].toLowerCase(),
    parentName && `delegated by ${parentName}`,
  ]
    .filter(Boolean)
    .join(", ");
};

const AgentDetails = ({
  node,
  activities,
  hidden,
  childNames,
}: {
  node: ConstellationNode;
  activities: Map<string, SubAgentActivity>;
  hidden: SubAgentActivity[];
  childNames: string[];
}) => {
  if (node.kind === "overflow") {
    return (
      <ul className="flex flex-col gap-0.5">
        {hidden.map((activity) => (
          <li key={activity.executionId}>
            {[activity.name, activity.modelName, stateLabel[activity.status]]
              .filter(Boolean)
              .join(" · ")}
          </li>
        ))}
      </ul>
    );
  }
  if (node.kind === "main") {
    return (
      <p>
        {node.model ? `${node.model} · ` : ""}
        {childNames.length
          ? `Delegated to ${childNames.join(", ")}`
          : "No direct delegations"}
      </p>
    );
  }
  const activity = activities.get(node.id)!;
  return (
    <>
      <p className="text-muted-foreground text-xs">
        {[
          activity.modelName,
          activity.depth > 1 && `Depth ${activity.depth}`,
          stateLabel[activity.status],
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <AgentTimeline steps={activitySteps(activity)} />
      {activity.content && (
        <MarkdownViewer content={activity.content} className="text-sm" />
      )}
      {activity.error && (
        <p className="text-destructive whitespace-pre-wrap">{activity.error}</p>
      )}
    </>
  );
};

/**
 * The main agent and every delegated sub-agent as stars joined by chart lines.
 * Live agents glow in `flare`, finished ones settle to `star` (primary), and
 * failures use destructive styling. The layout is a pure function of the
 * activities and the measured width (see `layoutConstellation`).
 *
 * The drawing is decorative. Over each star sits a button in an ordered list
 * (layout order: parents before children), so screen readers get the same
 * graph as text and keyboard users can reach every node. A button expands that
 * agent's details below the graph; Escape closes them and returns focus.
 */
export const AgentConstellation = ({
  activities,
  mainModel,
}: {
  activities: SubAgentActivity[];
  /** Model the main agent runs with in this chat, when known. */
  mainModel?: string | null;
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const buttons = React.useRef(new Map<string, HTMLButtonElement>());
  const detailsId = React.useId();
  const [width, setWidth] = React.useState(INITIAL_WIDTH);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const layout = React.useMemo(
    () => layoutConstellation(activities, { width, mainModel }),
    [activities, width, mainModel],
  );
  const position = new Map(layout.nodes.map((node) => [node.id, node]));
  const byId = new Map(activities.map((a) => [a.executionId, a]));
  const parentOf = new Map(layout.edges.map((edge) => [edge.to, edge.from]));
  const hidden = activities.filter((a) => !position.has(a.executionId));
  const running = activities.filter((a) => a.status === "running").length;
  const failed = activities.filter((a) => a.status === "error").length;
  const summary = [
    `Delegation graph: main agent and ${activities.length} sub-agent${activities.length === 1 ? "" : "s"}`,
    running && `${running} running`,
    failed && `${failed} failed`,
  ]
    .filter(Boolean)
    .join(", ");
  const open = expanded ? position.get(expanded) : undefined;

  const collapse = () => {
    if (!open) return;
    setExpanded(null);
    buttons.current.get(open.id)?.focus();
  };
  const onEscape = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    collapse();
  };

  return (
    <div
      ref={containerRef}
      data-slot="agent-constellation"
      data-columns={layout.columns}
      className="flex w-full min-w-0 flex-col gap-2 overflow-hidden"
      onKeyDown={onEscape}
    >
      <div className="relative" style={{ height: layout.height }}>
        <svg
          aria-hidden="true"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="block max-w-full"
        >
          <g>
            {layout.edges.map((edge) => {
              const from = position.get(edge.from);
              const to = position.get(edge.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`${edge.from}-${edge.to}`}
                  data-slot="constellation-edge"
                  data-from={edge.from === MAIN_NODE_ID ? "main" : edge.from}
                  data-to={edge.to}
                  data-state={edge.state}
                  x1={from.x}
                  y1={lineStart(from)}
                  x2={to.x}
                  y2={lineEnd(to)}
                  className={edgeStroke[edge.state]}
                  strokeWidth={edge.state === "running" ? 1.75 : 1.25}
                  strokeDasharray={edge.state === "running" ? "4 3" : undefined}
                  strokeLinecap="round"
                />
              );
            })}
          </g>
          {layout.nodes.map((node) => (
            <Star key={node.id} node={node} />
          ))}
        </svg>
        <ol aria-label={summary} className="absolute inset-0">
          {layout.nodes.map((node) => {
            const radius = starRadius(node);
            const top = node.y - radius - 8;
            const isOpen = expanded === node.id;
            return (
              <li
                key={node.id}
                className="absolute"
                style={{
                  left: node.x - COLUMN_WIDTH / 2 + 4,
                  top,
                  width: COLUMN_WIDTH - 8,
                  height: lineStart(node) - 2 - top,
                }}
              >
                <button
                  type="button"
                  ref={(element) => {
                    if (element) buttons.current.set(node.id, element);
                    else buttons.current.delete(node.id);
                  }}
                  data-slot="constellation-node-button"
                  data-node-id={node.id}
                  aria-label={nodeLabel(
                    node,
                    node.kind === "sub-agent"
                      ? (position.get(parentOf.get(node.id) ?? "")?.name ??
                          "Main agent")
                      : undefined,
                  )}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? detailsId : undefined}
                  title={nodeTitle(node)}
                  onClick={() => setExpanded(isOpen ? null : node.id)}
                  className={cn(
                    "rounded-control focus-visible:ring-ring size-full cursor-pointer outline-none focus-visible:ring-2",
                    isOpen && "bg-primary/5 ring-primary/40 ring-1",
                  )}
                />
              </li>
            );
          })}
        </ol>
      </div>
      {open && (
        <section
          id={detailsId}
          data-slot="constellation-details"
          aria-label={`${open.name} details`}
          className="bg-muted/60 border-border rounded-surface text-foreground flex min-w-0 flex-col gap-1.5 border px-3 py-2 text-sm [overflow-wrap:anywhere]"
        >
          <header className="flex items-center gap-2">
            <p className="font-medium">{open.name}</p>
            <button
              type="button"
              onClick={collapse}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-control ml-auto text-xs outline-none focus-visible:ring-2"
            >
              Close
            </button>
          </header>
          <AgentDetails
            node={open}
            activities={byId}
            hidden={hidden}
            childNames={layout.edges
              .filter((edge) => edge.from === open.id)
              .map((edge) => position.get(edge.to)?.name ?? "")}
          />
        </section>
      )}
    </div>
  );
};
