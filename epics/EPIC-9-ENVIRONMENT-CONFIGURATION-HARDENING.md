# EPIC-9 — Environment Configuration Hardening

## Status

**Proposed / planning only.** No spikes or implementation stories have started.
Number 9 follows the suggested epic sequence in `AGENTS.md`; it does not imply
that Epics 1–8 are complete. This epic has no prerequisite that they be complete.

## Goal

A developer configures Asterism once in a repository-root `.env`, and both apps,
maintenance commands, and local orchestration use predictable configuration.
CI and production can run entirely from injected environment variables without
requiring a dotenv file. Secrets remain server-side and existing data is preserved.

**Answer: yes, one `.env` is feasible.** Sharing a configuration source does not
mean exposing every value to the browser or passing every secret to every process.
Use one tracked root `.env.example` as the template and one ignored root `.env`
as the local source; do not maintain copies or symlinks in the applications.

## Current findings (repository inspection)

Actual `.env` values were not read; findings are based on tracked code/templates.

| Area               | Current behavior / risk                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Templates          | Root, frontend, and backend `.env.example` files duplicate settings.                                                                                                                                                                                      |
| Root scripts       | `package.json` invokes Turbo without loading `.env`; Turbo tracking/passthrough does not load dotenv files.                                                                                                                                               |
| Frontend wrapper   | `apps/frontend/scripts/run` prefers `../../.env`, falls back to `.env`, and uses `export $(cat ... \| xargs)`. This mishandles dotenv quoting, whitespace, and comments and can overwrite injected variables.                                             |
| Frontend framework | Next.js also has automatic app-local dotenv loading; interaction with the wrapper and `.env.*` variants must be resolved.                                                                                                                                 |
| Backend            | `Config` uses `env_file=".env"`, relative to the process working directory. Backend `reset:db` explicitly loads the app-local file.                                                                                                                       |
| Reset scripts      | Frontend `reset-db` computes its database path before sourcing the supplied file, executes shell syntax from that file, and uses `auth@latest`. `init.sh` removes databases at a developer-specific absolute path. These are migration/data-loss hazards. |
| Turbo              | Root `.env` is a global dependency; shared variables appear in both `globalEnv` and `globalPassThroughEnv`. Values loaded inside a task may not be accounted for in Turbo's environment hashing.                                                          |
| Docker             | Compose interpolates selected root settings into the container; Docker build supplies temporary auth settings. File-free build/runtime behavior needs regression coverage.                                                                                |
| CI                 | Existing workflows inject some settings and do not provision a dotenv file; local test commands must not fall through to developer secrets or databases.                                                                                                  |
| Documentation      | Root/backend READMEs describe shared-root configuration; frontend README describes per-app files. Root README's claim that `pnpm dev` loads the root file is not uniformly implemented.                                                                   |

## Proposed configuration contract (subject to spike decisions)

1. **One local source:** root `.env` and root `.env.example`; no implicit app-local fallback.
2. **Precedence:** explicit process environment > root dotenv > documented non-secret defaults.
   Tests deliberately disable developer-file loading and use isolated fixtures.
3. **Stable resolution:** resolve the root from the launcher/module location, not the
   caller's working directory. Supported root, filtered, and workspace commands agree.
4. **Safe parsing:** use a maintained dotenv parser or supported runtime facility;
   never `source`, `eval`, or `export $(...)` a dotenv file. Define a portable grammar
   across Node, Python, Compose, and `docker run --env-file`; do not assume their
   quoting or interpolation rules are identical.
5. **No hidden overrides:** define handling for app-local `.env`, `.env.local`,
   `.env.development*`, `.env.production*`, and `.env.test*`. Prefer a clear,
   value-redacted migration error over silently combining competing files.
6. **File optional in deployment:** injected environment is sufficient in CI and
   production; missing `.env` alone is not a startup error when configuration is valid.
7. **Validate by command:** runtime validates required secrets, URL, and storage
   settings before service readiness or destructive operations. Lint, typecheck,
   isolated tests, and image builds must not need real credentials or create real DBs.
8. **Secret boundary:** auth secrets, system keys, and admin passphrases are server-only;
   never add them to `NEXT_PUBLIC_*`, Next.js `env`, client props, logs, or image layers.
