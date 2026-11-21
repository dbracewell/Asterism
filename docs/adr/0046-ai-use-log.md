# ADR-0046 — AI-use log export

Status: accepted and implemented for US-57.4 on 2026-11-06
([EPIC-57](../epics/EPIC-57-WRITING-FEEDBACK-AND-AI-USE-TRANSPARENCY.md)).

## Context

Students want to show a teacher how they used AI on an assignment. The log must
come from what the app actually recorded, let the student choose what to
include, label spot-the-error exercise answers (ADR-0043), and never claim to
detect AI use. The story asks for Markdown or PDF.

## Decision

### 1. Provenance, not content

`POST /chat/ai-use-log` (`chatAiUseLogCreate`) takes `{chat_ids}` (1–50,
unique) and returns `AiUseLog`. It is owner scoped: it reads each chat through
the normal chat read, so one foreign or missing chat rejects the request with
404. For each chat it returns the title, project name and creation time, and
one entry per user turn on the active branch:

- the prompt text, time, learning mode, persona, template (name, level,
  availability), rubric name, skills, attached files (with availability) and
  whether the turn was a comparison column;
- the reply that answered it: time, status, model, distinct tools called across
  the run's steps, files the reply cited, the exercise flag, counts of the
  latest verification labels and the draft-comment summary. A turn without a
  reply says so.

The assistant's answer text is never included. The request is a read; the
client marks it to skip query invalidation.

### 2. Selection and rendering in the client

The export dialog opens from a chat's actions menu (that chat preselected) or
from **Export AI-use log** on a project. It lists the chats of that workspace
(the project, or General), then loads the log and lists every turn with a
checkbox; all start included. `renderAiUseLog` turns the selected turns into
Markdown: a disclaimer ("documents what Asterism recorded… does not detect AI
use"), a section per chat and one numbered entry per prompt. Prompts are quoted
line by line, so Markdown in them stays text. Exercise answers carry the
explicit label, and unavailable templates and files are marked as such.

### 3. PDF through the browser

No PDF library is added. **Save as PDF** renders the same Markdown into a
print-only root and opens the browser's print dialog, where the student picks
"Save as PDF"; a print rule hides the rest of the app while
`body.print-ai-use-log` is set. **Download Markdown** saves the file directly.

## Consequences

- No schema change and no new dependency.
- The log reflects the active branch; other branches and regenerated answers
  that are not active are not listed.
- Print output depends on the browser's PDF support. Server-side PDF can be
  added later behind the same Markdown without changing the selection model.
