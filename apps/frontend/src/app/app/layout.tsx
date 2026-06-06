import { AppContextProvider } from "@/app/app/app-provider";
import { Header } from "@/components/layout/header";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const jwtToken = await auth.api.getToken({ headers: headersList });
  const sessionData = await auth.api.getSession({ headers: headersList });
  if (!jwtToken || !sessionData) {
    throw redirect("/");
  }
  return (
    <AppContextProvider jwtToken={jwtToken.token} user={sessionData.user}>
      <Header />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </AppContextProvider>
  );
}
