import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const GroupSettings = () => {
  return (
    <Empty className="rounded-surface border p-8">
      <EmptyHeader>
        <EmptyTitle>Groups Settings</EmptyTitle>
        <EmptyDescription>
          User group management and policy configurations are planned for a
          future release.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};