9. **Preserve existing state:** no implicit secret rotation, database reset, dotenv
   overwrite, or deletion of old files during migration. Restart processes after edits;
   no hot reload of secrets is promised.
10. **Deployment compatibility:** retain `PUBLIC_URL` as the public origin and `/storage`
    as the container default. Decide `/run/secrets` precedence explicitly before changing
    the backend's existing secret-file support.

## Task-runner decision: Turbo is an option, not a requirement

The user explicitly permits evaluating alternatives to Turborepo. Keeping pnpm
workspaces and the monorepo does not require keeping Turbo. Separate two concerns:
**loading configuration** and **scheduling/caching tasks**. Changing the runner alone
does not make Node, Python, or pnpm automatically read the root `.env`.

| Option                                      | Environment handling                                                                                                                                                                                 | Trade-off                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Keep Turbo + shared root loader             | Load before Turbo; explicitly allow variables through strict mode and hash output-affecting values.                                                                                                  | Least migration work; retains task graph/cache but needs careful environment declarations.                                              |
| pnpm workspace scripts + shared root loader | Child commands inherit the loaded environment without Turbo's filtering layer; apply per-consumer secret scoping in the launcher. Use pnpm parallel execution or a small process supervisor for dev. | Simpler for two apps; loses Turbo task caching/graph features and needs verified process shutdown, failure handling, and task ordering. |
| Hybrid: direct pnpm dev, Turbo build/checks | Dev inherits from the shared loader; cached tasks retain explicit Turbo policy.                                                                                                                      | Keeps useful caching but adds two execution paths to test; consider only if that complexity is justified.                               |
| Make/Just or Compose-first development      | Still needs an explicit dotenv loader or container environment mapping.                                                                                                                              | Extra tooling or container-centric workflow; not clearly simpler solely for dotenv propagation.                                         |

### Preferred local-development candidate: mprocs

The user already has **mprocs** installed (local CLI verified: version 0.9.6).
Evaluate it as the preferred local app supervisor: separate frontend/backend panes,
individual restarts, and a single local launch command. This is a planning decision,
not an implemented or verified dotenv integration.

Proposed flow: **root configuration loader → mprocs → per-app pnpm scripts → Next.js / uv**.
The loader supplies the environment before mprocs starts; do not assume mprocs
loads dotenv automatically. A tracked `mprocs.yaml` should contain commands and
working directories, never secret values. Child entrypoints must retain the same
precedence/scoping rules for standalone use and must not overwrite inherited values.

mprocs replaces local process supervision. The maintainer confirmed that Turbo's
ordering, concurrency, and caching are not needed for finite tasks, so pnpm workspace
scripts will run build, lint, typecheck, and tests.

Keep a documented non-interactive path for CI, containers, and developers without
mprocs. Do not make an interactive TUI a deployment or CI prerequisite. Document
installation and the tested version; verify working-directory resolution, inherited
variables on restart, Ctrl-C/quit cleanup of uv/Next.js descendants, and behavior when
one app exits. mprocs need not share CI's fail-fast policy, but both must be explicit.
Changing `.env` should require restarting the root launcher unless the spike proves
and documents a safe reload path; restarting only a pane may retain old inherited values.

**Accepted decision:** use **mprocs for local development with a shared root loader**
and **pnpm workspaces for finite build/check tasks**. Remove Turbo in dedicated
US-9.5 before implementing the loader. Turbo does not load `.env`, and its retained
features have no current product value. Do not add a larger orchestrator just for dotenv.

SP-9.1 selected the runner and loader based on fixture results, maintenance burden,
and migration cost. US-9.5 owns the bounded Turbo removal (scripts,
dependency/lockfile, Docker/CI commands, `turbo.json`, and corresponding `AGENTS.md`
architecture/command guidance). A broader build-system redesign remains out of scope.

## Scope / non-goals

In scope: entrypoints, precedence, parsing, validation, migration safety, task-runner
selection (including bounded Turbo removal if approved), cache correctness,
Docker/CI behavior, tests, and documentation.

Not in scope: a hosted secret manager, automatic secret rotation, a new admin
configuration UI, changing auth/API contracts, redesigning storage, or implementing
other foundation epics. No OpenAPI/client regeneration is expected unless a later
story actually changes an API contract.

## Discovery spikes

