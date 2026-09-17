# Todo

Live execution checklist. Preserve completed history.

## EPIC-9 — Environment Configuration Hardening

Plan: [EPIC-9](epics/EPIC-9-ENVIRONMENT-CONFIGURATION-HARDENING.md).
Status: SP-9.1–SP-9.3 and US-9.1, US-9.2, and US-9.5 completed; US-9.3 canceled as not applicable; US-9.4 pending.
Order: SP-9.1 → SP-9.2 → SP-9.3 → US-9.5 → US-9.1 → US-9.2 → US-9.4.
Work on one item at a time; create a feature branch when each story starts.
Story completion requires passing checks and user confirmation before merge.
Checklist convention: `[ ]` pending, `[~]` in progress, `[x]` completed, `[-]` canceled/not applicable.

- [x] SP-9.1 — Task-runner selection, loading strategy, and portable dotenv grammar
  - [x] SP-9.1-T1: Inventory configuration consumers and supported root, filtered, workspace, and direct-runtime entrypoints; mark unsupported raw commands explicitly.
  - [x] SP-9.1-T2: Prototype launcher versus framework-native loading with synthetic fixtures for precedence, missing files, working directories, spaces, quotes, `#`, `=`, `$`, empty values, CRLF, and multiline/interpolation handling.
  - [x] SP-9.1-T3: Investigate Next.js dotenv variants and choose a stale-file detection policy that prevents silent app-local overrides without deleting user files.
  - [x] SP-9.1-T4: Record the selected runner and loader, portable grammar/rejections, precedence, command matrix, migration cost, and alternatives in an ADR; obtain user approval before runner replacement and refine US-9.1 estimates. ADR-0009 accepted and revised after maintainer review: use mprocs for local full-stack development, pnpm workspaces for finite tasks, and remove Turbo in US-9.5.
  - [x] SP-9.1-T5: Compare Turbo plus root loading, pnpm-only plus root loading, and a hybrid dev path using synthetic fixtures; measure setup complexity, cache benefit, task ordering, filtered execution, secret scoping, exit handling, and shutdown of both apps.
  - [x] SP-9.1-T6: Prototype root loading before mprocs with separate app commands/working directories; verify restart inheritance, secret-free configuration, descendant cleanup, app-exit policy, and a non-interactive fallback; compare retaining versus removing Turbo for build/check tasks.

- [x] SP-9.2 — Validation, secret boundaries, and safe migration
  - [x] SP-9.2-T1: Build a variable catalog with consumer, required/default rules, secret/public classification, build/runtime use, and environment/file-secret precedence.
  - [x] SP-9.2-T2: Define redacted validation and diagnostics, including placeholder/empty secrets, URL rules, absolute writable local storage, DB overrides, and unit-test/build exceptions.
  - [x] SP-9.2-T3: Design migration for conflicting existing files without printing values, regenerating secrets, overwriting files, or changing database destinations; review reset/init safety and confirmation requirements.
  - [x] SP-9.2-T4: Record the validation and migration ADR, including browser-bundle leakage checks and concrete acceptance fixtures. ADR-0010 accepted.

- [x] SP-9.3 — pnpm, Docker, and CI configuration parity
  - [x] SP-9.3-T1: Validate pnpm workspace environment inheritance, selection, failure propagation, and non-interactive execution; define checks proving complete removal of Turbo-specific assumptions.
  - [x] SP-9.3-T2: Compare Compose interpolation, `docker run --env-file`, image build, and file-free runtime; document grammar differences and runtime-only public-origin behavior.
  - [x] SP-9.3-T3: Define hermetic unit/E2E fixtures and a CI matrix that cannot read developer `.env` files, contact configured production services, or modify developer databases.
  - [x] SP-9.3-T4: Record deployment/environment-execution decisions and smoke-test evidence or blockers in an ADR; refine US-9.4 test scope. ADR-0011 accepted; strict portable dotenv grammar requires prominent documentation.

