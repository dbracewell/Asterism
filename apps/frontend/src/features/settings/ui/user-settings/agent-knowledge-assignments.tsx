import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { client } from "@/lib/api";
import {
  agentKnowledgeBaseAssignmentsReplaceMutation,
  knowledgeBaseGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function AgentKnowledgeAssignments({
  agentId,
  initialIds,
}: {
  agentId: string;
  initialIds: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-t pt-3">
      <Button type="button" variant="outline" onClick={() => setOpen(!open)}>
        Knowledge base assignments
      </Button>
      {open && <AssignmentEditor agentId={agentId} initialIds={initialIds} />}
    </section>
  );
}

function AssignmentEditor({
  agentId,
  initialIds,
}: {
  agentId: string;
  initialIds: string[];
}) {
  const [selected, setSelected] = useState(initialIds);
  const router = useRouter();
  const query = useQuery(
    knowledgeBaseGetManyOptions({ client, query: { page: 1, page_size: 100 } }),
  );
  const save = useMutation({
    ...agentKnowledgeBaseAssignmentsReplaceMutation({ client }),
    onSuccess: () => {
      router.refresh();
      toast.success("Knowledge base assignments saved");
    },
    onError: () => toast.error("Could not save knowledge base assignments"),
  });
  const options = query.data?.knowledge_bases ?? [];
  return (
    <div className="space-y-3 py-3">
      {query.isPending && <p role="status">Loading knowledge bases…</p>}
      {query.isError && (
        <div role="alert">
          Could not load knowledge bases.{" "}
          <Button type="button" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {query.data && options.length === 0 && <p>No knowledge bases.</p>}
      {options.map((base) => (
        <Label key={base.id}>
          <Checkbox
            checked={selected.includes(base.id)}
            onCheckedChange={(checked) =>
              setSelected(
                checked
                  ? [...selected, base.id]
                  : selected.filter((id) => id !== base.id),
              )
            }
          />
          {base.name}
        </Label>
      ))}
      <Button
        type="button"
        disabled={query.isPending || query.isError || save.isPending}
        onClick={() =>
          save.mutate({
            path: { agent_id: agentId },
            body: { knowledge_base_ids: selected },
          })
        }
      >
        Save assignments
      </Button>
    </div>
  );
}
