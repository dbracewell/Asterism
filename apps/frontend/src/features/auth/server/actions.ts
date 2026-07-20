import { User } from "@/features/auth/types";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

export const requireAdmin = cache(async () => {
  const user = await getCurrentUser();
  if (user.role !== "admin") {
    redirect("/");
  }
  return user;
});

export const getCurrentUser = cache(async () => {
  const headersList = await headers();
  const session = await auth.api.getSession({
    headers: headersList,
  });
  if (!session?.user || session.user.role == null) {
    redirect("/");
  }
  return {
    id: session.user.id,
    role: session.user.role,
    name: session.user.name,
    email: session.user.email,
  } as User;
});

export const getUserCount = cache(async () => {
  const context = await auth.$context;
  const r = await context.adapter.count({
    model: "user",
    where: [],
  });
  return r;
});
