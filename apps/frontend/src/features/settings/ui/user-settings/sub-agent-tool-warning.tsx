import { TriangleAlertIcon } from "lucide-react";

export const SubAgentToolWarning = () => (
  <div
    role="note"
    className="border-amber-500/40 bg-amber-500/10 text-foreground flex items-start gap-2 rounded-md border p-3 text-sm"
  >
    <TriangleAlertIcon
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-amber-500"
    />
    <p>
      Sub-agent tools run autonomously without asking for permission. Only
      select tools you trust this agent to use whenever another agent delegates
      work to it.
    </p>
  </div>
);
