import { notFound } from "next/navigation";
import { ProviderE2EHarness } from "./provider-e2e-harness";

export default function ProviderE2EPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <ProviderE2EHarness />;
}
