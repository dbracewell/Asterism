"use server";

import { auth } from "@/lib/auth";
import { ApiClient, ClientOptions } from "@/lib/client";
import { createClient, createConfig } from "@/lib/client/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

export const getApiClient = cache(async () => {
  const client = await getClient();
  return new ApiClient({ client });
});

export const getClient = cache(async () => {
  const { token: jwtToken } = await auth.api.getToken({
    headers: await headers(),
  });
  if (!jwtToken) {
    redirect("/");
  }
  return createClient(
    createConfig<ClientOptions>({
      baseUrl: process.env.NEXT_PUBLIC_BACKEND_API_URL!,
      headers: {
        Authorization: `Bearer ${jwtToken}`,
      },
    }),
  );
});
