# EPIC-89: User guide

Status: in progress (US-89.1 awaiting confirmation). Proposed 2026-11-18. Source: user request (2026-11-18).

## Objective

Write a complete user guide in `docs/guide/`. It is a tutorial: it walks a person
through Asterism task by task, with screenshots, from signing in for the first
time to running a class or administering the instance. A reader who has never
used an AI chat tool, and who is not technical, should be able to follow it.

Out of scope: server installation and operation, which belong to
[`docs/deployment.md`](../deployment.md). The administrator chapter covers what an
admin does in the app and links to the deployment guide for the rest.

## Where things stand (verified 2026-11-18)

| Area          | Today                                                                                                                            | Gap                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| In-app help   | Help center (`/help`), a help registry of about 50 terms, page guides and a first-chat tour (`apps/frontend/src/features/help/`) | Short reference text inside the app; no step-by-step walkthroughs                |
| Written guide | None; `docs/guide/` does not exist                                                                                               | Everything                                                                       |
| Screenshots   | Playwright E2E specs take screenshots for visual tests only                                                                      | No repeatable way to produce clean, current screenshots with realistic demo data |
| Demo data     | Capacity check boots a disposable instance with a stub model provider (`scripts/capacity/`)                                      | No seeded demo users, projects, files, decks or class for screenshots            |

## Decisions

- **Audience and voice.** Second person ("you"), plain words, short sentences,
  numbered steps for anything you do. Every technical term is either avoided or
  explained in a sentence the first time it appears. Target roughly an
  eighth-grade reading level.
- **Shape of a page.** Each page answers one task or a small group of related
  tasks: what you will do, what you need first, numbered steps, a screenshot at
  each step where the screen changes meaningfully, what you should see at the
  end, and "if something goes wrong".
- **Screenshots are generated, not hand-taken.** A script boots a disposable
  instance, seeds a fixed demo dataset, drives the app with Playwright and writes
  named images to `docs/guide/images/`. When the UI changes, the screenshots are
  regenerated with one command, so the guide does not drift.
- **Demo data is obviously fictional.** Invented names, a stub model provider
  with scripted replies, no real secrets, emails or personal data. Screenshots use
  one fixed light theme, a desktop viewport, and a phone viewport where mobile
  differs.
- **Every screenshot has alt text** that says what the image shows, so the guide
  works with a screen reader.
- **Names match the app.** The guide uses the labels on screen and the terms in
  the help registry and the shared terminology list (US-87.1).
- **Organized by role.** Everyone chapters first, then Educators, then
  Administrators. Admin-only and educator-only pages say so at the top.

## Proposed guide outline

```
docs/guide/
  README.md                    Start here: what Asterism is, how to use this guide
  01-getting-started/          Signing in, the home screen, your first chat, getting help
  02-chatting/                 Models, attachments, sources, branches, compare, canvas, images, templates, search
  03-files-and-projects/       The Files library, projects, project files and sub-agents, team packs
  04-learning/                 Learning modes, hints, reflections, AI-use log, rubrics
  05-studying/                 Flashcards and review, quizzes, notes, summaries, study guides, progress
  06-making-it-yours/          Settings, About you, agents, skills, templates, ChatGPT, your data
  07-for-educators/            Classes, invites, courses, mode policy, class insights
  08-for-administrators/       Setup, providers, users, groups and budgets, usage, status, policies, themes
  troubleshooting.md           Common messages and what to do
  glossary.md                  Plain-language terms
  images/                      Generated screenshots
```

## Open questions

1. Should the in-app Help center link to the matching guide page from each page
   guide? Proposed: yes, as a "Read the full walkthrough" link, added in US-89.9.
   That needs the guide to be reachable from a deployed instance (for example a
   link to the repository, or the guide served by the app).
2. Should screenshots be committed or produced in CI? Proposed: committed, so the
   guide reads correctly on GitHub; CI checks only that each referenced image
   exists.

## User stories

Suggested order: US-89.1 → 89.2 → 89.3 → 89.4 → 89.5 → 89.6 → 89.7 → 89.8 → 89.9.
US-89.1 must come first; the chapter stories can be reordered.

### US-89.1: Screenshot pipeline and guide skeleton

As a writer, I can regenerate every screenshot with one command against
realistic, fictional data.

- [x] `pnpm docs:screenshots`: boot a disposable instance (reuse
      `scripts/capacity/instance.mjs` and the stub provider), never touching the
      working database.
- [x] Seed script for the demo dataset: an admin, an educator and two students in
      their groups; a model provider and models; files in several formats; a
      project with files and a sub-agent; chats with branches, sources and a
      canvas; flashcard decks, a quiz and notes; a class with a course.
- [x] Stub provider serves scripted replies keyed to the demo prompts, so chat
      screenshots look like real answers.
- [x] Shot list file: each entry names the image, the page, the setup steps and
      the viewport. The script fails if a shot cannot be taken.
- [x] Fixed theme, fonts, dates and viewport so reruns produce the same images
      apart from real UI changes. (Dates the app shows and class join codes still
      vary; see the notes below.)
- [x] Create `docs/guide/README.md`, the folder structure, a page template and
      the writing rules (voice, steps, screenshots, alt text).

#### Notes (US-89.1)

