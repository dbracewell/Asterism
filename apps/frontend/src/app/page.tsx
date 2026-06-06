import { AuthForm } from "@/components/auth-form";
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
    redirect("/app");
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <AuthForm initialView={formParams.mode} referer={formParams.redirect} />
    </div>
  );
}
