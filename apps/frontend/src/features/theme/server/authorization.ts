import "server-only";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";

export async function requireThemeAdmin() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Authentication required");
  if (session.user.role !== "admin") throw new Error("Administrator required");
}
