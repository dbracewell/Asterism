"use client";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/hint";
import { saveBlob } from "@/lib/save-blob";
import { cn } from "@/lib/utils";
import {
  CodeIcon,
  DownloadIcon,
  Maximize2Icon,
  WorkflowIcon,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  diagramFileName,
  diagramImageSource,
  diagramPngBlob,
  diagramStore,
  diagramSvgBlob,
  type Diagram,
  type DiagramTheme,
} from "./diagram";

const noStore = {
  subscribe: () => () => {},
  getSnapshot: () => undefined,
};

export type DiagramFallback = (note?: string, actions?: ReactNode) => ReactNode;

/**
 * A ` ```mermaid ` block drawn as a diagram (ADR-0081). The source is
 * untrusted; it is drawn with the fixed policy, sanitized and shown as an
 * image. Until it is drawn, or if it can't be, `fallback(note)` shows the
 * code. A drawn diagram opens as the diagram; its toggle shows the code.
 */
export function DiagramBlock({
  source,
  closed,
  theme,
  fallback,
  scrollClassName,
}: {
  source: string;
  closed: boolean;
  theme: DiagramTheme;
  fallback: DiagramFallback;
  scrollClassName: string;
}) {
  const [view, setView] = useState<"diagram" | "code">("diagram");
  // Only a person's switch moves focus, never the first render.
  const [switched, setSwitched] = useState(false);
  const drawable = closed && !!source.trim();
  const store = useMemo(
    () => (drawable ? diagramStore(source, theme) : noStore),
    [drawable, source, theme],
  );
  // The server snapshot is always undefined, so the server and the first
  // client render both show code and hydration matches.
  const diagram = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    noStore.getSnapshot,
  );
  if (!diagram) return fallback();
  if (!diagram.ok) return fallback("Couldn't draw this diagram");
  const toggle = (
    <ViewToggle
      view={view}
      autoFocus={switched}
      onToggle={() => {
        setSwitched(true);
        setView(view === "diagram" ? "code" : "diagram");
      }}
    />
  );
  if (view === "code") return fallback(undefined, toggle);
  return (
    <DrawnDiagram
      diagram={diagram}
      source={source}
      toggle={toggle}
      scrollClassName={scrollClassName}
    />
  );
}

function ViewToggle({
  view,
  autoFocus,
  onToggle,
}: {
  view: "diagram" | "code";
  autoFocus: boolean;
  onToggle: () => void;
}) {
  const label = view === "diagram" ? "Show code" : "Show diagram";
  return (
    <Hint asChild hint={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        // Keeps focus on the toggle the person just used.
        autoFocus={autoFocus}
        onClick={onToggle}
      >
        {view === "diagram" ? <CodeIcon /> : <WorkflowIcon />}
      </Button>
    </Hint>
  );
}

// Scroll containers are named groups, not landmarks (EPIC-104): "Diagram:
// Water cycle". An untitled diagram's label already starts with "Diagram:".
const groupName = (label: string) =>
  label.startsWith("Diagram") ? label : `Diagram: ${label}`;

/** Inline diagrams shrink to fit the column down to this scale, then scroll. */
const MIN_FIT_SCALE = 0.75;

function DiagramImage({
  diagram,
  className,
  fit = false,
}: {
  diagram: Diagram;
  className?: string;
  /** Shrink to the column (down to MIN_FIT_SCALE) instead of full size. */
  fit?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local data: SVG, never a remote image
    <img
      data-slot="diagram-image"
      src={diagramImageSource(diagram.svg)}
      alt={diagram.label}
      width={diagram.width}
      height={diagram.height}
      className={cn("block h-auto max-w-none", className)}
      style={
        fit
          ? {
              maxWidth: `max(100%, ${Math.round(diagram.width * MIN_FIT_SCALE)}px)`,
            }
          : undefined
      }
      draggable={false}
    />
  );
}

function DrawnDiagram({
  diagram,
  source,
  toggle,
  scrollClassName,
}: {
  diagram: Diagram;
  source: string;
  toggle: ReactNode;
  scrollClassName: string;
}) {
  const figure = useRef<HTMLElement>(null);
  const download = async (format: "svg" | "png") => {
    try {
      // The PNG sits on the block's own card color, as on the page.
      const background = figure.current
        ? getComputedStyle(figure.current).backgroundColor
        : "transparent";
      const blob =
        format === "svg"
          ? diagramSvgBlob(diagram)
          : await diagramPngBlob(diagram, background);
      saveBlob(blob, diagramFileName(diagram.label, format));
    } catch {
      toast.error("Could not download the diagram.");
    }
  };

  return (
    <figure
      ref={figure}
      data-slot="diagram-block"
      className="not-prose rounded-surface border-border bg-card mb-5 max-w-full min-w-0 overflow-hidden border last:mb-0"
    >
      <div className="bg-muted text-muted-foreground border-border flex h-8 items-center gap-0.5 border-b pr-1 pl-3 text-xs">
        <span className="min-w-0 flex-1 truncate font-mono">diagram</span>
        {toggle}
        <Dialog>
          <Hint asChild hint="Expand">
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Expand diagram">
                <Maximize2Icon />
              </Button>
            </DialogTrigger>
          </Hint>
          <DialogContent className="w-auto sm:max-w-[min(calc(100vw-2rem),90rem)]">
            <DialogHeader>
              <DialogTitle>{diagram.label}</DialogTitle>
              <DialogDescription
                className={cn(!diagram.description && "sr-only")}
              >
                {diagram.description ?? "The diagram at full size."}
              </DialogDescription>
            </DialogHeader>
            <div
              role="group"
              aria-label={groupName(diagram.label)}
              tabIndex={0}
              className={cn(scrollClassName, "bg-card rounded-control p-2")}
            >
              <DiagramImage diagram={diagram} />
            </div>
          </DialogContent>
        </Dialog>
        <DropdownMenu>
          <Hint asChild hint="Download">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Download diagram">
                <DownloadIcon />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void download("svg")}>
              SVG image
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void download("png")}>
              PNG image
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CopyButton text={source} />
      </div>
      <div
        role="group"
        aria-label={groupName(diagram.label)}
        tabIndex={0}
        className={cn(scrollClassName, "p-3")}
      >
        <DiagramImage diagram={diagram} className="mx-auto" fit />
      </div>
      {diagram.description && (
        <figcaption className="sr-only">{diagram.description}</figcaption>
      )}
    </figure>
  );
}
