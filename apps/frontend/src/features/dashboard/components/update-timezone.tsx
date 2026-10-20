"use client";
import { useUser } from "@/features/auth/components/user-context";
import { authClient } from "@/lib/auth-client";
import { useEffect, useRef } from "react";

export const UpdateTimeZone = () => {
  const user = useUser();
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (
      user.timezone !== userTimezone &&
      attemptedRef.current !== userTimezone
    ) {
      attemptedRef.current = userTimezone;
      void authClient.updateUser({
        timezone: userTimezone,
      });
    }
  }, [user.timezone]);

  return null;
};
