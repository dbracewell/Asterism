import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";
import { KnowledgeBase } from "@/lib/client";
import {
  knowledgeBaseCreateMutation,
  knowledgeBaseUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";

type EditorProps = {
  editing: KnowledgeBase | null;
  clearEditing: () => void;
};

export const Editor = ({ editing, clearEditing }: EditorProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const createMutation = useMutation(knowledgeBaseCreateMutation({ client }));
  const updateMutation = useMutation(knowledgeBaseUpdateMutation({ client }));

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setDescription(editing.description || "");
      setIsOpen(true);
    }
  }, [editing]);

  const onSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (editing) {
      await updateMutation.mutateAsync({
        path: { knowledge_base_id: editing.id },
        body: { name: name.trim(), description: description.trim() || null },
      });
      clearEditing();
      setName("");
      setDescription("");
    } else {
      await createMutation.mutateAsync({
        body: { name: name.trim(), description: description.trim() || null },
      });
      setName("");
      setDescription("");
    }
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <div className="flex justify-start p-2">
        <Button variant="outline" onClick={() => setIsOpen(true)}>
          Create knowledge base
        </Button>
      </div>
    );
  }

  return (
    <form className="relative grid gap-3 p-4" onSubmit={onSubmit}>
      {editing == null && (
        <Button
          variant="destructiveGhost"
          size="icon"
          onClick={() => setIsOpen(false)}
          className="absolute top-1 right-1"
        >
          <XIcon />
        </Button>
      )}
      <label className="grid gap-1">
        <span className="text-sm font-medium">Name</span>
        <input
          className="rounded border bg-transparent p-2"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={255}
          required
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Description (optional)</span>
        <textarea
          className="rounded border bg-transparent p-2"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit">
          {editing ? "Save changes" : "Create knowledge base"}
        </Button>
        {editing && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setName("");
              setDescription("");
              clearEditing();
              setIsOpen(false);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
};
