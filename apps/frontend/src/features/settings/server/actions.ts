"use server";
import { LlmModel } from "@/lib/client";

export const fetchProviderModels = async (
  base_url: string,
): Promise<LlmModel[]> => {
  const modedUrl = base_url.endsWith("/") ? base_url.slice(0, -1) : base_url;
  const r = await fetch(`${modedUrl}/models`, {
    method: "GET",
  });
  if (r.ok) {
    const models = (await r.json()) as Record<string, any>;
    return models["data"].map((m: { id: string }) => ({
      name: m.id,
      is_active: true,
    }));
  }
  return [];
};
