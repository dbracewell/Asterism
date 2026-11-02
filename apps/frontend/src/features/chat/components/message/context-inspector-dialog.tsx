"use client";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AgentContext,
  InspectedChunk,
  layerLabel,
  turnContext,
} from "@/features/chat/lib/context-manifest";
import { client } from "@/lib/api";
import type {
  ContextFile,
  ContextLayerText,
  Message,
  MessageExecution,
} from "@/lib/client";
import {
  chatContextLayersGetOptions,
  chatFileGetInfoOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { formatPlural } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import React from "react";

const inclusionLabel: Record<ContextFile["inclusion"], string> = {
  text: "Included as text",
  image: "Included as an image",
  omitted: "Not included",
};

const sectionTitle = "text-muted-foreground font-medium";

function Layers({
  agent,
  execution,
  texts,
}: {
  agent: AgentContext;
  execution: MessageExecution | null | undefined;
  /** Owner-only layer text: undefined while loading, null when not kept. */
  texts: ContextLayerText[] | null | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h4 className={sectionTitle}>Prompt layers</h4>
      {agent.isSubAgent && (
        <p className="text-muted-foreground">
          Layer text isn&apos;t kept for sub-agent runs; only which layers were
          used.
        </p>
      )}
      <ol aria-label="Prompt layers" className="flex flex-col gap-1.5">
        {agent.layers.map((layer, index) => {
          const text = texts?.[index];
          const matches =
            text &&
            text.kind === layer.kind &&
            text.revision === layer.revision;
          return (
            <li key={`${layer.kind}-${layer.source_id}`} className="min-w-0">
              <Collapsible className="group/layer">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="text-foreground [overflow-wrap:anywhere]">
                    {layerLabel(layer, execution, agent.isSubAgent)}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    Revision {layer.revision} ·{" "}
                    {layer.characters === 0
                      ? "empty"
                      : formatPlural(layer.characters, "character")}
                  </span>
                  {matches && layer.characters > 0 && (
                    <CollapsibleTrigger className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-control ml-auto inline-flex items-center gap-0.5 outline-none focus-visible:ring-3">
                      <ChevronRightIcon
                        aria-hidden="true"
                        className="size-3.5 transition-transform group-data-[state=open]/layer:rotate-90 motion-reduce:transition-none"
                      />
                      Show text
                    </CollapsibleTrigger>
                  )}
                </div>
                {matches && (
                  <CollapsibleContent>
                    {/* The owner's own instructions, shown as plain text. */}
                    <pre className="bg-muted rounded-control mt-1 max-h-64 overflow-auto p-2 font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
                      {text.text}
                    </pre>
                  </CollapsibleContent>
                )}
              </Collapsible>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ChunkFileName({ chatId, fileId }: { chatId: string; fileId: string }) {
  const file = useQuery({
    ...chatFileGetInfoOptions({
      client,
      path: { chat_id: chatId, file_id: fileId },
    }),
    retry: false,
  });
  if (file.isPending) return <span>Checking file…</span>;
  if (file.error) return <span>File no longer in this chat</span>;
  return <span>{file.data.original_name}</span>;
}

function Chunk({ chatId, chunk }: { chatId: string; chunk: InspectedChunk }) {
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="text-foreground flex min-w-0 flex-wrap items-baseline gap-x-2 [overflow-wrap:anywhere]">
        <ChunkFileName chatId={chatId} fileId={chunk.file_id} />
        <span className="text-muted-foreground tabular-nums">
          Score {chunk.score.toFixed(2)} · generation{" "}
          {chunk.artifact_generation}
        </span>
        {chunk.truncated && <Badge variant="outline">Excerpt cut to fit</Badge>}
      </div>
      {chunk.excerpt != null && (
        // Retrieved text is untrusted file content: plain text, never markup.
        <blockquote
          data-untrusted="true"
          aria-label="Retrieved text (untrusted)"
          className="border-border text-muted-foreground border-l-2 ps-2 [overflow-wrap:anywhere] whitespace-pre-wrap"
        >
          {chunk.excerpt}
        </blockquote>
      )}
    </li>
  );
}

function AgentSection({
  agent,
  chatId,
  execution,
  texts,
}: {
  agent: AgentContext;
  chatId: string;
  execution: MessageExecution | null | undefined;
  texts: ContextLayerText[] | null | undefined;
}) {
  const headingId = `context-${agent.id}`;
  const omittedFiles = agent.files.filter(
    (file) => file.inclusion === "omitted",
  );
  const cut = agent.omissions.length + omittedFiles.length;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={headingId}
      className="border-border flex min-w-0 flex-col gap-3 border-t pt-3 first:border-t-0 first:pt-0"
      style={{
        paddingInlineStart: `${Math.max(agent.depth - 1, 0) * 0.75}rem`,
      }}
    >
      <h3 id={headingId} className="text-foreground text-sm font-medium">
        {agent.name}
      </h3>
      <Layers agent={agent} execution={execution} texts={texts} />
      {agent.template && (
        <p>
          <span className={sectionTitle}>Template: </span>
          <span className="[overflow-wrap:anywhere]">
            {agent.template.name}
          </span>{" "}
          <span className="text-muted-foreground">
            (revision {agent.template.revision})
          </span>
        </p>
      )}
      {agent.files.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <h4 className={sectionTitle}>Attached files</h4>
          <ul aria-label="Attached files" className="flex flex-col gap-1">
            {agent.files.map((file) => (
              <li
                key={file.file_id}
                className="flex min-w-0 flex-wrap items-baseline gap-x-2"
              >
                <span className="text-foreground [overflow-wrap:anywhere]">
                  {file.name}
                </span>
                <span className="text-muted-foreground">
                  {inclusionLabel[file.inclusion]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {agent.chunks.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <h4 className={sectionTitle}>Retrieved passages</h4>
          <ol aria-label="Retrieved passages" className="flex flex-col gap-2">
            {agent.chunks.map((chunk) => (
              <Chunk
                key={`${chunk.tool_call_id}-${chunk.chunk_id}`}
                chatId={chatId}
                chunk={chunk}
              />
            ))}
          </ol>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <h4 className={sectionTitle}>Truncated or left out</h4>
        {cut === 0 ? (
          <p className="text-muted-foreground">Nothing was cut or left out.</p>
        ) : (
          <ul
            aria-label="Truncated or left out"
            className="flex flex-col gap-1"
          >
            {omittedFiles.map((file) => (
              <li key={file.file_id} className="[overflow-wrap:anywhere]">
                <span className="text-foreground">{file.name}</span>:{" "}
                {file.reason}
              </li>
            ))}
            {agent.omissions.map((omission, index) => (
              <li key={index} className="[overflow-wrap:anywhere]">
                {omission.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * What each agent in a turn was given: prompt layers, template, attached
 * files, retrieved passages, and anything truncated or left out. Everything
 * comes from what was recorded when the run executed. Layer text is fetched
 * only for the chat owner when the dialog opens; retrieved text renders as
 * untrusted plain text.
 */
export function ContextInspectorDialog({
  chatId,
  steps,
  className,
}: {
  chatId: string;
  steps: Message[];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const context = React.useMemo(() => turnContext(steps), [steps]);
  const execution = steps.find((step) => step.execution)?.execution;
  const layerMessageId = context?.layerMessageId ?? null;
  const layers = useQuery({
    ...chatContextLayersGetOptions({
      client,
      path: { chat_id: chatId, message_id: layerMessageId ?? "" },
    }),
    enabled: open && layerMessageId != null,
    retry: false,
  });
  if (!context) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        data-slot="context-inspector"
        className={cn(
          "rounded-control hover:text-foreground focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
          className,
        )}
      >
        Context
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Context</DialogTitle>
          <DialogDescription>
            What each agent was given in this run, as recorded when it ran.
            Retrieved passages are file content and are shown as untrusted text.
          </DialogDescription>
        </DialogHeader>
        {layers.error && (
          <p role="alert" className="text-destructive">
            Couldn&apos;t load the layer text.
          </p>
        )}
        <div className="flex min-w-0 flex-col gap-3">
          {context.agents.map((agent) => (
            <AgentSection
              key={agent.id}
              agent={agent}
              chatId={chatId}
              execution={execution}
              texts={agent.isSubAgent ? null : layers.data?.layers}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
