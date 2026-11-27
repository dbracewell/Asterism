# EPIC-116: Untrusted files and input

Status: in progress (2026-11-27). Source: repository review (2026-11-26),
verified against the code at `40101ac7`.

## Objective

Uploaded files, cookies, prompts and fetched pages are bounded and checked
before they are processed or shown.

## Stories

### US-116.1: Office files checked before conversion

As an admin, I want uploaded documents bounded before they are converted.

- [x] DOCX, XLSX, PPTX and EPUB uploads get the same member-count and
      uncompressed-size checks as previews before conversion.
- [x] A conversion that times out stops using memory and threads.
- [x] Tests and release note.

### US-116.2: Shown files and preferences are sanitized

As a person using Asterism, I want uploaded pictures and preferences shown
safely.

- [x] Uploaded SVGs are sanitized before they are shown or opened.
- [x] The font-size preference is checked against the allowed sizes; preference
      cookies are `SameSite=Lax` and secure over HTTPS.
- [x] File names lose control and text-direction characters.
- [x] Downloaded diagram SVGs contain no external references.
- [x] Tests and release note.

### US-116.3: Prompt checks and fetches resist evasion

As an admin, I want the image prompt check and web fetches to hold up against
unusual input.

- [x] The image prompt check normalizes accents and removes invisible
      characters before matching.
- [x] `web_fetch` ignores proxy environment variables, uses the browser only
      for HTML, and caps a page's subrequests.
- [x] Model provider clients don't follow redirects and are dropped when a
      provider changes or is deleted.
- [x] Tests and release note.
