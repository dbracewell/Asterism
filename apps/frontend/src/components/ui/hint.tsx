import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import React from "react";

interface HintProps {
  children: React.ReactNode;
  asChild?: boolean;
  hint: string;
  hintClassName?: string;
}

export const Hint = ({
  asChild = true,
  children,
  hint,
  hintClassName,
}: HintProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
      <TooltipContent hideWhenDetached={true} className={hintClassName}>
        {hint}
      </TooltipContent>
    </Tooltip>
  );
};
