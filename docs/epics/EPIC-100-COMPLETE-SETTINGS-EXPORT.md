# EPIC-100: The settings export covers all of Admin Settings

Status: in progress (2026-11-24). Source: user request (2026-11-24): "Make sure that
the export settings covers all items in the admin settings panel."

## Objective

Exporting settings from one installation and importing them into another
reproduces everything an admin sets in Admin Settings. Account data and
downloaded model files stay out, by design. A test fails when a new admin
setting is not exported.

Out of scope: users, group membership, chats and files (that is backup and
restore, ADR-0072); downloaded model weights.

## Where things stand (verified 2026-11-24)

The export is `POST /settings/app/transfer/{export,preview,import}`
(`domains/settings_transfer/`, ADR-0052). It is an encrypted envelope,
`format_version: 1`, behind a passphrase, built by `collect_settings`
(`export.py:100-140`). Import merges and never removes anything.

| Admin Settings section                           | Exported                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Providers and models                             | Yes. User-owned ChatGPT providers are excluded by design.                                                                           |
| Theme editor                                     | **No.** Theme JSON files under `<storage_root>/themes` are only in backups.                                                         |
| Groups                                           | **Partial.** Name, model access and tool access are exported; **daily and monthly token budgets** are not (`documents.py:119-129`). |
| Usage                                            | **No.** `usage_timezone` (`usage/service.py:30`) is not on `ApplicationSettings`, so the coverage test cannot see it.               |
| Tools, Skills, Canvas, ChatGPT plans, Compaction | Yes                                                                                                                                 |
| Memory                                           | **Partial.** Only `enabled`; `group_ids` are dropped (`export.py:127`).                                                             |
| Image generation                                 | **Partial.** `group_ids` and the ONNX model's accepted licenses are dropped (`documents.py:81-90`).                                 |
| Image captioning                                 | Yes (mode and model)                                                                                                                |
| Users, Educators, Status                         | Account data or read-only; not settings                                                                                             |

- The comment that group limits "stay with the installation because ids differ"
  is out of date: groups are already exported by name.
- The coverage test (`tests/test_settings_export.py:243-249`) only checks
  `ApplicationSettings` fields.

## Decisions

- **Groups are referenced by name.** Memory and image generation `group_ids`,
  and group budgets, are exported against group names and mapped to the target
  installation's groups on import. A name with no matching group is created, as
  group import does now, and the preview lists it.
- **Accepted licenses are exported** with the model and version they were
  accepted for. Import keeps them only if the target downloads the same pinned
  model.
- **Themes are exported** as their JSON documents, validated on import with the
  theme editor's schema.
- **`format_version: 2`.** Version 1 files still import: stored file formats stay
  readable (ADR-0069). The preview names any section missing from a v1 file.
- **Coverage follows the panel, not one model.** A registry lists each Admin
  Settings section and its stored settings keys, with exported or excluded and a
  reason. The coverage test checks every key in the app settings store, plus
  themes and groups, against that registry.

## User stories

Suggested order: US-100.1 → 100.2 → 100.3.

### US-100.1: Coverage registry and test

- [x] Add the section registry (backend) and a test that fails on any stored
      admin setting not marked exported or excluded. It would fail today on
      `usage_timezone`, group budgets, memory and image groups, licenses and
      themes. Done: `settings_transfer/coverage.py`, with those gaps (and study
      in chat's groups) listed as missing until US-100.2.
- [x] Add an ADR-0052 addendum for v2 and the registry.

### US-100.2: Export and import what is missing

- [ ] Export and import `usage_timezone`, group budgets, memory and image
      generation groups by name, accepted ONNX licenses, and themes, as
      `format_version: 2`. v1 files still import.
- [ ] Preview lists every section and what will change, including groups to be
      created.
- [ ] Tests:
  - round trip into an empty installation and into one with differently
    numbered groups;
  - a v1 file imports;
  - wrong passphrase;
  - a theme that fails validation is refused with the rest of the import.

### US-100.3: Frontend and docs

- [ ] The Export pane lists what is and isn't included, generated from the
      registry so it stays accurate.
- [ ] Update `docs/guide/08-for-administrators` (export and import) and
      `docs/deployment.md`, and add release notes (Data: export format 2;
      Behavior: what is now included).

## Settled questions

1. Import stays **merge-only** (decided 2026-11-24): it never removes providers
   or other settings the file doesn't have.
