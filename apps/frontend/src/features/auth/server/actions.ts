"use server";
import {
  InstallUserSchema,
  InstallUserSchemaType,
} from "@/features/auth/schemas";
import { getAuth } from "@/lib/auth";
import { BACKEND_API_URL } from "@/lib/backend-url";
import { getFrontendServerConfig } from "@/lib/server-config";
import { headers } from "next/headers";
import { countUsers } from "./session";

export const installApp = async (data: InstallUserSchemaType) => {
  const parsed = InstallUserSchema.safeParse(data);
  if (!parsed.success) {
    throw Error(parsed.error.message);
  }

  const existingUsers = await countUsers();
  if (existingUsers > 0) {
    throw Error("Application is already installed");
  }

  let user;
  try {
    const headerList = await headers();
    user = await getAuth().api.signUpEmail({
      headers: headerList,
      body: { ...parsed.data },
      query: { adminKey: parsed.data.adminKey, install: true },
    });
  } catch (error: unknown) {
    throw Error(error instanceof Error ? error.message : JSON.stringify(error));
  }

  try {
    const result = await fetch(`${BACKEND_API_URL}/users/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify({
        user_id: user.user.id,
        system_key: getFrontendServerConfig().systemKey,
      }),
    });

    if (!result.ok) {
      let detail = "Failed to provision user in backend";
      try {
        const errorBody = await result.json();
        if (errorBody?.detail) {
          detail = String(errorBody.detail);
        }
      } catch {
        // Ignore JSON parse errors on non-JSON failure responses
      }
      throw Error(detail);
    }
  } catch (error: unknown) {
    try {
      const context = await getAuth().$context;
      await context.internalAdapter.deleteUser(user.user.id);
    } catch {
      // Best-effort rollback so failed backend provisioning does not brick install
    }
    throw error instanceof Error ? error : Error(String(error));
  }
};
