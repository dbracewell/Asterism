# Feature overlap review (2026-11-17)

Scope: user-facing features after EPIC-82. For each pair: what overlaps, and a
recommendation. Checked against the code on `main` at `33f07cac`.

## How a reply gets shaped today

Instruction layers, in authority order (`domains/agent/prompts.py`):

| Layer    | Source                                     | Who writes it    | Chosen per                 |
| -------- | ------------------------------------------ | ---------------- | -------------------------- |
| platform | fixed                                      | Asterism         | —                          |
| agent    | main-agent instructions                    | user             | user                       |
| profile  | persona USER.md                            | user             | chat (default or override) |
| mode     | learning mode                              | Asterism catalog | chat                       |
| task     | e.g. skill writer                          | Asterism         | run                        |
| project  | project instructions (+ goal when toggled) | user / educator  | project                    |
| skills   | `/` skills                                 | user             | branch                     |

Plus, outside the system prompt: templates (assemble the user message), the
prompt coach (reviews the user message), rubrics (input to Draft feedback mode).

That is **five user-written texts** that can each say "how should the assistant
respond": main-agent instructions, persona, project instructions, skills,
templates. Most of the overlap below comes from this.

## Findings

### 1. Personas ↔ learning modes — redundant. Remove personas.

Both switch response behavior per chat. Modes do it with tested, versioned
instructions; personas do it with free text and add a default pointer, a 20-row
limit, a per-chat override with its own revision, a composer chip, and a
reflection partition. Few users need several "selves"; one description of the
user covers the real need.

**Action:** [EPIC-83](../epics/EPIC-83-YOUR-ASTERISM-AND-PERSONA-REMOVAL.md)
replaces personas with one About you in a new Your Asterism settings section.

### 2. Main-agent instructions ↔ About you — partial overlap. Keep both, reword.

After EPIC-83 both are one-per-user free text in adjacent layers. The useful
split: About you describes the user; main-agent instructions describe the agent
(and sit beside its capabilities and loop limits). Today's persona help text
("Describe yourself and how you'd like the assistant to respond") blurs this.

**Decided (2026-11-17):** keep both. Instructions are how the agent acts; About
you is information about the user that the agent uses when writing an answer,
like a persistent memory of the user. Recorded in EPIC-83.

### 3. Self-imposed mode lock ↔ class mode policy — two mechanisms for one rule.

ADR-0031 (learner locks their own mode, no answer reveal) and ADR-0055 (educator
restricts modes in a course) both restrict which modes and reveals are allowed,
with separate UI (`chat-mode-lock.tsx`, `course-mode-policy.tsx`) and separate
enforcement.

**Decided (2026-11-17):** one policy, stricter rule wins.
[EPIC-85](../epics/EPIC-85-ONE-MODE-POLICY.md).

### 4. Weak spots ↔ topic mastery ↔ unclear items — three progress views on the same data.

All derive from quiz attempts, review logs and reflections
(ADR-0036/0049/0050) and appear as separate project study panels
(`project-weak-spots.tsx`, `project-topic-mastery.tsx`, plus unclear-cards from
reflections).

**Decided (2026-11-17):** one Progress panel.
[EPIC-84](../epics/EPIC-84-ONE-PROGRESS-PANEL.md).

### 5. Project learning goal ↔ project instructions — mostly redundant.

The goal (≤1,000 chars + target date) reaches a chat only when the per-message
goal toggle (`chat-goal-toggle.tsx`) is on; project instructions always do. The
goal's distinct value is the target date and showing it on the project page.

**Action:** keep the goal as project metadata (date, display), drop the composer
toggle and either always include the goal in the project layer or never include
it. Small story; could ride along with any project epic.

### 6. Templates ↔ skills ↔ prompt coach — three prompt helpers. Keep, but clarify.

- Templates assemble the **user message** from a framework form (teaching aid).
- Skills add **system instructions** for a branch.
- The prompt coach reviews the **user message** against a fixed rubric.

They are distinct in mechanism, but users see three things in the `+` menu and
settings that all "make prompts better". Templates and the coach share a purpose
(teaching prompt writing).

**Action:** no removal. Group templates and the coach under one "Prompt help"
heading in the composer menu and help; keep skills separate. Consider making the
coach a step of the template form rather than a global setting.

### 7. Rubrics settings section ↔ Draft feedback mode — a top-level section for one mode.

Only the Draft feedback mode uses user rubrics (`rubric_feedback` is set on one
catalog entry). A whole User Settings section serves one mode.

**Action:** move Rubrics under Templates (as "Templates & rubrics") to shorten
the settings nav. Low urgency.

### 8. Comparison ↔ disagreement display ↔ verify pass — layered, not redundant.

Disagreements summarise comparisons and sub-agent outputs; verify checks one
answer against sources. Each builds on the previous.

**Action:** none. Check that the message menu presents them as one "Check this
answer" group.

### 9. Draft feedback (inline comments) ↔ canvas — converging.

Draft review anchors comments to pasted text (ADR-0045); canvas holds editable
documents (ADR-0063). Students will want feedback on the document they are
writing in the canvas.

**Action:** future: let Draft feedback target a canvas document. Don't merge now;
canvas is opt-in and off by default.

### 10. Team packs ↔ course packs ↔ admin settings export — already consolidated.

Course packs reuse the team pack format (ADR-0054); admin export (ADR-0052) is a
different thing (secrets, instance config). No action.

### 11. Knowledge bases ↔ project files — already resolved.

EPIC-21/22/24 made knowledge file-centric and project-scoped; there is no
separate knowledge-base entity in the UI. No action.

### 12. AI-use log ↔ run inspection — different audiences. Keep.

The log is a student-facing export of their process; inspection is a debugging
view of agent runs. They read the same records. No action, but both must
reflect EPIC-83 (persona → About you).

## Suggested order

1. EPIC-83 (personas → About you). Biggest simplification; removes an invariant.
2. Learning goal toggle (finding 5) — small.
3. EPIC-84, one progress panel (finding 4).
4. EPIC-85, one mode policy (finding 3).
5. Settings/menu grouping (findings 6, 7) — UI only.
