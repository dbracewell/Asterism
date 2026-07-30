"use client";
import {
  FONT_SIZE_COOKIE,
  THEME_NAME_COOKIE,
  THEME_REFRESH_COOKIE,
} from "@/features/theme/constants";
import { ExtendedTheme } from "@/features/theme/types";
import Cookies from "js-cookie";
import { useRouter } from "next/navigation";
import React, { createContext, useCallback, useMemo } from "react";

export type ThemeData = {
  currentTheme: string;
  currentThemeType: "light" | "dark";
  allThemes: { name: string; filename: string; type: "light" | "dark" }[];
  fontSize: string;
  setFontSize: (fontSize: string) => void;
  setTheme: (themeFileName: string) => void;
  refresh: () => void;
};

export const ThemeContext = createContext<ThemeData | null>({
  currentTheme: "light",
  currentThemeType: "light",
  allThemes: [],
  fontSize: "16px",
  setFontSize: () => {},
  setTheme: () => {},
  refresh: () => {},
});

export const useTheme = (): ThemeData => {
  const context = React.useContext(ThemeContext);
  if (context == null) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};

export const ThemeProvider = ({
  themes,
  currentTheme,
  fontSize,
  currentThemeType,
  children,
}: {
  themes: Record<string, ExtendedTheme>;
  currentTheme: string;
  fontSize: string;
  currentThemeType: "dark" | "light";
  children: React.ReactNode;
}) => {
  const router = useRouter();
  const allThemes = useMemo(() => {
    return Object.values(themes).map((theme) => ({
      name: theme.name,
      filename: theme.filename,
      type: theme.type,
    }));
  }, [themes]);

  const setFontSize = useCallback((fontSize: string) => {
    try {
      Cookies.set(FONT_SIZE_COOKIE, fontSize);
    } catch (error) {
      console.log(error);
    }
  }, []);

  const setTheme = useCallback((themeFileName: string) => {
    Cookies.set(THEME_NAME_COOKIE, themeFileName, {
      expires: 365,
    });
  }, []);

  const refresh = useCallback(() => {
    Cookies.set(THEME_REFRESH_COOKIE, "yes");
    router.refresh();
  }, [router]);

  return (
    <ThemeContext.Provider
      value={{
        allThemes,
        currentTheme,
        currentThemeType,
        fontSize,
        setFontSize,
        setTheme,
        refresh,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export default ThemeContext;
