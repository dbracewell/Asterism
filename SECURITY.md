# Security policy

## Supported versions

Asterism is in 0.x. Security fixes go into the latest minor release only, as a
new patch release: today that is 0.6. Older minors get no fixes, so upgrade to
the newest patch of the latest minor to receive them. Read the
[release notes](docs/release-notes.md) for every release since the one you run.

| Version         | Fixes |
| --------------- | ----- |
| 0.6.x (latest)  | Yes   |
| 0.5.x and older | No    |

## Reporting a vulnerability

Please report privately, through GitHub's private vulnerability reporting:
open the repository's **Security** tab and choose **Report a vulnerability**
([direct link](https://github.com/dbracewell/Asterism/security/advisories/new)).
Do not open a public issue, pull request or discussion for a vulnerability.

Include what you can of:

- the version (Admin Settings → Status shows it and the commit) and how it is
  deployed;
- what an attacker can do, and what access they need first (none, a signed-in
  user, an educator, an administrator);
- steps or a proof of concept that reproduce it.

Asterism's own code and the published image `ghcr.io/dbracewell/asterism` are in
scope, including vulnerable dependencies in the image. A deployment that ignores
the [security defaults](docs/deployment.md#security-defaults), and the
services an administrator connects (model providers, MCP servers), are not.

## What happens next

1. We aim to acknowledge the report within 7 days.
2. We confirm the issue and how serious it is, and keep you updated in the
   private advisory, where we may ask questions or share a fix to try.
3. The fix ships in a new patch release of the latest minor. Its release notes
   say what was fixed and that administrators should upgrade.
4. We then publish the advisory, with a CVE when it qualifies, and credit you
   unless you ask us not to.

Please give us the chance to release a fix before you disclose anything
publicly. If the report turns out not to be a vulnerability, we say why and
close it.

## Checking an image

Every published image is signed and carries build provenance and an SBOM. See
[Verify the image](docs/deployment.md#verify-the-image) to check one before
running it.
