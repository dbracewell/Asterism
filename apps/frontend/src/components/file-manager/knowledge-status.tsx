"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/api";
import {
  fileCaptionRegenerateMutation,
  fileCaptionClearMutation,
  fileCaptionEditMutation,
  fileKnowledgeGetStatusOptions,
  fileKnowledgeRetryMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

export function KnowledgeStatus({
  filename,
  isImage,
}: {
  filename: string;
  isImage: boolean;
}) {
  const { data } = useQuery(
    fileKnowledgeGetStatusOptions({ client, path: { filename } }),
  );
  const retry = useMutation(fileKnowledgeRetryMutation({ client }));
  const regenerate = useMutation(fileCaptionRegenerateMutation({ client }));
  const clear = useMutation(fileCaptionClearMutation({ client }));
  const edit = useMutation(fileCaptionEditMutation({ client }));
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (!data) return null;
  const failed = data.status === "failed" || data.status === "canceled";
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground capitalize">
        Knowledge: {data.status}
      </span>
      {failed && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => retry.mutate({ path: { filename } })}
          disabled={retry.isPending}
        >
          Retry
        </Button>
      )}
      {isImage && data.status === "ready" && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => regenerate.mutate({ path: { filename } })}
            disabled={regenerate.isPending}
          >
            Regenerate caption
          </Button>
          {data.caption.text && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => clear.mutate({ path: { filename } })}
              disabled={clear.isPending}
            >
              Clear caption
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setText(data.caption.text ?? "");
              setEditing(true);
            }}
          >
            Edit caption
          </Button>
        </>
      )}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit canonical caption</DialogTitle>
          </DialogHeader>
          <DialogDescription>
            Caption regeneration may send the image to the configured external
            provider.
          </DialogDescription>
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Caption text"
          />
          <DialogFooter>
            <Button
              disabled={!text.trim() || edit.isPending}
              onClick={() =>
                edit.mutate(
                  { path: { filename }, body: { text } },
                  { onSuccess: () => setEditing(false) },
                )
              }
            >
              Save caption
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
