import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const ExportSettings = () => {
  return (
    <Empty className="rounded-surface border p-8">
      <EmptyHeader>
        <EmptyTitle>Export Settings</EmptyTitle>
        <EmptyDescription>
          Data and conversation export tools are planned for a future release.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};
