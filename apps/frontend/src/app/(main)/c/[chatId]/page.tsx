import SessionPage from "@/features/chat/components/session-page";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import z from "zod";

type ChatSessionPageProps = {
  params: Promise<{ chatId: string }>;
};

export default async function ChatSessionPage(props: ChatSessionPageProps) {
  const params = await props.params;
  const { data: chatId, success } = z.uuidv4().safeParse(params.chatId);

  if (!success) {
    redirect("/");
  }

  const jwtToken = await auth.api.getToken({
    headers: await headers(),
  });
  if (jwtToken == null) {
    redirect("/");
  }
  return <SessionPage chatId={chatId} jwtToken={jwtToken!.token} />;
}