Spikes are timeboxed research, not implementation completion. Record evidence,
recommendation, alternatives, and unresolved questions in ADR-style notes under
`docs/adr/`. If a timebox expires, report the blocker instead of silently expanding scope.
Execute one spike/story at a time.

### SP-9.1 — Task-runner selection, loading strategy, and portable dotenv grammar

**Timebox:** 2 engineering days. **Blocks:** US-9.1.

Questions: can a common launcher reliably cover pnpm/Turbo, Next.js, Python, auth
migrations, and codegen? Should Python retain any file loading? Which supported
commands bypass the launcher? How do native Node/uv loaders compare with an explicit
parser, including Node 22.13 compatibility and subprocess signal forwarding?

- [ ] SP-9.1-T1: Inventory configuration consumers and supported root, filtered, workspace, and direct-runtime entrypoints; mark unsupported raw commands explicitly.
- [ ] SP-9.1-T2: Prototype launcher versus framework-native loading with synthetic fixtures for precedence, missing files, working directories, spaces, quotes, `#`, `=`, `$`, empty values, CRLF, and multiline/interpolation handling.
- [ ] SP-9.1-T3: Investigate Next.js dotenv variants and choose a stale-file detection policy that prevents silent app-local overrides without deleting user files.
- [ ] SP-9.1-T4: Record the selected runner and loader, portable grammar/rejections, precedence, command matrix, migration cost, and alternatives in an ADR; obtain user approval before runner replacement and refine US-9.1 estimates.
- [ ] SP-9.1-T5: Compare Turbo plus root loading, pnpm-only plus root loading, and a hybrid dev path using synthetic fixtures; measure setup complexity, cache benefit, task ordering, filtered execution, secret scoping, exit handling, and shutdown of both apps.
- [ ] SP-9.1-T6: Prototype root loading before mprocs with separate app commands/working directories; verify restart inheritance, secret-free configuration, descendant cleanup, app-exit policy, and a non-interactive fallback; compare retaining versus removing Turbo for build/check tasks.

**Exit:** reproducible fixture results and an implementable loading contract, not
just a library recommendation. Use dummy secrets only.

### SP-9.2 — Validation, secret boundaries, and safe migration

**Timebox:** 1 engineering day. **Blocks:** US-9.2 and US-9.3.

Questions: which settings are required for which commands? What is consumed at
build versus runtime? Can validation occur before configuration imports create
storage? How do `/run/secrets`, explicit environment, and dotenv precedence align?

- [ ] SP-9.2-T1: Build a variable catalog with consumer, required/default rules, secret/public classification, build/runtime use, and environment/file-secret precedence.
- [ ] SP-9.2-T2: Define redacted validation and diagnostics, including placeholder/empty secrets, URL rules, absolute writable local storage, DB overrides, and unit-test/build exceptions.
- [ ] SP-9.2-T3: Design migration for conflicting existing files without printing values, regenerating secrets, overwriting files, or changing database destinations; review reset/init safety and confirmation requirements.
- [ ] SP-9.2-T4: Record the validation and migration ADR, including browser-bundle leakage checks and concrete acceptance fixtures.

**Exit:** variable catalog, safe migration runbook draft, and agreed validation matrix.

### SP-9.3 — pnpm, Docker, and CI configuration parity

**Timebox:** 1 engineering day. **Blocks:** US-9.4 and US-9.5; informs US-9.1.

- [ ] SP-9.3-T1: Validate pnpm workspace environment inheritance, selection, failure propagation, and non-interactive execution; define checks proving complete removal of Turbo-specific assumptions.
- [ ] SP-9.3-T2: Compare Compose interpolation, `docker run --env-file`, image build, and file-free runtime; document grammar differences and runtime-only public-origin behavior.
- [ ] SP-9.3-T3: Define hermetic unit/E2E fixtures and a CI matrix that cannot read developer `.env` files, contact configured production services, or modify developer databases.
- [ ] SP-9.3-T4: Record deployment/environment-execution decisions and smoke-test evidence or blockers in an ADR; refine US-9.4 test scope.

**Exit:** a verified compatibility matrix and environment-execution policy; real
production secrets must not be needed to investigate or build an image.

## Implementation user stories

### US-9.5 — Remove unnecessary Turborepo orchestration

**As a maintainer**, I want finite workspace tasks to use pnpm directly so that the
repository has no task runner whose ordering, concurrency, and caching are unnecessary.

