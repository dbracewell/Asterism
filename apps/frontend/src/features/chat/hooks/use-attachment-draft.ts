import { client } from "@/lib/api";
import {
  chatDraftCreateMutation,
  chatDraftAddFilesMutation,
  chatDraftRemoveFilesMutation,
  chatDraftDiscardMutation,
  chatDraftUploadMutation,
  chatDraftGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/** A lazy server draft owns staging; it never grants runtime scope before acceptance. */
export function useAttachmentDraft(chatId?: string) {
  const queryClient = useQueryClient();
  const create = useMutation({
    ...chatDraftCreateMutation({ client }),
    meta: { skipGlobalInvalidation: true },
  });
  const add = useMutation({
    ...chatDraftAddFilesMutation({ client }),
    meta: { skipGlobalInvalidation: true },
  });
  const remove = useMutation({
    ...chatDraftRemoveFilesMutation({ client }),
    meta: { skipGlobalInvalidation: true },
  });
  const discard = useMutation({
    ...chatDraftDiscardMutation({ client }),
    meta: { skipGlobalInvalidation: true },
  });
  const upload = useMutation({
    ...chatDraftUploadMutation({ client }),
    meta: { skipGlobalInvalidation: true },
  });
  const draft = useRef<Promise<string> | null>(null);
  const id = useRef<string | undefined>(undefined);
  const discardAsync = discard.mutateAsync;
  useEffect(
    () => () => {
      // Lazy draft expiry is the fallback if navigation cleanup cannot reach the server.
      const pending = draft.current;
      if (pending)
        void pending
          .then((draftId) => discardAsync({ path: { draft_id: draftId } }))
          .catch(() => undefined);
    },
    [discardAsync],
  );
  async function ensure() {
    if (!draft.current) {
      draft.current = create
        .mutateAsync({ body: { chat_id: chatId ?? null } })
        .then((value) => {
          id.current = value.id;
          return value.id;
        })
        .catch((error) => {
          draft.current = null;
          throw error;
        });
    }
    return draft.current;
  }
  return {
    id,
    async verify(fileIds: string[]) {
      if (!id.current) return;
      const current = await queryClient.fetchQuery({
        ...chatDraftGetOneOptions({ client, path: { draft_id: id.current } }),
        staleTime: 0,
      });
      const expected = new Set(fileIds);
      if (
        current.unavailable_file_ids.length ||
        current.file_ids.length !== expected.size ||
        current.file_ids.some((fileId) => !expected.has(fileId))
      ) {
        throw new Error(
          "Draft attachments changed or include an unconfirmed selection. Discard attachments and select again before sending.",
        );
      }
    },
    async upload(file: File) {
      const draftId = await ensure();
      return upload.mutateAsync({
        path: { draft_id: draftId },
        body: { files: [file] },
      });
    },
    async add(fileIds: string[]) {
      const draftId = await ensure();
      return add.mutateAsync({
        path: { draft_id: draftId },
        body: { file_ids: fileIds },
      });
    },
    async remove(fileId: string) {
      if (id.current)
        await remove.mutateAsync({
          path: { draft_id: id.current },
          body: { file_ids: [fileId] },
        });
    },
    async discard() {
      try {
        if (id.current)
          await discard.mutateAsync({ path: { draft_id: id.current } });
      } finally {
        draft.current = null;
        id.current = undefined;
      }
    },
    consumed() {
      draft.current = null;
      id.current = undefined;
    },
  };
}
