"use client";
import { User } from "@/features/auth/types";
import React, { createContext } from "react";

export const UserContext = createContext<{
  user: User | null;
}>({
  user: null,
});

export const useUser = (): User => {
  const user = React.useContext(UserContext);
  if (user.user == null) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return user.user;
};

export const UserProvider = ({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) => {
  return (
    <UserContext.Provider value={{ user }}>{children}</UserContext.Provider>
  );
};

export default UserProvider;
