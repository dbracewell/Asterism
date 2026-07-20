import SessionPage from "@/features/chat/components/session-page";
import { getApiClient } from "@/lib/api-server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import z from "zod";

type ChatSessionPageProps = {
  params: Promise<{ sessionId: string }>;
};

export default async function ChatSessionPage(props: ChatSessionPageProps) {
  const params = await props.params;
  const { data: session_id, success } = z.uuidv4().safeParse(params.sessionId);

  if (!success) {
    redirect("/");
  }

  const api = await getApiClient();
  const { data, error } = await api.chatSessionGetOne({
    path: {
      session_id,
    },
  });

  if (error) {
    console.log(error);
    if (error.code === 404) {
      redirect("/");
    }
    throw Error(`Error code: ${error}`);
  }

  const jwtToken = await auth.api.getToken({
    headers: await headers(),
  });
  if (jwtToken == null) {
    redirect("/");
  }
  return <SessionPage session={data} jwtToken={jwtToken.token} />;
}
