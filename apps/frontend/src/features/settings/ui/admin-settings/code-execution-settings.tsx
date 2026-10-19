import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const CodeExecutionSettings = () => {
  return (
    <Empty className="rounded-lg border p-8">
      <EmptyHeader>
        <EmptyTitle>Code Execution</EmptyTitle>
        <EmptyDescription>
          Sandboxed code execution and runtime environment settings are planned
          for a future release.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};
