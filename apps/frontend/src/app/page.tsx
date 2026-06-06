import { AuthForm } from "@/components/auth-form";
import z from "zod";

const searchSchema = z.object({
  mode: z.enum(["login", "signup"]).optional().catch("login"),
  redirect: z.string().optional(),
});

export default async function Home(params: PageProps<"/">) {
  const searchParams = await params.searchParams;
  const formParams = searchSchema.parse(searchParams);
  return (
    <div className="flex-1 flex items-center justify-center">
      <AuthForm initialView={formParams.mode} referer={formParams.redirect} />
    </div>
  );
}
