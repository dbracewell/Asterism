"use client";
import { client } from "@/client/client.gen";
import { User } from "better-auth";
import { createContext, useContext, useState } from "react";

export type AppContextValue = {
  jwtToken: string;
  user: User;
};

const AppContext = createContext<AppContextValue | null>(null);

type AppContextProviderProps = {
  jwtToken: string;
  user: User;
  children: React.ReactNode;
};

export const AppContextProvider = ({
  jwtToken,
  user,
  children,
}: AppContextProviderProps) => {
  const [jwtTokenState] = useState(jwtToken);
  const [userState] = useState(user);

  client.setConfig({
    auth: jwtToken,
    baseUrl: process.env.NEXT_PUBLIC_BACKEND_API_URL!,
  });

  return (
    <AppContext.Provider
      value={{
        jwtToken: jwtTokenState,
        user: userState,
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
