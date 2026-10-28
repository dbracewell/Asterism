import type React from "react";

interface ConstellationProps {
  size?: number;
  fill?: string;
  strokeWidth?: number;
  className?: string;
  /** Applied to every star; each also receives its index as `--node`. */
  nodeClassName?: string;
}

const NODES = [
  { cx: 80, cy: 125, r: 16 },
  { cx: 150, cy: 115, r: 28 },
  { cx: 180, cy: 35, r: 18 },
  { cx: 250, cy: 105, r: 18 },
  { cx: 205, cy: 190, r: 18 },
];

export default function Constellation({
  size = 70,
  fill = "var(--color-sidebar-foreground)",
  strokeWidth = 8,
  className,
  nodeClassName,
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
        <line x1="80" y1="125" x2="150" y2="115" />
        <line x1="150" y1="115" x2="180" y2="35" />
        <line x1="180" y1="35" x2="250" y2="105" />
        <line x1="150" y1="115" x2="250" y2="105" />
        <line x1="150" y1="115" x2="205" y2="190" />
        <line x1="205" y1="190" x2="250" y2="105" />
      </g>
    </svg>
  );
}
