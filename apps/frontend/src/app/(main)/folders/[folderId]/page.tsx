import { FolderPage } from "@/features/dashboard/components/folder-page";
import { redirect } from "next/navigation";
import z from "zod";

export default async function FolderRoute({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { data: folderId, success } = z
    .uuidv4()
    .safeParse((await params).folderId);
  if (!success) redirect("/");
  return <FolderPage folderId={folderId} />;
}
