import type { AiUseLog } from "@/lib/client";
import { expect, it } from "vitest";
import { EXERCISE_NOTE, LOG_DISCLAIMER, renderAiUseLog } from "./ai-use-log";

const time = (ms: number) => `T${ms}`;

const log: AiUseLog = {
  generated_at: 99,
  chats: [
    {
      chat_id: "c1",
      title: "Essay help",
      project: "History",
      created_at: 1,
      turns: [
        {
          message_id: "u1",
          at: 2,
          prompt: "# My draft\nUniforms should be required.",
          learning_mode: {
            id: "draft_feedback",
            name: "Draft feedback",
            version: 2,
          },
          persona: "Student",
          template: { name: "RTF", level: "standard", available: false },
          rubric: "Argumentative essay",
          goal: "Publish a reef survey",
          skills: ["citations"],
          files: [
            { name: "essay.txt", available: true },
            { name: "old.pdf", available: false },
          ],
          compared: true,
          reply: {
            message_id: "a1",
            at: 3,
            status: "completed",
            model: "Alpha",
            tools: ["search_knowledge"],
            cited_files: ["notes.md"],
            exercise: false,
            verification: {
              model: "Checker",
              at: 4,
              supported: 2,
              unsupported: 0,
              contradicted: 1,
              unchecked: 0,
            },
            draft_comments: { total: 5, resolved: 1 },
          },
        },
        {
          message_id: "u2",
          at: 5,
          prompt: "Quiz me",
          learning_mode: null,
          persona: null,
          template: null,
          rubric: null,
          skills: [],
          files: [],
          compared: false,
          reply: {
            message_id: "a2",
            at: 6,
            status: "completed",
            model: "Alpha",
            tools: [],
            cited_files: [],
            exercise: true,
            verification: null,
            draft_comments: null,
          },
        },
      ],
    },
    {
      chat_id: "c2",
      title: null,
      project: null,
      created_at: 7,
      turns: [
        {
          message_id: "u3",
          at: 8,
          prompt: "",
          learning_mode: null,
          persona: null,
          template: null,
          rubric: null,
          skills: [],
          files: [{ name: "photo.png", available: true }],
          compared: false,
          reply: null,
        },
      ],
    },
  ],
};

it("lists every recorded detail of the included turns", () => {
  const markdown = renderAiUseLog(log, new Set(["u1", "u2", "u3"]), time);
  expect(markdown).toContain(`Generated T99. ${LOG_DISCLAIMER}`);
  expect(markdown).toContain(
    "## Essay help\n\nProject: History. Started T1. 2 prompts included.",
  );
  expect(markdown).toContain("### 1. T2 · Draft feedback mode");
  // The prompt is quoted so its own Markdown stays text.
  expect(markdown).toContain("> # My draft\n> Uniforms should be required.");
  for (const line of [
    "- Persona: Student",
    "- Template: RTF (no longer available), standard level",
    "- Rubric: Argumentative essay",
    "- Learning goal included: Publish a reef survey",
    "- Skills: citations",
    "- Files attached: essay.txt, old.pdf (no longer available)",
    "- Sent to several models side by side; this is the column kept",
    "- Reply: T3 by Alpha",
    "- Tools used: search_knowledge",
    "- Files cited: notes.md",
    "- Verification by Checker (T4): 2 supported, 1 contradicted",
    "- Draft comments: 5 comments, 1 resolved",
  ])
    expect(markdown).toContain(line);
  expect(markdown).toContain("### 2. T5 · Standard mode");
  expect(markdown).toContain(`- **${EXERCISE_NOTE}**`);
  expect(markdown).toContain("## Untitled chat");
  expect(markdown).toContain("> (no text; files only)");
  expect(markdown).toContain("- Reply: none recorded");
});

it("leaves out unselected turns and chats", () => {
  const markdown = renderAiUseLog(log, new Set(["u2"]), time);
  expect(markdown).not.toContain("Uniforms should be required");
  expect(markdown).toContain("1 prompt included.");
  expect(markdown).toContain("### 1. T5 · Standard mode");
  expect(markdown).not.toContain("Untitled chat");
  expect(renderAiUseLog(log, new Set(), time)).toContain(
    "No prompts were selected.",
  );
});
