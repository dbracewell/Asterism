import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { InviteSignupForm } from "@/features/auth/components/invite-signup-form";
import {
  AuthHeading,
  authCardClassName,
} from "@/features/auth/components/setup-steps";
import { checkInvite, INVALID_INVITE } from "@/features/auth/server/invites";
import { countAdmins } from "@/features/auth/server/session";
import { getAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type InvitePageProps = { params: Promise<{ token: string }> };

function InviteNotice({
  description,
  detail,
  action,
}: {
  description: string;
  detail: string;
  action: { href: string; label: string };
}) {
  return (
    <div className={cn(authCardClassName, "my-auto max-w-md shrink-0")}>
      <AuthHeading description={description} />
      <FieldDescription className="text-center text-balance">
        {detail}
      </FieldDescription>
      <Button asChild className="w-full">
        <Link href={action.href}>{action.label}</Link>
      </Button>
    </div>
  );
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  // Before setup the only way in is the administrator's own signup.
  if ((await countAdmins()) === 0) {
    redirect("/sign-in");
  }
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) {
    return (
      <InviteNotice
        description="You're already signed in."
        detail="This invite creates a new account. To join a class with your current account, ask your educator for the class code."
        action={{ href: "/classes", label: "Go to Classes" }}
      />
    );
  }
  const invite = await checkInvite(token);
  if (!invite.ok) {
    return (
      <InviteNotice
        description="This invite can't be used."
        detail={
          invite.error === INVALID_INVITE
            ? "It may have been used already, expired or been withdrawn. Ask your educator for a new one."
            : invite.error
        }
        action={{ href: "/sign-in", label: "Sign in instead" }}
      />
    );
  }
  return (
    <InviteSignupForm
      token={token}
      courseName={invite.preview.class_name}
      educatorName={invite.preview.educator_name}
    />
  );
}
