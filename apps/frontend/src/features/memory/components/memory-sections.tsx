"use client";

import { useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useUser } from "@/features/auth/components/user-context";
import { useFeature } from "@/features/availability/queries";
import { HelpTopic } from "@/features/help/components/help-topic";
import { useUpdateUserSettings } from "@/features/settings/hooks/use-update-user-settings";
import { SettingsSection } from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import {
  memoryAvailabilityOptions,
  memoryGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { MemoryList } from "./memory-list";

/** Why memory isn't used here, from the one live check (ADR-0078); nothing when it is. */
export function MemoryAvailabilityNotice({
  projectId,
}: {
  projectId?: string;
}) {
  const availability = useQuery({
    ...memoryAvailabilityOptions({
      client,
      query: projectId ? { project_id: projectId } : {},
    }),
    retry: false,
  });
  if (!availability.data || availability.data.available) return null;
  const reason = availability.data.reason || "Memory isn't used here";
  return (
    <Alert>
      <InfoIcon />
      <AlertDescription>
        {`${reason.replace(/\.$/, "")}. Your saved memories are kept, and you can still change or delete them.`}
      </AlertDescription>
    </Alert>
  );
}

/** The first page of your user memories, shared with `MemoryList`'s cache. */
const firstUserPage = { kind: "user" as const, page: 1, page_size: 100 };

/**
 * Your Asterism → Memory: the "Use memory" setting and your user memories.
 * While the admin has memory off for you, the setting is hidden, and so is the
 * whole section unless you have memories to see or delete (EPIC-97).
 */
export function YourMemorySection() {
  const user = useUser();
  const { updateSetting, isUpdatingUserSetting } = useUpdateUserSettings();
  const allowed = useFeature("memory").available;
  const saved = useQuery({
    ...memoryGetManyOptions({ client, query: firstUserPage }),
    enabled: !allowed,
    retry: false,
  });
  if (!allowed && (saved.data?.total ?? 0) === 0) return null;
  return (
    <SettingsSection
      title="Memory"
      description="What Asterism remembers about you, such as how you like to learn, so you don't have to repeat it. Only you can see your memories: not educators and not administrators."
      actions={<HelpTopic id="concept.memory" />}
    >
      {allowed && (
        <div className="flex items-start gap-3">
          <Checkbox
            id="your-asterism-memory"
            aria-describedby="your-asterism-memory-description"
            checked={user.settings.memory_enabled ?? true}
            disabled={isUpdatingUserSetting}
            onCheckedChange={(checked) => {
              updateSetting("memory_enabled", !!checked, false);
            }}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="your-asterism-memory">Use memory</Label>
            <p
              id="your-asterism-memory-description"
              className="text-muted-foreground text-xs"
            >
              Each message adds the memories most relevant to it, as information
              about you, never as instructions. Off: Asterism uses none. Your
              memories are kept until you delete them.
            </p>
          </div>
        </div>
      )}
      <MemoryAvailabilityNotice />
      <MemoryList scope={{ kind: "user" }} />
    </SettingsSection>
  );
}

/**
 * A project's settings → Memory: what Asterism remembers for this project only.
 * Hidden while the admin has memory off for you, unless the project has
 * memories to see or delete (EPIC-97).
 */
export function ProjectMemorySection({ projectId }: { projectId: string }) {
  const allowed = useFeature("memory").available;
  const saved = useQuery({
    ...memoryGetManyOptions({
      client,
      query: { project_id: projectId, page: 1, page_size: 100 },
    }),
    enabled: !allowed,
    retry: false,
  });
  if (!allowed && (saved.data?.total ?? 0) === 0) return null;
  return (
    <section aria-label="Project memory" className="grid gap-3 border-t pt-6">
      <div className="flex items-center gap-1">
        <h2 className="font-medium">Project memory</h2>
        <HelpTopic id="concept.memory" />
      </div>
      <p className="text-muted-foreground text-sm">
        Used only in this project&apos;s chats, together with your memories
        about you. Only you can see them.
      </p>
      <MemoryAvailabilityNotice projectId={projectId} />
      <MemoryList scope={{ kind: "project", projectId }} />
    </section>
  );
}
