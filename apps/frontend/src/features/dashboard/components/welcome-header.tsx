"use client";

import { useAppContext } from "@/features/dashboard/components/app-provider";
import Constellation from "@/components/logo";

export const WelcomeHeader = () => {
  const { user } = useAppContext();
  return (
    <div className="relative mx-auto flex min-h-56 w-full max-w-lg flex-col items-center justify-center overflow-clip text-center">
      <Constellation
        className="absolute -z-10 opacity-10"
        fill="var(--color-muted-foreground)"
        size={200}
      />
      <h1 className="z-1 text-4xl font-bold">
        Welcome <span className="text-primary">{user.name}</span>,
      </h1>
      <h2 className="text-foreground/80 z-1 max-w-sm text-xl font-semibold text-balance">
        Where will your curiousity lead you today?
      </h2>
    </div>
  );
};
