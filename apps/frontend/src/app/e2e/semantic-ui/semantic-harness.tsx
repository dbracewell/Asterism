"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { APIImage } from "@/components/api-image";
import { FullLogo } from "@/components/full-logo";
import MarkdownViewer from "@/components/markdown-viewer";
import { CollapsibleSidebarGroup } from "@/features/dashboard/components/collapsible-sidebar-group";
import { SidebarProvider } from "@/components/ui/sidebar";

// Small production-component probe for typography, motion and named icon actions.
export function SemanticHarness() {
  const [cache] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={cache}>
      <main className="h-dvh overflow-auto p-4">
        <FullLogo />
        <MarkdownViewer
          content={
            "Inline `code sample`.\n\n```javascript\nconst answer = 42;\n```\n\n1. First\n2. Second"
          }
        />
        <APIImage filename="semantic-error.png" />
        <APIImage filename="semantic-missing.png" />
        <APIImage filename="semantic-loading.png" />
        <APIImage filename="semantic-zoom.png" alt="Test diagram" zoomable />
        <SidebarProvider className="min-h-0">
          <CollapsibleSidebarGroup
            label="Projects"
            cookieName="semantic-projects"
            onMenuActionClick={() => {}}
          >
            <p>Project content</p>
          </CollapsibleSidebarGroup>
        </SidebarProvider>
      </main>
    </QueryClientProvider>
  );
}
