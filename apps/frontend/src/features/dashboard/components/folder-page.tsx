"use client";

import { Spinner } from "@/components/ui/spinner";
import { client } from "@/lib/api";
import { folderGetOneOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";

export const FolderPage = ({ folderId }: { folderId: string }) => {
  const folder = useQuery(folderGetOneOptions({ client, path: { folder_id: folderId } }));
  if (folder.error) throw folder.error;
  if (!folder.data) return <Spinner />;
  return (
    <main className="container mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 pt-16">
      <header>
        <p className="text-muted-foreground text-sm">Folder</p>
        <h1 className="text-2xl font-semibold">{folder.data.title}</h1>
      </header>
    </main>
  );
};
