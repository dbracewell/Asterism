# EPIC-101: Guided install and setup

Status: complete (2026-11-24). Source: user request (2026-11-24): "A more robust
install that explains and walks through setting up the system (all items in the
admin settings)." Builds on EPIC-97 (what is hidden when off), EPIC-99 (captioning
and image search) and EPIC-100 (complete settings import).

## Objective

A new administrator can go from nothing to a configured installation without
reading the deployment guide end to end:

1. A setup command writes a valid `.env`, generating the secrets.
2. The first sign-in starts a setup walkthrough that explains every Admin Settings
   area in turn, and lets the admin set it, skip it or import settings.

At the end, the admin sees what is set, what is off, and what that means for
users.

Out of scope: hosting-specific installers (cloud templates, Helm); changing what
any setting does.

## Where things stand (verified 2026-11-24)

- **Configuration is by hand.**
  - `.env.example` lists the required settings: `ASTERISM_VERSION`, `PUBLIC_URL`,
    `BETTER_AUTH_SECRET`, `SYSTEM_KEY`, `ADMIN_PASSPHRASE`, `TRUSTED_PROXIES`.
  - The docs say to generate secrets with `openssl rand`.
  - `pnpm config:check` (`scripts/config-check.mjs`, `config-contract.mjs`)
    validates the file, and the entrypoint runs it in production. Nothing writes
    `.env`.
- **First run covers three steps** (EPIC-48, `features/auth/components/setup-steps.tsx:30-39`):
  1. Create the admin account (`auth-form.tsx:93-139`).
  2. Add a model provider, or import settings, and choose the default and draft
     models (`app/(auth)/setup`, shown only to an admin while there are no
     models).
  3. Start a chat.
- **First run never visits:** groups and budgets, usage time zone, tools and
  search providers, skills, canvas, memory, ChatGPT plans, compaction, image
  generation, captioning, theme, educators, and a first backup.
  `docs/deployment.md` §5 and `docs/guide/08-for-administrators/first-time-setup.md`
  list these as things to visit afterwards.

## Decisions

- **Setup command.** `docker compose run --rm asterism setup` (an entrypoint
  command, so no Node is needed on the host), also run as `pnpm configure` in a
  checkout. It asks for the public URL and proxy, generates `BETTER_AUTH_SECRET`,
  `SYSTEM_KEY` and `ADMIN_PASSPHRASE`, and writes `.env` from the config contract
  so it cannot drift from `pnpm config:check`. It warns that `SYSTEM_KEY` must be
  kept for backups, refuses to overwrite an existing `.env` without `--force`, and
  ends by running the config check.
- **The walkthrough is the Admin Settings sections in order,** not a second
  settings UI. Each step shows a short explanation (what it does, its default,
  what users see when it is off, per EPIC-97) and embeds that section's existing
  component. The section registry from EPIC-100 lists the steps, so a new admin
  setting appears in setup too.
- **Order:**
  1. Admin account
  2. Providers and models, or import settings (an import completes the steps it
     covers and leaves the rest)
  3. Groups and budgets
  4. Usage time zone
  5. Tools and search
  6. Knowledge: captioning. It stays off by default (decided 2026-11-24); the
     step says plainly that while captioning is off, images can't be found in
     search
  7. Skills, canvas, memory, image generation, ChatGPT plans, compaction (each one
     a switch with an explanation)
  8. Theme
  9. Educators
  10. First backup
  11. Summary
- **Every step can be skipped and revisited.** Progress is stored server-side per
  installation, so a second admin sees it. The walkthrough ends with a summary:
  each area set, skipped or off, with links. It stays at Admin Settings → Setup
  afterwards.
- **Not blocking.** Only the admin account and one model are required before
  chatting, as today.

## User stories

Suggested order: US-101.1 → 101.2 → 101.3 → 101.4.

### US-101.1: Setup command

- [x] Add an entrypoint `setup` command and `pnpm configure` (`scripts/setup.mjs`;
      run with `--user "$(id -u):$(id -g)"` so the container can write your
      directory). Both are
      interactive and use the config contract to generate secrets and write
      `.env`. A non-interactive mode takes flags or environment variables, for
      scripts.
- [x] Tests: the written file passes `pnpm config:check`; no overwrite without
      `--force`; secrets have the required length.
- [x] Rewrite the README quick start and `docs/deployment.md` §2 around it, and
      keep the manual path as a reference.

### US-101.2: Setup walkthrough frame

- [x] Store setup progress server-side (`setup_progress` in app settings: step
      states and timestamps), with an Alembic migration if a table is needed, and
      export it per EPIC-100's registry (or mark it excluded).
- [x] Build the step frame from the section registry: explanation, embedded
      section, Skip and Next, and resume where the admin left off.
- [x] Fold the existing provider, import and default-model steps (EPIC-48) into
      it.
- [x] Unit tests and Playwright: a fresh install goes through every step, skips
      some, and resumes after a reload.

### US-101.3: Explanations and summary

- [x] Write each step's explanation: what it does, its default, what users see
      when it is off, and a link to the guide page.
- [x] Add the summary page and Admin Settings → Setup.
- [x] Add the first backup step: explain `SYSTEM_KEY`, run or show the backup
      command, and record that the step was done.

### US-101.4: Docs

- [x] Rewrite `docs/guide/08-for-administrators/first-time-setup.md` around the
      walkthrough, with refreshed screenshots (`pnpm docs:check`), and update
      `docs/deployment.md` §5.
- [x] Release notes: Behavior (setup walkthrough); Image (the `setup` command).

## Settled questions

1. The setup command writes `.env` only, not `docker-compose.yml`; the
   deployment guide keeps covering the reverse proxy (decided 2026-11-24).
2. Existing installations don't see the walkthrough after upgrading; Admin
   Settings → Setup shows it, with steps never visited marked "not reviewed"
   (decided 2026-11-24).
