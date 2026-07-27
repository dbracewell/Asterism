"use client";
import { useUser } from "@/features/auth/components/user-context";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";

export const UpdateTimeZone = () => {
  const user = useUser();
  useEffect(() => {
    const updateTimezone = async () => {
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (user.timezone !== userTimezone) {
        await authClient.updateUser({
          timezone: userTimezone,
        });
      }
    };
    updateTimezone();
  }, [user]);
  return <></>;
};
