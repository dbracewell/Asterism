import { ChatSession } from "@/features/chat/components/chat-session";
import { ChatModel } from "@/lib/client";

const SessionPage = ({
  session,
  jwtToken,
  folderId,
}: {
  session: ChatModel;
  jwtToken: string;
  folderId?: string;
}) => {
  return <ChatSession session={session} jwtToken={jwtToken} folderId={folderId} />;
};

export default SessionPage;
