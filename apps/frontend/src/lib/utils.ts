import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
