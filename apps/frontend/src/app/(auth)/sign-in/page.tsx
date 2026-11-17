import { AuthForm } from "@/features/auth/components/auth-form";
import { signInRedirectPath } from "@/features/auth/redirect";
import { getUserCount } from "@/features/auth/server/session";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const headersList = await headers();
  const [resolvedSearchParams, sessionData] = await Promise.all([
    searchParams,
    getAuth().api.getSession({ headers: headersList }),
  ]);
  const referer = signInRedirectPath(resolvedSearchParams);

  if (sessionData) {
    redirect(referer);
  }

  const userCount = await getUserCount();
  const view = userCount > 0 ? "login" : "install";

  return (
    <AuthForm className="my-auto shrink-0" view={view} referer={referer} />
  );
}
