import { notFound } from "next/navigation";
import { SkillsSettingsHarness } from "./settings-harness";
export default async function SkillsSettingsTestPage({
  searchParams,
}: {
  searchParams: Promise<{ admin?: string }>;
}) {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return (
    <SkillsSettingsHarness admin={(await searchParams).admin === "true"} />
  );
}
