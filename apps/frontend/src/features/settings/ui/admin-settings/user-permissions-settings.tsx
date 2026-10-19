import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const UserPermissionsSettings = () => {
  return (
    <Empty className="rounded-lg border p-8">
      <EmptyHeader>
        <EmptyTitle>User Permissions</EmptyTitle>
        <EmptyDescription>
          Role-based access control and user permission management are planned
          for a future release.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};
