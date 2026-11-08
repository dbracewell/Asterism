import { Badge } from "@/components/ui/badge";
import { LockIcon } from "lucide-react";

/** Marks a record that a class's course manages (US-67.2). */
export function CourseManagedBadge({ managedBy }: { managedBy: string }) {
  return (
    <Badge variant="secondary">
      <LockIcon data-icon="inline-start" aria-hidden="true" />
      Managed by {managedBy}
    </Badge>
  );
}
