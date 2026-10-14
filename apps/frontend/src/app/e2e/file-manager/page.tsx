import * as FileManager from "@/components/file-manager";
import { notFound } from "next/navigation";

export default function FileManagerE2EPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return (
    <FileManager.Provider>
      <FileManager.UploadFileDropZone>
        <FileManager.Ribbon>
          <FileManager.DeleteSelectedFilesSection />
          <FileManager.UploadFilesSection />
        </FileManager.Ribbon>
        <FileManager.FileList />
      </FileManager.UploadFileDropZone>
    </FileManager.Provider>
  );
}
