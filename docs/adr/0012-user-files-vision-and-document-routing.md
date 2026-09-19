# ADR-0012: User-file vision and document routing

- **Status:** Accepted
- **Date:** 2026-09-16
- **Decision owners:** Asterism maintainers

## Context

Chat attachments must be useful to models without granting broad filesystem access or assuming that every configured model accepts images. File conversion can be slow or fail, and attachment bytes must not inflate relational chat history.

## Decision

1. Store user-scoped bytes behind `FileStore` (local filesystem initially) and store metadata/cache in `user_files`; messages persist only typed file references.
2. Route recognized images to native `image_url` parts only when the selected model's `supports_vision` is exactly `true`. Treat `false` and unknown as unsupported and explicitly tell the model that the image was omitted.
3. Read text/code directly and convert supported documents with bounded MarkItDown processing. Cache the result by SHA-256 on first attachment use; changed content invalidates that cache.
4. Bound upload bytes, conversion input, conversion wall-clock time, converted characters, and vision-image bytes. Conversion errors are per-file, content-free in logs, and do not abort the chat turn.
5. Keep unsupported, unavailable, and failed file names visible to users and model input. Do not add OCR, audio/video transcription, a read-file tool, cross-user sharing, quotas, resizing, or object storage in this release.

## Consequences

Regeneration rebuilds the same attachment-aware model input while deleted files remain visible as unavailable history references. Administrators can correct vision metadata without re-uploading. MarkItDown remains in-process, so a future hardening effort may move untrusted conversion into a sandbox; per-user storage quotas are also deferred.
