import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/features/auth/server/actions";
import SessionPage from "@/features/chat/components/session-page";
import { auth } from "@/lib/auth";
import { OctagonAlertIcon } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import z from "zod";

type ChatSessionPageProps = {
  params: Promise<{ chatId: string }>;
};

export default async function ChatSessionPage(props: ChatSessionPageProps) {
  const params = await props.params;
  const { data: chatId, success } = z.uuidv4().safeParse(params.chatId);

  if (!success) {
    redirect("/");
  }

  const jwtToken = await auth.api.getToken({
    headers: await headers(),
  });

  if (jwtToken == null) {
    redirect("/");
  }

  const user = await getCurrentUser();

  if (user.settings.default_agent_id == null) {
    return (
      <div className="flex flex-1 items-center justify-center pt-16">
        <div className="bg-destructive border-destructive flex flex-col items-center gap-6 rounded-xl border-2 p-20 text-center text-white/80 shadow-lg">
          <h2 className="flex items-center gap-3 text-xl font-bold">
            <OctagonAlertIcon className="size-20" /> You do not have a default
            agent set up.
          </h2>
          <Link
            href="/settings"
            className={buttonVariants({
              variant: "outline",
              size: "lg",
              className: "w-fit!",
            })}
          >
            Go to Settings →
          </Link>
        </div>
      </div>
    );
  }

  return <SessionPage chatId={chatId} jwtToken={jwtToken!.token} />;
}
