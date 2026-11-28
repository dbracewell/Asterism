# ADR-0052 — Settings export format

Status: accepted and implemented for US-63.1 on 2026-11-06
([EPIC-63](../epics/EPIC-63-ADMIN-SETTINGS-EXPORT-AND-IMPORT.md)). Amended for import by
US-63.2 and setup by US-63.3 (see the addenda).

## Context

An administrator needs to save application settings and restore them after a
reset or on a new install, where the file replaces provider setup. That only
works if API keys travel with the file. Stored keys are encrypted with the
instance's `SYSTEM_KEY`, which a new install does not share, so they must be
re-encrypted with something the administrator controls.

## Decision

### File

The file is a JSON envelope around one encrypted bundle:

```json
{
  "format": "asterism.settings-export",
  "format_version": 1,
  "salt": "<base64, 16 bytes>",
  "ciphertext": "<Fernet token>"
}
```

Everything else is inside the ciphertext, including provider names and URLs, so a
file reveals only that it is an Asterism settings file. `documents.py` defines the
bundle.

### Encryption

- The key comes from the passphrase through scrypt (N=2^17, r=8, p=1; about 128 MiB
  and well under a second), with a random salt for each export. The passphrase is
  NFKC-normalized first, so the same phrase matches across keyboards.
- Scrypt's cost is fixed by `format_version`, not stored in the file, so a crafted
  file cannot demand excessive memory. Raising the cost means a new version.
- Fernet authenticates the ciphertext. A wrong passphrase, an altered file and a bad
  salt all give the same error and reveal nothing.
- Passphrases are 12 to 1,024 characters. There is no recovery: a lost passphrase
  means the file is unusable.

### Contents

The bundle has one typed field for each application setting: providers with their
keys and models, the draft model, active tools, the skills and ChatGPT plan policies,
web and image search providers, and the captioning choice. A test fails when a field
on `ApplicationSettings` has no counterpart here.

- **Models travel by name.** The draft and captioning models are
  `{provider, model}` references, because record IDs differ between instances. A
  reference to a deleted model is dropped.
- **Only the captioning choice is taken from `knowledge.processing`.** Its other
  fields identify versions of the running code, and copying them could pin a new
  install to an old pipeline.
- **Out of scope:** user-owned ChatGPT providers, which are per-user sign-ins, and
  anything user-level, such as `prompt_coach_enabled`.

## Consequences

- **Keys can now leave the server.** Until this change the API never returned a
  stored key. An admin session can now obtain them all, in a file protected by a
  passphrase that session chooses, so a stolen admin session is worth more than it
  was. Export is admin-only and each one is logged with the admin's ID; neither the
  passphrase nor any key is logged.
- The file is only as strong as its passphrase, and it can be attacked offline.
  Scrypt slows guessing but cannot save a weak passphrase, so the Export pane says
  to choose one that isn't used elsewhere.
- A new application setting needs a new bundle field, and a bump to `format_version`
  when older readers would reject it. Older versions need no reader while the
  project has no production users.

## Addendum: import (US-63.2)

`POST /settings/app/transfer/preview` and `/import` each take the file's text and
the passphrase. Nothing is held between them, so import opens the file again. Both
are admin-only, and the preview returns no keys or parameter values.

- **Merge, never remove.** Providers are matched by name and models by name within
  them, so existing model IDs and the sub-agents bound to them survive. Providers and
  models the file lacks stay. A matching provider takes the file's URL and key.
- **The file wins where it has a value.** Tools, policies and captioning always
  apply. A file with no draft model or search provider leaves the current one alone,
  because absence there means the source had none, not that this instance should
  lose its own.
- **One transaction.** Everything is staged on one session. Captioning goes last:
  `update_captioning_configuration` commits that session, so its commit carries the
  whole import, and any earlier failure rolls it all back. Going through that path
  also schedules file reprocessing when captioning changes, as an admin edit would.
- **A passphrase is not validation.** Opening a file proves who wrote it, not that
  its contents are sound, so names, URLs, provider types and model references are
  checked before anything is written. A redacted key and a ChatGPT provider are refused.
- **Draft model.** If the merge deactivates the selected draft model and the file
  names no replacement, the selection is cleared.

## Addendum: setup (US-63.3)

The first-run provider step offers a settings file as an alternative, using the same
form and routes as Admin settings. `default_model_id` is a per-user setting, so the
file cannot carry it, and a new chat cannot send without a model. After importing,
the administrator picks a default from the imported models; none is chosen for them.
A file with no active models leads back to provider setup.

## Addendum: coverage registry (US-100.1)

The file's contents grew one setting at a time, and the only check, that every
`ApplicationSettings` field had a bundle field, couldn't see settings stored
elsewhere. The usage time zone (`usage_timezone`), group budgets and themes were
left out without anything failing.

`settings_transfer/coverage.py` now lists every stored admin setting:

- where it is stored: an `app_settings` key, or a table or directory;
- the Admin Settings section that edits it;
- the bundle field that carries it, or why it is excluded (account data such as
  users and educator approvals);
- any parts not carried yet.

Tests scan the backend for the ways an app setting is written, and fail when a
key found that way, or an `ApplicationSettings` field, is not in the registry.
They also fail when an entry neither names a bundle field nor explains its
absence. US-100.2 carries the parts listed as missing, in format version 2;
US-100.3 shows the registry in the Export pane.

## Addendum: format version 2 (US-100.2)

Version 2 carries what the registry listed as missing:

- **Group limits by name.** Memory, image generation and study in chat each have
  a `group_limit`. A built-in group is identified by its key, and a custom group
  by its name, since ids differ between installations. Import maps the names to
  this installation's groups, creating a custom group that is missing. An empty
  limit (`groups: null`) means every group.
- **Group budgets.** Each group has its daily and monthly token budgets.
- **The usage time zone.** An unknown zone refuses the import.
- **Accepted licenses.** These are the ONNX generator's catalog model ids. Those
  ids are pinned in code, so they mean the same model on both sides; an id this
  version doesn't know is skipped.
- **Custom themes.** Each theme is the editor's document, under its id. Import
  checks every theme first, with a copy of the editor's strict schema (a test
  keeps its color keys in step with `features/theme/schemas.ts`) and the rule
  that names are unique regardless of case, so a bad theme refuses the whole
  import. Theme files aren't in the database, so they are written atomically
  once the rest is committed. Themes not in the file stay.

Version 1 files still open. Every new part is optional, and a missing part leaves
this installation's own value as it is. The preview compares only what the file
carries, so a version 1 file never shows a change it won't make. Import stays
merge-only.

## Addendum: format version 3 (US-125.1)

Version 3 adds each provider's `service`: the OpenAI-compatible service it was
set up from, or `null` for Custom ([ADR-0086](0086-provider-services.md)). A
service on a provider that can't have one refuses the import. Version 1 and 2
files have no `service`, and importing one leaves each provider's service as it
is.
