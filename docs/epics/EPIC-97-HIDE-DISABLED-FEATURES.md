# EPIC-97: Hide what the admin has not enabled

Status: proposed (2026-11-24). Source: user request (2026-11-24): "Don't show
options throughout the system if the admin has not enabled them." Depends on
EPIC-96, which adds the live availability query this epic reads.

## Objective

People see only the features they can use. When a policy is off for someone,
either everywhere or for their group, its settings, menu items, tabs, help links
and tour steps are not shown to them. Admins still see and change every policy in
Admin Settings.

Out of scope: changing what any policy allows. Server-side checks stay as they
are, and hiding is presentation only, never the access check.

## Where things stand (verified 2026-11-24)

| Feature                              | Shown today when off                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image generation                     | Hidden ("+" menu, `composer-menu.tsx:172`)                                                                                                                                                                                                                                                                   |
| Tool allowlist, web search and fetch | Hidden in tool pickers (`agent-profile-form.tsx:168,477`)                                                                                                                                                                                                                                                    |
| Memory                               | "Use memory" checkbox disabled with an explanation (`memory-sections.tsx:45-75`). Project memory section shown with only an alert (`project-workspace.tsx:257`). Class "Let Asterism use students' memories" switch shown as available (`class-mode-policy.tsx:67-84`). Help topic (`help/registry.ts:153`). |
| Canvas                               | User setting disabled with an explanation (`general-settings.tsx:131,142`). Panel goes read-only.                                                                                                                                                                                                            |
| Skills                               | User Settings → Skills section shown with an alert (`user-settings/index.tsx:43-48`, `skill-status.tsx:23`). "+" menu "Skills" item shown as available (`chat-input.tsx:587`). `/` list says "disabled by an administrator". Sub-agent skills picker shown with a note. Tour step already hidden.            |
| Sub-agents (delegation)              | General sub-agents card shown with an explanation (`general-sub-agents.tsx:78,196`). Agents → Sub-agents (`agents-settings.tsx:97`) and the project Sub-agents tab shown as available.                                                                                                                       |
| ChatGPT plans                        | User Settings → ChatGPT always in the nav. Buttons disabled inside (`chatgpt-connection-settings.tsx:124,159,313`).                                                                                                                                                                                          |
| Code execution                       | Admin-only "Planned" placeholder (`admin-settings/code-execution-settings.tsx`)                                                                                                                                                                                                                              |
| Help topics                          | Filtered by audience (`everyone` or `admin`) only, not by feature (`help/registry.ts:9`)                                                                                                                                                                                                                     |

Reusable pieces:

- `SettingsSection` has `disabled?` and `badge?` fields, but the user section list
  is a static array.
- Composer menu items are left out when not passed in.
- The tour's `needsSkills` is the one feature-filter precedent.

## Decisions

- **Hide, don't disable.** When a feature is unavailable to the person, its
  entry points are not rendered: nav sections, menu items, tabs, toggles, help
  topics and tour steps.
- **Data people own stays reachable.** A user's saved memories, skills and
  canvases stay viewable and deletable when a policy is turned off, under one
  short line ("Your administrator has turned off memory. Your saved memories are
  kept."). They are hidden only when the user has none.
- **One source.** Every hide decision reads `useFeature()` from EPIC-96. No
  component calls a policy endpoint of its own to decide visibility.
- **Help follows availability.** Help topics and tour steps get an optional
  `feature` key and are filtered by it, generalising `needsSkills`.
- **Educator settings follow admin policy too.** The class memory switch is
  hidden when admin memory is off for the class's students.
- **Code execution leaves Admin Settings** until it exists. A "Planned" section
  is an option no one can use.

## User stories

Suggested order: US-97.1 → 97.2 → 97.3 → 97.4.

### US-97.1: Settings navigation built from availability

- [x] Build the User Settings section list from `useFeature()`. Skills and
      ChatGPT plans are left out when unavailable.
- [x] Remove the code execution placeholder from Admin Settings.
- [x] Memory and canvas toggles: hidden when unavailable, with the kept-data line
      where the user has saved items.
- [x] Unit tests per feature, on and off.

### US-97.2: Chat and composer

- [x] "+" menu: hide Skills when skills are unavailable. Image generation already
      works this way.
- [x] `/` discovery: show nothing (no "disabled by an administrator" list) when
      skills are off.
- [x] Canvas: no create affordance when unavailable. Existing canvases open
      read-only. Done in US-96.1: people never create canvases themselves, and
      `canEdit` follows availability (`canvas-panel.test.tsx`).
- [x] Tests for each, including a group-limited policy. Group limits are
      resolved by `GET /availability` (`test_availability.py`), so the
      frontend tests the answer it gets.

### US-97.3: Projects, agents and classes

- [x] Hide the project Sub-agents tab, Agents → Sub-agents and the General
      sub-agents card when delegation is unavailable, unless the user has
      definitions, in which case use the kept-data line.
- [x] Hide the project memory section and the class memory switch when memory is
      unavailable. The class switch reads a new `course_memory` entry in
      `GET /availability` (memory on for any group), since the educator's own
      group may be left out.
- [x] Hide the sub-agent skills picker when skills are off.
- [x] Tests.

### US-97.4: Help, tour and verification

- [x] Add a `feature` key to help topics and tour steps. Filter by availability,
      and replace `needsSkills`.
- [x] Playwright: with every policy off, a student sees no memory, canvas,
      skills, sub-agent, image or ChatGPT entry points. Done in
      `hidden-features.spec.ts` (isolated) for settings and help; sub-agents and
      the composer are covered by mocked specs, because other isolated specs set
      the tool allowlist and a fresh stack has no models. With each turned on, the
      entry point appears without a reload (EPIC-96).
- [x] Update the user guide where it says features "start off", and refresh the
      screenshots (`pnpm docs:check`). Add a Behavior line to the release notes.

## Settled questions

1. Admins who are also users do not see hidden entry points with an "Off for
   everyone" badge; they use Admin Settings to see what is off (decided
   2026-11-24).
