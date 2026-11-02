"""Fixture-based quality checks for the verify pass prompts (US-55.2).

Extraction cases check that factual claims are listed and that opinions,
offers and injected instructions are not. Judgment cases check the label (and,
optionally, the cited excerpt) for one claim. The checks measure prompt
quality against a live model; they never gate CI.
``scripts/evaluate_verification.py`` runs them.
"""

import re
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from asterism.domains.retrieval.service import RetrievalHit

from .verification import UnreadableReply, extract_messages, judge_messages, parse_claims, parse_judgment
from .verification_schemas import MAX_VERIFY_CLAIMS

FIXTURES = Path(__file__).parent / "evals" / "verify.json"


class ExtractionCase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    answer: str = Field(min_length=1)
    # Each pattern must match at least one listed claim (case-insensitive).
    required: list[str] = Field(default_factory=list)
    # No listed claim may match any of these.
    forbidden: list[str] = Field(default_factory=list)
    max_claims: int = Field(default=MAX_VERIFY_CLAIMS, ge=1, le=MAX_VERIFY_CLAIMS)

    @model_validator(mode="after")
    def _valid_patterns(self) -> "ExtractionCase":
        for pattern in (*self.required, *self.forbidden):
            re.compile(pattern)
        return self


class JudgmentCase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    claim: str = Field(min_length=1)
    excerpts: list[str] = Field(min_length=1, max_length=4)
    label: Literal["supported", "unsupported", "contradicted"]
    # 1-based excerpt numbers that must be cited, when it matters.
    evidence: list[int] | None = None


class VerifySuite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    extraction: list[ExtractionCase] = Field(min_length=1)
    judgment: list[JudgmentCase] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_ids(self) -> "VerifySuite":
        ids = [case.id for case in (*self.extraction, *self.judgment)]
        if len(ids) != len(set(ids)):
            raise ValueError("Case IDs must be unique")
        return self


class CaseResult(BaseModel):
    id: str
    passed: bool
    failures: list[str] = Field(default_factory=list)


def load_suite(path: Path = FIXTURES) -> VerifySuite:
    return VerifySuite.model_validate_json(path.read_text())


def score_extraction(case: ExtractionCase, reply: str) -> CaseResult:
    try:
        claims, _ = parse_claims(reply, case.answer, case.max_claims)
    except UnreadableReply:
        return CaseResult(id=case.id, passed=False, failures=["unreadable reply"])
    texts = [claim.claim for claim in claims]
    failures = [
        f"no claim matches {pattern!r}"
        for pattern in case.required
        if not any(re.search(pattern, text, re.IGNORECASE) for text in texts)
    ]
    failures += [
        f"a claim matches forbidden {pattern!r}"
        for pattern in case.forbidden
        if any(re.search(pattern, text, re.IGNORECASE) for text in texts)
    ]
    return CaseResult(id=case.id, passed=not failures, failures=failures)


def score_judgment(case: JudgmentCase, reply: str) -> CaseResult:
    try:
        judgment = parse_judgment(reply, len(case.excerpts))
    except UnreadableReply:
        return CaseResult(id=case.id, passed=False, failures=["unreadable reply"])
    failures = []
    if judgment.label != case.label:
        failures.append(f"label {judgment.label!r}, expected {case.label!r}")
    if case.evidence is not None and sorted(i + 1 for i in judgment.evidence) != sorted(case.evidence):
        failures.append(f"cited {[i + 1 for i in judgment.evidence]}, expected {case.evidence}")
    return CaseResult(id=case.id, passed=not failures, failures=failures)


def extraction_prompt(case: ExtractionCase) -> list[dict[str, str]]:
    return [{"role": m.role, "content": str(m.content)} for m in extract_messages(case.answer, case.max_claims)]


def judgment_prompt(case: JudgmentCase) -> list[dict[str, str]]:
    hits = [
        RetrievalHit(
            file_id=uuid.UUID(int=0),
            sources=("chat",),
            message_ids=(),
            artifact_generation=1,
            chunk_id=str(index),
            score=1.0,
            match_kind="text",
            excerpt=text,
        )
        for index, text in enumerate(case.excerpts)
    ]
    return [{"role": m.role, "content": str(m.content)} for m in judge_messages(case.claim, hits)]
