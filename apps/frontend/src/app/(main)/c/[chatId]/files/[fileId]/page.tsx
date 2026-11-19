import { ScopedFileView } from "@/features/chat/components/scoped-file-view";
export default async function ChatFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ chatId: string; fileId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { chatId, fileId } = await params;
  const { passage } = await searchParams;
  return (
    <ScopedFileView
      chatId={chatId}
      fileId={fileId}
      passage={typeof passage === "string" ? passage : null}
    />
  );
}
