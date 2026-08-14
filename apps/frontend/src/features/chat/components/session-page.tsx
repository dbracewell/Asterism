import { ChatSession } from "@/features/chat/components/chat-session";

const SessionPage = ({
  chatId,
  jwtToken,
  folderId,
}: {
  chatId: string;
  jwtToken: string;
  folderId?: string;
}) => {
  return (
    <ChatSession chatId={chatId} jwtToken={jwtToken} folderId={folderId} />
  );
};

export default SessionPage;
