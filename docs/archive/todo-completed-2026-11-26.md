# Completed checklist: 2026-11-26

## Pictures in lists, quotes and tables in exports

EPIC-109 is complete: every story was confirmed and merged on 2026-11-26 through pull requests #136 to #138. Canvas PDF downloads keep loose lists' numbers and draw chat pictures and diagrams in list items, quotes and table cells, with alt text; Word draws pictures in table cells. US-109.3 also fixed PDF downloads failing on a table cell with bold, code or a link (ADR-0083).

### [EPIC-109: Pictures in lists, quotes and tables in exports](../epics/EPIC-109-PICTURES-IN-NESTED-PDF-BLOCKS.md)

Source: user request (2026-11-26), PDF downloads showing a note instead of a picture under a step. [EPIC-109](../epics/EPIC-109-PICTURES-IN-NESTED-PDF-BLOCKS.md). Suggested order: US-109.1 → 109.2 → 109.3.

- [x] US-109.1: Loose lists keep their numbers and bullets in PDF (merged 2026-11-26, PR #136)
  - [x] Markers and indent for items whose text is in paragraphs, at each level
  - [x] Tight lists, quotes and headings unchanged
  - [x] Tests from text extracted from the PDF; release notes
- [x] US-109.2: Pictures in lists and quotes in PDF (merged 2026-11-26, PR #137)
  - [x] HTML renderer subclass with private `src` tokens; ADR-0083 and ADR-0082
  - [x] Images and diagrams at any list depth and in quotes, fitted to the indent, with alt text
  - [x] Unloaded images and undrawn diagrams keep their notes; other `<img>` never loads
  - [x] Tests, canvas guide page, release notes
- [x] US-109.3: Images in table cells in PDF and Word (merged 2026-11-26, PR #138)
  - [x] Spike: alt text on an fpdf2 cell image; record the choice in ADR-0083
  - [x] PDF and Word cell images with alt text, fitted to the cell; formatted PDF cells no longer fail
  - [x] Tests, canvas guide page, release notes

## PDF layout polish

EPIC-110 is complete: every story was confirmed and merged on 2026-11-26 through pull requests #140 to #142. Canvas PDF downloads keep bold and italics in table cells, line up code blocks under their list item with a gap below, and indent quotes with a bar at the left that continues across page breaks (ADR-0083).

### [EPIC-110: PDF layout polish](../epics/EPIC-110-PDF-LAYOUT-POLISH.md)

- [x] US-110.1: Bold and italics in PDF table cells
  - [x] Bold and italic runs print as such; literal marks print as written
  - [x] Code and link text print plain; link targets stay out
  - [x] Picture cells and notes unchanged
  - [x] Tests, ADR-0083 note, guide and release note
- [x] US-110.2: Code blocks under list items in PDF
  - [x] Code blocks start at the item's indent at every level and wrap inside the page
  - [x] Top-level code blocks unchanged
  - [x] Tests, guide and release note
- [x] US-110.3: Quotes that look like quotes in PDF
  - [x] Indent and a left bar for the full height, across page breaks; nested quotes further in
  - [x] Lists, pictures and diagrams in a quote line up with its text
  - [x] Tests, guide and release note
  - [x] A gap under every code block (found in US-110.2)

## Finding reflections

EPIC-111 is complete: every story was confirmed and merged on 2026-11-26 through pull requests #144 and #146. Chats have a Reflect button that follows the project's Reflections area, saving says where the reflection went, a project's Overview shows the newest reflection, and empty lists explain how to write one.

### [EPIC-111: Finding reflections](../epics/EPIC-111-FINDING-REFLECTIONS.md)

- [x] US-111.1: A visible Reflect button that follows the project's areas
  - [x] Reflect button in the chat header once the chat has an answer
  - [x] Button and menu item only when the project's Reflections area is on (General always)
  - [x] Saving says where the reflection went, with a link
  - [x] Tests, guide (with screenshot) and release note
- [x] US-111.2: Reflections easy to find afterwards
  - [x] Empty lists explain how to write one
  - [x] Project Overview shows the newest reflection or a prompt
  - [x] Help topics and guide name every way in
  - [x] Tests, guide and release note

## Sign-up and account hardening

EPIC-112 is complete: every story was confirmed and merged on 2026-11-26 through pull requests #148 to #150. After setup the admin passphrase needs the system key; invite sign-up fits a class on one network; admin changes go only through the app, from active admins, with a race-safe last-admin guard; and chat connections, invites, the ChatGPT callback and reset links end or stay single-use with the account.

### [EPIC-112: Sign-up and account hardening](../epics/EPIC-112-SIGN-UP-AND-ACCOUNT-HARDENING.md)

- [x] US-112.1: Sign-up limits that match the docs and fit a classroom
  - [x] The passphrase alone works only before any account exists; afterwards it also needs the system key
  - [x] Invite sign-up limited per invite as well as per address (a class of 30 on one network)
  - [x] A full rate-limit store drops its oldest entries; IPv6 grouped by /64
  - [x] Tests, auth-and-security doc and release note
- [x] US-112.2: Admin changes only from active admins, through the app
  - [x] `POST /users/` from a signed-in admin checks the caller is still active and not deleted; user ids are bounded and system keys are secret fields.
  - [x] Better Auth admin HTTP routes the app doesn't use are closed.
  - [x] Suspending or deleting admins re-checks that one active admin remains in the same transaction, so two admins acting at once can't remove both.
  - [x] Tests and release note.
- [x] US-112.3: Access ends with the account
  - [x] An open chat connection closes when its token expires.
  - [x] Invite redemption creates the user, claims the invite and adds the class membership in one transaction.
  - [x] The ChatGPT connection callback checks the account is active and uses its sign-in attempt exactly once.
  - [x] Issuing a password reset link revokes the account's earlier unused links.
  - [x] Tests and release note.

## Agent and budget limits

EPIC-113 is complete: every story was confirmed and merged on 2026-11-26 through pull requests #151, #153 and #154. Quiz grading counts against the token budget; tool calls written as text run only when tools were offered and never from code; and tool and stream errors fail once, clearly, with unique call ids, strict approvals and a regenerate that waits for the running reply.

### [EPIC-113: Agent and budget limits](../epics/EPIC-113-AGENT-AND-BUDGET-LIMITS.md)

- [x] US-113.1: Quiz grading within the token budget
  - [x] Submitting an attempt checks the budget before grading short answers.
  - [x] Over budget, the attempt is still saved, with short answers marked ungraded and a message saying why.
  - [x] ADR-0073 note, tests and release note.
- [x] US-113.2: Text tool calls only when tools were offered
  - [x] Tool calls written as text are read only when that request offered tools.
  - [x] Tool-call tags inside fenced or inline code are left as text.
  - [x] The final loop step, which offers no tools, never runs a tool call.
  - [x] Tests and release note.
- [x] US-113.3: Tool and stream errors end cleanly
  - [x] Tool errors that would repeat (bad input, coded errors) are not retried.
  - [x] A structured-output error ends the stream without a completion event.
  - [x] Duplicate tool call ids are made unique before approval.
  - [x] Regenerate is refused while a reply is running and reaches every open tab.
  - [x] Tool approvals accept only true or false; unexpected tool errors return a generic message.
  - [x] Tests and release note.

## CI and image supply chain

EPIC-114 is complete: every story was confirmed and merged on 2026-11-27 through pull requests #155, #157 and #158. CI installs dependencies with the same build-script allowlist as the image, workflow checkouts keep no credentials and every job has a timeout, and the image records its extracted libgbm1, Node and Chromium versions so scans and `check:image` cover them.

### [EPIC-114: CI and image supply chain](../epics/EPIC-114-CI-AND-IMAGE-SUPPLY-CHAIN.md)

- [x] US-114.1: Dependency build scripts follow the allowlist
  - [x] CI and `ci:local:*` drop `approve-builds --all` and the flags that turn the allowlist off; `strictDepBuilds` is on.
  - [x] `minimumReleaseAge` is set to the week Dependabot already assumes.
  - [x] CI passes (better-sqlite3 and Playwright still build); release note.
- [x] US-114.2: Workflow tokens and timeouts
  - [x] Every checkout sets `persist-credentials: false` unless a later step pushes.
  - [x] Every release job has a timeout; fork pull requests get their own concurrency group.
  - [x] The Node version comes from one place; `vuln-issue.mjs` survives a bad marker.
- [x] US-114.3: Scans see every runtime component
  - [x] `check:image` records and checks the extracted `libgbm1`, Node and Chromium versions.
  - [x] `uv` comes from a digest-pinned image.
  - [x] `install-trivy.mjs` uses a private temporary directory; `check-pins.mjs` compares paths reliably.
  - [x] Tests for the scripts; release note (Image).

## Proxy and deployment hardening

EPIC-115 is complete: every story was confirmed and merged on 2026-11-27 through pull requests #160, #161 and #162. The bundled nginx trusts forwarded headers only from configured proxies, serves only the public host and keeps the system key inside the container; the default container drops capabilities and file secrets read the same everywhere; and restores stay private and refuse a missing key.

### [EPIC-115: Proxy and deployment hardening](../epics/EPIC-115-PROXY-AND-DEPLOYMENT-HARDENING.md)

- [x] US-115.1: The proxy trusts only what it should
  - [x] The forwarded scheme is honoured only from trusted proxies; requests for unknown hosts are refused.
  - [x] The internal system-key header is removed from public requests.
  - [x] The one-hour timeouts and unbuffered proxying apply only to chat, events and other streaming routes.
  - [x] Readiness checks reuse a result for a few seconds.
  - [x] Tests (`check:image` or edge-config) and release note.
- [x] US-115.2: Container and setup defaults
  - [x] `docker-compose.yml` drops capabilities, sets `no-new-privileges` and a process limit; the host gateway mapping is documented as optional.
  - [x] `setup.mjs --force` leaves `.env` readable only by its owner.
  - [x] Secret files with Windows line endings give the same key in every entrypoint command.
  - [x] API docs are off in production.
  - [x] Release note (Configuration, Image).
- [x] US-115.3: Backups restore privately and refuse a missing key
  - [x] Restored databases are readable only by their owner.
  - [x] A restore stops when the backup recorded a system key and none is set.
  - [x] Extraction has total size and file count limits; vector table names are checked.
  - [x] A cancelled data export leaves no partial file.
  - [x] Tests, backup guide and release note.

## Untrusted files and input

EPIC-116 is complete: every story was confirmed and merged on 2026-11-27 through pull requests #164, #165 and #166. Office and zip uploads are bounded before conversion, which runs in a killable child process; uploaded SVGs, file names and preferences are sanitized before they are shown; and the image prompt check, web fetches and provider clients resist unusual input.

### [EPIC-116: Untrusted files and input](../epics/EPIC-116-UNTRUSTED-FILES-AND-INPUT.md)

- [x] US-116.1: Office files checked before conversion
  - [x] DOCX, XLSX, PPTX and EPUB uploads get the same member-count and uncompressed-size checks as previews before conversion.
  - [x] A conversion that times out stops using memory and threads.
  - [x] Tests and release note.
- [x] US-116.2: Shown files and preferences are sanitized
  - [x] Uploaded SVGs are sanitized before they are shown or opened.
  - [x] The font-size preference is checked against the allowed sizes; preference cookies are `SameSite=Lax` and secure over HTTPS.
  - [x] File names lose control and text-direction characters.
  - [x] Downloaded diagram SVGs contain no external references.
  - [x] Tests and release note.
- [x] US-116.3: Prompt checks and fetches resist evasion
  - [x] The image prompt check normalizes accents and removes invisible characters before matching.
  - [x] `web_fetch` ignores proxy environment variables, uses the browser only for HTML, and caps a page's subrequests.
  - [x] Model provider clients don't follow redirects and are dropped when a provider changes or is deleted.
  - [x] Tests and release note.

## Correctness cleanup

EPIC-117 is complete: every story was confirmed and merged on 2026-11-27 through pull requests #168, #169 and #170. Settings imports and admin checks are consistent, the chat connection, titles, downloads, event stream and query cache behave correctly, and housekeeping fixes cover exports, the health check, the build context and the security policy.

### [EPIC-117: Correctness cleanup](../epics/EPIC-117-CORRECTNESS-CLEANUP.md)

- [x] US-117.1: Settings and admin consistency
  - [x] A settings import that fails partway leaves nothing applied, and never gives the admin group a budget.
  - [x] Model discovery keeps the draft model.
  - [x] Pack review and course apply offer only tools the person's group allows.
  - [x] Tool settings check component parameters; the generic setting route for study chat checks groups; nested secrets are redacted.
  - [x] Tests and release note.
- [x] US-117.2: Chat and frontend fixes
  - [x] The chat connection's heartbeat timeout has a margin over the server's ping; stray `console.log` calls are removed.
  - [x] Chat titles can be generated again later in a chat.
  - [x] File names containing `%` open and show correctly.
  - [x] Sending a message refreshes only the queries it changes.
  - [x] Downloads share one helper; the shared event worker drops closed tabs and closes the stream on sign-out.
  - [x] The query client is per request on the server; the canvas preview keeps listening until a valid message arrives.
  - [x] Tests and release note.
- [x] US-117.3: Housekeeping
  - [x] Word tables with many columns keep a positive picture width; ZIP names keep their folder when disambiguated.
  - [x] `SECURITY.md` names the supported version.
  - [x] The container health check doesn't follow redirects; `reset-databases` checks the database URL prefix; `.dockerignore` excludes docs, tests and local data.
  - [x] The unused proxy-list call in `setup.mjs` is removed.

## Release pages

EPIC-118 is complete: US-118.1 was confirmed and merged on 2026-11-27 through pull request #172. The release workflow creates each tag's GitHub Release from its release notes, with links pointing at that version's files, and the missing pages for v0.2.2 through v0.5.0 were created from the release notes.

### [EPIC-118: Release pages](../epics/EPIC-118-RELEASE-PAGES.md)

- [x] US-118.1: The release workflow creates the Release page
  - [x] After the image is published and verified, a job creates the tag's Release from its section of the release notes, marked latest only when it is the newest tag, and updates it on a re-run.
  - [x] Only that job can write to the repository.
  - [x] Pages for v0.2.2 through v0.5.0 are created from the release notes.
  - [x] Tests, release guide and release note.

## Non-blocking server work

EPIC-119 is complete: every story was confirmed and merged on 2026-11-28 through pull requests #175, #176 and #177. Uploads, generated images, canvas exports and model bundle checks no longer block the server's event loop, and exports no longer hold a database connection while they render.

### [EPIC-119: Non-blocking server work](../epics/EPIC-119-NON-BLOCKING-SERVER-WORK.md)

- [x] US-119.1: Uploads and generated images don't block
  - [x] Hashing and writing an upload run off the event loop.
  - [x] Cleaning a generated PNG runs off the event loop.
  - [x] A file that is already ready isn't hashed again each time it is checked.
  - [x] Tests show the hashing, writing and image cleaning run outside the event loop.
  - [x] Tests and release note.
- [x] US-119.2: Exports don't hold the database
  - [x] A canvas export reads what it needs, closes its database session, then renders.
  - [x] Building the ZIP runs off the event loop.
  - [x] Pictures already stored as PNG go into the ZIP without being re-encoded.
  - [x] Tests and release note.
- [x] US-119.3: Model checks don't block
  - [x] Checking a model bundle against its manifest runs off the event loop.
  - [x] The health check answers while a bundle is being verified.
  - [x] Tests and release note.
