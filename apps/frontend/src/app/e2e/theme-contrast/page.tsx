import { notFound } from "next/navigation";
import { ThemeContrastHarness } from "./theme-contrast-harness";

export default function ThemeContrastPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <ThemeContrastHarness />;
}
