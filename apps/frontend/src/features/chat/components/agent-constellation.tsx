"use client";

import {
  ConstellationNode,
  ConstellationNodeState,
  fitLabel,
  layoutConstellation,
  MAIN_NODE_ID,
} from "@/features/chat/lib/constellation-layout";
import { SubAgentActivity } from "@/features/chat/types";
import { cn } from "@/lib/utils";
import React from "react";

// Before the first measurement: the narrowest supported pane.
const INITIAL_WIDTH = 320;

const stateLabel: Record<ConstellationNodeState, string> = {
  running: "Running",
  completed: "Done",
  error: "Failed",
};

const coreFill: Record<ConstellationNodeState, string> = {
  running: "fill-flare",
  completed: "fill-primary",
  error: "fill-destructive",
};

const edgeStroke: Record<ConstellationNodeState, string> = {
  running: "stroke-flare",
  completed: "stroke-border",
  error: "stroke-destructive/60",
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

/**
 * The main agent and every delegated sub-agent as stars joined by chart lines.
 * Live agents glow in `flare`, finished ones settle to `star` (primary), and
 * failures use destructive styling. The layout is a pure function of the
 * activities and the measured width (see `layoutConstellation`).
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
  const [width, setWidth] = React.useState(INITIAL_WIDTH);

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
  const running = activities.filter((a) => a.status === "running").length;
  const failed = activities.filter((a) => a.status === "error").length;
  const summary = [
    `Delegation graph: main agent and ${activities.length} sub-agent${activities.length === 1 ? "" : "s"}`,
    running && `${running} running`,
    failed && `${failed} failed`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      ref={containerRef}
      data-slot="agent-constellation"
      data-columns={layout.columns}
      className="w-full min-w-0 overflow-hidden"
    >
      <svg
        role="img"
        aria-label={summary}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block max-w-full"
      >
        <g aria-hidden="true">
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
    </div>
  );
};