**Dependencies:** SP-9.1 and SP-9.3. **Execution order:** complete before US-9.1.

- [ ] US-9.5-T1: Replace root build, lint, typecheck, test, and local-CI Turbo invocations with explicit pnpm workspace commands; preserve workspace filtering and non-zero failure propagation without adding ordering or concurrency requirements.
- [ ] US-9.5-T2: Replace Dockerfile and GitHub Actions Turbo invocations, then verify frontend image build and both required CI status-check command paths.
- [ ] US-9.5-T3: Remove `turbo.json`, the Turbo dependency and lockfile entries, `.turbo` guidance/ignores where applicable, and all obsolete Turbo environment/cache configuration.
- [ ] US-9.5-T4: Update `AGENTS.md`, root/app READMEs, and command examples to describe pnpm workspaces and mprocs accurately; retain focused workspace commands.
- [ ] US-9.5-T5: Add or run regression checks proving every finite root task invokes both applicable workspaces, filtered tasks remain available, failures propagate, and no tracked command references Turbo.

**Acceptance criteria**

- Build, lint, typecheck, and tests run successfully from the root using pnpm workspaces.
- CI and Docker builds contain no Turbo command or dependency.
- Focused frontend/backend commands remain documented and functional.
- `rg` and lockfile checks find no active Turbo configuration, package, command, or stale documentation outside preserved historical planning records.
- Removing Turbo does not load `.env`; environment loading remains explicitly owned by US-9.1.

### US-9.1 — Configure and launch both apps from one root file

**As a developer**, I want one local configuration source so that the frontend,
backend, and tools cannot silently disagree.

**Dependencies:** US-9.5, SP-9.1, and the loading decision from SP-9.3.

- [ ] US-9.1-T1: Implement the selected root-resolved loader and explicit inherited-environment precedence without shell evaluation.
- [ ] US-9.1-T2: Wire supported root/filtered/workspace dev, build/start, codegen, and maintenance entrypoints; remove backend/app-local implicit fallback and preserve subprocess exit codes/signals.
- [ ] US-9.1-T3: Implement non-destructive legacy dotenv detection and missing-file behavior; consolidate tracked examples into the root template.
- [ ] US-9.1-T4: Add parsing, precedence, command-directory, legacy-file, file-free, and signal/exit regression tests; prominently document the strict portable dotenv grammar with valid/invalid examples and explain why quotes, whitespace, `$`, escapes, interpolation, and inline comments are rejected.
- [ ] US-9.1-T5: Add a secret-free mprocs.yaml and root local-dev command using the shared loader; document installation/tested version, restart semantics, and the non-interactive fallback; test environment parity and process cleanup.

**Acceptance criteria**

- A fresh checkout with only root `.env` launches both apps using identical shared values.
- If mprocs is selected, both panes use the shared configuration, quitting leaves no
  orphan app processes, and CI/container commands work without mprocs installed.
- Supported root, filtered, and workspace invocations yield the same configuration;
  explicit environment overrides win, including deliberately empty values (then validation applies).
- No app-local file is silently loaded, created, synchronized, or symlinked.
- File-free execution works with injected valid configuration. Unsupported syntax
  and stale files produce actionable messages without secret values.

### US-9.2 — Fail safely on invalid configuration without leaking secrets

**As an operator**, I want early, redacted configuration errors so that a bad
configuration cannot start an insecure or incorrectly routed deployment.

**Dependencies:** US-9.1 and SP-9.2.

- [ ] US-9.2-T1: Implement the agreed command-specific validation rules in backend and server-side frontend configuration, preserving stable variable names.
- [ ] US-9.2-T2: Add a documented configuration-check command that reports variable names and sources, never values, and performs no DB mutations.
- [ ] US-9.2-T3: Enforce server-only secret boundaries and agreed environment/file-secret precedence; prevent production startup with missing or known placeholder required secrets.
- [ ] US-9.2-T4: Add invalid-config, redaction, build/test-isolation, and client-bundle secret-canary tests; document the variable catalog.

**Acceptance criteria**

- Invalid required settings fail before service readiness or database mutation,
  with the setting name and correction guidance but no secret or credential-bearing URL.
- Runtime checks do not require production credentials for lint/typecheck/unit tests/build.
- Synthetic secret canaries do not appear in browser-delivered bundles or diagnostics.
- Valid environment-only and supported `/run/secrets` deployments still work.

