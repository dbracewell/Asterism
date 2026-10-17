import { notFound } from "next/navigation";
import { AgentSettingsHarness } from "./settings-harness";

export default function AgentSettingsTestPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <AgentSettingsHarness />;
}
