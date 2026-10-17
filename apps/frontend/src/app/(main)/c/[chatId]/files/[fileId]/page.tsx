import { ScopedFileView } from "@/features/chat/components/scoped-file-view";
export default async function ChatFilePage({
  params,
}: {
  params: Promise<{ chatId: string; fileId: string }>;
}) {
  const { chatId, fileId } = await params;
  return <ScopedFileView chatId={chatId} fileId={fileId} />;
}
