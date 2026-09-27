import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { IconDatabaseFilled } from "@tabler/icons-react";

export const NoBases = () => {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconDatabaseFilled />
        </EmptyMedia>
        <EmptyTitle>No knowledge bases yet</EmptyTitle>
        <EmptyDescription>
          Create one to begin indexing private documents.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};
