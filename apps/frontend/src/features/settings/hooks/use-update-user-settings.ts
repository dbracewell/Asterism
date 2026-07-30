"use client";

import {
  userSettingsBulkUpdateMutation,
  userSettingUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { client } from "@/lib/client/client.gen";
import { prettyText } from "@/lib/formatters";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";

export function useUpdateUserSettings() {
  const router = useRouter();

  const updateSettingMutation = useMutation({
    ...userSettingUpdateMutation({
      client: client,
    }),
    onSuccess: () => {
      router.refresh();
    },
    onError: () => {
      toast.error("Failed to update setting. Please try again.");
    },
  });
  const updateSettingFn = updateSettingMutation.mutate;

  const updateSetting = useCallback(
    (key: string, value: unknown, notify: boolean = true): void => {
      updateSettingFn(
        {
          path: {
            key: key,
          },
          body: {
            value,
          },
        },
        {
          onSuccess(data) {
            if (notify) {
              toast.success(`Successfully updated ${prettyText(data.key)}`);
            }
          },
        },
      );
    },
    [updateSettingFn],
  );

  const updateAll = useMutation({
    ...userSettingsBulkUpdateMutation({
      client: client,
    }),
    onSuccess: () => {
      router.refresh();
    },
    onError: () => toast.error("Failed to update settings. Please try again."),
  });

  return {
    updateSetting,
    isUpdatingUserSetting: updateSettingMutation.isPending,
    updateAll: updateAll.mutate,
    isUpdatingAll: updateAll.isPending,
  };
}
