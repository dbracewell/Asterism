import { bundledThemes } from "@/features/theme/bundled";
import type { MetadataRoute } from "next";

// US-41.6: installable app identity; icons come from `pnpm generate:icons`.
export default function manifest(): MetadataRoute.Manifest {
  const { colors } = bundledThemes.atlas;
  return {
    name: "Asterism",
    short_name: "Asterism",
    description: "Where will your curiosity lead you today?",
    start_url: "/",
    display: "standalone",
    background_color: colors.background,
    theme_color: colors.primary,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
