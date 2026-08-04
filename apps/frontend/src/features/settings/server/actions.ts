"use server";

import type { LlmProviderModel } from "@/lib/client";

export const fetchProviderModels = async (
  base_url: string,
  provider_id: string,
): Promise<LlmProviderModel[]> => {
  const modedUrl = base_url.endsWith("/") ? base_url.slice(0, -1) : base_url;
  const r = await fetch(`${modedUrl}/models`, {
    method: "GET",
  });
  if (r.ok) {
    const models = (await r.json()) as Record<string, any>;
    return models["data"].map((m: { id: string }) => ({
      name: m.id,
      provider_id,
      is_active: true,
    }));
  }
  return [];
};
