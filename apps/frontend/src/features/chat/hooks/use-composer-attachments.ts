import type { UserFile } from "@/lib/client";
import { errorMessage } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAttachmentDraft } from "./use-attachment-draft";

export type UploadState = "queued" | "uploading" | "ready" | "failed";

export interface AttachedFile {
  id: string;
  name: string;
  file?: File;
  source?: UserFile;
  preview?: string;
  state: UploadState;
  error?: string;
  sourceId?: string;
}

/**
 * The composer's attachments: local files with previews, staged uploads and
 * picked library files, backed by the chat's attachment draft.
 */
export function useComposerAttachments({
  chatId,
  onChange,
  onError,
}: {
  chatId?: string;
  /** The attachment set changed, so a pending request id no longer applies. */
  onChange: () => void;
  /** A failure to show beside the composer; `undefined` clears it. */
  onError: (message: string | undefined) => void;
}) {
  const draft = useAttachmentDraft(chatId);
  const [isStaging, setIsStaging] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const previewUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      onChange();
      const additions = files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        file,
        state: "queued" as const,
        // No thumbnail for SVG: its markup is not cleaned until it is uploaded.
        preview:
          file.type.startsWith("image/") && file.type !== "image/svg+xml"
            ? URL.createObjectURL(file)
            : undefined,
      }));
      additions.forEach((file) => {
        if (file.preview) previewUrls.current.add(file.preview);
      });
      setAttachedFiles((previous) => [...previous, ...additions]);
    },
    [onChange],
  );

  const updateFile = useCallback(
    (id: string, update: Partial<AttachedFile>) =>
      setAttachedFiles((files) =>
        files.map((file) => (file.id === id ? { ...file, ...update } : file)),
      ),
    [],
  );

  const removeFile = useCallback(
    async (id: string) => {
      onChange();
      const selected = attachedFiles.find((item) => item.id === id);
      setIsStaging(true);
      try {
        if (selected?.sourceId) await draft.remove(selected.sourceId);
        setAttachedFiles((files) => {
          const file = files.find((item) => item.id === id);
          if (file?.preview) {
            URL.revokeObjectURL(file.preview);
            previewUrls.current.delete(file.preview);
          }
          return files.filter((item) => item.id !== id);
        });
      } catch (error) {
        onError(errorMessage(error, "Upload failed. Please retry."));
      } finally {
        setIsStaging(false);
      }
    },
    [attachedFiles, draft, onChange, onError],
  );

  function clearAttachments() {
    attachedFiles.forEach((file) => {
      if (file.preview) {
        URL.revokeObjectURL(file.preview);
        previewUrls.current.delete(file.preview);
      }
    });
    setAttachedFiles([]);
    onChange();
  }

  async function discardAttachments() {
    setIsStaging(true);
    onError(undefined);
    try {
      await draft.discard();
    } catch {
      onError(
        "Attachments cleared here. If server cleanup failed, staged references expire automatically; library files remain.",
      );
    } finally {
      clearAttachments();
      setIsStaging(false);
    }
  }

  /** Uploads what is not yet staged; a failed file's id comes back `null`. */
  const stageUploads = async () =>
    Promise.all(
      attachedFiles.map(async (attachment) => {
        if (attachment.sourceId) return attachment.sourceId;
        if (!attachment.file) return null;
        updateFile(attachment.id, { state: "uploading", error: undefined });
        try {
          const data = await draft.upload(attachment.file);
          const uploaded = data.files[0];
          if (!uploaded)
            throw new Error("The server did not return an uploaded file.");
          updateFile(attachment.id, {
            state: "ready",
            sourceId: uploaded.id,
            source: uploaded,
          });
          return uploaded.id;
        } catch (error) {
          const message = errorMessage(error, "Upload failed. Please retry.");
          toast.error(`Upload failed for ${attachment.name}: ${message}`);
          updateFile(attachment.id, {
            state: "failed",
            error: message,
          });
          return null;
        }
      }),
    );

  /** "Upload now": stages queued and failed files without sending. */
  const retryUploads = async () => {
    setIsStaging(true);
    try {
      await stageUploads();
    } finally {
      setIsStaging(false);
    }
  };

  const pickFiles = async (files: UserFile[]) => {
    onChange();
    setIsStaging(true);
    try {
      await draft.add(files.map((file) => file.id));
      setAttachedFiles((current) => [
        ...current,
        ...files
          .filter((file) => !current.some((item) => item.sourceId === file.id))
          .map((source) => ({
            id: source.id,
            sourceId: source.id,
            name: source.original_name,
            source,
            state: "ready" as const,
          })),
      ]);
    } finally {
      setIsStaging(false);
    }
  };

  return {
    draft,
    attachedFiles,
    isStaging,
    addFiles,
    removeFile,
    clearAttachments,
    discardAttachments,
    stageUploads,
    retryUploads,
    pickFiles,
  };
}
