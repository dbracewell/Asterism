import * as FileManager from "@/components/file-manager";
import { PageHeader, PageLayout } from "@/components/page-layout";

export default function FilesPage() {
  return (
    <PageLayout fill className="min-h-[32rem]">
      <PageHeader
        title="Files"
        description="Your file library. Upload files here, then add them to projects and chats."
      />
      <FileManager.Provider>
        <FileManager.UploadFileDropZone className="relative">
          <FileManager.Ribbon>
            <FileManager.DeleteSelectedFilesSection />
            <FileManager.UploadFilesSection />
          </FileManager.Ribbon>
          <FileManager.FileList />
        </FileManager.UploadFileDropZone>
      </FileManager.Provider>
    </PageLayout>
  );
}
