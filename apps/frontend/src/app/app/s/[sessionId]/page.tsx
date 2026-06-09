import { SessionPage } from "@/features/chat/components/session-page";

type ChatSessionPageProps = {
  params: Promise<{ sessionId: string }>;
};

export default async function ChatSessionPage(props: ChatSessionPageProps) {
  const params = await props.params;
  return <SessionPage sessionId={params.sessionId} />;
}
