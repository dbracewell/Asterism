# EPIC-1-FOUNDATIONS

## Goal
Establish a reliable monorepo foundation for backend + frontend development with consistent developer workflows and CI quality gates.

## User Stories

### US-1.1 Monorepo tooling and workspace standards
**As a developer**, I want Turborepo + pnpm workspace standards enforced so local and CI runs are consistent.

#### Tasks
- [ ] Confirm root scripts for `dev`, `build`, `lint`, `test`, `typecheck`.
- [ ] Validate `turbo.json` pipelines and task dependencies.
- [ ] Add/update shared formatting and linting config.
- [ ] Document common monorepo commands.

### US-1.2 Backend and frontend baseline apps boot successfully
**As a developer**, I want baseline backend and frontend startup instructions verified so contributors can run the app quickly.

#### Tasks
- [ ] Verify backend local setup/install/run steps.
- [ ] Verify frontend local setup/install/run steps.
- [ ] Add environment variable templates and required keys.
- [ ] Update READMEs with validated setup instructions.

### US-1.3 CI quality gate baseline
**As a maintainer**, I want automated checks for lint/type/test so broken code is blocked early.

#### Tasks
- [ ] Add CI workflow for lint + typecheck + test.
- [ ] Ensure CI uses workspace-aware caching.
- [ ] Fail CI on broken checks.
- [ ] Document expected CI status checks.
