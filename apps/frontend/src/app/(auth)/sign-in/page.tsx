import { AuthForm } from "@/features/auth/components/auth-form";
import { getUserCount } from "@/features/auth/server/actions";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import z from "zod";

const searchSchema = z.object({
  mode: z.enum(["login", "signup"]).optional().catch("login"),
  redirect: z.string().optional(),
});

type HomePageProps = {
  searchParams: Promise<{
    mode?: string;
    redirect?: string;
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const headersList = await headers();
  const [resolvedSearchParams, sessionData] = await Promise.all([
    searchParams,
    auth.api.getSession({ headers: headersList }),
  ]);
  const formParams = searchSchema.parse(resolvedSearchParams);

  if (sessionData) {
    redirect("/");
  }

  const userCount = await getUserCount();
  const view = "install"; //userCount > 0 ? "login" : "install";

  return (
    <div className="flex flex-1 items-center justify-center">
      <AuthForm view={view} referer={formParams.redirect} />
    </div>
  );
}
