import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const UserPermissionsSettings = () => {
  return (
    <Empty className="rounded-surface border p-8">
      <EmptyHeader>
        <EmptyTitle>User Permissions</EmptyTitle>
        <EmptyDescription>
          Admin and user access checks are already enforced. User management
          screens and permission policy controls are planned for a future
          release.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};
