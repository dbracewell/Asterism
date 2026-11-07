# EPIC-63: Admin settings export and import

Status: in progress. Source: user request (2026-11-06), before a database reset.

## Objective

An administrator can save every application setting to one file and bring it
back later: on the same instance after a reset, or on a new install, where it
replaces provider setup. Admin settings → Export is a placeholder today.

## Ownership and delivery

- One encrypted file ([ADR-0052](../adr/0052-settings-export-format.md)). Provider
  and search keys travel inside it, protected by a passphrase the administrator
  chooses, because the instance's `SYSTEM_KEY` differs on a new install.
- Admin-only. A new `settings_transfer` domain owns the format and both directions.
- Import merges: providers in the file are added or updated by name, settings in
  the file overwrite current values, and other providers stay, so sub-agents bound
  to them keep working.
- Model references travel by provider and model name, never by ID.
- Users, chats, files and user-owned ChatGPT connections are out of scope.

## US-63.1: Export settings

As an administrator, I want to save all application settings to an encrypted file.

Estimate: 1 day. Dependencies: none.

Acceptance: from Admin settings → Export, the administrator sets a passphrase and
downloads a file. It holds every application setting, global providers and their
models, including keys, and shows no secret without the passphrase. Non-admins
are refused, and each export is logged.

- [x] Write the ADR; implement the format and export with tests.
- [x] Build the Export pane; test it.

## US-63.2: Import settings in Admin settings

As an administrator, I want to restore a settings file on a running instance.

Estimate: 1 day. Dependencies: US-63.1.

Acceptance: from Admin settings → Export, the administrator picks a file and enters
the passphrase, sees what will change, and confirms. Import merges in one
transaction. A wrong passphrase or altered file changes nothing and reveals nothing.

- [x] Implement preview and transactional merge; test merge, references, rollback and failures.
- [x] Build the import flow; test it.

## US-63.3: Import during setup

As the administrator of a new install, I want to use a settings file in place of
setting up a provider.

Estimate: 0.5 day. Dependencies: US-63.2.

Acceptance: the first-run provider step offers import as an alternative. After a
successful import, setup finishes and the app opens with the imported models.

- [ ] Add import to the setup step; test the alternative path.
