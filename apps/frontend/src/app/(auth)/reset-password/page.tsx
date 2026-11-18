import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import {
  AuthHeading,
  authCardClassName,
} from "@/features/auth/components/setup-steps";
import { cn } from "@/lib/utils";

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

/** Where an administrator's one-time reset link lands (US-86.2). */
export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const { token } = await searchParams;
  if (typeof token !== "string" || !token) {
    return (
      <div className={cn(authCardClassName, "my-auto max-w-md shrink-0")}>
        <AuthHeading description="This reset link is incomplete." />
        <FieldDescription className="text-center text-balance">
          Copy the whole link your administrator sent, or ask them for a new
          one.
        </FieldDescription>
        <Button asChild className="w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  }
  return <ResetPasswordForm token={token} />;
}
