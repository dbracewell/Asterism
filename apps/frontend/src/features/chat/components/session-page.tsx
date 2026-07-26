import {
  ChatSessionInput,
  ChatSessionMessageList,
  ChatSessionProvider,
} from "@/features/chat/components/chat-session";
import { ChatModel } from "@/lib/client";

const SessionPage = ({
  session,
  jwtToken,
}: {
  session: ChatModel;
  jwtToken: string;
}) => {
  return (
    <ChatSessionProvider session={session} jwtToken={jwtToken}>
      <ChatSessionMessageList />
      <ChatSessionInput />
    </ChatSessionProvider>
  );
};

export default SessionPage;
