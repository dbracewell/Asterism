import "server-only";

import { User } from "@/features/auth/types";
import { getApiClient } from "@/lib/api-server";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

export async function countUsers(): Promise<number> {
  const context = await getAuth().$context;
  return await context.adapter.count({
    model: "user",
    where: [],
  });
}

export const getCurrentUser = cache(async () => {
  const headersList = await headers();
  const session = await getAuth().api.getSession({
    headers: headersList,
  });
  if (!session?.user || session.user.role == null) {
    redirect("/");
  }

  const api = await getApiClient();
  const settings = await api.userSettingsGet({
    throwOnError: true,
  });

  return {
    id: session.user.id,
    role: session.user.role,
    name: session.user.name,
    email: session.user.email,
    settings: settings.data,
  } as User;
});

export const getUserCount = cache(countUsers);
