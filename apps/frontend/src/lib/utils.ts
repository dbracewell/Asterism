import { ErrorDetail } from "@/lib/client";
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The shape tiers (US-41.4) are radius tokens, so `rounded-chip` replaces a
// component's `rounded-control` instead of both applying.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { radius: ["control", "surface", "overlay", "chip", "dot"] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The API's safe error text: a `detail` string, or the first validation
 * message. `fallback` when the error carries neither.
 */
export function errorDetail(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "detail" in error) {
    const { detail } = error;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string")
      return detail[0].msg;
  }
  return fallback;
}

/** A thrown `Error`'s message, else the API's error text (see `errorDetail`). */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : errorDetail(error, fallback);
}

export function isErrorDetail(err: unknown): err is ErrorDetail {
  return (
    err != null &&
    typeof err === "object" &&
    "code" in (err as object) &&
    "detail" in (err as object)
  );
}
