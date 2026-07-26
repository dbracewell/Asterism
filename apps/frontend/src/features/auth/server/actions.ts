"use server";
import { User } from "@/features/auth/types";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getApiClient } from "@/lib/api-server";
import { InstallUserSchema, InstallUserSchemaType } from "@/features/auth/schemas";

export const requireAdmin = cache(async () => {
  const user = await getCurrentUser();
  if (user.role !== "admin") {
    redirect("/");
  }
  return user;
});

export const installApp = async (data: InstallUserSchemaType) => {
  const parsed = InstallUserSchema.safeParse(data);
  if (!parsed.success) {
    throw Error(parsed.error.message);
  }

  let user;
  try {
    const headerList = await headers();
    user = await auth.api.signUpEmail({
      headers: headerList,
      body: { ...parsed.data },
      query: { adminKey: parsed.data.adminKey, install: true },
    });
  } catch (error: unknown) {
    throw Error(JSON.stringify(error));
  }
  const result = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/users/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify({
        user_id: user.user.id,
        system_key: process.env.SYSTEM_KEY,
      }),
    },
  );
  if (!result.ok) {
    const error = await result.json();
    console.log(error);
    throw Error(error["detail"]);
  }
};

export const getCurrentUser = cache(async () => {
  const headersList = await headers();
  const session = await auth.api.getSession({
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

export const getUserCount = cache(async () => {
  const context = await auth.$context;
  return await context.adapter.count({
    model: "user",
    where: [],
  });
});
