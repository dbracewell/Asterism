"use client";

import { Switch } from "@/components/ui/switch";
import { errorDetail } from "@/features/classes/error-detail";
import { client } from "@/lib/api";
import type { JoinedClass } from "@/lib/client";
import { classInsightsConsentUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { useId } from "react";

/** A student's opt-in to class-wide totals (US-60.5). Off by default. */
export function InsightsConsent({ item }: { item: JoinedClass }) {
  const id = useId();
  const update = useMutation(classInsightsConsentUpdateMutation({ client }));
  const checked = update.isPending
    ? (update.variables?.body.consent ?? !!item.insights_consent)
    : !!item.insights_consent;
  return (
    <div className="grid gap-1 text-sm">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={checked}
          disabled={update.isPending}
          onCheckedChange={(consent) =>
            update.mutate({ path: { class_id: item.id }, body: { consent } })
          }
        />
        <label htmlFor={id}>Share my practice results in class totals</label>
      </div>
      <p className="text-muted-foreground">
        {item.educator_name} sees only totals by course file, and only when at
        least five students share. Never your chats, answers or own results. You
        can stop sharing at any time.
      </p>
      {update.error && (
        <p role="alert" className="text-destructive">
          {errorDetail(update.error, "Could not save your choice.")}
        </p>
      )}
    </div>
  );
}
