"use server";

import { Llm } from "@/lib/client";

export const fetchProviderModels = async (
  base_url: string,
  provider_id: string,
  apiKey: string,
): Promise<Llm[]> => {
  const modedUrl = base_url.endsWith("/") ? base_url.slice(0, -1) : base_url;
  const r = await fetch(`${modedUrl}/models`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (r.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const models = (await r.json()) as Record<string, any>;
    return models["data"].map((m: { id: string }) => ({
      id: crypto.randomUUID(),
      name: m.id,
      provider_id,
      is_active: true,
    }));
  }
  return [];
};
