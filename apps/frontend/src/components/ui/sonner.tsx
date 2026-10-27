"use client";

import { useTheme } from "@/features/theme/components/theme-context";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { currentThemeType } = useTheme();

  return (
    <Sonner
      theme={currentThemeType}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // richColors: themes have no success/warning roles, so status toasts
          // tint with primary (keeping popover text for contrast) and errors
          // tint with destructive.
          ...richColors("success", "--primary", "--popover-foreground"),
          ...richColors("info", "--primary", "--popover-foreground"),
          ...richColors("warning", "--primary", "--popover-foreground"),
          ...richColors("error", "--destructive", "--destructive"),
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

function richColors(status: string, role: string, text: string) {
  return {
    [`--${status}-bg`]: `color-mix(in oklab, var(${role}) 10%, var(--popover))`,
    [`--${status}-border`]: `color-mix(in oklab, var(${role}) 40%, var(--popover))`,
    [`--${status}-text`]: `var(${text})`,
  };
}

export { Toaster };
