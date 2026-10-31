import type { PromptFramework, PromptTemplateSummary } from "@/lib/client";
import type { TemplateSelection } from "../components/template-picker-dialog";

export type TemplateSlashOption = {
  key: string;
  label: string;
  description: string;
  /** `null` opens the template list. */
  selection: TemplateSelection | null;
};

/** Slash-friendly form of a display name: "My brief" → "my-brief". */
export function slashName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * `/template` opens the list; framework IDs and template names open their
 * builder directly. Matching is a prefix of the command or of any name word.
 */
export function templateSlashOptions(
  search: string,
  {
    frameworks,
    templates,
  }: { frameworks: PromptFramework[]; templates: PromptTemplateSummary[] },
): TemplateSlashOption[] {
  const matches = (command: string) =>
    !search ||
    command.startsWith(search) ||
    command.split("-").some((word) => word.startsWith(search));
  const options: TemplateSlashOption[] = [];
  if (matches("template"))
    options.push({
      key: "template",
      label: "/template",
      description: "Build a prompt from a framework or your templates.",
      selection: null,
    });
  for (const framework of frameworks)
    if (matches(framework.id))
      options.push({
        key: `framework:${framework.id}`,
        label: `/${framework.id}`,
        description: `Template · ${framework.name}`,
        selection: { source: "framework", id: framework.id },
      });
  for (const template of templates) {
    const command = slashName(template.name);
    if (command && matches(command))
      options.push({
        key: `template:${template.id}`,
        label: `/${command}`,
        description: `Your template · ${template.name}`,
        selection: { source: "template", id: template.id },
      });
  }
  return options;
}
