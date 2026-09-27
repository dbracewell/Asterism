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
  hidden?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export const Hint = ({
  asChild = true,
  children,
  hint,
  hintClassName,
  hidden = false,
  align = "center",
  side = "top",
}: HintProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
      <TooltipContent
        hideWhenDetached={true}
        className={hintClassName}
        hidden={hidden}
        align={align}
        side={side}
      >
        {hint}
      </TooltipContent>
    </Tooltip>
  );
};
