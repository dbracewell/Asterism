import { cn } from "@/lib/utils";
import React from "react";

export const Required = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <div className="flex items-center gap-1">
      {children}
      <span className={cn("text-destructive size-4", className)}>*</span>
    </div>
  );
};
