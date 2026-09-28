import { FileManager } from "@/components/file-manager";
import { notFound } from "next/navigation";

export default function FileManagerE2EPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <FileManager allowFileUpload />;
}