- **Command.** `pnpm docs:screenshots` ([scripts README](../../scripts/README.md#docs-screenshotsmjs)).
  A full run takes under two minutes on a cached image: about 10 s to start, 10 s
  to set up and seed, and 3 s a shot.
- **What is fixed, and what is not.** Theme (light Atlas), font size, viewport,
  device scale, locale, time zone, reduced motion, the demo text and every model
  reply are fixed. Dates and times shown by the app ("First seen", "Next review",
  "1 minute ago") and the class join code come from the server clock and random
  generator, so they change from run to run. Fixing them would need a fake clock
  inside the container; not worth it for the guide.
- **A scripted model, not the capacity stub.** The run reuses the capacity
  check's container and session helpers, but the capacity stub only streams a
  fixed list of words. The guide needs real answers, tool calls and JSON for the
  study generators, so `scripts/screenshots/demo-provider.mjs` is a separate
  double.
- **First-run setup is photographed live.** The administrator account and provider
  are created in the browser, so the setup screens are real. The passkey field is
  masked before its picture is taken.
- **Default model.** With more than one model enabled, only the administrator gets
  a default model from setup; everyone else sees "Select a model…" until they
  choose one. The seed sets a default for each demo person. US-89.2 and US-89.3
  must explain choosing a model.
- **Branches come from Regenerate.** There is no way to edit a sent message;
  "Editing" in US-89.3 means regenerating. Found a probable bug: regenerating an
  answer that searched files puts the new branch on the hidden tool-call step, so
  its switcher never shows (tracked in `todo.md`). The demo branch is a General
  chat without a search step.
- **README picture.** The `chat-tutor` shot also writes `docs/images/asterism-chat.png`,
  so the README's picture is regenerated with the guide's.
- **Open question 2 (commit screenshots) is decided: yes.** They are committed so
  the guide reads on GitHub; `pnpm docs:check` checks that every referenced image
  exists.

### US-89.2: Getting started

As a new user, I can sign in, find my way around and have my first chat.

- [ ] What Asterism is and what it can help with, in plain words.
- [ ] Signing in: accepting an invite link, signing in, resetting a password
      with a link from an admin, signing out and "sign out everywhere".
- [ ] A tour of the screen: sidebar, General chats, projects, Files, search,
      settings, help, on desktop and phone.
- [ ] Your first chat: typing a message, stopping a reply, choosing a model, what
      the progress panel shows.
- [ ] Getting help: the Help center, help icons and the first-chat tour.

### US-89.3: Chatting

As a user, I can use every chat feature with confidence.

- [ ] Choosing and comparing models.
- [ ] Attaching files and seeing which files are in context.
- [ ] Reading sources and citations.
- [ ] Editing, regenerating and switching between branches.
- [ ] Approving or denying a tool request.
- [ ] Canvas: creating, editing and reading a document with Asterism.
- [ ] Generating images (when your group allows it).
- [ ] Using `/` skills, prompt templates and the prompt coach.
- [ ] Long conversations and context compaction, in plain terms.
- [ ] Finding old chats with search.

### US-89.4: Files and projects

As a user, I can keep my material in one place and work on it in projects.

- [ ] The Files library: uploading, processing status, retrying, image
      captions, downloading and deleting.
- [ ] Projects: creating one, adding and removing files, project settings and
      sub-agents for the project.
- [ ] What removing a file from a project does, compared with deleting it.
- [ ] Team packs: exporting and importing a project setup, and what a pack
      never includes.

### US-89.5: Learning with Asterism

As a student, I can use Asterism to learn rather than just get answers.

- [ ] Learning modes: Standard, Tutor, Explain-back, Review my work, Draft
      feedback, Research assistant; when to use each, with an example chat.
- [ ] Hint levels and Show answer.
- [ ] Mode restrictions set by a class, and how they appear to you.
- [ ] Reflections, the AI-use log and exporting it.
- [ ] Rubrics: writing one and using it for feedback.

### US-89.6: Studying

As a student, I can turn my material into study aids and practice.

- [ ] Flashcard decks: drafting from files, reviewing drafts, studying.
- [ ] Practice quizzes: creating, taking and reviewing attempts.
- [ ] Study notes, summaries and study guides.
- [ ] Following your progress.

### US-89.7: Making Asterism yours

As a user, I can set Asterism up the way I work and manage my own data.

- [ ] General settings: theme and fonts.
- [ ] Your Asterism: About you (what to write, what not to), your usage and
      budget.
- [ ] Agents: main-agent instructions, sub-agents, the General chat set.
- [ ] Skills: writing one, drafting one with Asterism, assigning it.
- [ ] Templates and Rubrics settings.
- [ ] Connecting a ChatGPT plan.
- [ ] Download my data and asking for your account to be deleted.

### US-89.8: For educators

As an educator, I can run a class in Asterism.

- [ ] Creating a class and inviting students.
- [ ] Courses and course-managed content: what students see and cannot change.
- [ ] Setting mode policy for a class.
- [ ] Reading class insights.

### US-89.9: For administrators, troubleshooting and review

As an administrator, I can run Asterism from Admin Settings; as any reader, I
can fix common problems; and the guide has been checked by following it.

- [ ] First-time setup: the admin passphrase, connecting a provider, enabling a
      model.
- [ ] Providers and models, including pricing.
- [ ] Users: invites, suspend and reactivate, reset links, deletion and deletion
      requests.
- [ ] Groups and budgets, Usage, Status.
- [ ] Policies: Tools, Skills, Canvas, ChatGPT Plans, Context Compaction, Image
      Generation, Image Captioning, Educators, Export; Code Execution is marked
      Planned.
- [ ] Theme Editor.
- [ ] Troubleshooting page: capacity full, usage limit, suspended account, too
      many requests, failed file processing, model unavailable.
- [ ] Glossary aligned with the help registry and the terminology list.
- [ ] Walkthrough review: follow every page on a fresh demo instance and fix any
      step that does not match the app.
- [ ] Readability review by someone non-technical (or against the reading-level
      target), and fix what confuses them.
- [ ] Link the guide from `README.md` and, if agreed (open question 1), from the
      in-app Help center.
- [ ] `pnpm docs:check` passes, including every image reference.