### US-9.3 — Migrate existing installations without data loss

**As an existing developer/operator**, I want a clear migration and safe maintenance
commands so that consolidation preserves users, sessions, secrets, and storage.

**Dependencies:** US-9.1, US-9.2, and SP-9.2.

- [ ] US-9.3-T1: Publish a manual, conflict-aware migration runbook covering backups, retained secret values/DB paths, ignored legacy-file archival outside auto-loading locations, restart, and rollback.
- [ ] US-9.3-T2: Harden reset/init scripts to load and validate configuration before selecting database targets; remove developer-specific paths and shell sourcing, use the pinned auth CLI, and require explicit destructive confirmation.
- [ ] US-9.3-T3: Test differing old/root configurations, missing/invalid settings, external DB overrides, and confirmation cancellation using disposable data only.
- [ ] US-9.3-T4: Reconcile root/frontend/backend READMEs and bootstrap examples with the tested single-file workflow and clearly distinguish initialization, migration, and destructive reset.

**Acceptance criteria**

- Migration never automatically chooses between conflicting secrets or deletes old files.
- Existing secrets and database destinations can be retained, with a documented rollback.
- Maintenance targets are resolved after configuration loading; invalid/ambiguous targets
  and absent confirmation cause no deletion. Non-local DB reset behavior is explicit.
- No initialization or reset example contains a developer-specific absolute path.

### US-9.4 — Keep configuration deterministic across CI and containers

**As a maintainer**, I want automated parity and isolation checks so that local
convenience does not cause cache errors, broken deployment, or secret leakage.

**Dependencies:** US-9.1–US-9.3 and SP-9.3.

- [ ] US-9.4-T1: Verify pnpm workspace tasks inherit only the intended injected configuration, execute fresh, propagate failures, and contain no obsolete Turbo invocations.
- [ ] US-9.4-T2: Align Docker/Compose entrypoints and build/runtime validation with the contract, retain environment-only operation, and verify dotenv exclusion from build context/layers.
- [ ] US-9.4-T3: Add CI regressions for no-dotenv quality gates, isolated unit/E2E fixtures, root/filtered commands, special-character parity, and container auth/shared-key smoke tests.
- [ ] US-9.4-T4: Verify runtime `PUBLIC_URL` changes without image rebuild and secret-canary absence from client artifacts/logs/layers; document deployment limitations and run all relevant quality gates.

**Acceptance criteria**

- CI runs from a clean checkout without real secrets or developer storage access.
- pnpm workspace tasks execute fresh and propagate failures. Runtime-only secrets are
  not needlessly treated as client/build configuration.
- Docker builds without root `.env`; Compose and direct container startup accept valid
  injected settings, with documented parsing differences and `/storage` behavior.
- Existing authentication, privileged shared-key flows, and public-origin routing remain functional.

## Execution plan and definition of done

Recommended sequence: **SP-9.1 → SP-9.2 → SP-9.3 → US-9.5 → US-9.1 → US-9.2 → US-9.3 → US-9.4**.
Spikes may refine task boundaries, but do not start multiple implementation stories.
Create a feature branch when each story starts and update `todo.md` as work proceeds.

For every story: complete tasks, pass relevant lint/typecheck/tests, document changes,
verify auth/permission paths, and request user completion confirmation before merging
its branch into `main`. Run the applicable `CI / Lint, Typecheck, Test` and
`CI / Frontend E2E (Playwright)` checks. Update OpenAPI/generated clients only if affected.

The epic is complete only after all spikes and stories meet their exit/acceptance
criteria and the user confirms completion. Inform the user and propose the next plan.

## Risks to resolve, not hide

- Next.js and Pydantic can independently reintroduce local-file behavior.
- Dotenv dialects differ: `#`, `$`, quotes, multiline values, and Compose interpolation
  can change secret values unless the supported grammar is tested and documented.
- Loading configuration separately in pnpm package scripts can recreate drift; use the shared root launcher where configuration is required.
- Eager auth/config imports may create storage during builds or tests.
- A shared local file simplifies setup but does not justify broad process permissions
  or browser exposure; per-consumer scoping must follow the catalog.
- Reset/init changes are directly tied to configuration safety and require disposable
  fixtures; never verify them against a developer's actual configured databases.
