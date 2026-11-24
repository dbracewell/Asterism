"use client";

import { useQuery } from "@tanstack/react-query";
import React, { createContext, useContext, useMemo } from "react";
import {
  availabilityOptions,
  type Feature,
} from "@/features/availability/queries";
import type { HelpViewer } from "../registry";

/**
 * Who is reading help (ADR-0032): whether they may see admin-only help, and
 * which features the admin lets them use (EPIC-97), so help about a feature
 * that is off for them is left out. Presentation only: admin pages and APIs
 * keep their own authorization. Without a provider, the viewer is a non-admin
 * with every feature on.
 */
const HelpAudienceContext = createContext<HelpViewer>({
  isAdmin: false,
  has: () => true,
});

export function HelpAudienceProvider({
  isAdmin,
  owner,
  children,
}: {
  isAdmin: boolean;
  /** The signed-in person, whose availability decides feature help. */
  owner?: string;
  children: React.ReactNode;
}) {
  if (owner)
    return (
      <OwnedHelpAudience isAdmin={isAdmin} owner={owner}>
        {children}
      </OwnedHelpAudience>
    );
  return (
    <HelpAudienceContext.Provider value={{ isAdmin, has: () => true }}>
      {children}
    </HelpAudienceContext.Provider>
  );
}

function OwnedHelpAudience({
  isAdmin,
  owner,
  children,
}: {
  isAdmin: boolean;
  owner: string;
  children: React.ReactNode;
}) {
  const { data } = useQuery(availabilityOptions(owner));
  const value = useMemo<HelpViewer>(
    () => ({
      isAdmin,
      has: (feature: Feature) => !!data?.[feature]?.available,
    }),
    [isAdmin, data],
  );
  return (
    <HelpAudienceContext.Provider value={value}>
      {children}
    </HelpAudienceContext.Provider>
  );
}

export function useHelpAudience() {
  return useContext(HelpAudienceContext);
}
