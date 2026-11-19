"use client";
import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/api";
import {
  chatFileGetInfoOptions,
  chatFileGetPassageOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import type { ChatFilePassage } from "@/lib/client";
import { APIDownload } from "@/components/api-download";
import { APIImage } from "@/components/api-image";
import { QueryError } from "@/components/query-error";
import { errorDetail } from "@/lib/utils";
import { reflowPassage } from "@/features/chat/lib/passage-text";
import Link from "next/link";

/** Where the passage sits, in words: "Passage 2 of 12" or the image description. */
export function passagePlace(passage: ChatFilePassage): string {
  const place = `passage ${passage.position} of ${passage.total}`;
  return passage.kind === "caption"
    ? `From the description of this image, ${place}.`
    : `${place[0].toUpperCase()}${place.slice(1)} in this file.`;
}

/** The passage with wrapped lines joined into paragraphs (see reflowPassage). */
function PassageQuote({ text }: { text: string }) {
  const passage = reflowPassage(text);
  return (
    <blockquote className="border-primary/40 bg-muted/40 rounded-surface flex flex-col gap-3 border-l-4 p-4 wrap-anywhere">
      {passage.kind === "preformatted" ? (
        <p className="whitespace-pre-wrap">{passage.text}</p>
      ) : (
        passage.paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))
      )}
    </blockquote>
  );
}

/**
 * A source of the conversation (US-90.4): the file, and with `passage` the
 * cited chunk Asterism used. Both are rechecked against the chat's live file
 * scope; the passage text is the file's own content, shown as plain text.
 */
export function ScopedFileView({
  chatId,
  fileId,
  passage = null,
}: {
  chatId: string;
  fileId: string;
  passage?: string | null;
}) {
  const file = useQuery({
    ...chatFileGetInfoOptions({
      client,
      path: { chat_id: chatId, file_id: fileId },
    }),
    retry: false,
    staleTime: 0,
  });
  const cited = useQuery({
    ...chatFileGetPassageOptions({
      client,
      path: { chat_id: chatId, file_id: fileId, chunk_id: passage ?? "" },
    }),
    enabled: !!passage && file.isSuccess,
    retry: false,
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
          <h1 className="text-heading break-all">{file.data.original_name}</h1>
          {passage ? (
            <section
              aria-labelledby="cited-passage"
              className="flex flex-col gap-2"
            >
              <h2 id="cited-passage" className="text-muted-foreground text-sm">
                The passage Asterism used
              </h2>
              {cited.isPending ? (
                <p role="status">Loading the passage…</p>
              ) : cited.error ? (
                <p className="text-muted-foreground">
                  {errorDetail(
                    cited.error,
                    "The passage could not be loaded. You can still download the file.",
                  )}
                </p>
              ) : (
                <figure className="flex flex-col gap-2">
                  <PassageQuote text={cited.data.text} />
                  <figcaption className="text-muted-foreground text-sm">
                    {passagePlace(cited.data)}
                  </figcaption>
                </figure>
              )}
            </section>
          ) : (
            <p>This file is one of the sources this conversation can use.</p>
          )}
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
