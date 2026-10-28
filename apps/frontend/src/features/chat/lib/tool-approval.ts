export type ToolRiskLevel = "changes" | "reads" | "unknown";

export type ToolRiskHint = {
  level: ToolRiskLevel;
  label: string;
  text: string;
};

// Name-based hints only: the approval protocol carries no tool risk metadata.
const CHANGES =
  /(^|[_.-])(write|delete|remove|create|update|edit|modify|send|post|put|patch|exec|execute|run|shell|command|move|rename|upload|install|deploy|save)([_.-]|$)/i;
const READS =
  /(^|[_.-])(read|get|list|search|fetch|find|query|lookup|view|browse)([_.-]|$)/i;

/**
 * A plain-language hint about what approving a tool may do, guessed from its
 * name. It is advisory: the arguments are what the user is actually approving.
 */
export function toolRiskHint(name: string): ToolRiskHint {
  if (CHANGES.test(name)) {
    return {
      level: "changes",
      label: "May make changes",
      text: "This tool may change data or act outside this chat.",
    };
  }
  if (READS.test(name)) {
    return {
      level: "reads",
      label: "Looks read-only",
      text: "This tool appears to read information, but its arguments may be sent to an outside service.",
    };
  }
  return {
    level: "unknown",
    label: "Unknown effect",
    text: "Check the arguments to see what this tool will do.",
  };
}
