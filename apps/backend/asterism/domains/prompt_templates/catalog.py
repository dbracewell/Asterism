"""Bundled, read-only prompt frameworks shipped with the server.

Every entry is validated through the same parser as user templates at import
time, so a malformed bundled framework fails startup and tests. Bump an entry's
``revision`` whenever its document changes, and bump ``CATALOG_VERSION`` whenever
any entry is added, removed or revised.
"""

from dataclasses import dataclass
from types import MappingProxyType

from .documents import TemplateDocument, parse_document

CATALOG_VERSION = 1


@dataclass(frozen=True)
class BundledFramework:
    id: str
    revision: int
    document: TemplateDocument


_SOURCES: tuple[tuple[str, int, dict], ...] = (
    (
        "rtf",
        1,
        {
            "name": "RTF",
            "description": "Role, Task, Format: say who the assistant should be, what to do, and how to answer.",
            "fields": [
                {
                    "kind": "short_text",
                    "key": "role",
                    "label": "Role",
                    "help": "Who should the assistant act as? Pick someone with the right expertise.",
                    "required": True,
                    "default": "an experienced teacher",
                },
                {
                    "kind": "long_text",
                    "key": "task",
                    "label": "Task",
                    "help": "What do you want done? Use a clear action verb and include the key details.",
                    "required": True,
                },
                {
                    "kind": "short_text",
                    "key": "format",
                    "label": "Format",
                    "help": "What shape should the answer take: a list, a table, a short paragraph, code?",
                    "required": True,
                    "default": "a short bulleted list",
                },
            ],
            "body": "Act as {{role}}.\n\nTask: {{task}}\n\nRespond in this format: {{format}}.",
        },
    ),
    (
        "co-star",
        1,
        {
            "name": "CO-STAR",
            "description": "Context, Objective, Style, Tone, Audience, Response: a complete brief for the answer.",
            "fields": [
                {
                    "kind": "long_text",
                    "key": "context",
                    "label": "Context",
                    "help": "Background the assistant needs: the situation, what you have tried, and why it matters.",
                    "required": True,
                },
                {
                    "kind": "long_text",
                    "key": "objective",
                    "label": "Objective",
                    "help": "The specific outcome you want from this answer.",
                    "required": True,
                },
                {
                    "kind": "short_text",
                    "key": "style",
                    "label": "Style",
                    "help": "A writing style to follow, such as a textbook, a news article or a friendly email.",
                    "required": True,
                    "default": "clear and plain, like a good textbook",
                },
                {
                    "kind": "select",
                    "key": "tone",
                    "label": "Tone",
                    "help": "The attitude the answer should convey.",
                    "required": True,
                    "options": ["neutral", "friendly", "formal", "encouraging", "enthusiastic"],
                    "default": "neutral",
                },
                {
                    "kind": "short_text",
                    "key": "audience",
                    "label": "Audience",
                    "help": "Who will read the answer, and what do they already know?",
                    "required": True,
                },
                {
                    "kind": "short_text",
                    "key": "response",
                    "label": "Response format",
                    "help": "The exact shape of the answer, including length.",
                    "required": True,
                    "default": "three short paragraphs",
                },
            ],
            "body": (
                "# Context\n{{context}}\n\n"
                "# Objective\n{{objective}}\n\n"
                "# Style\nWrite in this style: {{style}}.\n\n"
                "# Tone\nUse a {{tone}} tone.\n\n"
                "# Audience\nThe audience is {{audience}}.\n\n"
                "# Response\nRespond as {{response}}."
            ),
        },
    ),
    (
        "craft",
        1,
        {
            "name": "CRAFT",
            "description": "Context, Role, Action, Format, Target audience: frame the problem before asking.",
            "fields": [
                {
                    "kind": "long_text",
                    "key": "context",
                    "label": "Context",
                    "help": "Describe the situation and any constraints.",
                    "required": True,
                },
                {
                    "kind": "short_text",
                    "key": "role",
                    "label": "Role",
                    "help": "The expertise the assistant should bring.",
                    "required": True,
                    "default": "a patient subject-matter expert",
                },
                {
                    "kind": "long_text",
                    "key": "action",
                    "label": "Action",
                    "help": "The steps or task to perform. Be specific about what done looks like.",
                    "required": True,
                },
                {
                    "kind": "short_text",
                    "key": "format",
                    "label": "Format",
                    "help": "How the result should be laid out.",
                    "required": True,
                    "default": "numbered steps",
                },
                {
                    "kind": "short_text",
                    "key": "audience",
                    "label": "Target audience",
                    "help": "Who the result is for, and their level of experience.",
                    "required": True,
                },
            ],
            "body": (
                "Context: {{context}}\n\n"
                "Role: You are {{role}}.\n\n"
                "Action: {{action}}\n\n"
                "Format: Present the result as {{format}}.\n\n"
                "Target audience: {{audience}}."
            ),
        },
    ),
    (
        "few-shot",
        1,
        {
            "name": "Few-shot",
            "description": "Show a few worked examples so the assistant can copy the pattern.",
            "fields": [
                {
                    "kind": "long_text",
                    "key": "instruction",
                    "label": "Instruction",
                    "help": "Describe the task the examples demonstrate.",
                    "required": True,
                },
                {
                    "kind": "examples",
                    "key": "examples",
                    "label": "Examples",
                    "help": "Two to five input and output pairs. Keep them consistent in format.",
                    "required": True,
                    "default": [
                        "Input: The meeting moved to Tuesday.\nOutput: Schedule change",
                        "Input: Lunch is on us today!\nOutput: Social",
                    ],
                },
                {
                    "kind": "long_text",
                    "key": "input",
                    "label": "Your input",
                    "help": "The new case you want handled the same way.",
                    "required": True,
                },
            ],
            "body": (
                "{{instruction}}\n\n"
                "Follow the pattern shown in these examples.\n\n"
                "{{examples}}\n\n"
                "Now apply the same pattern to this input:\n{{input}}"
            ),
        },
    ),
    (
        "step-by-step",
        1,
        {
            "name": "Step-by-step",
            "description": "Ask for the reasoning one step at a time before the final answer.",
            "fields": [
                {
                    "kind": "long_text",
                    "key": "problem",
                    "label": "Problem",
                    "help": "State the problem exactly, including any numbers or conditions.",
                    "required": True,
                },
                {
                    "kind": "long_text",
                    "key": "known",
                    "label": "What you already know",
                    "help": "Facts, formulas or attempts so far. This helps the assistant start at your level.",
                    "required": True,
                    "default": "Nothing yet.",
                },
                {
                    "kind": "select",
                    "key": "finish",
                    "label": "Finish with",
                    "help": "How the answer should end.",
                    "required": True,
                    "options": [
                        "a clearly labelled final answer",
                        "a check that the answer is correct",
                        "a one-paragraph summary of the method",
                    ],
                    "default": "a clearly labelled final answer",
                },
            ],
            "body": (
                "Solve the following problem step by step.\n\n"
                "Problem:\n{{problem}}\n\n"
                "What I already know:\n{{known}}\n\n"
                "Work through it one step at a time and explain the reasoning for each step. "
                "Finish with {{finish}}."
            ),
        },
    ),
)

FRAMEWORKS: MappingProxyType[str, BundledFramework] = MappingProxyType(
    {
        framework_id: BundledFramework(id=framework_id, revision=revision, document=parse_document(source))
        for framework_id, revision, source in _SOURCES
    }
)
