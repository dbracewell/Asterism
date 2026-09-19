import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { CircleQuestionMarkIcon } from "lucide-react";

export const HelpIcon = ({
  text,
  className,
}: {
  text: string;
  className?: string;
}) => {
  return (
    <Hint hint={text}>
      <CircleQuestionMarkIcon className={cn("z-0 size-3", className)} />
    </Hint>
  );
};
