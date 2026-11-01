"use client";

import React, { createContext, useContext } from "react";

/**
 * Whether the viewer may see admin-only help (ADR-0032). Presentation only:
 * admin pages and APIs keep their own authorization. Defaults to non-admin.
 */
const HelpAudienceContext = createContext<{ isAdmin: boolean }>({
  isAdmin: false,
});

export function HelpAudienceProvider({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  return (
    <HelpAudienceContext.Provider value={{ isAdmin }}>
      {children}
    </HelpAudienceContext.Provider>
  );
}

export function useHelpAudience() {
  return useContext(HelpAudienceContext);
}
