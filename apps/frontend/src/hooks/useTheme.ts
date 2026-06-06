"use client";

import { Theme } from "@/lib/theme";
import Cookies from "js-cookie";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export const useTheme = () => {
  const router = useRouter();
  const [currentTheme, setCurrentTheme] = useState(() => {
    return Cookies.get("custom-theme-name") ?? "light";
  });
  const [allThemes, setAllThemes] = useState<Theme[]>([]);

  useEffect(() => {
    const listThemes = async () => {
      const response = await fetch("/api/theme/list");
      if (response.ok) {
        const data = await response.json();
        setAllThemes(data as Theme[]);
      }
    };
    listThemes();
  }, []);

  const setTheme = useCallback(async (themeName: string) => {
    try {
      const response = await fetch(`/api/theme?name=${themeName}`);
      if (response.ok) {
        const themeData = await response.json();
        setCurrentTheme(themeData.name);
        Cookies.set("custom-theme-name", themeName);
        Cookies.set("custom-theme", themeData, {
          expires: 365,
          path: "/",
        });
        router.refresh();
      } else {
        console.log(response.statusText);
      }
    } catch (error) {
      console.log(error);
    }
  }, []);

  return {
    theme: currentTheme,
    themeList: allThemes,
    setTheme,
  };
};
