"use client";

import { Button } from "@/components/ui/button";
import { ImportSettings } from "@/features/settings/ui/admin-settings/import-settings";
import { actionClassName } from "./provider-setup-shared";

/** Replaces provider setup with a file from Admin settings → Export (US-63.3). */
export function ImportStep({
  onBack,
  onImported,
}: {
  onBack: () => void;
  onImported: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm">
        Use a settings file exported from Admin settings to bring in your
        providers, models and policies.
      </p>
      <ImportSettings onImported={onImported} />
      <Button
        type="button"
        variant="ghost"
        className={actionClassName}
        onClick={onBack}
      >
        Set up a provider instead
      </Button>
    </div>
  );
}
