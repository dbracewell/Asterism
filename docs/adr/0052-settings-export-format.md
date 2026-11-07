# ADR-0052 — Settings export format

Status: accepted and implemented for US-63.1 on 2026-11-06
([EPIC-63](../epics/EPIC-63-ADMIN-SETTINGS-EXPORT-AND-IMPORT.md)).

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
