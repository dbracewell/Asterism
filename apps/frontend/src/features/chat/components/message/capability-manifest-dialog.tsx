"use client";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AgentCapabilities,
  capabilityGroups,
  entriesOfKind,
  grantLabel,
  manifestSummary,
  turnCapabilities,
} from "@/features/chat/lib/capability-manifest";
import type { CapabilityEntry, Message } from "@/lib/client";
import { cn } from "@/lib/utils";
import React from "react";

const entryName = (entry: CapabilityEntry) =>
  entry.name ?? (entry.kind === "file" ? "Unavailable file" : entry.id);

function Entry({ entry }: { entry: CapabilityEntry }) {
  return (
    <li className="flex min-w-0 flex-col gap-1">
      {/* Skill, file and sub-agent names are untrusted text; React escapes them. */}
      <span
        className={cn(
          "text-foreground [overflow-wrap:anywhere]",
          entry.kind === "tool" && "font-mono",
        )}
      >
        {entryName(entry)}
      </span>
      <ul aria-label="Granted by" className="flex flex-wrap gap-1">
        {entry.grants.map((grant) => (
          <li key={grant}>
            <Badge variant="outline">{grantLabel[grant]}</Badge>
          </li>
        ))}
        {entry.approval === "ask" && (
          <li>
            <Badge variant="secondary">Asks you first</Badge>
          </li>
        )}
      </ul>
    </li>
  );
}

function AgentSection({ agent }: { agent: AgentCapabilities }) {
  const { manifest } = agent;
  const headingId = `capabilities-${agent.id}`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={`capabilities-${agent.id}`}
      className="border-border flex min-w-0 flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0"
      style={{
        paddingInlineStart: `${Math.max(agent.depth - 1, 0) * 0.75}rem`,
      }}
    >
      <header className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <h3 id={headingId} className="text-foreground text-sm font-medium">
          {agent.name}
        </h3>
        {agent.model && (
          <span className="text-muted-foreground [overflow-wrap:anywhere]">
            {agent.model}
          </span>
        )}
        {manifest && (
          <span className="text-muted-foreground ml-auto">
            {manifestSummary(manifest)}
          </span>
        )}
      </header>
      {!manifest ? (
        <p className="text-muted-foreground">
          No capabilities were recorded for this agent.
        </p>
      ) : (
        <>
          {manifest.model_supports_tools === false && (
            <p className="text-muted-foreground">
              This model can&apos;t call tools, so no tools were offered.
            </p>
          )}
          {capabilityGroups.map(({ kind, title }) => {
            const entries = entriesOfKind(manifest, kind);
            if (entries.length === 0) return null;
            return (
              <div key={kind} className="flex min-w-0 flex-col gap-1.5">
                <h4 className="text-muted-foreground font-medium">{title}</h4>
                <ul aria-label={title} className="flex flex-col gap-2">
                  {entries.map((entry) => (
                    <Entry key={entry.id} entry={entry} />
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

/**
 * What each agent in a turn could use, and why. Shows the manifests recorded
 * when each agent started; it never recomputes them from current settings.
 * Renders nothing for turns that recorded no manifest.
 */
export function CapabilityManifestDialog({
  steps,
  className,
}: {
  steps: Message[];
  className?: string;
}) {
  const agents = React.useMemo(() => turnCapabilities(steps), [steps]);
  if (agents.length === 0) return null;

  return (
    <Dialog>
      <DialogTrigger
        data-slot="capability-manifest"
        className={cn(
          "rounded-control hover:text-foreground focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
          className,
        )}
      >
        Capabilities
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Capabilities</DialogTitle>
          <DialogDescription>
            What each agent could use in this run, and what allowed it. Recorded
            when the run started; later setting changes don&apos;t alter it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          {agents.map((agent) => (
            <AgentSection key={agent.id} agent={agent} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
