import { getCurrentUser } from "@/features/auth/server/session";
import { ProviderSetupStep } from "@/features/setup/components/provider-setup-step";
import { needsProviderSetup } from "@/features/setup/needs-provider-setup";
import { redirect } from "next/navigation";

export default async function SetupPage() {
  // Re-evaluated on every request, so a reload mid-step returns to it and a
  // finished (or later) instance continues to the app.
  if (!needsProviderSetup(await getCurrentUser())) {
    redirect("/");
  }
  return <ProviderSetupStep className="my-auto shrink-0" />;
}
