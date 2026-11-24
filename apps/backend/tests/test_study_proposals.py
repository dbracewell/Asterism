"""US-98.2: chat drafts of decks and quizzes are validated and stored by rule (EPIC-98)."""

import sqlite3
import uuid

import pytest
from asterism.domains.study.proposal_schemas import StudyDeckDraft, StudyQuizDraft
from migration_harness import upgrade_to
from pydantic import ValidationError
from test_migrations import migration_db as _migration_db

migration_db = _migration_db
FILE = uuid.uuid4()


def test_a_deck_draft_is_bounded_like_the_button_flow():
    deck = StudyDeckDraft.model_validate(
        {"title": " Cells ", "cards": [{"front": "Organelle?", "back": "Mitochondria", "file_ids": [FILE, FILE]}]}
    )
    assert deck.title == "Cells"
    assert deck.cards[0].file_ids == [FILE]
    with pytest.raises(ValidationError):
        StudyDeckDraft.model_validate({"title": "Empty", "cards": []})
    with pytest.raises(ValidationError):
        StudyDeckDraft.model_validate({"title": "Many", "cards": [{"front": "a", "back": "b"}] * 31})
    with pytest.raises(ValidationError):
        StudyDeckDraft.model_validate({"title": "Extra", "cards": [{"front": "a", "back": "b"}], "owner": "x"})


def test_a_quiz_draft_needs_a_consistent_answer_key():
    ok = StudyQuizDraft.model_validate(
        {
            "title": "Cells",
            "questions": [
                {
                    "kind": "multiple_choice",
                    "prompt": "Powerhouse?",
                    "options": ["Nucleus", "Mitochondria"],
                    "correct_option": 1,
                    "explanation": "It makes ATP.",
                },
                {"kind": "short_answer", "prompt": "Why ATP?", "rubric": "Energy currency of the cell."},
            ],
        }
    )
    assert len(ok.questions) == 2
    bad = [
        {"kind": "multiple_choice", "prompt": "One option", "options": ["A"], "correct_option": 0},
        {"kind": "multiple_choice", "prompt": "Out of range", "options": ["A", "B"], "correct_option": 2},
        {"kind": "multiple_choice", "prompt": "Repeated", "options": ["A", "A"], "correct_option": 0},
        {"kind": "multiple_choice", "prompt": "No key", "options": ["A", "B"]},
        {"kind": "short_answer", "prompt": "No rubric"},
        {"kind": "short_answer", "prompt": "Options", "options": ["A", "B"], "rubric": "x"},
    ]
    for question in bad:
        with pytest.raises(ValidationError):
            StudyQuizDraft.model_validate({"title": "Bad", "questions": [question]})


@pytest.mark.asyncio
async def test_the_table_allows_one_draft_of_each_kind_per_run_and_keeps_decisions_consistent(migration_db):
    await upgrade_to(migration_db, "head")
    run = uuid.uuid4().hex

    def insert(kind="deck", status="pending", decided=None, saved=None, execution=run):
        connection.execute(
            "INSERT INTO study_proposals (id, user_id, project_id, chat_id, message_id, execution_id, kind, payload, "
            "status, saved_id, created_at, decided_at) VALUES (?, 'u', ?, ?, ?, ?, ?, '{}', ?, ?, 0, ?)",
            (
                uuid.uuid4().hex,
                uuid.uuid4().hex,
                uuid.uuid4().hex,
                uuid.uuid4().hex,
                execution,
                kind,
                status,
                saved,
                decided,
            ),
        )

    # Foreign keys are off in a raw connection; these checks are the table's own rules.
    with sqlite3.connect(migration_db) as connection:
        insert("deck")
        insert("quiz")
        with pytest.raises(sqlite3.IntegrityError):
            insert("deck")  # a second deck in the same run
        with pytest.raises(sqlite3.IntegrityError):
            insert("cards", execution=uuid.uuid4().hex)
        with pytest.raises(sqlite3.IntegrityError):
            insert("deck", status="saved", decided=1, execution=uuid.uuid4().hex)  # saved names what it made
        with pytest.raises(sqlite3.IntegrityError):
            insert("deck", status="pending", decided=1, execution=uuid.uuid4().hex)
        insert("deck", status="saved", decided=1, saved=uuid.uuid4().hex, execution=uuid.uuid4().hex)
        insert("quiz", status="dismissed", decided=1, execution=uuid.uuid4().hex)
