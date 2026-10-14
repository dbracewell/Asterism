import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export function QueryError({
  error,
  message,
  retry,
  isRetrying,
}: {
  error: unknown;
  message: string;
  retry: () => unknown;
  isRetrying: boolean;
}) {
  const detail =
    error &&
    typeof error === "object" &&
    "detail" in error &&
    typeof error.detail === "string"
      ? error.detail
      : null;

  return (
    <Empty className="flex-none gap-2 p-4">
      <div role="alert">
        <EmptyTitle className="text-destructive">{message}</EmptyTitle>
        {detail && <EmptyDescription>{detail}</EmptyDescription>}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={isRetrying}
        onClick={() => void retry()}
      >
        {isRetrying ? "Retrying…" : "Retry"}
      </Button>
    </Empty>
  );
}
