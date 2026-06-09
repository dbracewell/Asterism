"use client";
import { User } from "better-auth";
import { createContext, useContext } from "react";

export type AppContextValue = {
  user: User;
};

const AppContext = createContext<AppContextValue | null>(null);

type AppContextProviderProps = {
  user: User;
  children: React.ReactNode;
};

export const AppContextProvider = ({
  user,
  children,
}: AppContextProviderProps) => {
  return (
    <AppContext.Provider
      value={{
        user,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const ctxt = useContext(AppContext);
  if (!ctxt) {
    throw Error("useAppContext must be used inside a AppContextProvider");
  }
  return ctxt;
};
