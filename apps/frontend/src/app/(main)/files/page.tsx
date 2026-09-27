import { FileManager } from "@/components/file-manager";

export default function FilesPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="bg-accent text-accent-foreground border-b px-4 py-2 text-lg font-bold">
        File Manager
      </h1>
      <FileManager allowFileUpload={true} />
    </div>
  );
}
