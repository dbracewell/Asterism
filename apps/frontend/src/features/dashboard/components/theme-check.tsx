"use client";
import { useUser } from "@/features/auth/components/user-context";
import { useTheme } from "@/features/theme/components/theme-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME_NAME,
} from "@/features/theme/constants";

export const ThemeCheck = () => {
  const user = useUser();
  const { currentTheme, setTheme, fontSize, setFontSize } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (
      user.settings.theme !== currentTheme ||
      user.settings.font_size !== fontSize
    ) {
      setTheme(user.settings.theme ?? DEFAULT_THEME_NAME);
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
    user.settings.theme,
  ]);

  return null;
};
