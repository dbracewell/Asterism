import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// New bundled files automatically join both browser matrices; unit tests ensure registration.
export const themes = readdirSync(resolve("src/features/theme/bundled"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.slice(0, -5))
  .sort();

export const reviewViewports = [
  {
    name: "phone-short",
    width: 320,
    height: 300,
    pane: 320,
    fontSize: 16,
    reducedMotion: false,
  },
  {
    name: "desktop-narrow",
    width: 1440,
    height: 300,
    pane: 240,
    fontSize: 16,
    reducedMotion: true,
  },
  {
    name: "phone-large-text",
    width: 390,
    height: 600,
    pane: 390,
    fontSize: 32,
    reducedMotion: true,
  },
] as const;
