"use client";
import * as FileManager from "@/components/file-manager";
import { useFileManager } from "@/components/file-manager/context";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { client } from "@/lib/api";
import { knowledgeBaseFileCreateManyMutation } from "@/lib/client/@tanstack/react-query.gen";
import { isErrorDetail } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { LinkIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export function AddFilesDialog({
  knowledgeBaseId,
}: {
  knowledgeBaseId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Hint hint="Add files to the knowledge base" side="top" asChild>
        <DialogTrigger
          aria-label="Add files"
          className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
        >
          <LinkIcon />
        </DialogTrigger>
      </Hint>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Add files to this knowledge base</DialogTitle>
          <DialogDescription>
            Select library files to add, or upload new ones first. Files already
            in this knowledge base cannot be selected.
          </DialogDescription>
        </DialogHeader>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          <FileManager.Provider
            checkKnowledgeBaseId={knowledgeBaseId}
            isSelectable={(file) => !file.in_checked_knowledge_base}
            mode="picker"
          >
            <FileManager.UploadFileDropZone>
              <FileManager.Ribbon>
                <FileManager.UploadFilesSection />
                <KnowledgeBaseAddSection
                  knowledgeBaseId={knowledgeBaseId}
                  onAdded={() => setOpen(false)}
                />
              </FileManager.Ribbon>
              <FileManager.FileList />
            </FileManager.UploadFileDropZone>
          </FileManager.Provider>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const KnowledgeBaseAddSection = ({
  knowledgeBaseId,
  onAdded,
}: {
  knowledgeBaseId: string;
  onAdded: () => void;
}) => {
  const { selectedFiles, setSelectedFiles, isMutating, setIsMutating, files } =
    useFileManager();

  const { mutate: addMembershipsMutation } = useMutation({
    ...knowledgeBaseFileCreateManyMutation({ client }),
    onMutate: () => {
      setIsMutating(true);
    },
    onSettled: () => {
      setIsMutating(false);
    },
    onError: (error) => {
      if (isErrorDetail(error)) {
        toast.error(`Unable to add files. ${error.detail}`);
      } else {
        toast.error("Unable to add files");
      }
    },
    onSuccess: () => {
      setSelectedFiles([]);
      onAdded?.();
    },
  });

  const addSelectedToKnowledgeBase = useCallback(() => {
    if (!knowledgeBaseId || selectedFiles.length === 0) return;
    addMembershipsMutation({
      path: { knowledge_base_id: knowledgeBaseId },
      body: {
        file_ids: files
          .filter((file) => selectedFiles.includes(file.filename))
          .map((file) => file.id),
      },
    });
  }, [addMembershipsMutation, files, knowledgeBaseId, selectedFiles]);

  return (
    <FileManager.RibbonSection title="Add">
      <Hint
        hint="Add selected files to this knowledge base"
        side="top"
        asChild
      >
        <Button
          aria-label={`Add selected (${selectedFiles.length})`}
          variant="ghost"
          size="icon-lg"
          disabled={selectedFiles.length === 0 || isMutating}
          onClick={() => {
            addSelectedToKnowledgeBase();
          }}
        >
          <LinkIcon />
        </Button>
      </Hint>
    </FileManager.RibbonSection>
  );
};
