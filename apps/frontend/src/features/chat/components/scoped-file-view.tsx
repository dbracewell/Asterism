"use client";
import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/api";
import { chatFileGetInfoOptions } from "@/lib/client/@tanstack/react-query.gen";
import { APIDownload } from "@/components/api-download";
import { APIImage } from "@/components/api-image";
import { QueryError } from "@/components/query-error";
import Link from "next/link";
export function ScopedFileView({
  chatId,
  fileId,
}: {
  chatId: string;
  fileId: string;
}) {
  const file = useQuery({
    ...chatFileGetInfoOptions({
      client,
      path: { chat_id: chatId, file_id: fileId },
    }),
    retry: false,
    staleTime: 0,
  });
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6 pt-16">
      <Link className="underline" href={`/c/${chatId}`}>
        Back to conversation
      </Link>
      {file.error ? (
        <QueryError
          error={file.error}
          message="This source is no longer available in the active chat context."
          retry={file.refetch}
          isRetrying={file.isFetching}
        />
      ) : file.isPending || file.isFetching ? (
        <p role="status">Checking source access…</p>
      ) : (
        <>
          <h1 className="text-heading break-all">
            {file.data.original_name}
          </h1>
          <p>
            Authorized source in the current file scope of this conversation.
          </p>
          {file.data.kind === "image" && (
            <APIImage
              filename={file.data.filename}
              fileId={fileId}
              chatId={chatId}
              alt={file.data.original_name}
              width={320}
              height={240}
            />
          )}
          <APIDownload
            filename={file.data.filename}
            fileId={fileId}
            chatId={chatId}
            linkText="Download source"
          />
        </>
      )}
    </main>
  );
}
