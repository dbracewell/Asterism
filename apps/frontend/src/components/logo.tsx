import type React from "react";

interface ConstellationProps {
  size?: number;
  fill?: string;
  strokeWidth?: number;
  className?: string;
  /** Applied to every star; each also receives its index as `--node`. */
  nodeClassName?: string;
  /** Applied to every connection; each also receives its index as `--line`. */
  lineClassName?: string;
}

const NODES = [
  { cx: 80, cy: 125, r: 16 },
  { cx: 150, cy: 115, r: 28 },
  { cx: 180, cy: 35, r: 18 },
  { cx: 250, cy: 105, r: 18 },
  { cx: 205, cy: 190, r: 18 },
];

const LINES = [
  [80, 125, 150, 115],
  [150, 115, 180, 35],
  [180, 35, 250, 105],
  [150, 115, 250, 105],
  [150, 115, 205, 190],
  [205, 190, 250, 105],
];

export default function Constellation({
  size = 70,
  fill = "var(--color-sidebar-foreground)",
  strokeWidth = 8,
  className,
  nodeClassName,
  lineClassName,
}: ConstellationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="50 10 230 200"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
    >
      {/* Nodes */}
      {NODES.map((node, index) => (
        <circle
          key={index}
          {...node}
          fill={fill}
          className={nodeClassName}
          style={
            nodeClassName
              ? ({ "--node": index } as React.CSSProperties)
              : undefined
          }
        />
      ))}

      {/* Connections */}
      <g stroke={fill} strokeWidth={strokeWidth} strokeLinecap="round">
        {LINES.map(([x1, y1, x2, y2], index) => (
          <line
            key={index}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            pathLength={lineClassName ? 1 : undefined}
            className={lineClassName}
            style={
              lineClassName
                ? ({ "--line": index } as React.CSSProperties)
                : undefined
            }
          />
        ))}
      </g>
    </svg>
  );
}
