# Release notes

Changes an administrator should know about before upgrading: configuration,
the image and anything that needs action. Read the section for every release
since the one you run. Upgrade steps are in
[Deploying and running Asterism](deployment.md#6-storage-backups-and-upgrades).

Each release lists its changes under these headings, in this order, and leaves
out the empty ones:

- **Configuration:** settings that are new, renamed or removed, or whose default
  changed, and what to set before upgrading.
- **Data:** migrations and changes to stored data or files. Upgrading migrates
  them; going back means restoring the backup taken before the upgrade.
- **Image:** what is in the container image and how to build or run it: its
  size, packages, build arguments and platforms.
- **Behavior:** documented behavior that now works differently, for people or
  for administrators.

Changes are added under **Unreleased** as they are made. A release turns
Unreleased into its version and date.

## Unreleased

### Behavior

- Uploading a large file, publishing a course or generating an image no longer
  pauses the server for other people: hashing, writing and cleaning images run
  in the background. A file that is already processed isn't re-read in full
  each time it is used, unless it changed on disk.
- Downloading a canvas no longer holds a database connection while diagrams
  are drawn or the file is built, and a chat's canvas ZIP is built in the
  background without re-encoding its images.
- Checking a downloaded model (search, captioning or image generation) no
  longer pauses the server: the check runs in the background, and the model's
  status reads **verifying** until it finishes.

## 0.6.0 (2026-11-27)

### Configuration

- `docker-compose.yml` drops all Linux capabilities, sets `no-new-privileges`
  and a limit of 1,024 processes and threads. Its `host.docker.internal`
  mapping is now marked optional. If you run your own compose file, copy these
  settings.
- pnpm installs refuse packages published less than a week ago
  (`minimumReleaseAge`), and only the packages listed under `allowBuilds` in
  `pnpm-workspace.yaml` may run install scripts, in CI as in the image.
- After first-run setup, creating an account with `ADMIN_PASSPHRASE` over
  Better Auth's sign-up route also needs `SYSTEM_KEY` (`systemKey` in the query).
  Scripts that create accounts this way must send both; the bundled browser
  tests, screenshot seed, capacity check and upgrade check already do.
- The bundled nginx believes `X-Forwarded-Proto`, like `X-Forwarded-For`, only
  from `TRUSTED_PROXIES`, and answers 421 for any `Host` other than
  `PUBLIC_URL`'s or loopback. A TLS proxy in front must pass `Host` through and
  be listed in `TRUSTED_PROXIES`.

### Image

- The container health check no longer follows redirects: each path must
  answer 200 itself. The build context leaves out documentation (except the
  in-app guide), tests and local data.
- The entrypoint reads file secrets for every command, `backup` and `verify`
  included, and drops one trailing `\r\n` or `\n` the same way the backend and
  frontend do, so a secret file saved on Windows gives the same key everywhere.
- The image records the versions of what it copies in rather than installs
  (the unpacked `libgbm1`, Node and Playwright's Chromium) in
  `/usr/share/asterism/components.json`, and lists `libgbm1` where scanners and
  the SBOM look for packages. `uv` comes from its digest-pinned image instead of
  PyPI.
- The runtime stage is on a newer `python:3.13-slim-trixie` base, which carries
  `zlib1g` 1.3.1-1+deb13u1, so the image no longer upgrades `zlib1g` itself.
- `libzstd1` is 1.5.7+dfsg-1+deb13u1, which fixes CVE-2026-124851 (high). The
  base doesn't carry the fix yet, so the runtime stage upgrades it
  (`BASE_LAG_UPGRADES` in the Dockerfile) until a base update does.
- The image includes `packages/diagram-policy`, the diagram rules the app and
  canvas exports share. `pnpm check:image` also checks that the mermaid and
  DOMPurify bundles the export renderer needs are readable and that mermaid is
  the frontend's pinned version.
- `pnpm check:image` draws a mermaid diagram inside the running container, as
  the runtime user, to check the export renderer works with the image's own
  Chromium, fonts and bundles.

### Behavior

- Each release now gets its GitHub Release page, with that version's release
  notes, once its image is published and verified.
- A Word download of a table with many columns keeps its pictures visible, and
  a ZIP of downloads keeps a file's folder when it renames a repeated name.
  `pnpm reset:db` refuses a `DB_URL` that isn't SQLite, and `pnpm release`
  updates the supported version in `SECURITY.md`.
- The chat connection waits 25 seconds, not 10, without a message from the
  server before reconnecting. A chat opened before its first message still
  gets a title, and a malformed `/files/` address shows "not found" instead of
  an error page.
- Sending a message refreshes only the chat, chat list, search, draft, context,
  comparison, file scope and usage queries, not every query. Downloads share
  one helper. The event stream closes on sign-out, and the shared worker drops
  a tab that stops answering for 3 minutes.
- Each server render gets its own query cache, and the canvas preview waits for
  the app's page instead of giving up on the first stray message.
- A settings import that fails at any step changes nothing, and never gives the
  admin group a token budget. Refreshing a provider's models keeps the draft
  model when the provider leaves it out of its list.
- Pack review and import, and applying a course, offer only tools the person's
  group allows. Tool settings check search provider parameters as the
  single-setting route does; that route checks the groups a study chat or image
  generation policy names; and secrets nested inside provider parameters are
  redacted.
- The image prompt check ignores accents, full-width letters and invisible
  characters, so they no longer slip a refused word past it.
- `web_fetch` ignores proxy settings in the server's environment, renders only
  HTML pages in the browser, and stops a rendered page after 100 requests.
- Model provider clients no longer follow redirects, and saving or deleting a
  provider drops its pooled client, so a rotated key or a removed provider is
  not used again.
- Uploaded and produced SVGs are cleaned before they are shown, so opening one
  in its own tab runs nothing; one with nothing drawable left shows as
  unavailable. Downloaded diagram SVGs keep no external stylesheet or `url()`.
- Uploaded file names lose control and text-direction characters instead of
  being refused for them. The font-size setting accepts only 12, 14, 16, 18 or
  20 px, and preference cookies are `SameSite=Lax` and `Secure` over HTTPS.
- Uploaded DOCX, XLSX, PPTX, EPUB and zip files with more than 10,000 members or
  more than 512 MiB uncompressed are not converted ("File expands beyond the
  processing limit"). Conversion runs in a child process that is stopped when
  `FILE_CONVERSION_TIMEOUT_S` passes.
- Restore refuses a backup that recorded a `SYSTEM_KEY` fingerprint when no
  `SYSTEM_KEY` is set, stops at 1,000,000 entries or the storage disk's free
  space, checks vector table names, and leaves both restored databases readable
  only by their owner. A cancelled data export leaves no partial file.
- The production backend no longer serves `/api/py/openapi.json` or the API docs
  pages. `setup --force` leaves the replaced `.env` readable only by its owner.
- Through the bundled nginx, only the chat WebSocket and `/api/stream` events
  keep one-hour timeouts and unbuffered proxying; other requests time out after
  five minutes. Public requests lose any `X-Asterism-System-Key` header, and the
  public readiness checks reuse their result for 5 seconds.
- A tool error that would happen again, such as bad input, is no longer retried,
  and an unexpected tool error shows the model only its type, not its details.
  Repeated tool call ids are made unique before approval, a regenerate sent
  while a reply is running is ignored and its notice reaches every open tab,
  and a tool approval counts only a true or false answer.
- Grading a quiz counts against the token budget like other study tools. Over
  budget, the attempt is still saved, with short answers left ungraded and a note
  saying why; before, grading ignored the budget.
- Tool calls that a model writes as text are run only when that request offered
  tools, and a call shown inside a code block or inline code stays text. The last
  step of a run, which offers no tools, never runs a call.
- An open chat closes its connection when the sign-in token behind it expires
  and reconnects with a fresh one; a reply that is running carries on.
- Creating a password reset link cancels the account's earlier unused links.
- Joining a class through an invite either fully succeeds or leaves the invite
  unused; before, a failure partway could use up the invite.
- A ChatGPT connection can't finish for an account suspended while it was
  connecting, and each connection attempt can be completed only once.
- Better Auth's admin routes that Asterism doesn't use (such as setting roles or
  passwords, creating users and impersonation) are closed over HTTP, so account
  changes always go through Admin → Users.
- A suspended or deleted administrator's remaining token can no longer create
  users through `POST /users/`, and two administrators suspending or deleting
  each other at the same moment can't leave no active administrator.
- Invite sign-up allows 60 attempts per address and 5 per invite link every 15
  minutes, so a class of 30 behind one school network can join together; before,
  10 per address blocked most of the class. First-run setup keeps 10 per address.
  The sign-up limiters count IPv6 clients by /64 network and, when full, forget
  the oldest address instead of refusing everyone.
- Chats have a **Reflect** button at the top once they have an answer, so
  reflections are easier to find. In a project, it and the **Reflect on this
  session** menu item appear only while the project's Reflections area is on;
  before, a reflection could be saved to a hidden tab. Saving now says where
  the reflection was kept, with a link.
- A project's Overview shows its newest reflection, or how to write one, while
  the Reflections area is on. Empty reflection lists now point to the Reflect
  button.
- Canvas PDF downloads indent quotes, one step per level, with a grey bar at
  the left that continues across page breaks. Lists, code and pictures in a
  quote line up with its text.
- Canvas PDF downloads line up a code block in a list item with the item's
  text, at every level, instead of starting it at the page margin, and leave a
  small gap under every code block.
- Canvas PDF downloads keep bold and italics in table cells. Code and links
  in a cell still print as plain text.
- Canvas downloads now show chat pictures in table cells. In Word, cells also
  keep their bold, code and links. In a PDF, a cell shows a picture when the
  picture is all it holds, and other cells are plain text: a PDF whose table
  had bold, code or a link in a cell used to fail to download.
- Canvas PDF downloads now show chat pictures and diagrams inside list items
  and quotes, lined up with the item's text, instead of an "Image not
  included" note or the diagram's code.
- Canvas PDF downloads keep the numbers and bullets of list items written
  with blank lines between them, and indent an item's later paragraphs
  under it. Before, those items printed as plain paragraphs.
- Diagrams whose `accTitle` or `accDescr` lines come before the diagram type,
  as the main agent's instructions used to suggest, now draw instead of
  showing as code. So do mind maps with those lines. Mind maps and timelines
  are named from them too. An unnamed flowchart is now called "Diagram:
  flowchart" (and downloads as `flowchart.svg` or `.png`), not
  "flowchart-v2". The main agent is now shown where those lines go, and it
  names mind maps too. This applies in the app and in Word and PDF exports.
- A ` ```mermaid ` block in a reply, canvas, Study note or guide page now
  shows as a diagram. It loads only when a page has one, and a diagram that
  can't be drawn shows as code with a note. Diagrams use the current theme's
  colors, and each has buttons to show its code, open it full size, copy the
  source and download it as SVG or PNG. Directives in a diagram can't change
  its security settings, theme or fonts
  ([ADR-0081](adr/0081-mermaid-diagrams.md)).
- The main agent now draws diagrams, flowcharts, mind maps and timelines as
  mermaid diagrams in its reply instead of asking the image model for them,
  which drew their labels badly. Image generation is for pictures.
- Canvas documents downloaded as Word or PDF, or saved to Files in those
  formats, show mermaid diagrams as pictures with alt text, drawn on the server
  in light colors. A diagram that can't be drawn appears as code with "Diagram
  not drawn". Markdown, text and ZIP downloads keep the diagram's text. Exports
  with diagrams take a few seconds longer.
- Pictures made in a chat, and files attached to it or its project, now show
  in that chat's canvas documents instead of "File unavailable"
  ([ADR-0083](adr/0083-images-in-canvas.md)).
- The main agent is told it can put pictures and files from the chat in a
  canvas document, for example an image it just made.
- Canvas documents downloaded as Word or PDF, or saved to Files in those
  formats, include the chat's pictures with alt text. Other images, such as
  pictures from the web, are written as "Image not included" with their
  description; nothing is fetched. Markdown and text downloads write each
  picture's description instead of its internal link, and the chat's ZIP
  includes the pictures in an `images` folder. Download my data still keeps
  the stored text.
- Screen readers no longer list every code block, table, equation and diagram
  in an answer as a landmark. Each is a group named for what it holds, such as
  "Code: python" or "Table", and still scrolls with the keyboard. Task-list
  checkboxes in answers are named "Done" or "Not done".
- With the system's Reduce motion setting on, loading spinners now turn slowly
  instead of stopping, which made them look stuck. Other animations and
  transitions stay off.
- Setup (Admin Settings → Setup) no longer has Theme, Educators and First
  backup steps. Change those from their own Admin Settings sections; Status
  shows the last backup. Progress already recorded for those steps is ignored.
- The first-run setup card lists four steps. A new third step, **Review the
  remaining settings (optional)**, is current once a model is enabled, so the
  card shows that the setup walkthrough comes next.
- In setup, **Next** now saves the step's unsaved changes first and reads
  **Save and continue** while there are any. **Skip for now** saves nothing and
  asks before discarding changes, as does opening another step. Reviewed steps
  are marked **Reviewed** instead of **Done**.

## 0.5.0 (2026-11-24)

### Configuration

- A new admin setting, **Study in chat** (Admin Settings → Study in chat,
  `study_chat`), is **on** by default and can be limited to groups. It lets the
  assistant draft flashcard decks and practice quizzes in project chats whose
  Study area is on. Settings
  export carries its on/off switch; group limits stay with each installation.
- `EMBEDDING_DIMENSION` is removed; the vector size now comes from the
  embedding model. Remove it from `.env` if you set it.

### Data

- Settings files are now format version 2. They also carry group token budgets,
  which groups may use memory, image generation and study in chat (by group
  name), the usage time zone, accepted model licenses and custom themes.
  Version 1 files still import, leaving those parts as they are. Admin Settings → Export
  lists what a file includes and leaves out.

- Classes get a switch for decks and quizzes from chat, on for existing classes
  (migration `5c9a5a096d23`).
- A new `study_proposals` table holds the decks and quizzes the assistant drafts
  in chats, until the person saves or dismisses them; it's in Download my data.
  Decks and quizzes record the draft and chat they were saved from (migration
  `2114351c62ff`, which rebuilds `study_quizzes`; existing rows are kept).

- Search and memory now use the multilingual-e5-small embedding model instead
  of CLIP ([ADR-0079](adr/0079-multilingual-text-embeddings.md)). On the first
  start after upgrading, Asterism downloads the new model (135 MB) into
  `models/knowledge-e5-small`, deletes `models/knowledge-clip`, and re-embeds
  every file as a new processing generation. Images reuse the caption they
  already have. Until a file has been re-embedded, search doesn't find it, so
  expect search to fill back in over the first minutes to hours, depending on
  the size of the library. Memory vectors are rebuilt once the model is ready.
  The vector tables are renamed for the model, and the CLIP ones are dropped.
  A data migration records the CLIP-era processing policy on installations
  that never stored one, so this happens there too.

### Image

- The image has a `setup` command that writes `.env` for a new installation:
  `docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD:/out" ghcr.io/dbracewell/asterism:<version> setup`.
  It generates the secrets, checks the values and never replaces an existing
  file. In a checkout, `pnpm configure` does the same.

### Behavior

- Admin Settings has a new **Setup** section that walks through every
  administrator setting in order, with what each one does and its default.
  Skip or review each step; progress is shared by every administrator, so setup
  resumes at the first step nobody reviewed. Finishing the first-run provider
  steps now offers **Continue setup** as well as **Start chatting**. Setup
  progress is not included in a settings export.
- Each setup step links to its page in the user guide. The last step, **First
  backup**, shows the backup and verify commands and the last backup the server
  recorded, and explains why `SYSTEM_KEY` must be kept apart from backups. A
  summary lists the steps not reviewed, skipped and reviewed.
- A damaged or cut-off image upload shows **Embedding: failed** again. Since
  images are found by their captions, it had shown as ready.
- The [first-time setup guide](guide/08-for-administrators/first-time-setup.md)
  follows the walkthrough, with new screenshots.
- Ask for flashcards or a quiz in a project chat, and the assistant drafts a
  deck or a practice quiz from the conversation and the project's files. A card
  under the reply shows the draft to edit, save to Study or dismiss; nothing is
  added to Study until you save it. It needs the project's Study area, the
  admin's **Study in chat** setting, the course's switch (for course projects)
  and a model that supports tools.

- Search works across languages: a question in one language finds files and
  memories written in another, and each chunk of a file is read in full (512
  tokens, where the previous model read 77).
- Images are found in search only through their caption. With image captioning
  off, images are stored and can be attached to chats, but search won't find
  them. Admin Settings → Image captioning says so, and counts the images that
  have no caption.

- User Settings no longer shows settings for a feature the admin has turned off
  for that person: the Skills and ChatGPT sections, Use memory and Canvas.
  Someone who already has skills, a ChatGPT connection or memories saved still
  sees them, to review or delete. Admin Settings no longer lists the planned
  Code execution section. In chats, the composer's menu leaves out Skills and
  typing "/" offers only templates while skills are off. While sub-agents are
  off, Settings → Agents, the project Sub-agents tab and switch, and the Agent
  workspace starting point are hidden (kept for people who already have
  sub-agents or selections). Project memory, a sub-agent's skills and a class's
  memory switch follow the same rule, and so do the help center, page help and
  the first-chat tour.
- Turning a feature on or off in Admin Settings (for example memory or canvas)
  now shows in User Settings and chats without reloading the page. Other people's
  open tabs catch up within about 30 seconds, when the tab is next focused.
- A list that was still loading when you changed something (for example
  "Your classes" when joining a class from a link) now shows the change instead
  of the answer from before it.

## 0.4.0 (2026-11-23)

### Configuration

- A new admin setting, `memory` (Admin Settings → Memory), is off by default and
  can be limited to groups. Settings export carries its
  on/off switch; group limits stay with each installation, as for image
  generation.

### Data

- Classes have a `memory_enabled` switch, on for every existing class, for an
  educator to turn memory off in a course. Each person also gets a "Use memory"
  setting, on unless they turn it off.
- New `memory_proposals` and `memory_proposal_events` tables hold the memories
  the assistant offers in a chat until the person saves or dismisses them, and
  an audit record of each offer and decision (ids and times only). Proposals
  are deleted with their chat; the audit record is kept until the account is
  deleted. Upgrading adds both empty.
- A new `message_memories` table pins the memories each accepted turn used, so
  a resumed reply uses the same ones. Its rows are deleted with the memory, the
  message or the account. Turns accepted before upgrading use no memories.
- A new `memories` table holds what Asterism remembers about each person (user
  memory) and about their work in each project (project memory), with a memory
  vector table, `memory_vectors`, next to the knowledge vectors (ADR-0078).
  Upgrading adds both empty; nothing existing changes. Only the owner can read
  their memories. Deleting an account or a project deletes its memories.

### Behavior

- Memory (ADR-0078): when an administrator turns it on, Asterism keeps in mind
  what each person saves about themselves (Settings → Your Asterism → Memory)
  and about their work in a project (the project's Settings tab), and adds the
  most relevant ones to each message as information, never instructions. Only
  the person can see their memories. Each person can turn memory off for
  themselves, and an educator for a course. A reply's Context lists the
  memories it used. The assistant can offer to remember something the person
  said (the internal `propose_memory` tool); a card under the reply offers
  Save, Edit or Dismiss, and nothing is saved without the person's click.
- Memories leave with a person's data and survive backups and upgrades: Download
  my data adds `memories.json` (sensitive memories marked) and the memory
  offers, their audit records and each turn's memories under `records/`.
  Backups already include the memory vectors. Each start rebuilds, in the
  background, any memory vector that is missing or out of date, such as after
  a restore or a save while the embedding model was down, and removes vectors
  whose memory is gone.

## 0.3.1 (2026-11-23)

### Image

- Test tooling and pip are no longer in the image. `vitest`, `vite`, `jsdom`
  and `undici` reached the production install as better-auth's optional
  `vitest` peer, though nothing at run time used them; a pnpm hook now drops
  that peer. The base image's pip, and the `msgpack`, `setuptools` and
  `urllib3` it vendors, are removed from the runtime stage (the app runs from
  the backend's own environment). This fixes 14 high-severity findings, in
  `vite`, `undici`, `msgpack` and `setuptools`. The image is 3.59 GB on arm64
  (was 3.72 GB). `pnpm check:image` now fails if `vitest`, `vite` or `jsdom` is
  in the image's `node_modules`, or the system Python can import pip.
- The frontend's Node packages have no fixable high-severity finding. In the
  image, `fast-uri` is 3.1.9 (was 3.1.2), `browserslist` 4.29.6 (was 4.28.2)
  and `source-map-js` 1.2.4 (was 1.2.1). Development tooling outside the image
  is upgraded too (`brace-expansion`, `js-yaml`, `vite`, `vitest`, `undici`);
  `js-yaml` needs a pnpm override because `@hey-api/json-schema-ref-parser`
  pins an old version. The lockfile no longer pins a pnpm binary (11.5.0, left
  from the first commit); the image and CI install pnpm 11.17.0 from
  `packageManager`.
- The backend's Python packages have no fixable high-severity finding:
  `cryptography` 50.0.2 (was 49.0.0), `filelock` 4.2.10 (was 3.32.0),
  `soupsieve` 4.1.1 (was 2.9.1) and `urllib3` 2.8.0 (was 2.7.0). Nothing needs
  changing before upgrading. `filelock` 4 changes only the on-disk format of
  `SoftReadWriteLock`, which neither Asterism nor huggingface-hub uses, so
  model downloads and the Hugging Face cache keep working across the upgrade.
- `zlib1g` is 1.3.1-1+deb13u1, which fixes CVE-2026-85091 (high). The pinned
  `python:3.13-slim-trixie` base still has 1.3.1-1+b1 three weeks after Debian's
  fix, so the runtime stage upgrades it (`BASE_LAG_UPGRADES` in the Dockerfile).
  `pnpm check:image` fails once the base carries the fix, so the upgrade comes
  out with the base update.
- A high-severity vulnerability with a fix now fails CI and stops a release,
  as a critical with a fix already did. The weekly scan of the published image
  opens its issue for one too. With this release the image and both lockfiles
  have none. To accept a finding instead, add it to `.trivyignore.yaml` with a
  statement and an expiry date, as for criticals.

## 0.3.0 (2026-11-22)

### Configuration

- `LOCAL_CAPTION_MODEL_BUNDLE_SHA256` is removed. It was validated but never
  checked against the bundle; the code now pins the SHA-256 of every caption
  model file. A value still set is ignored, so you can unset it at any time.

### Data

- The local captioning model folder, `models/captioning-smolvlm2`, is replaced by
  the new model's files on its first download; the old PyTorch weights (about
  1 GB) are deleted then. Stored captions are not changed.

### Image

- The published image no longer includes PyTorch, diffusers or sympy, so it is
  about 1 GB smaller: about 3.8 GB unpacked, down from about 4.8 GB in 0.2.2. Embeddings, captioning and the new **ONNX** image generator run on
  ONNX Runtime and need no GPU. The **Diffusers** generator is in the
  [GPU build](deployment.md#gpu-build) only, built with
  `--build-arg TORCH_VARIANT=gpu` as before, which now also installs it. ComfyUI
  is unchanged.
- The image size budget checked in CI and the release workflow is lowered from
  5.25 GB to 4.25 GB, so the size gained stays gained.
- [Verify the image](deployment.md#verify-the-image) gives the commands to check
  an image's signature, provenance and SBOM before running it, for every image
  from 0.2.2, and how to read the SBOM. Add the check to your upgrade: the
  upgrade steps now include it. [`SECURITY.md`](../SECURITY.md) says which
  versions get security fixes (the latest minor, 0.2) and how to report a
  vulnerability privately.

### Behavior

- A new image generator, **ONNX**, runs small Stable Diffusion models on the
  server's CPU in every build: LCM DreamShaper v7 (1.6 GB download, about 5 GB of
  memory, a few seconds per 512 px image on a fast CPU) and SDXL Turbo (6.2 GB,
  about 8 GB, Stability AI Community License, accepted before download). Choose it
  in Admin Settings → Image generation and download a model from **ONNX models**.
  The models are int8 conversions published under `huggingface.co/davidb727`
  ([ADR-0077](adr/0077-torch-free-default-image.md)).
- If you use the Diffusers generator with the published image, it stops
  generating after the upgrade: Admin Settings → Image generation keeps it saved
  but shows "Diffusers is not available in this image. Choose ONNX to generate
  images on this server's CPU", and people aren't offered image creation. Choose
  ONNX or a ComfyUI server, or build and run the GPU image. Nothing switches
  generator by itself. Downloaded Diffusers models stay in
  `models/image-generation` until you remove them (from the GPU build's Local
  models page, or by deleting their folders).
- Local image captioning runs SmolVLM2 on ONNX Runtime instead of PyTorch
  ([ADR-0077](adr/0077-torch-free-default-image.md)). Its model files change, so
  an instance with local captioning on downloads them once (about 265 MB) on its
  first start after the upgrade; images uploaded meanwhile are captioned once the
  download is verified. It needs about 2 GiB of memory headroom, down from 4 GiB,
  and is about a quarter faster. New captions are worded a little differently and
  are often shorter; regenerating a file captions it again with the new model.

## 0.2.2 (2026-11-22)

### Image

- The image size budget checked in CI and the release workflow is raised from
  5 GB to 5.25 GB, for this release's dependency updates (onnxruntime 1.32 alone
  adds about 45 MB). EPIC-94 takes PyTorch out of the image and lowers it again.
- The image is built from base images pinned by digest, with GitHub Actions
  pinned by commit, so rebuilding a release pulls the same bases. Dependabot
  proposes updates weekly.
- Every image is scanned with Trivy before it is released: a critical
  vulnerability with a fix stops the release. A weekly scan of the published
  image opens an issue when a new one is found.
- Published images carry an SPDX SBOM and build provenance for each
  architecture. They are attached to the image index (each architecture's entry
  has an attestation manifest beside it, listed as `unknown/unknown`) and
  published as GitHub artifact attestations for this repository's release
  workflow, which `gh attestation verify` checks.
- Published images are signed with cosign, keyless, by this repository's
  release workflow; `cosign verify` checks the signature against that workflow's
  identity.

## 0.2.1 (2026-11-21)

### Image

- **Upgrade from 0.2.0:** this release fixes critical vulnerabilities in the
  0.2.0 image, including unauthenticated remote code execution in Next.js and
  heap overflows when Pillow decodes uploaded images. Pull the new image and
  restart; both databases migrate on start.
  - Next.js 16.2.7 → 16.4.6
  - Pillow 12.3.0 → 13.0.0
  - better-auth 1.6.11 → 1.7.26 (its tables migrate on start)
  - PyJWT 2.13.0 → 2.15.1
  - certifi 2026.6.17 → 2026.10.23 (drops the compromised emSign roots)

### Behavior

- A database from a development build before 0.2.0 is still refused at start,
  and the message now says how to start fresh with Docker (remove the storage
  volume) as well as in a checkout.

## 0.2.0 (2026-11-20)

### Data

- Compaction summaries written by **Compact now** named the model by its id.
  Upgrading renames them to the model's name (migration `c3a1f0d2b9e4`).

### Image

- **Install by pulling:** each release is published as
  [`ghcr.io/dbracewell/asterism`](https://github.com/dbracewell/Asterism/pkgs/container/asterism)
  for amd64 and arm64, tagged with its version and `latest`.
  `docker-compose.yml` now runs that image: set `ASTERISM_VERSION` in `.env`
  to the release (Compose refuses to start without it), then
  `docker compose pull && docker compose up -d`. If you built from source
  before, keep doing so with `docker-compose.build.yml`; see
  [Building from source](deployment.md#building-from-source). The GPU build is
  not published: build it from source with `TORCH_VARIANT=gpu`.
- **One version:** Asterism is now version 0.2.0 everywhere. Admin Settings →
  Status and backup manifests used to say 0.1.0. Status and backups also name
  the commit the image was built from, when it is built with
  `ASTERISM_COMMIT=$(git rev-parse HEAD)`; see
  [Start](deployment.md#3-start). The image carries the standard OCI labels for
  its version, commit and source.
- **The image is smaller:** about 4.4 GB on disk instead of 10.8 GB, and under
  1 GB to download instead of 3.6 GB. PyTorch is now the CPU-only build, and
  only the frontend's runtime packages are installed. Embeddings, captioning
  and local image generation work as before.
- **GPU build:** to run local image generation on an NVIDIA GPU, build with
  `--build-arg TORCH_VARIANT=gpu` (about 8 GB on disk, estimated). See
  [GPU build](deployment.md#gpu-build). If you relied on the image's CUDA
  libraries before, rebuild with this argument.
- **Headless Chromium is included,** so the web fetch tool can read short and
  JavaScript-heavy pages in the container. Fetching them used to fail with an
  error. The browser has no network of its own; every request goes through the
  tool's checked connection.

### Behavior

- A signed-in person who isn't an administrator now gets **403** from admin
  routes, and stays signed in. Missing or invalid tokens still get 401.
