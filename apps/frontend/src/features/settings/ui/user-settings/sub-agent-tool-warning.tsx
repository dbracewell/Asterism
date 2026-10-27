import { TriangleAlertIcon } from "lucide-react";

export const SubAgentToolWarning = () => (
  <div
    role="note"
    className="text-foreground rounded-surface border-primary/40 bg-primary/10 flex items-start gap-2 border p-3 text-sm"
  >
    <TriangleAlertIcon
      aria-hidden="true"
      className="text-primary mt-0.5 size-4 shrink-0"
    />
    <p>
      Sub-agent tools run autonomously without asking for permission. Only
      select tools you trust this agent to use whenever another agent delegates
      work to it.
    </p>
  </div>
);
