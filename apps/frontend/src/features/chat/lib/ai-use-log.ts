import type { AiUseLog, LoggedReply, LoggedTurn } from "@/lib/client";

/** How the log states times; tests pass a fixed formatter. */
export type TimeFormatter = (ms: number) => string;

export const defaultTimeFormat: TimeFormatter = (ms) =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export const EXERCISE_NOTE =
  "Exercise: this answer contained one deliberate error (spot-the-error practice).";

export const LOG_DISCLAIMER =
  "This log documents how AI was used, from what Asterism recorded. It does not detect AI use, and it does not include the assistant's answers.";

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function unavailable(name: string, available: boolean) {
  return available ? name : `${name} (no longer available)`;
}

/** Each line of the prompt as a Markdown quote, so headings in it stay text. */
function quote(text: string) {
  return text.trim()
    ? text
        .trim()
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n")
    : "> (no text; files only)";
}

function replyLines(
  reply: LoggedReply | null | undefined,
  time: TimeFormatter,
) {
  if (!reply) return ["- Reply: none recorded"];
  const lines = [
    `- Reply: ${time(reply.at)}${reply.model ? ` by ${reply.model}` : ""}${reply.status === "completed" ? "" : ` (${reply.status})`}`,
  ];
  if (reply.exercise) lines.push(`- **${EXERCISE_NOTE}**`);
  if (reply.tools.length) lines.push(`- Tools used: ${reply.tools.join(", ")}`);
  if (reply.cited_files.length)
    lines.push(`- Files cited: ${reply.cited_files.join(", ")}`);
  const verification = reply.verification;
  if (verification) {
    const counts = (
      [
        ["supported", verification.supported],
        ["unsupported", verification.unsupported],
        ["contradicted", verification.contradicted],
        ["unchecked", verification.unchecked],
      ] as const
    )
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${count} ${label}`);
    lines.push(
      `- Verification by ${verification.model} (${time(verification.at)}): ${counts.length ? counts.join(", ") : "no claims found"}`,
    );
  }
  if (reply.draft_comments)
    lines.push(
      `- Draft comments: ${plural(reply.draft_comments.total, "comment")}, ${reply.draft_comments.resolved} resolved`,
    );
  return lines;
}

function turnSection(turn: LoggedTurn, index: number, time: TimeFormatter) {
  const mode = turn.learning_mode?.name ?? "Standard";
  const lines = [
    `### ${index}. ${time(turn.at)} · ${mode} mode`,
    "",
    "**Prompt:**",
    "",
    quote(turn.prompt),
    "",
  ];
  if (turn.persona) lines.push(`- Persona: ${turn.persona}`);
  if (turn.template)
    lines.push(
      `- Template: ${unavailable(turn.template.name, turn.template.available)}, ${turn.template.level} level`,
    );
  if (turn.rubric) lines.push(`- Rubric: ${turn.rubric}`);
  if (turn.skills.length) lines.push(`- Skills: ${turn.skills.join(", ")}`);
  if (turn.files.length)
    lines.push(
      `- Files attached: ${turn.files.map((file) => unavailable(file.name, file.available)).join(", ")}`,
    );
  if (turn.compared)
    lines.push(
      "- Sent to several models side by side; this is the column kept",
    );
  lines.push(...replyLines(turn.reply, time));
  return lines.join("\n");
}

/**
 * Renders the selected turns of an AI-use log as Markdown (US-57.4).
 * `included` holds the user-turn message IDs to keep; chats with no
 * included turns are left out.
 */
export function renderAiUseLog(
  log: AiUseLog,
  included: ReadonlySet<string>,
  time: TimeFormatter = defaultTimeFormat,
) {
  const sections = log.chats.flatMap((chat) => {
    const turns = chat.turns.filter((turn) => included.has(turn.message_id));
    if (!turns.length) return [];
    const title = chat.title?.trim() || "Untitled chat";
    return [
      [
        `## ${title}`,
        "",
        `${chat.project ? `Project: ${chat.project}. ` : ""}Started ${time(chat.created_at)}. ${plural(turns.length, "prompt")} included.`,
        "",
        turns
          .map((turn, index) => turnSection(turn, index + 1, time))
          .join("\n\n"),
      ].join("\n"),
    ];
  });
  return [
    "# AI-use log",
    "",
    `Generated ${time(log.generated_at)}. ${LOG_DISCLAIMER}`,
    "",
    sections.length ? sections.join("\n\n") : "No prompts were selected.",
    "",
  ].join("\n");
}
