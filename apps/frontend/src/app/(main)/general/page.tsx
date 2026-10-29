import { PageHeader, PageLayout } from "@/components/page-layout";
import { WorkspaceChats } from "@/features/projects/components/workspace-chats";

export default function GeneralPage() {
  return (
    <PageLayout>
      <PageHeader
        title="General"
        description="Independent chats with their own attachments and no project instructions."
      />
      <WorkspaceChats projectId={null} />
    </PageLayout>
  );
}
