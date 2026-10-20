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

export const getCurrentUser = cache(async (): Promise<User> => {
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

  const sessionUser = session.user as typeof session.user & {
    timezone?: string;
  };

  return {
    id: sessionUser.id,
    role: sessionUser.role as "admin" | "user",
    name: sessionUser.name,
    email: sessionUser.email,
    timezone: sessionUser.timezone ?? "UTC",
    settings: settings.data,
  };
});

export const getUserCount = cache(countUsers);
