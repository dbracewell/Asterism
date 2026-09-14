"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function setActiveMessageId(chatId: string, activeId: string) {
  const cookieStore = await cookies();
  cookieStore.set(chatId, activeId, {
    httpOnly: true,
    secure: true,
    maxAge: 60,
  });
  redirect(`/c/${chatId}`);
}
