import {
  ChatSessionInput,
  ChatSessionMessageList,
  ChatSessionProvider,
} from "@/features/chat/components/chat-session";
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
  const model = session.messages
    ? session.messages[session.messages.length - 1].model
    : undefined;
  return (
    <ChatSessionProvider session={session} jwtToken={jwtToken}>
      <ChatSessionMessageList />
      <ChatSessionInput defaultModel={model} />
    </ChatSessionProvider>
  );
};

export default SessionPage;
