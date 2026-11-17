import { Button } from "@/components/ui/button";
import type { AppliedTemplate } from "@/features/templates/components/template-picker-dialog";
import { levelLabel } from "@/features/templates/lib/levels";
import { cn } from "@/lib/utils";
import { ImagePlusIcon, LayoutTemplateIcon, XIcon } from "lucide-react";
import { COMPOSER_CHIP } from "../lib/composer-chip";

const LABEL_CHIP = cn(
  COMPOSER_CHIP,
  "bg-secondary text-secondary-foreground inline-flex items-center pr-0.5",
);

/** The next message is an image request; removable. */
export function ImageRequestChip({
  disabled,
  onRemove,
}: {
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      className={LABEL_CHIP}
      title="Your next message describes an image to create."
    >
      <ImagePlusIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">Image</span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="rounded-chip"
        disabled={disabled}
        aria-label="Don't create an image"
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </span>
  );
}

/** The template the draft was built with, recorded on the message; removable. */
export function TemplateLabelChip({
  template,
  disabled,
  onRemove,
}: {
  template: AppliedTemplate;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      className={LABEL_CHIP}
      title={`This message records that it was built with ${template.name} at the ${template.use.level} level.`}
    >
      <LayoutTemplateIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">Built with {template.name}</span>
      <span className="text-muted-foreground shrink-0">
        · {levelLabel(template.use.level)}
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="rounded-chip"
        disabled={disabled}
        aria-label={`Remove ${template.name} template label`}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </span>
  );
}
