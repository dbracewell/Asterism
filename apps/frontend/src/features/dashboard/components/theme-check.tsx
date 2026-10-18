"use client";
import { useUser } from "@/features/auth/components/user-context";
import { useTheme } from "@/features/theme/components/theme-context";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME_NAME,
} from "@/features/theme/constants";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const ThemeCheck = () => {
  const user = useUser();
  const { currentTheme, allThemes, setTheme, fontSize, setFontSize } =
    useTheme();
  // An isolated malformed/deleted custom palette must not cause refresh loops.
  const desiredTheme = allThemes.some(
    (theme) => theme.filename === user.settings.theme,
  )
    ? user.settings.theme!
    : DEFAULT_THEME_NAME;
  const router = useRouter();

  useEffect(() => {
    if (desiredTheme !== currentTheme || user.settings.font_size !== fontSize) {
      setTheme(desiredTheme);
      setFontSize(user.settings.font_size ?? DEFAULT_FONT_SIZE);
      router.refresh();
    }
  }, [
    currentTheme,
    fontSize,
    router,
    setFontSize,
    setTheme,
    user.settings.font_size,
    desiredTheme,
  ]);

  return null;
};
