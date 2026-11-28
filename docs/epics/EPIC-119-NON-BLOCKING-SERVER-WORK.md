# EPIC-119: Non-blocking server work

Status: proposed (2026-11-27). Source: repository review (2026-11-26), work
deferred from EPIC-117.

## Objective

One person's slow job never pauses the server for everyone else.

Some slow work runs directly on the server's event loop: hashing uploads and
model files, cleaning generated images, and building ZIP exports. While it
runs, every other request waits. A canvas export also keeps a database session
open while the browser renders, for up to 60 seconds. With about ten or more
active users, a large upload or an export causes visible pauses for others.

## Stories

### US-119.1: Uploads and generated images don't block

As a user, I want the app to stay responsive while someone else uploads a large
file or generates an image.

- [ ] Hashing and writing an upload run off the event loop, in chunks.
- [ ] Cleaning a generated PNG runs off the event loop.
- [ ] A file that is already ready isn't hashed again each time it is checked.
- [ ] A test shows another request is answered while a large upload is hashed.
- [ ] Tests and release note.

### US-119.2: Exports don't hold the database

As a user, I want exports to leave the database free for others while they
render.

- [ ] A canvas export reads what it needs, closes its database session, then
      renders.
- [ ] Building the ZIP runs off the event loop.
- [ ] Pictures already stored as PNG go into the ZIP without being re-encoded.
- [ ] Tests and release note.

### US-119.3: Model checks don't block

As an administrator, I want the server to keep answering health checks while it
verifies downloaded models.

- [ ] Checking a model bundle against its manifest runs off the event loop.
- [ ] The health check answers while a bundle is being verified.
- [ ] Tests and release note.
