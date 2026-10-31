"""Bundled, read-only prompt frameworks shipped with the server.

Every entry is validated through the same parser as user templates at import
time, so a malformed bundled framework fails startup and tests. Bump an entry's
``revision`` whenever its document changes, and bump ``CATALOG_VERSION`` whenever
any entry is added, removed or revised.
"""

from dataclasses import dataclass
from types import MappingProxyType

from .documents import TemplateDocument, parse_document

CATALOG_VERSION = 2


@dataclass(frozen=True)
class BundledFramework:
    id: str
    revision: int
    document: TemplateDocument


_SOURCES: tuple[tuple[str, int, dict], ...] = (
    (
        "rtf",
        2,
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
                    "example": "a senior data analyst who explains things simply",
                },
                {
                    "kind": "long_text",
                    "key": "task",
                    "label": "Task",
                    "help": "What do you want done? Use a clear action verb and include the key details.",
                    "required": True,
                    "example": "Explain how compound interest works, using a savings account as the example.",
                },
                {
                    "kind": "short_text",
                    "key": "format",
                    "label": "Format",
                    "help": "What shape should the answer take: a list, a table, a short paragraph, code?",
                    "required": True,
                    "default": "a short bulleted list",
                    "example": "a table with one row per year",
                },
                {
                    "kind": "long_text",
                    "key": "constraints",
                    "label": "Constraints",
                    "help": "Anything to include or avoid, such as length, sources or jargon.",
                    "example": "Keep it under 150 words and avoid formulas.",
                },
            ],
            "body": (
                "Act as {{role}}.\n\nTask: {{task}}\n\nRespond in this format: {{format}}."
                "{{#constraints}}\n\nConstraints: {{constraints}}{{/constraints}}"
            ),
            "checklist": [
                "Say who the assistant should act as.",
                "State the task with a clear action verb and the key details.",
                "Describe the shape of the answer you want.",
                "Mention limits such as length, or what to avoid.",
            ],
        },
    ),
    (
        "co-star",
        2,
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
                    "example": "I run a small bakery and want to start a weekly email newsletter.",
                },
                {
                    "kind": "long_text",
                    "key": "objective",
                    "label": "Objective",
                    "help": "The specific outcome you want from this answer.",
                    "required": True,
                    "example": "Write the first newsletter, announcing our new sourdough class.",
                },
                {
                    "kind": "short_text",
                    "key": "style",
                    "label": "Style",
                    "help": "A writing style to follow, such as a textbook, a news article or a friendly email.",
                    "default": "clear and plain, like a good textbook",
                    "example": "a friendly email from a local shop owner",
                },
                {
                    "kind": "select",
                    "key": "tone",
                    "label": "Tone",
                    "help": "The attitude the answer should convey.",
                    "options": ["neutral", "friendly", "formal", "encouraging", "enthusiastic"],
                    "default": "neutral",
                },
                {
                    "kind": "short_text",
                    "key": "audience",
                    "label": "Audience",
                    "help": "Who will read the answer, and what do they already know?",
                    "required": True,
                    "example": "regular customers who have never baked bread",
                },
                {
                    "kind": "short_text",
                    "key": "response",
                    "label": "Response format",
                    "help": "The exact shape of the answer, including length.",
                    "required": True,
                    "default": "three short paragraphs",
                    "example": "a subject line and a body of about 200 words",
                },
            ],
            "body": (
                "# Context\n{{context}}\n\n"
                "# Objective\n{{objective}}\n\n"
                "{{#style}}# Style\nWrite in this style: {{style}}.\n\n{{/style}}"
                "{{#tone}}# Tone\nUse a {{tone}} tone.\n\n{{/tone}}"
                "# Audience\nThe audience is {{audience}}.\n\n"
                "# Response\nRespond as {{response}}."
            ),
            "checklist": [
                "Give the background: the situation and why it matters.",
                "State the specific outcome you want.",
                "Name a style and tone, if they matter.",
                "Say who the audience is and what they already know.",
                "Describe the shape and length of the response.",
            ],
        },
    ),
    (
        "craft",
        2,
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
                    "example": "Our team is moving from spreadsheets to a shared project tracker next month.",
                },
                {
                    "kind": "short_text",
                    "key": "role",
                    "label": "Role",
                    "help": "The expertise the assistant should bring.",
                    "default": "a patient subject-matter expert",
                    "example": "an operations manager who has led tool migrations",
                },
                {
                    "kind": "long_text",
                    "key": "action",
                    "label": "Action",
                    "help": "The steps or task to perform. Be specific about what done looks like.",
                    "required": True,
                    "example": "Draft a two-week rollout plan, including training and a fallback.",
                },
                {
                    "kind": "short_text",
                    "key": "format",
                    "label": "Format",
                    "help": "How the result should be laid out.",
                    "default": "numbered steps",
                    "example": "a checklist grouped by week",
                },
                {
                    "kind": "short_text",
                    "key": "audience",
                    "label": "Target audience",
                    "help": "Who the result is for, and their level of experience.",
                    "required": True,
                    "example": "team leads who are comfortable with spreadsheets",
                },
            ],
            "body": (
                "Context: {{context}}\n\n"
                "{{#role}}Role: You are {{role}}.\n\n{{/role}}"
                "Action: {{action}}\n\n"
                "{{#format}}Format: Present the result as {{format}}.\n\n{{/format}}"
                "Target audience: {{audience}}."
            ),
            "checklist": [
                "Describe the situation and its constraints.",
                "Say what expertise the assistant should bring.",
                "Spell out the action and what done looks like.",
                "Describe how the result should be laid out.",
                "Name the target audience and their experience.",
            ],
        },
    ),
    (
        "few-shot",
        2,
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
                    "example": "Classify each message into one category.",
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
                    "example": "The office will be closed on Friday.",
                },
            ],
            "body": (
                "{{instruction}}\n\n"
                "Follow the pattern shown in these examples.\n\n"
                "{{examples}}\n\n"
                "Now apply the same pattern to this input:\n{{input}}"
            ),
            "checklist": [
                "Describe the task the examples demonstrate.",
                "Include two to five examples in the same format.",
                "Make the examples cover different cases.",
                "Give the new input to handle the same way.",
            ],
        },
    ),
    (
        "step-by-step",
        2,
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
                    "example": "A train leaves at 9:40 and travels 210 km at 84 km/h. When does it arrive?",
                },
                {
                    "kind": "long_text",
                    "key": "known",
                    "label": "What you already know",
                    "help": "Facts, formulas or attempts so far. This helps the assistant start at your level.",
                    "example": "I know time = distance / speed but I get confused with the minutes.",
                },
                {
                    "kind": "select",
                    "key": "finish",
                    "label": "Finish with",
                    "help": "How the answer should end.",
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
                "{{#known}}What I already know:\n{{known}}\n\n{{/known}}"
                "Work through it one step at a time and explain the reasoning for each step."
                "{{#finish}} Finish with {{finish}}.{{/finish}}"
            ),
            "checklist": [
                "State the problem exactly, with every number and condition.",
                "Say what you already know or have tried.",
                "Ask for the reasoning one step at a time.",
                "Say how the answer should end.",
            ],
        },
    ),
)

FRAMEWORKS: MappingProxyType[str, BundledFramework] = MappingProxyType(
    {
        framework_id: BundledFramework(id=framework_id, revision=revision, document=parse_document(source))
        for framework_id, revision, source in _SOURCES
    }
)
