"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { useUser } from "@/features/auth/components/user-context";
import {
  availableTourSteps,
  FIRST_CHAT_TOUR_PARAM,
  FIRST_CHAT_TOUR_VALUE,
  tourTarget,
  type TourStep,
} from "@/features/help/tour";
import { useUpdateUserSettings } from "@/features/settings/hooks/use-update-user-settings";
import { XIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React from "react";

const SETTING = "first_chat_tour";

type Tour = { steps: TourStep[]; index: number; target: HTMLElement | null };

/**
 * The optional first-chat tour on the new-chat page (US-61.4).
 *
 * New learners are offered the tour until they finish or dismiss it; that
 * choice is stored per user. `?tour=first-chat` (from the help panel or User
 * Settings) starts it again. `skillsEnabled` is `undefined` while unknown.
 */
export function FirstChatTour({
  skillsEnabled,
}: {
  skillsEnabled: boolean | undefined;
}) {
  const user = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { updateSetting } = useUpdateUserSettings();
  const recorded = user.settings.first_chat_tour ?? null;
  const requested = search.get(FIRST_CHAT_TOUR_PARAM) === FIRST_CHAT_TOUR_VALUE;
  const [tour, setTour] = React.useState<Tour | null>(null);
  const [offerClosed, setOfferClosed] = React.useState(false);

  const start = React.useCallback(() => {
    const steps = availableTourSteps(!!skillsEnabled);
    setOfferClosed(true);
    if (steps.length === 0) return;
    setTour({ steps, index: 0, target: tourTarget(steps[0]) });
  }, [skillsEnabled]);

  // A restart link starts the tour once the skill policy is known.
  const startedFromLink = React.useRef(false);
  React.useEffect(() => {
    if (!requested) {
      startedFromLink.current = false;
      return;
    }
    if (skillsEnabled === undefined || startedFromLink.current) return;
    startedFromLink.current = true;
    const frame = requestAnimationFrame(start);
    return () => cancelAnimationFrame(frame);
  }, [requested, skillsEnabled, start]);

  const end = (outcome: "completed" | "dismissed") => {
    setTour(null);
    setOfferClosed(true);
    // Skipping a replay keeps an earlier completion.
    if (outcome === "completed" || recorded !== "completed")
      updateSetting(SETTING, outcome, false);
    if (requested) {
      const params = new URLSearchParams(search.toString());
      params.delete(FIRST_CHAT_TOUR_PARAM);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    }
  };

  const go = (index: number) =>
    setTour((current) =>
      current
        ? {
            ...current,
            index,
            target: tourTarget(current.steps[index]),
          }
        : current,
    );

  if (tour) return <TourStepPopover tour={tour} onGo={go} onEnd={end} />;
  // Wait for the skill policy so the tour knows whether to include skills.
  if (recorded !== null || requested || offerClosed) return null;
  if (skillsEnabled === undefined) return null;
  return (
    <Card
      size="sm"
      role="region"
      aria-labelledby="first-chat-tour-offer"
      className="w-full"
    >
      <CardHeader>
        <CardTitle id="first-chat-tour-offer">New here?</CardTitle>
        <CardDescription>
          Take a short tour of the message box and the controls around it.
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={start}>
          Start tour
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => end("dismissed")}
        >
          No thanks
        </Button>
      </CardFooter>
    </Card>
  );
}

function TourStepPopover({
  tour,
  onGo,
  onEnd,
}: {
  tour: Tour;
  onGo: (index: number) => void;
  onEnd: (outcome: "completed" | "dismissed") => void;
}) {
  const { steps, index, target } = tour;
  const step = steps[index];
  const last = index === steps.length - 1;
  const titleId = React.useId();
  const bodyId = React.useId();
  const nextRef = React.useRef<HTMLButtonElement>(null);
  const anchor = React.useMemo(() => ({ current: target }), [target]);

  React.useEffect(() => {
    target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [target]);

  return (
    <>
      {target && <TourHighlight target={target} />}
      <Popover
        open
        modal
        onOpenChange={(open) => {
          if (!open) onEnd("dismissed");
        }}
      >
        {target && (
          <PopoverAnchor virtualRef={anchor as React.RefObject<HTMLElement>} />
        )}
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={8}
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className="w-80 max-w-[calc(100vw-1rem)] gap-3"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            nextRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document
              .querySelector<HTMLElement>('[data-tour="message"]')
              ?.focus();
          }}
          // Only Skip, Escape or Finish end the tour.
          onInteractOutside={(event) => event.preventDefault()}
        >
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {`Step ${index + 1} of ${steps.length}: ${step.title}. ${step.body}`}
          </p>
          <PopoverHeader className="pr-8">
            <p className="text-muted-foreground">
              Step {index + 1} of {steps.length}
            </p>
            <PopoverTitle id={titleId} className="text-sm">
              {step.title}
            </PopoverTitle>
            <PopoverDescription id={bodyId} className="text-sm">
              {step.body}
            </PopoverDescription>
          </PopoverHeader>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-2 right-2"
            aria-label="Skip tour"
            onClick={() => onEnd("dismissed")}
          >
            <XIcon aria-hidden="true" />
          </Button>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onEnd("dismissed")}
            >
              Skip tour
            </Button>
            <div className="flex gap-2">
              {/* aria-disabled keeps focus on the button at the first step. */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-disabled={index === 0}
                className="aria-disabled:opacity-50"
                onClick={() => {
                  if (index > 0) onGo(index - 1);
                }}
              >
                Back
              </Button>
              <Button
                ref={nextRef}
                type="button"
                size="sm"
                onClick={() => (last ? onEnd("completed") : onGo(index + 1))}
              >
                {last ? "Finish" : "Next"}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

/** A ring drawn around the current step's control; follows scroll and resize. */
function TourHighlight({ target }: { target: HTMLElement }) {
  const [rect, setRect] = React.useState<DOMRect | null>(null);

  React.useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setRect(target.getBoundingClientRect()),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(target);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [target]);

  if (!rect) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="tour-highlight"
      className="ring-ring rounded-control pointer-events-none fixed z-50 ring-2 ring-offset-2"
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}
