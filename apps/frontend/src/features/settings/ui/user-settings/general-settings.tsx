import { useId, useState } from "react";
import { FontSizeSelector } from "@/components/settings/font-size-selector";
import { ModelSelector } from "@/components/settings/model-selector";
import { ThemeGallery } from "@/components/settings/theme-gallery";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpTopic } from "@/features/help/components/help-topic";
import { firstChatTourHref } from "@/features/help/tour";
import Link from "next/link";
import { useUser } from "@/features/auth/components/user-context";
import { useUpdateUserSettings } from "@/features/settings/hooks/use-update-user-settings";
import { useTheme } from "@/features/theme/components/theme-context";
import {
  SettingsPane,
  SettingsSection,
} from "@/features/settings/ui/settings-section";

export const GeneralSettings = () => {
  const { updateSetting, isUpdatingUserSetting } = useUpdateUserSettings();
  const user = useUser();
  const userSettings = user.settings;
  const { setTheme } = useTheme();
  const themeLabelId = useId();
  // Show the pick at once; the saved setting arrives on the next refresh.
  const [pickedTheme, setPickedTheme] = useState<string>();

  return (
    <SettingsPane
      title="General"
      description="Appearance and defaults for your account."
      className="@container/general"
    >
      {user.settings.group && (
        <SettingsSection title="Account">
          <div className="flex items-center gap-1 text-sm">
            <span>
              Group: <strong>{user.settings.group.name}</strong>
            </span>
            <HelpTopic id="concept.group" />
          </div>
          <p className="text-muted-foreground text-xs">
            Your group decides which models and tools you may use. Only an
            administrator can change it.
          </p>
        </SettingsSection>
      )}
      <SettingsSection title="Appearance">
        <div className="flex min-w-0 flex-col gap-2">
          <Label id={themeLabelId} asChild>
            <span>Theme</span>
          </Label>
          <ThemeGallery
            labelId={themeLabelId}
            currentTheme={pickedTheme ?? user.settings.theme}
            canEdit={user.role === "admin"}
            onChange={(theme) => {
              setPickedTheme(theme);
              updateSetting("theme", theme, false);
              setTheme(theme);
            }}
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 items-center gap-x-4 gap-y-3 @sm/general:grid-cols-[auto_minmax(0,1fr)]">
          <Label htmlFor="general-font-size">Font Size</Label>
          <FontSizeSelector
            id="general-font-size"
            disabled={isUpdatingUserSetting}
            currentSize={user.settings.font_size}
            onChange={(size) => updateSetting("font_size", size, false)}
          />
          <Label htmlFor="general-show-thinking">Show Thinking</Label>
          <Checkbox
            id="general-show-thinking"
            checked={user.settings.show_thinking ?? false}
            disabled={isUpdatingUserSetting}
            onCheckedChange={(checked) => {
              updateSetting("show_thinking", !!checked, false);
            }}
          />
        </div>
      </SettingsSection>
      <SettingsSection
        title="Chat"
        description="New chats start with this model; each chat keeps its own selection."
      >
        <div className="flex flex-col items-start gap-2">
          <Label htmlFor="general-default-model">Default Model</Label>
          <ModelSelector
            id="general-default-model"
            className="w-full max-w-80 min-w-0"
            value={userSettings.default_model_id ?? undefined}
            onValueChange={(v) => {
              updateSetting("default_model_id", v);
            }}
            availableModels={Object.values(userSettings.models ?? {})}
          />
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="general-prompt-coach"
            aria-describedby="general-prompt-coach-description"
            checked={user.settings.prompt_coach_enabled ?? false}
            disabled={isUpdatingUserSetting}
            onCheckedChange={(checked) => {
              updateSetting("prompt_coach_enabled", !!checked, false);
            }}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="general-prompt-coach">Prompt Coach</Label>
            <p
              id="general-prompt-coach-description"
              className="text-muted-foreground text-xs"
            >
              Adds a &ldquo;Review prompt&rdquo; button to the message box. It
              checks your draft for a clear goal, audience, context,
              constraints, output format and examples, and suggests edits you
              can apply. Reviews are not saved, and nothing is sent to the chat.
            </p>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Guided tour"
        description="A short walkthrough of the message box and the controls around it."
      >
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground text-xs">
            {user.settings.first_chat_tour === "completed"
              ? "You finished the tour."
              : user.settings.first_chat_tour === "dismissed"
                ? "You skipped the tour."
                : "You haven't taken the tour yet."}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={firstChatTourHref}>Restart the chat tour</Link>
          </Button>
        </div>
      </SettingsSection>
    </SettingsPane>
  );
};
