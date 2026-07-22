"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { userSettingsBulkUpdateMutation, userSettingUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { client } from "@/lib/client/client.gen";
import { toast } from "sonner";
import { useCallback } from "react";

export function useUpdateUserSettings() {
  const router = useRouter();

  const updateSettingMutation = useMutation({
    ...userSettingUpdateMutation({
      client: client,
    }),
    onSuccess: () => {},
    onError: () => {
      toast.error("Failed to update setting. Please try again.");
    },
  });
  const updateSettingFn = updateSettingMutation.mutate;

  const updateSetting = useCallback(
    (key: string, value: unknown): void => {
      updateSettingFn({
        path: {
          key: key,
        },
        body: {
          value,
        },
      });
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
