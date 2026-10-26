import { WorkspaceChats } from "@/features/projects/components/workspace-chats";
export default function GeneralPage() {
  return (
    <main className="container mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 pt-16">
      <header>
        <h1 className="text-title">General</h1>
        <p className="text-muted-foreground">
          Independent chats with their own attachments and no project
          instructions.
        </p>
      </header>
      <WorkspaceChats projectId={null} />
    </main>
  );
}
