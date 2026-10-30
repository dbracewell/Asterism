import { ProviderSetupStep } from "@/features/setup/components/provider-setup-step";
import { notFound } from "next/navigation";

// Renders the provider step inside the real auth layout, without its admin
// guard, so browser specs can drive it against mocked provider APIs.
export default function ProviderSetupE2EPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <ProviderSetupStep className="my-auto shrink-0" />;
}
