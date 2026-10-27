"use client";
import { client } from "@/lib/api";
import { chatSessionGetOneOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";

export function useWorkspaceScope() {
  const pathname = usePathname();
  const search = useSearchParams();
  const chatId = pathname.match(/^\/c\/([^/]+)/)?.[1];
  const routeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const chat = useQuery({
    ...chatSessionGetOneOptions({ client, path: { chat_id: chatId ?? "" } }),
    enabled: !!chatId,
    retry: false,
  });
  const projectId =
    routeProjectId ??
    (chatId
      ? chat.data?.info.project_id
      : pathname === "/"
        ? search.get("project_id")
        : null) ??
    null;
  return {
    projectId,
    chatId,
    chatTitle: chat?.data?.info.title ?? null,
    refetch: chat.refetch,
    isFetching: chat.isFetching,
    pending: !!chatId && chat.isPending,
    error: chatId ? chat.error : null,
  };
}
