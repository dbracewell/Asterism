"use client";

import { cn } from "@/lib/utils";
import { createContext, useContext, type ComponentProps } from "react";
import { createPortal } from "react-dom";

const NoticeSlot = createContext<HTMLElement | null>(null);

/** Provides the element under the composer's chip row that collects notices. */
export const ComposerNoticeSlot = NoticeSlot.Provider;

/**
 * A picker's error or status line. Inside the composer it renders below the
 * chip row, so the row can scroll sideways on narrow screens (US-73.2);
 * elsewhere it renders in place on its own line.
 */
export function ComposerNotice({ className, ...props }: ComponentProps<"div">) {
  const slot = useContext(NoticeSlot);
  const notice = (
    <div
      {...props}
      className={cn("order-last w-full basis-full px-2 text-xs", className)}
    />
  );
  return slot ? createPortal(notice, slot) : notice;
}
