import { notFound } from "next/navigation";
import { SkillsSettingsHarness } from "./settings-harness";
export default function SkillsSettingsTestPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <SkillsSettingsHarness />;
}
