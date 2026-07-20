"use client"; // Error boundaries must be Client Components

import { Button, buttonVariants } from "@/components/ui/button";
import { OctagonXIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Folder loading error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-4">
      <div className="bg-card border-destructive mx-auto flex w-full max-w-xl flex-col rounded-xl border-2 p-10 shadow">
        <h2 className="text-destructive flex items-center justify-center gap-3 text-xl font-bold">
          <OctagonXIcon /> Something went wrong
        </h2>
        <h3 className="text-center text-sm">{error.message}</h3>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button size="lg" variant="ghost" onClick={() => reset()}>
            Try again
          </Button>
          <Link
            className={buttonVariants({ variant: "destructive", size: "lg" })}
            href="/"
          >
            Go to App
          </Link>
        </div>
      </div>
    </div>
  );
}
