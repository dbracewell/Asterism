"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

export const SKILL_PAGE_SIZES = [10, 25, 50] as const;
const DEFAULT_SIZE = 10;

export type SkillListParams = {
  query: string;
  page: number;
  pageSize: number;
};

function readPage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function readSize(value: string | null) {
  const size = Number(value);
  return (SKILL_PAGE_SIZES as readonly number[]).includes(size)
    ? size
    : DEFAULT_SIZE;
}

/**
 * Search, page and page size for the Skills list (US-75.2). They start from
 * the URL and are written back with `history.replaceState`, so a reload or a
 * shared link reopens the same page without adding Back-button entries.
 */
export function useSkillListParams() {
  const searchParams = useSearchParams();
  const [params, setParams] = useState<SkillListParams>(() => ({
    query: searchParams?.get("skills_q") ?? "",
    page: readPage(searchParams?.get("skills_page") ?? null),
    pageSize: readSize(searchParams?.get("skills_size") ?? null),
  }));
  const update = (next: Partial<SkillListParams>) => {
    const merged = { ...params, ...next };
    setParams(merged);
    const url = new URL(window.location.href);
    const write = (key: string, value: string, empty: string) => {
      if (value === empty) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    };
    write("skills_q", merged.query, "");
    write("skills_page", String(merged.page), "1");
    write("skills_size", String(merged.pageSize), String(DEFAULT_SIZE));
    window.history.replaceState(null, "", url);
  };
  return [params, update] as const;
}
