import { SessionPage } from "@/features/chat/components/session-page";

export default async function ChatSessionPage(
  props: PageProps<"/app/s/[sessionId]">,
) {
  const params = await props.params;
  return <SessionPage sessionId={params.sessionId} />;
}
