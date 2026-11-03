"""Bundled, read-only rubrics shipped with the server (US-57.1).

Every entry is validated through the same parser as owned rubrics at import
time, so a malformed bundled rubric fails startup and tests. Bump an entry's
``revision`` whenever its document changes, and bump ``RUBRIC_CATALOG_VERSION``
whenever any entry is added, removed or revised.
"""

from dataclasses import dataclass
from types import MappingProxyType

from .rubrics import RubricDocument, parse_rubric

RUBRIC_CATALOG_VERSION = 1

_LEVELS = ["Exemplary", "Proficient", "Developing", "Beginning"]


@dataclass(frozen=True)
class BundledRubric:
    id: str
    revision: int
    document: RubricDocument


_SOURCES: tuple[tuple[str, int, dict], ...] = (
    (
        "argumentative-essay",
        1,
        {
            "name": "Argumentative essay",
            "description": "A general rubric for essays that take a position and defend it with evidence.",
            "levels": _LEVELS,
            "criteria": [
                {
                    "label": "Thesis",
                    "description": "A clear, arguable claim that the whole essay supports.",
                    "descriptors": [
                        "The thesis is specific, arguable and insightful, and it frames the whole essay.",
                        "The thesis is clear and arguable and the essay mostly supports it.",
                        "The thesis is present but vague, too broad, or only partly arguable.",
                        "There is no identifiable thesis, or it states a fact rather than a claim.",
                    ],
                },
                {
                    "label": "Evidence",
                    "description": "Relevant, credible support for each point, with sources acknowledged.",
                    "descriptors": [
                        "Every point is backed by well-chosen, credible evidence that is cited correctly.",
                        "Most points are supported by relevant evidence; citations are mostly correct.",
                        "Evidence is thin, loosely related, or not clearly attributed.",
                        "Claims are mostly unsupported or rely on opinion alone.",
                    ],
                },
                {
                    "label": "Analysis",
                    "description": "Explaining how the evidence supports the claim, and engaging with other views.",
                    "descriptors": [
                        "Analysis explains clearly why the evidence matters and answers counterarguments.",
                        "Analysis connects evidence to the claim; counterarguments are mentioned.",
                        "Evidence is often summarized rather than explained; other views are ignored.",
                        "There is little or no explanation of how the evidence supports the claim.",
                    ],
                },
                {
                    "label": "Organization",
                    "description": "A logical structure with focused paragraphs and clear transitions.",
                    "descriptors": [
                        "The structure builds the argument; every paragraph has one clear focus.",
                        "The structure is logical with only minor lapses in focus or transitions.",
                        "Some paragraphs wander or are out of order; transitions are abrupt.",
                        "There is no clear structure; ideas are hard to follow.",
                    ],
                },
                {
                    "label": "Style and conventions",
                    "description": "Clear, precise sentences with correct grammar, spelling and punctuation.",
                    "descriptors": [
                        "Writing is precise and fluent with virtually no errors.",
                        "Writing is clear; occasional errors do not get in the way of meaning.",
                        "Frequent errors or wordy sentences sometimes obscure meaning.",
                        "Errors are so frequent that meaning is often unclear.",
                    ],
                },
            ],
        },
    ),
    (
        "lab-report",
        1,
        {
            "name": "Lab report",
            "description": "A rubric for science lab reports: question, method, results and conclusions.",
            "levels": _LEVELS,
            "criteria": [
                {
                    "label": "Question and hypothesis",
                    "description": "A focused research question and a testable, reasoned hypothesis.",
                    "descriptors": [
                        "The question is focused and the hypothesis is testable and justified with theory.",
                        "The question is clear and the hypothesis is testable.",
                        "The question or hypothesis is vague or only partly testable.",
                        "The question or hypothesis is missing or cannot be tested.",
                    ],
                },
                {
                    "label": "Method",
                    "description": "Materials, variables and steps described well enough to repeat the experiment.",
                    "descriptors": [
                        "Variables and controls are identified, and the steps could be repeated exactly.",
                        "The method is clear enough to repeat with minor gaps.",
                        "Important steps, variables or controls are missing.",
                        "The method is missing or too unclear to follow.",
                    ],
                },
                {
                    "label": "Results",
                    "description": "Data presented accurately in labelled tables or graphs, with units.",
                    "descriptors": [
                        "Data are complete, accurate and clearly presented with units and labels.",
                        "Data are presented clearly with minor omissions in units or labels.",
                        "Data are incomplete, hard to read, or missing units.",
                        "Data are missing or not presented.",
                    ],
                },
                {
                    "label": "Analysis and conclusion",
                    "description": "Interpreting the results against the hypothesis, with sources of error.",
                    "descriptors": [
                        "The conclusion follows from the data, addresses the hypothesis and weighs errors.",
                        "The conclusion is supported by the data and mentions sources of error.",
                        "The conclusion only partly follows from the data; errors are not discussed.",
                        "The conclusion is missing or contradicts the data.",
                    ],
                },
                {
                    "label": "Scientific writing",
                    "description": "Objective, concise language and correct use of terms.",
                    "descriptors": [
                        "Language is precise, objective and uses scientific terms correctly.",
                        "Language is mostly objective with occasional imprecise terms.",
                        "Language is often informal or uses terms incorrectly.",
                        "Language is unclear or largely informal.",
                    ],
                },
            ],
        },
    ),
    (
        "personal-narrative",
        1,
        {
            "name": "Personal narrative",
            "description": "A rubric for personal essays and narratives that tell a true story with meaning.",
            "levels": _LEVELS,
            "criteria": [
                {
                    "label": "Focus and meaning",
                    "description": "A clear central experience and what it meant to the writer.",
                    "descriptors": [
                        "The story centers on one experience and reveals a thoughtful, specific insight.",
                        "The story has a clear focus and states what it meant.",
                        "The focus drifts, or the meaning is stated vaguely.",
                        "There is no clear central experience or meaning.",
                    ],
                },
                {
                    "label": "Detail and description",
                    "description": "Concrete sensory detail, dialogue and showing rather than telling.",
                    "descriptors": [
                        "Vivid, specific details and dialogue bring key moments to life.",
                        "Details are mostly concrete and support the story.",
                        "Details are general; the story is mostly told rather than shown.",
                        "There are few or no details.",
                    ],
                },
                {
                    "label": "Structure and pacing",
                    "description": "An engaging opening, a clear sequence and a satisfying ending.",
                    "descriptors": [
                        "The opening hooks, pacing slows at key moments and the ending resonates.",
                        "The sequence is clear with a defined beginning, middle and end.",
                        "The sequence is sometimes confusing or the ending is abrupt.",
                        "Events are hard to follow; there is no clear beginning or end.",
                    ],
                },
                {
                    "label": "Voice",
                    "description": "A distinct, consistent personal voice suited to the story.",
                    "descriptors": [
                        "The voice is distinct, honest and consistent throughout.",
                        "The voice is mostly consistent and personal.",
                        "The voice is flat or shifts unevenly.",
                        "There is no discernible personal voice.",
                    ],
                },
                {
                    "label": "Conventions",
                    "description": "Grammar, spelling, punctuation and paragraphing, including dialogue.",
                    "descriptors": [
                        "Virtually no errors; dialogue is punctuated and paragraphed correctly.",
                        "Occasional errors do not get in the way of meaning.",
                        "Frequent errors sometimes distract from the story.",
                        "Errors are so frequent that the story is hard to read.",
                    ],
                },
            ],
        },
    ),
)

RUBRICS: MappingProxyType[str, BundledRubric] = MappingProxyType(
    {
        rubric_id: BundledRubric(id=rubric_id, revision=revision, document=parse_rubric(source))
        for rubric_id, revision, source in _SOURCES
    }
)
