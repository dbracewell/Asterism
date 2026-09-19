import { notFound } from "next/navigation";
import { SubAgentE2EHarness } from "./sub-agent-e2e-harness";

export default function SubAgentE2EPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <SubAgentE2EHarness />;
}
