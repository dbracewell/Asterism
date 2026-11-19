# Writing the user guide

How to write and update a page in the [user guide](README.md). The guide is for
people who use Asterism, not for the people who build or run the server. Many
readers have never used an AI chat tool, and many are not technical.

## Where pages go

Each chapter is a numbered folder with one Markdown file per page. Add the page to
its chapter's list in [README.md](README.md).

```
docs/guide/
  README.md                    Start here
  01-getting-started/          Signing in, the screen, your first chat, getting help
  02-chatting/                 Models, attachments, sources, branches, canvas, images, templates, search
  03-files-and-projects/       The Files library, projects, sub-agents, team packs
  04-learning/                 Learning modes, hints, reflections, AI-use log, rubrics
  05-studying/                 Flashcards, quizzes, notes, summaries, study guides, progress
  06-making-it-yours/          Settings, About you, agents, skills, templates, ChatGPT, your data
  07-for-educators/            Classes, invites, courses, mode policy, class insights
  08-for-administrators/       Setup, providers, users, groups and budgets, usage, status, policies, themes
  troubleshooting.md           Common messages and what to do
  glossary.md                  Plain-language terms
  images/                      Generated screenshots; never edit by hand
```

Name page files after the task, in lowercase with hyphens:
`02-chatting/choosing-a-model.md`.

## Voice

- Talk to the reader as "you". Say "Asterism" for the app, never "the system".
- Use short sentences and everyday words. Aim for something a 13-year-old could
  follow.
- Use the labels exactly as they appear on screen, in **bold**: "Select
  **New chat**". Use the names in the [terminology list](../terminology.md), and
  avoid the words in its **Avoid** column.
- Explain a term in one sentence the first time a page uses it, or link to the
  [glossary](glossary.md).
- Say what something is for before you say how to use it.
- Keep the guide free of how the code works, story numbers and planned
  features. If something isn't in the app yet, leave it out.

## The shape of a page

Each page covers one task, or a few closely related tasks. Use this outline:

```markdown
# Doing the task

One or two sentences: what you will do and why it helps.

> **Who can do this:** everyone. ← or "educators" or "administrators"

## Before you start

- What you need first, with links (a model set up by your administrator, a file…).

## Steps

1. Select **Something**.

   ![What the screen shows now](../images/name-of-shot.png)

2. Type …, then select **Save**.

## What you should see

What the screen looks like when it worked.

## If something goes wrong

- **The message you might see.** What it means and what to do.

## Related

- [Another page](../02-chatting/another-page.md)
```

Leave out a section that has nothing to say, except **Steps**.

## Steps

- Number every action. One action per step; two only when they always go together
  ("type your question, then press Enter").
- Start each step with the verb: **Select**, **Type**, **Choose**, **Drag**. Say
  "select" rather than "click" or "tap", so the step works on a phone too.
- Say where a control is when it isn't obvious: "at the bottom of the screen",
  "in the sidebar on the left".
- When the phone layout differs, add a short "On a phone, …" sentence to the step.

## Screenshots

Screenshots are made by a script, never by hand, so they stay current when the
app changes.

- Add a picture where the screen changes in a way the reader needs to see, not
  after every step.
- To add one, add an entry to [`scripts/screenshots/shots.mjs`](../../scripts/screenshots/shots.mjs)
  and run `pnpm docs:screenshots --only <name>`. If the shot needs data that isn't
  there yet, add it to the demo dataset in
  [`scripts/screenshots/`](../../scripts/screenshots/). The
  [scripts README](../../scripts/README.md#docs-screenshotsmjs) explains the
  command.
- Link images with a relative path: `![…](../images/chat-tutor.png)`.
- Every image needs alt text that says what the picture shows, as if you were
  describing it to someone who can't see it: "The Files library listing four
  files, one of them still processing". Use the shot's `alt` text, adjusted to
  the page if needed.
- The demo data is fictional. Never take a screenshot of a real instance or
  real people.

## Links

The guide is also shown inside Asterism, at `/help/guide`, so keep links relative:

- Link to another guide page by its file, such as `../02-chatting/canvas.md`; the
  app turns it into a guide page. Anchors work as on GitHub.
- Show a screenshot from `../images/`; the app serves those files.
- A link that leaves `docs/guide`, such as `../../deployment.md`, opens on GitHub in
  the app. Keep these for administrators.
- No raw HTML: the app doesn't render it.

When a page describes one of the app's pages, set that page guide's `walkthrough`
in `apps/frontend/src/features/help/pages.ts`, so its help offers **Read the full
walkthrough**.

## Before you finish

- Follow your own steps on a fresh demo instance (`pnpm docs:screenshots --keep`
  leaves one running).
- Run `pnpm docs:check` to check every link and image.
- Add the page to the chapter's list in [README.md](README.md).
