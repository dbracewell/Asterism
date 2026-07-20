"use client";
import { CopyButton } from "@/components/copy-button";
import MarkdownViewer from "@/components/markdown-viewer";
import { Button } from "@/components/ui/button";
import { useUser } from "@/features/auth/components/user-context";
import ChatInput from "@/features/chat/components/chat-input";
import {
  ChatSessionInput,
  ChatSessionMessageList,
  ChatSessionProvider,
} from "@/features/chat/components/chat-session";
import { useActiveChatSession } from "@/features/chat/hooks/use-active-chat-session";
import { ChatSessionModel, MessageModel } from "@/lib/client";
import { cn } from "@/lib/utils";
import { RotateCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

const SessionPage = ({
  session,
  jwtToken,
}: {
  session: ChatSessionModel;
  jwtToken: string;
}) => {
  return (
    <ChatSessionProvider session={session} jwtToken={jwtToken}>
      <ChatSessionMessageList />
      <ChatSessionInput />
    </ChatSessionProvider>
  );
};

const SessionPage2 = ({
  session,
  jwtToken,
}: {
  session: ChatSessionModel;
  jwtToken: string;
}) => {
  const user = useUser();
  const setSession = useActiveChatSession((state) => state.setSession);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<MessageModel[]>(session.messages);
  const [currentThought, setCurrentThought] = useState<string | null>(null);
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const [tps, setTPS] = useState<number | null>(null);
  const didUnmount = useRef(false);
  const streamingMessageRef = useRef<string>("");
  const streamingThoughtRef = useRef<string>("");
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  const { sendMessage, readyState } = useWebSocket(
    `ws://${process.env.NEXT_PUBLIC_BACKEND_API_URL!.replace("http://", "")}/chat/stream/${session.info.id}?token=${jwtToken}`,
    {
      shouldReconnect: () => didUnmount.current === false,
      reconnectAttempts: 10,
      reconnectInterval: 3000,
      onMessage: (event) => {
        const msgContent = JSON.parse(event.data);

        if (msgContent.type === "STREAM_START") {
          streamingMessageRef.current = "";
          streamingThoughtRef.current = "";

          // Start the UI update loop (20 frames per second is plenty smooth)
          if (!flushTimerRef.current) {
            flushTimerRef.current = setInterval(() => {
              setCurrentMessage(streamingMessageRef.current);
              setCurrentThought(streamingThoughtRef.current);
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }, 5);
          }
        }

        if (msgContent.type === "THINKING_DELTA") {
          streamingThoughtRef.current = msgContent.content;
        }

        if (msgContent.type === "TEXT_DELTA") {
          streamingMessageRef.current = msgContent.content;
        }

        if (msgContent.type === "STREAM_END") {
          // Stop the interval
          if (flushTimerRef.current) {
            clearInterval(flushTimerRef.current);
            flushTimerRef.current = null;
          }

          const lastMessages = JSON.parse(msgContent.content) as MessageModel[];
          setMessages((prev) => [...prev.slice(0, -1), ...lastMessages]);

          // Reset states and refs
          setCurrentMessage(null);
          setCurrentThought(null);
          streamingMessageRef.current = "";
          streamingThoughtRef.current = "";
          setTPS(msgContent.tokens_per_second ?? null);

          setTimeout(() => {
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        }
      },
    },
  );

  useEffect(() => {
    return () => {
      didUnmount.current = true;
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
      }
    };
  }, []);

  // useEffect(() => {
  //   if (!lastJsonMessage) return;

  //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
  //   const msgContent = lastJsonMessage as Record<string, any>;

  //   if (msgContent["type"] === "THINKING_DELTA") {
  //     setCurrentThought(msgContent["content"]);
  //   }

  //   if (msgContent["type"] === "TEXT_DELTA") {
  //     setCurrentMessage(msgContent["content"]);
  //   }

  //   if (msgContent["type"] === "STREAM_END") {
  //     const lastMessages = JSON.parse(msgContent["content"]) as MessageModel[];
  //     setMessages((prev) => [...prev.slice(0, -1), ...lastMessages]);
  //     setCurrentMessage(null);
  //     setCurrentThought(null);
  //     setTPS(msgContent["tokens_per_second"] ?? null);
  //   }

  //   bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [setMessages, lastJsonMessage]);

  useEffect(() => {
    if (session) {
      setSession(session);
    }
    return () => setSession(null);
  }, [session, setSession]);

  const connectionStatus = {
    [ReadyState.CONNECTING]: "Connecting",
    [ReadyState.OPEN]: "Open",
    [ReadyState.CLOSING]: "Closing",
    [ReadyState.CLOSED]: "Closed",
    [ReadyState.UNINSTANTIATED]: "Uninstantiated",
  }[readyState];

  return (
    <>
      <div
        className="no-scrollbar absolute top-0 left-1/2 flex h-screen w-full max-w-6xl -translate-x-1/2 flex-col overflow-y-auto p-4 pt-14"
        ref={containerRef}
      >
        <div className="flex min-w-0 flex-col gap-3">
          {messages.map((message, index) => (
            <div
              className="flex w-full min-w-0 flex-1 flex-col gap-2"
              key={message.id}
            >
              <h4
                className={cn(
                  "mb-1 px-2 text-xs",
                  message.role === "user" && "ml-auto text-right",
                )}
              >
                {message.role === "user"
                  ? user.name.split(" ")[0]
                  : "Assistant"}{" "}
                <br />
                {new Date(message.created_at * 1000).toLocaleString()}
              </h4>
              {message.thinking && (
                <details className="text-muted-foreground bg-muted rounded-xl p-2 text-xs">
                  <summary>Thinking</summary>
                  <MarkdownViewer
                    content={message.thinking}
                    codeFontSize="10px"
                    className="max-h-50 overflow-auto text-xs"
                  />
                </details>
              )}
              <MarkdownViewer
                content={message.content}
                className={cn(
                  "flex w-full flex-1 flex-col",
                  message.role === "user" &&
                    "bg-accent text-accent-foreground ml-auto max-w-xl rounded-xl p-2",
                )}
              />
              <div
                className={cn(
                  "flex w-fit items-center",
                  message.role === "user" && "ml-auto",
                )}
              >
                {index === messages.length - 1 && tps && (
                  <h5 className="text-muted-foreground px-2 pt-2 text-xs">
                    {tps.toFixed(2)} tps
                  </h5>
                )}
                <Button size="icon-sm" variant="ghost">
                  <RotateCwIcon />
                </Button>
                <CopyButton text={message.content} />
              </div>
            </div>
          ))}
          {currentThought && (
            <details
              open
              className="text-muted-foreground bg-muted/50 mb-2 rounded-xl p-2 text-xs italic"
            >
              <summary>Thinking</summary>
              <p className="p-3">{currentThought}</p>
            </details>
          )}
          {currentMessage && (
            <div className="bg-accent/50 text-accent-foreground rounded-xl border p-4 shadow-md md:max-w-[60%]">
              {currentMessage}
            </div>
          )}
        </div>
        <div className="mb-40 size-20" ref={bottomRef}></div>
      </div>

      <div className="absolute right-1/2 bottom-3 flex w-full max-w-3xl translate-x-1/2 flex-col bg-transparent">
        <ChatInput
          disabled={connectionStatus !== "Open"}
          onSubmit={(msg) => {
            setMessages((prev) => [
              ...prev,
              {
                id: "user-msg",
                role: "user",
                content: msg,
                created_at: Date.now(),
              } as MessageModel,
            ]);
            sendMessage(JSON.stringify({ message: msg }));
          }}
        />
      </div>
    </>
  );
};

export default SessionPage;
