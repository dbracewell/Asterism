import React from "react";

// Far enough from the bottom to offer "jump to latest" even when idle.
const SCROLL_BOTTOM_THRESHOLD = 200;
// Scrolling up past this stops following the conversation.
const AUTO_SCROLL_LOCK_THRESHOLD = 16;

/**
 * Follows a transcript's end as it grows, until the user scrolls up. The
 * arguments are whatever grows the transcript; `messageListRef` marks its end.
 */
export function useChatAutoScroll({
  messages,
  incomingMessage,
  comparisonStream,
  subAgentActivities,
  isProcessing,
}: {
  messages: unknown;
  incomingMessage: unknown;
  comparisonStream: unknown;
  subAgentActivities: unknown;
  isProcessing: boolean;
}) {
  const messageListRef = React.useRef<HTMLDivElement | null>(null);
  const preventAutoScrollRef = React.useRef(false);
  const lastScrollTopRef = React.useRef(0);
  const [isScrollable, setIsScrollable] = React.useState(false);
  const [isScrolledAway, setIsScrolledAway] = React.useState(false);

  // Before paint, so a scroll event never measures growth not yet followed.
  React.useLayoutEffect(() => {
    if (preventAutoScrollRef.current) return;
    messageListRef.current?.scrollIntoView({ behavior: "instant" });
  }, [
    messages,
    incomingMessage,
    comparisonStream,
    subAgentActivities,
    isProcessing,
  ]);

  const onScroll = (e: React.UIEvent<HTMLElement>) => {
    const { scrollTop } = e.currentTarget;
    const scrollPosition =
      e.currentTarget.scrollHeight - (scrollTop + e.currentTarget.clientHeight);

    // Only scrolling up locks: content growing below is not a choice to
    // stop following, even when this event lands after it.
    const scrolledUp = scrollTop < lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;
    const isLocked =
      scrollPosition > AUTO_SCROLL_LOCK_THRESHOLD &&
      (scrolledUp || preventAutoScrollRef.current);
    preventAutoScrollRef.current = isLocked;
    if (isLocked !== isScrolledAway) setIsScrolledAway(isLocked);

    const isNowScrollable = scrollPosition > SCROLL_BOTTOM_THRESHOLD;
    if (isNowScrollable !== isScrollable) {
      setIsScrollable(isNowScrollable);
    }
  };

  /** Resume following on the next growth, wherever the user had read to. */
  const follow = () => {
    preventAutoScrollRef.current = false;
  };

  const jumpToLatest = () => {
    preventAutoScrollRef.current = false;
    setIsScrollable(false);
    setIsScrolledAway(false);
    messageListRef.current?.scrollIntoView({ behavior: "instant" });
  };

  return {
    messageListRef,
    isScrollable,
    isScrolledAway,
    onScroll,
    follow,
    jumpToLatest,
  };
}
