import { HelpTopic } from "@/features/help/components/help-topic";

export { CourseManagedBadge } from "@/components/course-managed-badge";

/** Explains why the controls nearby are off, instead of letting a save fail. */
export function CourseManagedNote({ managedBy }: { managedBy: string }) {
  return (
    <div className="text-muted-foreground flex items-start gap-1 text-sm">
      <p>
        {managedBy}&apos;s course manages this, so only course updates can
        change it.
      </p>
      <HelpTopic id="concept.course" />
    </div>
  );
}
