"use client";

import { UserProvider } from "@/features/auth/components/user-context";
import { GeneralSettings } from "@/features/settings/ui/user-settings/general-settings";
import { LibraryFilePicker } from "@/components/file-manager/library-file-picker";
import * as FileManager from "@/components/file-manager";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SettingsCard } from "@/features/settings/ui/settings-card";
import { ThemeEditor } from "@/features/settings/ui/admin-settings/theme-editor";
import { MainAgentForm } from "@/features/settings/ui/user-settings/agent-profile-form";
import { useReadWriteSearchParams } from "@/hooks/use-read-write-search-params";

const stressText =
  "Validation details: " +
  "unbroken".repeat(40) +
  " Please review the fields. ".repeat(40);

function Dialogs() {
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open tall dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Validation</DialogTitle>
            <DialogDescription>{stressText}</DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button>Open tall confirmation</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm change</AlertDialogTitle>
            <AlertDialogDescription>{stressText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LibraryFilePicker
        excludedIds={[]}
        onPick={async () => {
          throw new Error("Test staging failure");
        }}
      />
      <MainAgentForm
        configuration={{
          id: "main",
          name: "Main",
          description: "",
          system_prompt: "Instructions",
          tools: [],
          max_steps: 5,
        }}
      />
    </div>
  );
}

export function ResponsivenessHarness() {
  const { getSearchParam } = useReadWriteSearchParams();
  const paneWidth = Number(getSearchParam("pane")) || 1440;
  return (
    <main
      className="flex h-dvh min-h-0 min-w-0 flex-col p-2"
      style={{ width: `min(100%, ${paneWidth}px)` }}
    >
      <UserProvider
        user={{
          id: "responsive-user",
          name: "Responsive user",
          email: "responsive@example.test",
          role: "admin",
          timezone: "UTC",
          settings: {
            main_agent: {
              id: "main",
              name: "Main",
              description: "",
              system_prompt: "",
              max_steps: 5,
              tools: [],
            },
          },
        }}
      >
        <SettingsCard
          name="admin"
          defaultTab={getSearchParam("setting") ?? undefined}
          settings={[
            {
              type: "section",
              label: "Themes",
              value: "themes",
              isDefault: true,
              icon: null,
              settingsPane: <ThemeEditor />,
            },
            {
              type: "section",
              label: "Files",
              value: "files",
              icon: null,
              settingsPane: (
                <FileManager.Provider>
                  <FileManager.Ribbon />
                  <FileManager.FileList />
                </FileManager.Provider>
              ),
            },
            {
              type: "section",
              label: "General",
              value: "general",
              icon: null,
              settingsPane: <GeneralSettings />,
            },
            ...Array.from({ length: 12 }, (_, index) => ({
              type: "section" as const,
              label: `Additional section ${index + 1}`,
              value: `additional-${index + 1}`,
              icon: null,
              settingsPane: <p>Additional settings</p>,
            })),
            {
              type: "section",
              label: "Dialogs",
              value: "dialogs",
              icon: null,
              settingsPane: <Dialogs />,
            },
          ]}
        />
      </UserProvider>
    </main>
  );
}
