"use client";

import { Button } from "@/components/ui/button";
import { OctagonXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Error({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-4">
      <div className="bg-card border-destructive mx-auto flex w-full max-w-xl flex-col rounded-xl border-2 p-10 shadow">
        <h2 className="text-destructive flex items-center justify-center gap-3 text-xl font-bold">
          <OctagonXIcon /> Something went wrong
        </h2>
        <h3 className="text-center text-sm">{error.message}</h3>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button size="lg" variant="ghost" onClick={() => router.refresh()}>
            Try again
          </Button>
          <Button
            variant="destructive"
            size="lg"
            onClick={() => router.push("/")}
          >
            Go to App
          </Button>
        </div>
      </div>
    </div>
  );
}
