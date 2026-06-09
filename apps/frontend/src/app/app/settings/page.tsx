import { ApiClient } from "@/client";
import { createClient } from "@/client/client/client.gen";
import { SettingsPageView } from "@/features/settings/ui/settings-page-view";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export default async function SettingsPage() {
  const jwtToken = await auth.api.getToken({
    headers: await headers(),
  });
  const client = createClient({
    baseUrl: process.env.NEXT_PUBLIC_BACKEND_API_URL!,
    auth: jwtToken.token,
  });
  const { data, error } = await new ApiClient({ client }).getCurrentUser();
  if (error || !data) {
    redirect("/");
  }
  const roles = data?.roles ?? [];
  return (
    <Suspense>
      <SettingsPageView isAdmin={roles.indexOf("admin") >= 0} />
    </Suspense>
  );
}
