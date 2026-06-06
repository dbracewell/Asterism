import { AuthForm } from "@/components/auth-form";
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
  const formParams = searchSchema.parse(await searchParams);
  return (
    <div className="flex-1 flex items-center justify-center">
      <AuthForm initialView={formParams.mode} referer={formParams.redirect} />
    </div>
  );
}
