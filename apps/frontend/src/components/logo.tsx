
interface ConstellationProps {
  size?: number;
  fill?: string;
  strokeWidth?: number;
}

export default function Constellation({
  size = 200,
  fill = "var(--color-foreground)",
  strokeWidth = 8,
}: ConstellationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 300 250"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
    >
      {/* Connections */}
      <g stroke={fill} strokeWidth={strokeWidth} strokeLinecap="round">
        <line x1="80" y1="125" x2="150" y2="115" />
        <line x1="150" y1="115" x2="180" y2="35" />
        <line x1="180" y1="35" x2="250" y2="105" />
        <line x1="150" y1="115" x2="250" y2="105" />
        <line x1="150" y1="115" x2="205" y2="190" />
        <line x1="205" y1="190" x2="250" y2="105" />
      </g>

      {/* Nodes */}
      <circle cx="80" cy="125" r="16" fill={fill} />
      <circle cx="150" cy="115" r="28" fill={fill} />
      <circle cx="180" cy="35" r="18" fill={fill} />
      <circle cx="250" cy="105" r="18" fill={fill} />
      <circle cx="205" cy="190" r="18" fill={fill} />
    </svg>
  );
}
