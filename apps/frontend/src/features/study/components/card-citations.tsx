"use client";

import { Badge } from "@/components/ui/badge";
import type { StudyCitation } from "@/lib/client";

export function CardCitations({ citations }: { citations: StudyCitation[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Sources:</span>
      {citations.map((citation, index) => (
        <Badge
          key={`${citation.file_id}-${citation.chunk_id ?? index}`}
          variant={citation.available ? "secondary" : "outline"}
          title={citation.excerpt ?? undefined}
        >
          {citation.available
            ? citation.file_name
            : "Source no longer in this project"}
        </Badge>
      ))}
    </div>
  );
}
