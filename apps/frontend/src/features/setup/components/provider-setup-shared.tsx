"use client";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { errorDetail } from "@/lib/utils";
import Link from "next/link";
import { type RefObject, useRef, useState } from "react";
import { flushSync } from "react-dom";

// Full-width actions wrap at large text sizes instead of overflowing the card.
export const actionClassName = "h-auto min-h-7 w-full py-1 whitespace-normal";

/** The API's safe error text, without its machine-readable category prefix. */
export function errorSuffix(error: unknown) {
  const detail = errorDetail(error, "");
  return detail ? ` ${detail.replace(/^[a-z_]+: /, "")}` : "";
}

/** A focused error summary; repeated failures return focus to it. */
export function useErrorSummary() {
  const ref = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const show = (text: string) => {
    flushSync(() => setMessage(text));
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: "start" });
  };
  return {
    errorRef: ref,
    error: message,
    showError: show,
    clearError: () => setMessage(null),
  };
}

export function ErrorSummary({
  id,
  ref,
  message,
}: {
  id: string;
  ref: RefObject<HTMLDivElement | null>;
  message: string | null;
}) {
  if (!message) return null;
  return (
    <FieldError
      ref={ref}
      id={id}
      tabIndex={-1}
      className="rounded-control scroll-mt-6 wrap-anywhere outline-offset-4 focus-visible:outline-2"
    >
      {message}
    </FieldError>
  );
}

export function SkipLink() {
  return (
    <Button asChild variant="ghost" className={actionClassName}>
      <Link href="/">Skip for now</Link>
    </Button>
  );
}
