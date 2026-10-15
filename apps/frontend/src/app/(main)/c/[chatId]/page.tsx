import { ChatSession } from "@/features/chat/components/chat-session";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import z from "zod";

type ChatSessionPageProps = {
  params: Promise<{ chatId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function ChatSessionPage(props: ChatSessionPageProps) {
  const params = await props.params;
  const { data: chatId, success } = z.uuidv4().safeParse(params.chatId);

  if (!success) {
    redirect("/");
  }

  const jwtToken = await getAuth().api.getToken({
    headers: await headers(),
  });

  if (jwtToken == null) {
    redirect("/");
  }

  return <ChatSession chatId={chatId} jwtToken={jwtToken.token} />;
}
