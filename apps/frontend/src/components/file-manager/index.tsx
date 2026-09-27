"use client";
import FileManagerProvider from "@/components/file-manager/context";
import { FileList } from "@/components/file-manager/file-list";
import { Footer } from "@/components/file-manager/footer";
import { Header } from "@/components/file-manager/header";
import { FileManagerPane } from "@/components/file-manager/pane";

type ActionButtonProps = {
  onClick: (filenames: string[]) => void;
  label: string;
  hint: string;
  icon: React.ReactNode;
  isPending?: boolean;
  variant?: "default" | "destructive" | "secondary" | "ghost" | "link";
  className?: string;
  clearSelectionAfterClick?: boolean;
};

type FileManagerProps = {
  className?: string;
  actionButton?: ActionButtonProps;
  allowFileUpload?: boolean;
};

export const FileManager = ({
  allowFileUpload,
  className,
}: FileManagerProps) => {
  return (
    <FileManagerProvider>
      <FileManagerPane
        allowFileUpload={allowFileUpload ?? false}
        className={className}
      >
        <Header allowFileUpload={allowFileUpload ?? false} />
        <FileList />
        <Footer />
      </FileManagerPane>
    </FileManagerProvider>
  );
};
