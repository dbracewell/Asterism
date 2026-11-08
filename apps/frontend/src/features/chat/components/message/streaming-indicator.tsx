import Constellation from "@/components/logo";
import { cn } from "@/lib/utils";

const STAR_CLASS =
  "animate-twinkle motion-reduce:animate-none [animation-delay:calc(var(--node)*180ms)]";

/**
 * Branded "the agent is working" signal: the constellation's stars twinkle in
 * sequence. Under reduced motion the stars stay fully lit and still.
 *
 * `turn` stands in for an assistant reply that has not started yet and sits in
 * the marker column; `inline` trails a reply that is still streaming. A
 * `label` names the work in visible text, e.g. "Compacting conversation…".
 */
export const StreamingIndicator = ({
  variant = "inline",
  label,
}: {
  variant?: "turn" | "inline";
  label?: string;
}) => (
  <div
    role="status"
    data-slot="streaming-indicator"
    data-variant={variant}
    className={cn(
      "text-primary flex items-center",
      variant === "turn" ? "mb-5 gap-3" : "mt-2",
    )}
  >
    {!label && <span className="sr-only">Assistant is working…</span>}
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center",
        variant === "turn" && "bg-primary/10 rounded-dot mt-0.5 size-7",
      )}
    >
      <Constellation
        size={variant === "turn" ? 18 : 16}
        fill="currentColor"
        strokeWidth={14}
        nodeClassName={STAR_CLASS}
      />
    </span>
    {label && <span className="text-muted-foreground text-sm">{label}</span>}
  </div>
);
