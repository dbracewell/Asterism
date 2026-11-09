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

export const formatURL = (
  path: string,
  searchParams: Record<
    string,
    string | number | boolean | null | undefined | string[]
  >,
) => {
  const paramBuilder = new URLSearchParams();
  Object.entries(searchParams).forEach(([k, v]) => {
    if (v != null) {
      const strValue = Array.isArray(v)
        ? v.map((e) => String(e)).join(",")
        : String(v);
      if (!!strValue.trim()) {
        paramBuilder.set(k, strValue.trim());
      }
    }
  });
  return `${path}/?${paramBuilder.toString()}`;
};

export function isErrorDetail(err: unknown): err is ErrorDetail {
  return (
    err != null &&
    typeof err === "object" &&
    "code" in (err as object) &&
    "detail" in (err as object)
  );
}
