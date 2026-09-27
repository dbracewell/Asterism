import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export const useReadWriteSearchParams = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setSearchParams = useCallback(
    (params: Record<string, string | undefined>) => {
      const newSearchParams = new URLSearchParams(searchParams.toString());
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined) {
          newSearchParams.delete(key);
        } else {
          newSearchParams.set(key, value);
        }
      });
      const newSearch = newSearchParams.toString();
      router.replace(`${pathname}?${newSearch}`);
    },
    [pathname, router, searchParams],
  );

  const getSearchParam = useCallback(
    (param: string) => {
      return searchParams.get(param);
    },
    [searchParams],
  );

  const getSearchParams = useCallback(
    (params: string[]) => {
      return params.map((param) => searchParams.get(param) ?? undefined);
    },
    [searchParams],
  );

  return { getSearchParam, getSearchParams, setSearchParams };
};
