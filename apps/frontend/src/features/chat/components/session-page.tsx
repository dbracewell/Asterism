import { ChatSession } from "@/features/chat/components/chat-session";

const SessionPage = ({
  sessionId,
  jwtToken,
  folderId,
}: {
  sessionId: string;
  jwtToken: string;
  folderId?: string;
}) => {
  return (
    <ChatSession
      sessionId={sessionId}
      jwtToken={jwtToken}
      folderId={folderId}
    />
  );
};

export default SessionPage;
