import { cn } from "@/lib/utils";

export const AnimatedBorder = ({
  children,
  borderComponent,
  className,
  childContainerClassName,
}: {
  children: React.ReactNode;
  borderComponent?: React.ReactNode;
  childContainerClassName?: string;
  className?: string;
}) => {
  {
    /*from-pink-500 via-purple-500 to-cyan-500 */
  }
  return (
    <div
      className={cn(
        "from-primary/80 via-primary/50 to-primary/80 text-primary-foreground relative w-full animate-[gradient-move_3s_linear_infinite] overflow-clip rounded-[inherit] bg-linear-to-r bg-size-[200%_auto] p-1 shadow-2xl transition-shadow focus-within:shadow-[0_0_15px_rgba(122,0,255,0.5)]",
        className,
      )}
    >
      {borderComponent}
      <div
        className={cn(
          "bg-background rounded-[inherit]",
          childContainerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
};
