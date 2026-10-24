import { notFound } from "next/navigation";
import { PlannedSettingsHarness } from "./settings-harness";

export default function PlannedSettingsPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <PlannedSettingsHarness />;
}
