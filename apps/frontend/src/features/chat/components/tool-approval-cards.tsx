"use client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Payload } from "@/features/chat/components/agent-timeline";
import { formatPayload } from "@/features/chat/lib/agent-timeline";
import { ToolRiskLevel, toolRiskHint } from "@/features/chat/lib/tool-approval";
import { PermissionRequest } from "@/features/chat/types";
import { formatPlural } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  CircleHelpIcon,
  EyeIcon,
  ShieldQuestionIcon,
  TriangleAlertIcon,
} from "lucide-react";
import React from "react";

export type ToolApprovalDecision = (
  request: PermissionRequest,
  approved: boolean,
) => void;

const RiskIcon = ({ level }: { level: ToolRiskLevel }) => {
  const className = "mt-0.5 size-3.5 shrink-0";
  switch (level) {
    case "changes":
      return (
        <TriangleAlertIcon
          aria-hidden="true"
          className={cn(className, "text-destructive")}
        />
      );
    case "reads":
      return <EyeIcon aria-hidden="true" className={className} />;
    case "unknown":
      return <CircleHelpIcon aria-hidden="true" className={className} />;
  }
};

const isEditable = (element: Element | null) =>
  element instanceof HTMLElement &&
  (element.isContentEditable ||
    element.matches("input, textarea, select, [role=textbox]"));

const ToolApprovalCard = ({
  request,
  decision,
  cardRef,
  onDecide,
}: {
  request: PermissionRequest;
  /** The decision already sent, while the backend has not confirmed it. */
  decision?: boolean;
  cardRef: (element: HTMLDivElement | null) => void;
  onDecide: (approved: boolean) => void;
}) => {
  const id = React.useId();
  const hint = toolRiskHint(request.name);
  const args = request.arguments.trim();
  const sent = decision != null;
  const actionClass =
    "aria-disabled:pointer-events-none aria-disabled:opacity-50";

  return (
    <Card
      ref={cardRef}
      size="sm"
      tabIndex={-1}
      role="group"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      data-slot="tool-approval"
      data-risk={hint.level}
      className={cn(
        "focus-visible:ring-ring outline-none focus-visible:ring-2",
        hint.level === "changes" && "ring-destructive/30",
      )}
    >
      <CardHeader>
        <CardTitle id={`${id}-title`} className="flex items-center gap-1.5">
          <ShieldQuestionIcon aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            Allow <span className="font-mono">{request.name}</span>?
          </span>
        </CardTitle>
        <CardDescription id={`${id}-hint`} className="flex gap-1.5">
          <RiskIcon level={hint.level} />
          <span>
            <span className="text-foreground font-medium">{hint.label}.</span>{" "}
            {hint.text} Unanswered requests are denied after a minute.
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {args && args !== "{}" ? (
          <Payload label="Arguments" text={formatPayload(args)} />
        ) : (
          <p className="text-muted-foreground">No arguments.</p>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-2">
        {sent && (
          <span role="status" className="text-muted-foreground mr-auto">
            {decision ? "Approving…" : "Denying…"}
          </span>
        )}
        <Button
          variant="outline"
          aria-label={`Deny ${request.name}`}
          aria-disabled={sent || undefined}
          className={actionClass}
          onClick={() => onDecide(false)}
        >
          Deny
        </Button>
        <Button
          aria-label={`Approve ${request.name}`}
          aria-disabled={sent || undefined}
          className={actionClass}
          onClick={() => onDecide(true)}
        >
          Approve
        </Button>
      </CardFooter>
    </Card>
  );
};

/**
 * Pending tool approvals as focus-managed cards. A newly arrived request takes
 * focus unless the user is typing; after a decision, focus moves to the next
 * undecided card, and returns to where it came from once none remain. Each
 * request is answered at most once; the card leaves when the backend confirms.
 */
export function ToolApprovalCards({
  requests,
  onDecide,
}: {
  requests: PermissionRequest[];
  onDecide: ToolApprovalDecision;
}) {
  const [decisions, setDecisions] = React.useState<Record<string, boolean>>({});
  const decisionsRef = React.useRef(decisions);
  const cards = React.useRef(new Map<string, HTMLDivElement>());
  const seen = React.useRef(new Set<string>());
  const sectionRef = React.useRef<HTMLElement>(null);
  const holdsFocus = React.useRef(false);
  const returnFocus = React.useRef<HTMLElement | null>(null);

  const undecided = (except?: string) =>
    requests.find(
      (request) =>
        request.id !== except && decisionsRef.current[request.id] == null,
    );

  React.useLayoutEffect(() => {
    const fresh = requests.filter((request) => !seen.current.has(request.id));
    fresh.forEach((request) => seen.current.add(request.id));
    const active = document.activeElement;

    // The focused card was removed: continue with another one or go back.
    if (holdsFocus.current && (active == null || active === document.body)) {
      const next = undecided() ?? requests[0];
      if (next) {
        cards.current.get(next.id)?.focus();
        return;
      }
      holdsFocus.current = false;
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target?.isConnected) target.focus();
      return;
    }

    if (fresh.length > 0 && !holdsFocus.current && !isEditable(active)) {
      returnFocus.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      cards.current.get(fresh[0].id)?.focus();
    }
    // Only a change of requests may move focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests]);

  const decide = (request: PermissionRequest, approved: boolean) => {
    if (decisionsRef.current[request.id] != null) return;
    decisionsRef.current = { ...decisionsRef.current, [request.id]: approved };
    setDecisions(decisionsRef.current);
    onDecide(request, approved);
    const next = undecided(request.id);
    if (next && holdsFocus.current) cards.current.get(next.id)?.focus();
  };

  const waiting = requests.filter((request) => decisions[request.id] == null);

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {waiting.length > 0 &&
          `${formatPlural(waiting.length, "tool")} waiting for approval`}
      </p>
      {requests.length > 0 && (
        <section
          ref={sectionRef}
          aria-label="Tool approvals"
          className="min-w-0 py-1"
          onFocus={() => {
            holdsFocus.current = true;
          }}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && !sectionRef.current?.contains(next)) {
              holdsFocus.current = false;
              returnFocus.current = null;
            }
          }}
        >
          <ul className="flex min-w-0 flex-col gap-2">
            {requests.map((request) => (
              <li key={request.id} className="min-w-0">
                <ToolApprovalCard
                  request={request}
                  decision={decisions[request.id]}
                  cardRef={(element) => {
                    if (element) cards.current.set(request.id, element);
                    else cards.current.delete(request.id);
                  }}
                  onDecide={(approved) => decide(request, approved)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