- [x] US-9.5 — Remove unnecessary Turborepo orchestration
  - [x] US-9.5-T1: Replace root build, lint, typecheck, test, and local-CI Turbo invocations with explicit pnpm workspace commands; preserve workspace filtering and non-zero failure propagation without adding ordering or concurrency requirements.
  - [x] US-9.5-T2: Replace Dockerfile and GitHub Actions Turbo invocations, then verify frontend image build and both required CI status-check command paths.
  - [x] US-9.5-T3: Remove `turbo.json`, the Turbo dependency and lockfile entries, `.turbo` guidance/ignores where applicable, and all obsolete Turbo environment/cache configuration.
  - [x] US-9.5-T4: Update `AGENTS.md`, root/app READMEs, and command examples to describe pnpm workspaces and mprocs accurately; retain focused workspace commands.
  - [x] US-9.5-T5: Add or run regression checks proving every finite root task invokes both applicable workspaces, filtered tasks remain available, failures propagate, and no tracked command references Turbo.

- [x] US-9.1 — Configure and launch both apps from one root file
  - [x] US-9.1-T1: Implement the selected root-resolved loader and explicit inherited-environment precedence without shell evaluation.
  - [x] US-9.1-T2: Wire supported root/filtered/workspace dev, build/start, codegen, and maintenance entrypoints; remove backend/app-local implicit fallback and preserve subprocess exit codes/signals.
  - [x] US-9.1-T3: Implement non-destructive legacy dotenv detection and missing-file behavior; consolidate tracked examples into the root template.
  - [x] US-9.1-T4: Add parsing, precedence, command-directory, legacy-file, file-free, and signal/exit regression tests; prominently document the strict portable dotenv grammar with valid/invalid examples and explain why quotes, whitespace, `$`, escapes, interpolation, and inline comments are rejected.
  - [x] US-9.1-T5: Add a secret-free mprocs.yaml and root local-dev command using the shared loader; document installation/tested version, restart semantics, and the non-interactive fallback; test environment parity and process cleanup.

- [x] US-9.2 — Fail safely on invalid configuration without leaking secrets
  - [x] US-9.2-T1: Implement the agreed command-specific validation rules in backend and server-side frontend configuration, preserving stable variable names.
  - [x] US-9.2-T2: Add a documented configuration-check command that reports variable names and sources, never values, and performs no DB mutations.
  - [x] US-9.2-T3: Enforce server-only secret boundaries and agreed environment/file-secret precedence; prevent production startup with missing or known placeholder required secrets.
  - [x] US-9.2-T4: Add invalid-config, redaction, build/test-isolation, and client-bundle secret-canary tests; document the variable catalog.

- [-] US-9.3 — Migrate existing installations without data loss (not applicable: there are no existing installations)
  - [-] US-9.3-T1: Migration runbook not required.
  - [-] US-9.3-T2: Migration scope canceled; reset/init safety moved to US-9.4-T5.
  - [-] US-9.3-T3: Legacy-installation fixtures not required; reset cancellation coverage moved to US-9.4-T5.
  - [-] US-9.3-T4: Migration documentation not required; fresh-install/reset documentation moved to US-9.4-T6.

- [ ] US-9.4 — Keep configuration deterministic across CI and containers
  - [ ] US-9.4-T1: Verify pnpm workspace tasks inherit only the intended injected configuration, execute fresh, propagate failures, and contain no obsolete Turbo invocations.
  - [ ] US-9.4-T2: Align Docker/Compose entrypoints and build/runtime validation with the contract, retain environment-only operation, and verify dotenv exclusion from build context/layers.
  - [ ] US-9.4-T3: Add CI regressions for no-dotenv quality gates, isolated unit/E2E fixtures, root/filtered commands, special-character parity, and container auth/shared-key smoke tests.
  - [ ] US-9.4-T4: Verify runtime `PUBLIC_URL` changes without image rebuild and secret-canary absence from client artifacts/logs/layers; document deployment limitations and run all relevant quality gates.
  - [ ] US-9.4-T5: Harden reset/init scripts to validate configuration before selecting targets, remove developer-specific paths and shell sourcing, use the pinned auth CLI, require explicit destructive confirmation, and test cancellation with disposable data.
  - [ ] US-9.4-T6: Document the tested fresh-install, initialization, and destructive-reset workflows without legacy-installation migration guidance.

### Epic closure

- [ ] Verify all spike exits and story acceptance criteria; request user completion confirmation.
- [ ] On confirmation, complete approved merges, announce epic completion, and propose the next plan.
