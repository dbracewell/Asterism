import Constellation from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * Small constellation that marks where an assistant turn begins. Decorative:
 * the enclosing article carries the speaker label.
 */
export const MessageMarker = ({ visible }: { visible: boolean }) => (
  <span
    aria-hidden="true"
    data-slot="message-marker"
    className={cn(
      "bg-primary/10 text-primary rounded-dot mt-0.5 flex size-7 shrink-0 items-center justify-center",
      !visible && "invisible",
    )}
  >
    <Constellation size={18} fill="currentColor" strokeWidth={14} />
  </span>
);
