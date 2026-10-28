import type { SubAgentActivity } from "@/features/chat/types";

export type ConstellationNodeState = SubAgentActivity["status"];

export type ConstellationNode = {
  /** `main` for the root, otherwise the delegation execution id. */
  id: string;
  kind: "main" | "sub-agent" | "overflow";
  name: string;
  model: string | null;
  state: ConstellationNodeState;
  /** Delegation level: 0 for the main agent. */
  level: number;
  x: number;
  y: number;
  /** Overflow node only: how many agents it stands for, and how many run. */
  hidden?: number;
  hiddenRunning?: number;
};

export type ConstellationEdge = {
  from: string;
  to: string;
  /** The child's state; a live delegation draws a live line. */
  state: ConstellationNodeState;
};

export type ConstellationLayout = {
  width: number;
  height: number;
  columns: number;
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
};

export const MAIN_NODE_ID = "main";
/** Horizontal slot per node; labels are truncated to fit it. */
export const COLUMN_WIDTH = 112;
export const ROW_HEIGHT = 76;
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 6;
/** Sub-agents drawn before the rest fold into one "+N more" node. */
export const MAX_VISIBLE_SUB_AGENTS = 16;
const TOP_PADDING = 18;
const BOTTOM_PADDING = 40;

export const columnsForWidth = (width: number) =>
  Math.min(
    MAX_COLUMNS,
    Math.max(MIN_COLUMNS, Math.floor(width / COLUMN_WIDTH)),
  );

/**
 * Places the main agent and its delegations deterministically: one band per
 * delegation level, each band wrapping into rows of `columns` slots. Siblings
 * keep their parent's order, then arrival order. A delegation whose parent is
 * unknown attaches to the main agent. Past `maxVisible` sub-agents, the rest
 * (always the deepest or latest, so no drawn line loses an end) fold into one
 * overflow node.
 */
export function layoutConstellation(
  activities: SubAgentActivity[],
  {
    width,
    mainModel = null,
    maxVisible = MAX_VISIBLE_SUB_AGENTS,
  }: { width: number; mainModel?: string | null; maxVisible?: number },
): ConstellationLayout {
  const columns = columnsForWidth(width);
  const known = new Set(activities.map((activity) => activity.executionId));
  const children = new Map<string, SubAgentActivity[]>();
  for (const activity of activities) {
    const parent =
      activity.parentExecutionId &&
      activity.parentExecutionId !== activity.executionId &&
      known.has(activity.parentExecutionId)
        ? activity.parentExecutionId
        : MAIN_NODE_ID;
    children.set(parent, [...(children.get(parent) ?? []), activity]);
  }

  // Breadth-first from the main agent: ancestors always precede descendants.
  const ordered: {
    activity: SubAgentActivity;
    parent: string;
    level: number;
  }[] = [];
  const queue = [{ id: MAIN_NODE_ID, level: 0 }];
  const visited = new Set<string>([MAIN_NODE_ID]);
  while (queue.length) {
    const { id, level } = queue.shift()!;
    for (const activity of children.get(id) ?? []) {
      if (visited.has(activity.executionId)) continue;
      visited.add(activity.executionId);
      ordered.push({ activity, parent: id, level: level + 1 });
      queue.push({ id: activity.executionId, level: level + 1 });
    }
  }
  // A parent cycle in the input can't reach the main agent; attach it there.
  for (const activity of activities) {
    if (visited.has(activity.executionId)) continue;
    visited.add(activity.executionId);
    ordered.push({ activity, parent: MAIN_NODE_ID, level: 1 });
  }

  const overflowing = ordered.length > maxVisible;
  const shown = overflowing ? ordered.slice(0, maxVisible - 1) : ordered;
  const hidden = overflowing ? ordered.slice(maxVisible - 1) : [];

  // A child's failure is its own; the main agent carries on.
  const running = activities.some((activity) => activity.status === "running");
  const placed: Omit<ConstellationNode, "x" | "y">[] = [
    {
      id: MAIN_NODE_ID,
      kind: "main",
      name: "Main agent",
      model: mainModel,
      state: running ? "running" : "completed",
      level: 0,
    },
    ...shown.map(({ activity, level }) => ({
      id: activity.executionId,
      kind: "sub-agent" as const,
      name: activity.name,
      model: activity.modelName,
      state: activity.status,
      level,
    })),
  ];
  if (hidden.length) {
    const hiddenRunning = hidden.filter(
      ({ activity }) => activity.status === "running",
    ).length;
    placed.push({
      id: "overflow",
      kind: "overflow",
      name: `+${hidden.length} more`,
      model: null,
      state: hiddenRunning ? "running" : "completed",
      level: placed.at(-1)!.level,
      hidden: hidden.length,
      hiddenRunning,
    });
  }

  const nodes: ConstellationNode[] = [];
  let row = 0;
  for (let level = 0; ; level++) {
    const band = placed.filter((node) => node.level === level);
    if (!band.length) break;
    for (let start = 0; start < band.length; start += columns, row++) {
      const slice = band.slice(start, start + columns);
      slice.forEach((node, index) =>
        nodes.push({
          ...node,
          x: width / 2 + (index - (slice.length - 1) / 2) * COLUMN_WIDTH,
          y: TOP_PADDING + row * ROW_HEIGHT,
        }),
      );
    }
  }

  return {
    width,
    height: TOP_PADDING + (row - 1) * ROW_HEIGHT + BOTTOM_PADDING,
    columns,
    nodes,
    edges: shown.map(({ activity, parent }) => ({
      from: parent,
      to: activity.executionId,
      state: activity.status,
    })),
  };
}

/** Clips a label to roughly fit one column; the full text stays in a title. */
export const fitLabel = (text: string, max = 15) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
