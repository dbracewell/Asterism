import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";
import React from "react";

type LoadingButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    isLoading: boolean;
  };

export const LoadingButton = ({
  className,
  variant,
  size,
  asChild = false,
  isLoading,
  ...props
}: LoadingButtonProps) => {
  const { children, ...rest } = props;
  return (
    <Button
      variant={variant}
      size={size}
      asChild={asChild}
      className={className}
      {...rest}
    >
      <div className="grid w-full grid-cols-1 items-center justify-items-center">
        <div
          className={cn(
            "col-start-1 col-end-1 row-start-1 row-end-1",
            isLoading ? "invisible" : "visible",
          )}
        >
          {children}
        </div>
        <div
          className={cn(
            "col-start-1 col-end-1 row-start-1 row-end-1",
            isLoading ? "visible" : "invisible",
          )}
        >
          <Loader2Icon className="animate-spin" />
        </div>
      </div>
    </Button>
  );
};
