# Asterism Codebase Audit (`problems.md`)

This document explains the security issues, bugs, frontend inconsistencies, code smells, and overengineering found across the Asterism repository. Every issue is written in **plain, everyday language (ELI5)** and breaks down:

1. **What the problem is** (and where it lives in the code)
2. **What it affects** (why you should care)
3. **What the fix is** (how to solve it)

---

## Table of Contents

1. [Security Problems](#1-security-problems)
2. [General Problems & Bugs (Broken Features, Crashes & Performance)](#2-general-problems--bugs-broken-features-crashes--performance)
3. [Frontend Inconsistencies (UI, Styling & Component Rules)](#3-frontend-inconsistencies-ui-styling--component-rules)
4. [Code Smells (Messy Patterns, Hidden Traps & N+1 Queries)](#4-code-smells-messy-patterns-hidden-traps--n1-queries)
5. [Overengineering & Dead Weight (Unused Code & Unnecessary Complexity)](#5-overengineering--dead-weight-unused-code--unnecessary-complexity)

---

## 1. Security Problems

### 1.1 [FIXED] The AI Can Be Tricked Into Browsing Your Private Internal Network (SSRF & Browser Bomb)

- **Where**:
  - [fetch.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/tools/builtin/fetch.py#L90-L167) (`_js_site_fetch`, `fetch_page`, `fetch_markdown`)
  - [web_fetch.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/tools/builtin/web_fetch.py#L13-L18) (`web_fetch`)
  - [web_search.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/tools/builtin/web_search.py#L48-L57) (`_research`)
  - [schemas.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/tools/schemas.py#L16-L20) (`SearchArgs.limit`)
- **What the problem is**:
  Imagine giving a helpful assistant a key to every room inside your house and telling them, *"If anyone asks you to fetch a letter from an address, go grab it and read it out loud."* Right now, when the AI uses `web_fetch` or `web_search`, the backend server visits **any** URL without checking if that address is on the public internet or inside your private network (`localhost`, `127.0.0.1`, `192.168.x.x`, or cloud metadata `169.254.169.254`). Even worse, if the response is shorter than 1,050 characters, the server opens a real headless Chrome browser (Playwright) and runs whatever JavaScript is on that page. And because `SearchArgs.limit` has no maximum cap, the AI can ask for `limit=500` results at once, launching hundreds of simultaneous web requests and Chrome browsers.
- **What it affects**:
  - **Private network exposure**: A malicious webpage or document can hide instructions ("Prompt Injection") telling the AI to fetch `http://127.0.0.1:8000/...` or internal services on your LAN and read the results back to the attacker.
  - **Server crash (Denial of Service)**: One search request with a huge `limit` will spawn dozens of Chrome processes and freeze the server out of memory.
- **What the fix is**:
  1. Check every URL (and every redirect) before fetching: allow only `http://` and `https://`, look up the domain's IP address, and block private, loopback (`127.0.0.1`), and link-local (`169.254.x.x`) IPs.
  2. Block private IP requests inside Playwright (`page.route("**/*", ...)`).
  3. Put a strict cap on `SearchArgs.limit` (e.g., `Field(default=3, ge=1, le=10)`) and use an `asyncio.Semaphore(2)` so at most 2 headless browser pages can run at the same time.

---

### 1.2 [FIXED] Leftover Door Lets Anyone Set Any Cookie on the Website & Redirect Users

- **Where**: [actions.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/server/actions.ts#L1-L15) (`setActiveMessageId`)
- **What the problem is**:
  There is an unused file marked with `"use server"` at the top. In Next.js, putting `"use server"` at the top of a file turns every exported function into a public web endpoint that anyone on the internet can call with a `POST` request. `setActiveMessageId(chatId, activeId)` doesn't check if the caller is logged in, and it runs `cookieStore.set(chatId, activeId, { httpOnly: true, ... })` followed by `redirect(\`/c/\${chatId}\`)`. That's like leaving an unlocked maintenance panel outside your building where a stranger can relabel any switch (`chatId`) to any value (`activeId`).
- **What it affects**:
  An unauthenticated attacker can call this action to overwrite important `httpOnly` cookies (such as login session cookies, logging the user out or swapping their session) and trigger open redirects.
- **What the fix is**:
  Delete [apps/frontend/src/features/chat/server/actions.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/server/actions.ts) completely—nothing in the app uses it.

---

### 1.3 [FIXED] Anyone Can Create Accounts Anytime, and a Half-Finished Setup Locks You Out Forever

- **Where**:
  - [auth-core.ts](file:///Users/david/prj/asterism/apps/frontend/src/lib/auth-core.ts#L17-L22) and [auth-core.ts](file:///Users/david/prj/asterism/apps/frontend/src/lib/auth-core.ts#L52-L74)
  - [actions.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/auth/server/actions.ts#L15-L50) (`installApp`)
  - [server-config-core.ts](file:///Users/david/prj/asterism/apps/frontend/src/lib/server-config-core.ts#L118-L137)
- **What the problem is**:
  Four separate problems exist in how initial setup and user sign-up work:
  1. **Open sign-up forever**: BetterAuth's `/api/auth/sign-up/email` route is always open. The code only checks the admin key if `?install=true` is in the URL. If someone sends a sign-up request *without* `?install=true`, it happily creates a `"user"` account even after initial setup is done.
  2. **No "already installed" check**: Even with `?install=true`, the server never checks if the app already has users (`getUserCount() > 0`). Anyone who knows or guesses the admin passphrase can create more admin accounts later.
  3. **Empty passphrase default in dev/test modes**: In non-full-runtime configs, `adminPassphrase` defaults to an empty string `""`, so an empty `adminKey` matches `adminKey === config.adminPassphrase`.
  4. **Half-finished setup bricks the app**: During first-time setup (`installApp`), the frontend saves the new admin user into `users.db` *first*, and then calls the Python backend (`POST /users/`). If the Python backend happens to be down or returns an error, `users.db` now has 1 user. When you refresh `/sign-in`, the app sees `userCount > 0` and hides the setup screen forever, even though your user doesn't properly exist in the backend!
- **What it affects**:
  Unauthorized account creation, admin elevation, and a broken first-time setup experience if the backend isn't reachable at the exact moment of install.
- **What the fix is**:
  1. In `databaseHooks.user.create.before` ([auth-core.ts](file:///Users/david/prj/asterism/apps/frontend/src/lib/auth-core.ts#L53)) and `installApp`, block sign-up unless `getUserCount() === 0` (initial install with a non-empty passphrase checked with `crypto.timingSafeEqual`) or an already-logged-in admin is creating the user.
  2. In `installApp`, wrap the backend `fetch` in a `try/catch` that deletes the user from `users.db` if the backend call fails, so setup can be retried cleanly.

---

### 1.4 [FIXED] Sign-In Redirect Can Send Users to Scammer Websites or Run JavaScript (Open Redirect & XSS)

- **Where**:
  - [sign-in/page.tsx](file:///Users/david/prj/asterism/apps/frontend/src/app/(auth)/sign-in/page.tsx#L8-L10)
  - [auth-form.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/auth/components/auth-form.tsx#L50-L93)
  - [proxy.ts](file:///Users/david/prj/asterism/apps/frontend/src/proxy.ts#L39-L54)
- **What the problem is**:
  When you log in at `/sign-in?redirect=...`, the login form checks `referer && !referer.includes("sign-in")` and then runs `window.location.href = safeRedirect`. It never checks whether `redirect` is actually a page on *this* site! Worse, line 72 passes the unchecked `referer` directly to `callbackURL`. Additionally, [proxy.ts](file:///Users/david/prj/asterism/apps/frontend/src/proxy.ts#L39-L41) builds redirect URLs using `x-forwarded-host` and `x-forwarded-proto` headers directly from the incoming request without checking if they match your server's real hostname.
- **What it affects**:
  If a user clicks a link like `/sign-in?redirect=https://evil-phishing-site.com` or `/sign-in?redirect=javascript:alert(1)`, as soon as they type their password and log in, the browser either executes the `javascript:` code on your app's domain (stealing data) or sends them straight to the attacker's site.
- **What the fix is**:
  1. Only allow `redirect` values that start with a single `/` and do not start with `//`:
     `const isSafePath = (p?: string) => Boolean(p && p.startsWith("/") && !p.startsWith("//") && !p.includes("/sign-in"));`
  2. In [proxy.ts](file:///Users/david/prj/asterism/apps/frontend/src/proxy.ts#L39-L41), use the validated `getFrontendServerConfig().publicUrl` (or `request.nextUrl.clone()`) instead of trusting raw `x-forwarded-host` headers.

---

### 1.5 [FIXED] Any Logged-In User Can Broadcast Fake Live Events to All Other Users

- **Where**:
  - [api/stream/route.ts](file:///Users/david/prj/asterism/apps/frontend/src/app/api/stream/route.ts#L30-L50) and [api/stream/route.ts](file:///Users/david/prj/asterism/apps/frontend/src/app/api/stream/route.ts#L91-L95)
  - [use-publish-global-event.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/sse/hooks/use-publish-global-event.ts#L17-L21)
  - [rate-limiter.ts](file:///Users/david/prj/asterism/apps/frontend/src/lib/rate-limiter.ts#L6-L19)
- **What the problem is**:
  The live event stream (`POST /api/stream`) is like a building-wide PA system. Only the backend server (using `X-System-Key`) should be allowed to make announcements for any user. However, `POST /api/stream` also lets **any normal logged-in user** post announcements—and lets them specify any `userId` (or leave `userId` blank, which broadcasts the message to **every user on the platform**!).
  On top of that:
  - The client hook [use-publish-global-event.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/sse/hooks/use-publish-global-event.ts#L19) sends `user_id` (with an underscore), while the server expects `userId` (camelCase), so Zod throws `user_id` away and accidentally broadcasts to everyone!
  - The rate limiter trusts the `x-forwarded-for` header, which anyone can fake with a random string on every request (bypassing the limit and filling up server memory in the `clients` Map).
  - There is a hard limit of 50 total SSE connections across the entire server (`MAX_SSE_LISTENERS = 50`), meaning one user opening 50 browser tabs blocks live updates for every other user on the site.
- **What it affects**:
  One user can force every other user's browser to refetch data or overwrite chat titles in their sidebar, or block everyone else's live stream connection.
- **What the fix is**:
  1. Require `X-System-Key` (compared via `crypto.timingSafeEqual`) for `POST /api/stream`, or if client publishing is kept, force `userId = session.user.id` on the server.
  2. Enforce a per-user SSE connection cap instead of a tiny 50-connection global cap.
  3. Wrap `await req.json()` in `try/catch` so invalid JSON returns `400` instead of crashing with `500`.

---

### 1.6 [FIXED] Password Rules Check for Uppercase and Lowercase Using a "Case-Insensitive" Flag

- **Where**: [schemas.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/auth/schemas.ts#L11-L23)
- **What the problem is**:
  The password validator tries to check for a lowercase letter (`/[a-z]/i`) and an uppercase letter (`/[A-Z]/i`), but both regular expressions have the `i` flag at the end. In regex, `i` means **"ignore case"**! That's like a bouncer checking if you're wearing a red shirt while wearing colorblind glasses that make red and green look identical.
- **What it affects**:
  A password with **all lowercase** letters passes the "must contain uppercase" check, and a password with **all uppercase** letters passes the "must contain lowercase" check.
- **What the fix is**:
  Remove the `i` flag from both checks: `/[a-z]/.test(data)` and `/[A-Z]/.test(data)`.

---

### 1.7 [FIXED] Tool API Keys Are Sent Back to the Browser in Plain Text & Stored Unencrypted

- **Where**:
  - [models.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/settings/models.py#L43-L46) (`ProviderModel.api_key`)
  - [schemas.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/settings/schemas.py#L109-L111) (`ComponentProviderParameters.parameters`)
  - [service.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/settings/service.py#L544-L669) (`get_app_settings`, `upsert_app_setting`)
  - [tool_settings.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/settings/tool_settings.py#L21-L51) (`get_tool_settings`, `update_tool_settings`)
- **What the problem is**:
  For LLM providers (like OpenAI), the backend hides the secret API key when sending settings to the browser and only says `has_api_key: true`. However, for tool providers (like Brave Search API keys in `web_search_provider` / `image_search_provider`) and in `PUT /settings/app/llm_providers`, the backend returns the **actual secret API keys in plain text** in the HTTP response! Also, all API keys are stored in plain text in the SQLite database file.
- **What it affects**:
  Anyone inspecting network responses on an admin session (or reading `GET /settings/app/tools`) can read the saved Brave/tool API keys directly, and any database backup exposes all keys in plain text.
- **What the fix is**:
  Never return saved secret parameters in `GET /settings/app/tools` or `PUT /settings/app/{key}` responses (use write-only secret inputs + `has_api_key` indicators), and encrypt secret keys at rest using a server key.

---

### 1.8 [FIXED] Broken Login Tokens Can Authenticate as User `"None"` or Crash the Server with a 500 Error

- **Where**: [security.py](file:///Users/david/prj/asterism/apps/backend/asterism/core/security.py#L25-L48) (`verify_jwks_token`)
- **What the problem is**:
  When checking a user's JWT login token, the backend writes:
  ```python
  id=str(payload.get("sub")),
  email=str(payload.get("email")),
  name=str(payload.get("name")),
  role=cast(Literal["user", "admin"], payload.get("role")),
  ```
  In Python, if `payload.get("sub")` is missing (`None`), `str(None)` doesn't fail—it turns it into the 4-letter word `"None"`! And if `role` is missing or invalid, Pydantic throws a `ValidationError`, which `verify_jwks_token` doesn't catch (it only catches `jwt.PyJWTError`).
- **What it affects**:
  A token missing a `sub` claim would log in as a shared user whose ID is literally `"None"`, and a token with a missing/unexpected `role` crashes the request with a `500 Internal Server Error` instead of returning `401 Unauthorized`.
- **What the fix is**:
  Explicitly check that `sub`, `email`, and `name` are non-empty strings and `role in ("user", "admin")` before constructing `AuthedUser`, and catch `ValidationError` to raise `UnauthorizedException`.

---

### 1.9 [FIXED] Untyped App Settings Endpoints Can Corrupt the Whole App's Configuration

- **Where**:
  - [service.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/settings/service.py#L593-L700) (`upsert_app_setting`, `bulk_update_app_setting`, `delete_app_setting`)
  - [settings_router.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/settings/settings_router.py#L333-L348) and [settings_router.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/settings/settings_router.py#L402-L435)
- **What the problem is**:
  The backend has safe, schema-checked endpoints for updating tools, providers, and knowledge settings. But it also leaves open generic `PUT /settings/app/{key}`, `PATCH /settings/app`, and `DELETE /settings/app/{key}` endpoints that write **any** JSON into the `app_settings` table without checking if it matches `AppSettings` or `ToolSettings`. Worse, updating `llm_providers` through those generic routes skips the check (`ensure_captioning_selection_is_valid`) that ensures the image-captioning model still exists.
- **What it affects**:
  Saving a malformed value through those endpoints breaks `get_app_settings()` and `get_tool_settings()` with a `ValidationError`, crashing chat and settings across the whole app until the database is manually repaired.
- **What the fix is**:
  Remove the untyped `/settings/app/{key}` and `PATCH /settings/app` routes (or validate every write against `AppSettings` and run `ensure_captioning_selection_is_valid`).

---

### 1.10 [FIXED] Other Security Tightening Needed

- **Server-only helper files marked with `"use server"`**:
  - **Where**: [api-server.ts](file:///Users/david/prj/asterism/apps/frontend/src/lib/api-server.ts#L1-L22) and `getCurrentUser` / `getUserCount` in [features/auth/server/actions.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/auth/server/actions.ts#L52-L81).
  - **Problem**: Marking helper files with `"use server"` exposes internal server functions (`getApiClient`, `getClient`, `getUserCount`) as public HTTP POST endpoints.
  - **Fix**: Replace `"use server"` with `import "server-only";` in [api-server.ts](file:///Users/david/prj/asterism/apps/frontend/src/lib/api-server.ts), and move `getCurrentUser` and `getUserCount` into a `server-only` file.
- **WebSocket JWT in URL Query String & Never Refreshed**:
  - **Where**: [backend-url.ts](file:///Users/david/prj/asterism/apps/frontend/src/lib/backend-url.ts#L8-L17), [c/[chatId]/page.tsx](file:///Users/david/prj/asterism/apps/frontend/src/app/(main)/c/[chatId]/page.tsx#L20-L28), [use-chat-websocket.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/hooks/use-chat-websocket.tsx#L89-L92), and [chat/router.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/router.py#L87).
  - **Problem**: The user's secret JWT login token is placed in the WebSocket URL (`?token=...`), which gets written into server and proxy logs. Furthermore, the token is created once when the page loads—if the chat tab stays open until the token expires and the WebSocket reconnects, it reuses the expired token and fails.
  - **Fix**: Fetch a fresh token via `authClient.token()` on reconnect and pass authentication via the first WebSocket message or `Sec-WebSocket-Protocol` instead of the URL query string.
- **Non-Constant-Time Secret Check & 422 Input Reflection**:
  - **Where**: [user/router.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/user/router.py#L30) and [main.py](file:///Users/david/prj/asterism/apps/backend/asterism/main.py#L109-L124).
  - **Problem**: `payload.system_key == config.system_key` uses `==` instead of `hmac.compare_digest` on an unauthenticated endpoint that can create admin users, and `validation_exception_handler` echoes raw `error['input']` (which can contain secrets or huge payloads) back in 422 error responses.
  - **Fix**: Use `hmac.compare_digest` and remove `: {error['input']}` from 422 validation error strings.
- **"Zip Bomb" Images Can Freeze the Server**:
  - **Where**: [images.py](file:///Users/david/prj/asterism/apps/backend/asterism/common/images.py#L7-L25) (`generate_thumbnail`).
  - **Problem**: A tiny image file with huge pixel dimensions raises `PIL.Image.DecompressionBombError` (which is not caught by `except (UnidentifiedImageError, OSError):`) and runs synchronously on the main event loop thread.
  - **Fix**: Catch `Image.DecompressionBombError`, set a reasonable `Image.MAX_IMAGE_PIXELS`, and run `generate_thumbnail` inside `asyncio.to_thread`.

---

## 2. General Problems & Bugs (Broken Features, Crashes & Performance)

### 2.1 [FIXED] Brave Web Search Always Crashes With "Division by Zero"

- **Where**: [web_search.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/components/builtin/web_search.py#L58-L69) (`BraveWebSearchProvider.search`)
- **What the problem is**:
  When Brave Search returns results, the code loops through them starting at `index = 0` (`for index, result in enumerate(results):`) and calculates `relevance_score = 1 / index`. On the very first result (`index = 0`), it computes `1 / 0`, which immediately crashes with `ZeroDivisionError`! Right below that, it also runs `await asyncio.sleep(1)` outside of any loop, adding a pointless 1-second delay.
- **What it affects**:
  Brave Web Search is 100% broken whenever it finds at least one search result.
- **What the fix is**:
  Change `1 / index` to `1 / (index + 1)` (or `enumerate(results, start=1)`) and delete the stray `await asyncio.sleep(1)` and `page += 1` at the end of the function.

---

### 2.2 [FIXED] Captioned Images Are Never Marked as "Ready", So Knowledge Search Ignores Them

- **Where**:
  - [ingestion.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/extraction/ingestion.py#L216) (`_ingest_image`)
  - [captioning.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/extraction/captioning.py#L267-L289) (`ImageCaptioningCoordinator.caption`)
  - [retrieval/service.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/retrieval/service.py#L26-L27) (`RetrievalArtifact.ready`)
- **What the problem is**:
  When you upload an image, `text_embeddings_ready` starts out as `False`. Later, the background captioning worker generates a text description of the image, converts that description into a searchable vector, and saves it into LanceDB. However, the worker **forgets to flip `artifact.text_embeddings_ready = True`**! When the AI later tries to search your files (`RetrievalService.search`), it checks `artifact.ready` (which requires `text_embeddings_ready == True`), assumes the image still isn't ready, and skips it!
- **What it affects**:
  Image captions stored in the vector database cannot be searched by `search_knowledge` on image-only scopes—the tool always thinks your uploaded images are "unavailable."
- **What the fix is**:
  Set `artifact.text_embeddings_ready = True` in [captioning.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/extraction/captioning.py#L282) right after saving the caption's text embedding to `self.vectors`.

---

### 2.3 [FIXED] The Agent Can Get Stuck Talking to Itself 15 Times in a Row

- **Where**: [agent.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/agent/agent.py#L461-L562) (`Agent._run`)
- **What the problem is**:
  The agent runs inside a loop (`for step in range(self.max_steps):`, up to 15 steps) so that if the AI calls a tool, it can run the tool and ask the AI to continue. When the AI finishes talking *without* calling any tools, line 561 checks:
  ```python
  if event.finish_reason == "stop":
      return
  ```
  Wait—what if the AI finished without calling any tools, but its `finish_reason` was `"length"` (it hit the token limit), `"content_filter"`, or `None` (which many local model servers like Ollama or vLLM send)? Because `finish_reason` isn't literally `"stop"`, the loop **doesn't stop**! It sends the conversation right back to the AI again and again, up to 15 times in a row for a single user message!
- **What it affects**:
  Runaway AI loops, wasted tokens, slow responses, and 15 back-to-back assistant replies when using local models or hitting token limits.
- **What the fix is**:
  When the AI response has no tool calls (`not event.has_tool_calls()`), always `return` at line 561 regardless of what `finish_reason` string the model provider sent.

---

### 2.4 [FIXED] Web Fetch Ignores 404/500 Errors and Launches a Full Chrome Browser on Error Pages

- **Where**: [fetch.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/tools/builtin/fetch.py#L103-L105) and [fetch.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/tools/builtin/fetch.py#L151-L167) (`fetch_page`, `_js_site_fetch`)
- **What the problem is**:
  Line 151 writes `response.raise_for_status` **without parentheses `()`**! In Python, leaving off `()` means the function is never actually called—it does nothing at all. So when a website returns `404 Not Found` or `500 Server Error` with a short error message like `"404 Not Found"`, `fetch_page` doesn't realize it failed. Instead, it sees that the page text is under 250 characters, assumes it must be a fancy JavaScript app, and launches headless Chrome (`_js_site_fetch`) to load the 404 page again! And inside `_js_site_fetch`, if `page.goto()` returns `None`, line 105 crashes with `AttributeError: 'NoneType' object has no attribute 'headers'`.
- **What it affects**:
  Broken web fetches waste seconds launching Chrome on dead links and feed 404 error text to the AI as if it were the real webpage content.
- **What the fix is**:
  Add the missing parentheses `response.raise_for_status()` on line 151, and check `if response is None:` in `_js_site_fetch`.

---

### 2.5 [FIXED] Starting a Live Chat Stream Immediately Wipes Out the Streaming Bubble & Jumps Scroll

- **Where**: [chat-session.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/chat-session.tsx#L107-L118) and [chat-session.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/chat-session.tsx#L128-L165)
- **What the problem is**:
  In `ChatSession`, a `useEffect` watches `[session, setSession]` so it can reset state when you open a chat:
  ```tsx
  useEffect(() => {
    if (session && !sessionLoadedRef.current) {
      setIncomingMessage(null);
      scrollRef.current?.scrollIntoView({ behavior: "instant" });
      sessionLoadedRef.current = true;
    }
    return () => {
      sessionLoadedRef.current = false;
    };
  }, [session, setSession]);
  ```
  Notice the cleanup function: every time the `session` object changes in React Query's cache, React runs the cleanup (`sessionLoadedRef.current = false`) and then immediately runs the `if` block (`setIncomingMessage(null)`)!
  When does `session` change? Right when the AI starts streaming (`onStreamStart` updates the cache to mark your user message `"completed"`) and right when the chat's title updates via SSE! So right as the AI starts replying (or when the title updates mid-stream), this effect wipes out `incomingMessage` and yanks your scroll position!
- **What it affects**:
  Flickering/disappearing streaming bubbles and sudden scroll jumps while a response is streaming.
- **What the fix is**:
  Track the current chat's ID (`loadedSessionIdRef.current !== session.id`) instead of resetting a boolean to `false` on every cache update.

---

### 2.6 [FIXED] The 50ms Streaming Throttle Is Bypassed on Every Token (`delta`)

- **Where**: [use-chat-websocket.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/hooks/use-chat-websocket.tsx#L94-L102) and [use-chat-websocket.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/hooks/use-chat-websocket.tsx#L169-L232)
- **What the problem is**:
  Someone wrote a nice `scheduleFlush()` helper to batch incoming AI words so React only re-renders 20 times per second (every 50ms) instead of hundreds of times per second. They used `scheduleFlush()` on the `"start"` event... and then forgot to use it on `"delta"` (the event that actually fires for every single word/token)! Instead, `"delta"` calls `onStreamUpdateRef.current?.(streamingMessageRef.current)` directly on every token. Meanwhile, `sub_agent_start`, `sub_agent_delta`, and `sub_agent_end` don't call either one!
- **What it affects**:
  High CPU usage and UI lag during fast streaming because React re-renders and re-parses the entire Markdown document on every single token, while sub-agent updates sit stuck in memory until the next main event arrives.
- **What the fix is**:
  Call `scheduleFlush()` in `delta`, `sub_agent_start`, `sub_agent_delta`, and `sub_agent_end`.

---

### 2.7 [FIXED] Clicking Inside "Thinking" or Tool Output to Copy Text Immediately Closes the Box

- **Where**: [chat-session.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/chat-session.tsx#L641-L674) (`MessageItem`)
- **What the problem is**:
  The expandable "Thinking" / Tool Calls section puts `onClick={(e) => { e.preventDefault(); setShowThinking(prev => !prev); }}` on the outer `<details>` wrapper instead of on the `<summary>` header bar. Because every click inside the expanded content bubbles up to `<details>`, clicking anywhere inside the thinking text or trying to highlight/copy tool output immediately collapses the box!
- **What it affects**:
  Users cannot click or select text inside expanded thinking blocks or tool call results.
- **What the fix is**:
  Use the shared shadcn `<Collapsible>`, `<CollapsibleTrigger>`, and `<CollapsibleContent>` components (or put the `onClick` handler only on `<summary>`).

---

### 2.8 [FIXED] New Users Without a Saved Font Size Can Get Stuck in an Infinite Page-Refresh Loop

- **Where**:
  - [theme-check.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/dashboard/components/theme-check.tsx#L23-L28)
  - [theme-context.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/theme/components/theme-context.tsx#L80-L103)
  - [font-size-selector.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/settings/font-size-selector.tsx#L32)
  - [theme-selector.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/settings/theme-selector.tsx#L35)
- **What the problem is**:
  In `ThemeCheck`:
  ```ts
  const desiredTheme = user.settings.theme ?? DEFAULT_THEME;
  if (desiredTheme !== currentTheme || user.settings.font_size !== fontSize) {
    setTheme(desiredTheme);
    setFontSize(user.settings.font_size ?? DEFAULT_FONT_SIZE);
    router.refresh();
  }
  ```
  Look closely at `user.settings.font_size !== fontSize`. When a user hasn't explicitly saved a font size in the database yet, `user.settings.font_size` is `undefined`, while the cookie `fontSize` is `"medium"`. Because `undefined !== "medium"` is **always true**, every render calls `setFontSize("medium")` and `router.refresh()`, over and over in an infinite loop! Also, `FontSizeSelector` and `ThemeSelector` use `defaultValue={value}` instead of `value={value}`, so they don't stay in sync if the value changes.
- **What it affects**:
  Endless `router.refresh()` calls on every render when `user.settings.font_size` is unset, plus double refreshes when changing themes.
- **What the fix is**:
  Define `const desiredFontSize = user.settings.font_size ?? DEFAULT_FONT_SIZE;` and compare `desiredFontSize !== fontSize`. Also change `defaultValue={value}` to `value={value}` in `FontSizeSelector` and `ThemeSelector`.

---

### 2.9 [FIXED] Opening a Chat Re-Reads and Re-Hashes Every Attached File From Disk (and Every Request Commits to SQLite)

- **Where**:
  - [processor.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/files/processor.py#L67-L86) (`MarkItDownFileProcessor.ensure_processed`)
  - [orchestrator.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/orchestrator.py#L281-L375) (`_build_agent_messages`, `estimate_context_usage`)
  - [user/service.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/user/service.py#L47-L69) (`ensure_user`, `initialize_user_settings`)
- **What the problem is**:
  Two separate backend bottlenecks slow down every request:
  1. **Re-hashing files on every read**: In `ensure_processed()`, the code calculates the SHA-256 hash of the entire file from disk on lines 67–68 *before* checking `if file.content_status is not FileContentStatus.PENDING: return file` on line 85! And when you simply open a chat (`GET /chat/{chat_id}`), the backend estimates token usage by loading every message and attachment—which re-hashes every attached file from disk and base64-encodes every attached image into RAM just to count how many images there are!
  2. **Database `COMMIT` on every single API request**: `get_current_user` calls `ensure_user()` on every authenticated API call. Even when the user is already in `_user_cache`, `ensure_user()` still calls `initialize_user_settings()`, which runs a `SELECT` on `agent_profiles` and a `await session.commit()` on every single GET/POST request!
- **What it affects**:
  Slow chat loading, heavy disk reads, high memory spikes on chats with images/PDFs, and unnecessary SQLite write locks on every API request.
- **What the fix is**:
  1. In `ensure_processed()`, check `if file.content_status is not FileContentStatus.PENDING and file.sha256: return file` at the very top of the function before hashing the file.
  2. In `ensure_user()`, return immediately when the user is already in `_user_cache`.

---

### 2.10 [FIXED] Other Backend & Frontend Bugs that Cause Crashes or Broken Behavior

- **Chat crashes if any message or file contains `<|endoftext|>`**:
  - **Where**: [token_counting.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/llm/token_counting.py#L29) (`estimate_text_tokens`).
  - **Problem**: `tiktoken` is called with default settings, which throws a `ValueError` if the text contains special strings like `<|endoftext|>` (common in AI papers, code, or logs). Opening a chat with that string crashes `GET /chat/{chat_id}` with a 500 error.
  - **Fix**: Pass `disallowed_special=()` to `.encode(text, disallowed_special=())`.
- **"Always Allow" checkbox on tool approval silently does nothing**:
  - **Where**: [orchestrator.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/orchestrator.py#L278-L279) (`save_always_allow_preference`).
  - **Problem**: When a user checks "Always allow" for a tool, the frontend sends `always_allow: true`, the backend spawns a background task calling `save_always_allow_preference(tool_id)`, and that method's body is literally just `pass`!
  - **Fix**: Implement saving the preference or hide the "Always allow" checkbox in the UI until implemented.
- **Deleting a chat leaves a ghost `(NULL, NULL, '', '')` row in the search index**:
  - **Where**: [search_index.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/search_index.py#L42-L47) (`chat_search_messages_ad`).
  - **Problem**: The SQLite `AFTER DELETE ON messages` trigger runs `INSERT INTO chat_search SELECT chats.id, ..., group_concat(...) FROM chats ... WHERE chats.id = old.chat_id` without a `GROUP BY chats.id`. In SQL, a `SELECT` with an aggregate (`group_concat`) and no `GROUP BY` **always returns 1 row of `NULL`s** even when 0 rows match `WHERE`! So deleting a chat inserts a ghost `(NULL, NULL, '', '')` row into `chat_search`.
  - **Fix**: Add `GROUP BY chats.id` to all `SELECT ... group_concat(...)` trigger queries in [search_index.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/search_index.py#L28-L47).
- **Streamed tool calls break or crash on several OpenAI-compatible providers**:
  - **Where**: [llm/client.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/llm/client.py#L181-L272) (`StreamHandler`) and [retries.py](file:///Users/david/prj/asterism/apps/backend/asterism/common/retries.py#L41-L77) (`retry_async_gen`).
  - **Problem**: If an OpenAI-compatible server includes `tc_chunk.id` on every streamed argument chunk, line 262 resets `self.tool_calls_dict[idx]` to empty strings, wiping out the tool's name and arguments! If a stream fails halfway through, `@retry_async_gen` retries using the same `StreamHandler`, gluing the new response onto the half-finished old response. And if the model hallucinates a tool name via `<tool_call>` text tags, [registry.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/tools/registry.py#L189) crashes with `KeyError`.
  - **Fix**: Use `setdefault` in `StreamHandler._handle_chunk`, instantiate `StreamHandler` inside the retry function (only retrying before the first token is sent), and use `self.registry.get(...)` in `ToolRegistry.invoke_tool`.
- **`PATCH /chat/{chat_id}/message/{message_id}` crashes if `tool_results` is sent**:
  - **Where**: [chat/schemas.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/schemas.py#L115) and [chat/service.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/service.py#L102-L108).
  - **Problem**: The request schema calls the field `tool_results`, while the database table column is named `tool_call_results`, causing a SQLAlchemy `CompileError`. It also doesn't check `chat_jobs.guard_idle_change(chat_id)`.
  - **Fix**: Align the field name to `tool_call_results` (or remove it from `UpdateMessageRequest`) and wrap `update_message` in `chat_jobs.guard_idle_change(chat_id)`.
- **Refreshing provider models crashes with 500 if a sub-agent uses a removed model**:
  - **Where**: [settings/service.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/settings/service.py#L478-L500) (`replace_provider_models`).
  - **Problem**: Unlike `delete_provider`, `replace_provider_models` doesn't catch `IntegrityError` when SQLite refuses to delete a model that a sub-agent is bound to.
  - **Fix**: Catch `IntegrityError` and return a friendly `409 Conflict` message (or mark the model inactive instead of deleting it).
- **Clicking an image to zoom in shows the tiny blurry thumbnail instead of the full image**:
  - **Where**: [api-image.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/api-image.tsx#L139-L143).
  - **Problem**: The zoom modal `<DialogContent>` renders `<img src={data.thumbnail} />`—the exact same low-res thumbnail you just clicked on!
  - **Fix**: Load the full image via `fileDownloadFile` when the zoom dialog is opened.
- **Live updates (`SharedWorker`) don't work on iPhones/iPads or Android Chrome, and loop on `/sign-in`**:
  - **Where**: [worker-provider.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/sse/components/worker-provider.tsx#L14-L18), [providers.tsx](file:///Users/david/prj/asterism/apps/frontend/src/app/providers.tsx#L27), and [sse-worker.js](file:///Users/david/prj/asterism/apps/frontend/public/sse-worker.js#L4-L22).
  - **Problem**: Mobile browsers don't support `SharedWorker`, so `if (typeof SharedWorker === "undefined") return;` disables all live SSE events on mobile. Also, `WorkerProvider` runs on `/sign-in` before login, failing with 401 every 2 seconds in an endless loop.
  - **Fix**: Mount `WorkerProvider` inside the authenticated dashboard layout and fall back to a regular `EventSource("/api/stream")` when `SharedWorker` isn't supported.
- **Sidebar drag-resizer lets you widen the sidebar past 300px, then refuses to let you shrink it back to default (256px)**:
  - **Where**: [sidebar.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/ui/sidebar.tsx#L190-L192).
  - **Problem**: Line 190 clamps the drag width between `200` and `500`, and then line 191 checks `if (newWidth >= 300)`—blocking you from ever dragging it narrower than `300px`!
  - **Fix**: Remove the `if (newWidth >= 300)` check on line 191.

---

## 3. Frontend Inconsistencies (UI, Styling & Component Rules)

### 3.1 [FIXED] Hand-Rolled HTML Widgets Instead of Shared `shadcn/ui` Components

- **Where**:
  - [model-selector.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/settings/model-selector.tsx#L1-L197) vs. [chat-model-picker.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/chat-model-picker.tsx#L25-L106)
  - [captioning-settings.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/settings/ui/admin-settings/captioning-settings.tsx#L118-L145)
  - [chat-session.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/chat-session.tsx#L641-L674) and [sub-agent-activity.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/sub-agent-activity.tsx#L63-L69)
  - [nav-chat-sessions.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/dashboard/components/nav-chat-sessions.tsx#L174)
  - [api-download.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/api-download.tsx#L65-L73)
- **What the problem is**:
  The project rules (`AGENTS.md` §3.2) state that UI controls should use shared `shadcn/ui` components so everything looks, behaves, and works with keyboards consistently. However:
  - `ChatModelPicker` uses the clean shadcn `<Select>`, while `ModelSelector` in Settings is a 197-line custom dropdown built from scratch with raw `<button>` tags, manual window scroll listeners, and hardcoded `z-400` / `z-1000` layers—and it doesn't support keyboard arrow keys or `Escape`!
  - `CaptioningSettings` uses raw `<fieldset>`, `<legend>`, and `<input type="radio">` instead of the shared shadcn field/select components.
  - Thinking and Sub-Agent panels use raw `<details>`/`<summary>` instead of shadcn `<Collapsible>`.
  - `APIDownload` uses `<a href="#" onClick={...}>` instead of `<Button variant="link">`.
- **What it affects**:
  Inconsistent look and feel, broken keyboard navigation in settings dropdowns, and duplicated UI code.
- **What the fix is**:
  Replace `ModelSelector` with shadcn `<Select>` (like `ChatModelPicker`), use `<Collapsible>` for thinking/sub-agent drawers, and use shadcn `<FieldSet>`/`<Label>`/`<Button>` across settings and download links.

---

### 3.2 [FIXED] Five Components Import the Wrong `cn` Package, Breaking Tailwind Style Overrides

- **Where**:
  - [card.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/ui/card.tsx#L1)
  - [input-group.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/ui/input-group.tsx#L5)
  - [file-list.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/file-manager/file-list.tsx#L10)
  - [upload-file-drop-zone.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/file-manager/upload-file-drop-zone.tsx#L6)
  - [model-selector.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/settings/model-selector.tsx#L6)
- **What the problem is**:
  In a shadcn/Tailwind codebase, `import { cn } from "@/lib/utils"` combines class names *and* resolves conflicts (so passing `p-0` to a `<Card>` removes its default `p-6`). However, these 5 files accidentally write `import { cn } from "cn";`—which imports a tiny unrelated npm package that does **not** merge Tailwind classes! Also, [use-update-user-settings.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/settings/hooks/use-update-user-settings.ts#L7) imports `{ client } from "@/lib/client/client.gen"` instead of the configured `{ client } from "@/lib/api"`.
- **What it affects**:
  Passing custom padding, background, or border classes to `<Card>`, `<InputGroup>`, or `<FileList>` results in both classes fighting each other in CSS instead of cleanly overriding.
- **What the fix is**:
  Change all 5 imports to `import { cn } from "@/lib/utils"`, remove the `"cn"` package from `apps/frontend/package.json`, and import `{ client } from "@/lib/api"` in `use-update-user-settings.ts`.

---

### 3.3 [FIXED] Every Screen Handles Loading and Errors Differently (and Chat Errors Lock Up the Whole Chat)

- **Where**:
  - [query-error.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/query-error.tsx#L1-L40)
  - [agents-settings.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/settings/ui/user-settings/agents-settings.tsx#L261-L281)
  - [providers-tab.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/settings/ui/admin-settings/providers-tab.tsx#L369-L373)
  - [chat-session.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/chat-session.tsx#L290-L301)
- **What the problem is**:
  - **Errors**: The app has a shared `<QueryError>` component with a Retry button. Yet `agents-settings.tsx` builds its own `QueryFailure` component, `agent-profile-form.tsx` builds inline `<Empty role="alert">` blocks, `providers-tab.tsx` and `tools-settings.tsx` render plain red text *with no Retry button at all*, and `chat-session.tsx` replaces the **entire chat history** with a dead-end error box if `socketError` is set (forcing you to refresh the browser to see your chat again).
  - **Loading**: Some screens use `<Spinner loadingMessage="..." />`, others use `<AdminPaneLoading />`, and others render plain unstyled `<p>Loading…</p>` text.
- **What it affects**:
  Jarring visual jumps when switching tabs, no way to retry failed loads in Admin Settings without refreshing the whole page, and losing sight of your entire conversation if a single WebSocket error occurs.
- **What the fix is**:
  Standardize on `<QueryError>` and `<Spinner>` across all settings tabs, and show `socketError` as a dismissible banner above the chat input instead of hiding the entire chat history.

---

### 3.4 [FIXED] Global CSS Rule Breaks Badges/Code Inside Even Table Rows, Plus Typos & Fake Admin Tabs

- **Where**:
  - [globals.css](file:///Users/david/prj/asterism/apps/frontend/src/app/globals.css#L106)
  - [nav-profile-selector.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/dashboard/components/nav-profile-selector.tsx#L21)
  - [lazy-sections.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/settings/ui/admin-settings/lazy-sections.tsx#L108-L157)
  - [setttings-card.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/settings/ui/setttings-card.tsx)
- **What the problem is**:
  1. **Broken table styling**: [globals.css](file:///Users/david/prj/asterism/apps/frontend/src/app/globals.css#L106) has `tr:nth-child(even) * { @apply bg-accent text-accent-foreground; }`. Because of the `*` (everything inside), every `<code>`, `<Badge>`, link, or button inside an even-numbered table row has its background and text color forcefully overwritten!
  2. **Placeholder Admin tabs**: Five tabs in Admin Settings (*Groups*, *Users*, *Image Generation*, *Code Exection*, *Export*) are clickable in the sidebar but only show 1-sentence placeholder text (`<div>Groups Settings</div>`).
  3. **Typos**: `"Code Exection"` (missing `u`), `setttings-card.tsx` (three `t`s), `--font-monsterrat` (Montserrat), `"curiousity"` in [layout.tsx](file:///Users/david/prj/asterism/apps/frontend/src/app/layout.tsx#L30), and `text-primary-foreground-foreground` (double `-foreground`).
- **What it affects**:
  Broken styling inside Markdown tables, confusing non-functional tabs in Admin Settings, and easy-to-miss naming typos.
- **What the fix is**:
  Remove `*` from `tr:nth-child(even)` in `globals.css`, hide or explicitly badge unfinished Admin Settings tabs (tracked in `US-35.1`), and fix the spelling typos.

---

## 4. Code Smells (Messy Patterns, Hidden Traps & N+1 Queries)

### 4.1 [FIXED] Opening the File Manager Fires Up to 101 Separate Requests at Once (N+1 Query Storm)

- **Where**:
  - [file-list.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/file-manager/file-list.tsx#L104-L111) and [file-list.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/file-manager/file-list.tsx#L191-L195)
  - [api-image.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/api-image.tsx#L44-L49)
  - [knowledge-status.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/file-manager/knowledge-status.tsx#L50-L55)
- **What the problem is**:
  Imagine asking a librarian for a list of 50 books, and the librarian hands you a sheet that *already includes* each book's cover picture (`file.thumbnail`). Instead of looking at that sheet, for every single book on the list you walk back up to the desk 50 separate times to ask *"What is the cover picture for book #1?"* (`GET /files/info/{filename}`) and 50 more times to ask *"What is the indexing status for book #1?"* (`GET /files/knowledge/{filename}`).
- **What it affects**:
  Opening a page of 50 files in the File Manager triggers up to **101 simultaneous HTTP requests** (plus 101 database commits because of §2.9!), making the File Manager sluggish and flooding the backend.
- **What the fix is**:
  Pass `file.thumbnail` directly into `<APIImage>` when `FileList` already has it, and include knowledge status in the `GET /files/` list response (or batch-fetch statuses in one request).

---

### 4.2 [FIXED] Every Page Load Sends a `POST` Request to Update Your Timezone

- **Where**:
  - [features/auth/server/actions.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/auth/server/actions.ts#L66-L72) (`getCurrentUser`)
  - [update-timezone.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/dashboard/components/update-timezone.tsx#L6-L20) (`UpdateTimeZone`)
- **What the problem is**:
  When `getCurrentUser()` builds the `User` object on the server, it forgets to include `timezone: session.user.timezone` and uses `as User` to silence TypeScript. Then, in the browser, `<UpdateTimeZone>` checks `if (user.timezone !== userTimezone)`. Since `user.timezone` is always `undefined`, that check is **always true**, so the browser sends a `POST` request to `authClient.updateUser({ timezone })` on every single page load and refresh!
- **What it affects**:
  Wasted network requests and database writes to `users.db` on every single navigation/refresh.
- **What the fix is**:
  Include `timezone: session.user.timezone ?? undefined` in `getCurrentUser()` and remove the unsafe `as User` cast.

---

### 4.3 [FIXED] Defining `<Dialog>` Inside `useConfirmationDialog` Destroys and Recreates the Modal on Every Render

- **Where**: [confirmation-dialog.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/confirmation-dialog.tsx#L46-L67)
- **What the problem is**:
  Inside `useConfirmationDialog()`, the code defines `const Dialog = () => (<AlertDialog ... />)`. In React, defining a component function *inside* another function means React sees `Dialog` as a brand-new component type on every single render of the parent component, unmounting the old dialog and mounting a fresh one from scratch.
- **What it affects**:
  Broken dialog animations, lost keyboard focus state, and unnecessary DOM recreation across `NavChatSessions`, `NavProjects`, `FileList`, `AgentsSettings`, and `ProvidersTab`.
- **What the fix is**:
  Move `<ConfirmationDialog>` outside the hook as a normal top-level React component, or return the rendered JSX element directly instead of a component function.

---

### 4.4 [FIXED] Every Mutation Refetches Everything in the App (While Some Mutations Refetch Twice)

- **Where**:
  - [providers.tsx](file:///Users/david/prj/asterism/apps/frontend/src/app/providers.tsx#L12-L16)
  - [nav-chat-sessions.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/dashboard/components/nav-chat-sessions.tsx#L92-L94)
  - [use-chat-session-crud.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/hooks/use-chat-session-crud.ts#L25-L46)
  - [tools-settings.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/settings/ui/admin-settings/tools-settings.tsx#L41-L43)
- **What the problem is**:
  `providers.tsx` configures a global `MutationCache` that calls `queryClient.invalidateQueries()` (with no filter) after **every** mutation—meaning even uploading a draft file attachment refetches all user settings, models, projects, and chat lists across the whole app. Meanwhile, `nav-chat-sessions.tsx`, `use-chat-session-crud.ts`, and `tools-settings.tsx` *also* call `queryClient.invalidateQueries()` manually, causing double refetches (and violating `AGENTS.md` §3.2).
- **What it affects**:
  Unnecessary background network chatter every time any action is taken.
- **What the fix is**:
  Remove the duplicate manual `invalidateQueries` calls, and allow mutations to pass targeted invalidation keys or `meta: { skipGlobalInvalidation: true }`.

---

### 4.5 [FIXED] Starting One Chat Turn Queries the Entire Chat History 5+ Times in a Row

- **Where**:
  - [orchestrator.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/orchestrator.py#L401-L403) (`run_agent`)
  - [agent.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/agent/agent.py#L293-L336) (`prepare_execution`, `prepare_execution_scope`)
  - [prompt_composition.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/prompt_composition.py#L26-L46)
  - [tool_policy.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/tool_policy.py#L20-L88)
- **What the problem is**:
  When you send a single chat message, `run_agent` calls `prepare_execution`, which calls `build_prompt_snapshot` and `resolve_effective_tools`, and then calls `prepare_execution_scope`, and then calls `_build_agent_messages`. Every single one of those steps independently queries the database for `read_chat_scope_snapshot` and `read_project_scope_snapshot`—loading **all messages in the chat** from SQLite over and over again (5+ times for a single turn!).
- **What it affects**:
  Dozens of redundant database queries before the AI even starts generating its first word.
- **What the fix is**:
  Load `ChatScopeSnapshot` and `ProjectScopeSnapshot` once at the start of the turn and pass that snapshot object to the prompt composer, tool policy resolver, and message builder.

---

### 4.6 Other Backend & Frontend Code Smells

- **Webhooks and JWKS fetches block the main async event loop**:
  - **Where**: [events.py](file:///Users/david/prj/asterism/apps/backend/asterism/core/events.py#L54-L76) (`post_webhook`) and [security.py](file:///Users/david/prj/asterism/apps/backend/asterism/core/security.py#L35) (`verify_jwks_token`).
  - **Problem**: `post_webhook` uses synchronous `requests.post(url)` with **no timeout** directly on the async event loop. If a webhook server hangs, the entire backend freezes for all users.
  - **Fix**: Use `httpx.AsyncClient(timeout=5.0)` (or `asyncio.to_thread` with a timeout) for webhooks and JWKS key lookups.
- **WebSocket connections hold a database session open for hours & leak `AsyncOpenAI` clients**:
  - **Where**: [chat/router.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/router.py#L88-L130) and [llm/client.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/llm/client.py#L66-L290).
  - **Problem**: The WebSocket route injects `session: DBSessionDep`, keeping a SQLAlchemy session open for the entire time a chat tab is open, even though it's only used for the first 20ms during connection setup. Also, every `Agent` creates a new `AsyncOpenAI` HTTP connection pool and never closes it, and `llm_request_limiter` ([llm/client.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/llm/client.py#L66)) is defined but never actually used!
  - **Fix**: Open a short `async with get_async_db_session() as session:` block only for the WebSocket handshake, share/close `AsyncOpenAI` clients, and use `async with llm_request_limiter.acquire():` in `LLMClient`.
- **Model files (hundreds of MBs) are SHA-256 hashed synchronously when Python imports the module**:
  - **Where**: [model_download.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/extraction/model_download.py#L151-L166) and [extraction/runtime.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/extraction/runtime.py#L16-L21).
  - **Problem**: `ModelDownloadService` hashes every file in the CLIP and SmolVLM2 model folders inside `__post_init__` at import time, and hashes them again synchronously on the event loop whenever `GET /settings/app/knowledge/models/{bundle}/status` is called. Also, `OnnxClipEmbeddingProvider.initialize` ([embedding.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/extraction/embedding.py#L77-L94)) and `LocalSmolVlm2CaptionProvider.initialize` ([captioning.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/extraction/captioning.py#L102-L135)) check `if self._session is None:` *outside* `async with self._semaphore:`, so two concurrent requests will load the model into memory twice.
  - **Fix**: Re-check `if self._session is None:` inside the semaphore, and cache manifest verification in a background thread instead of running it at import time and on every status poll.
- **`Cache-Control: immutable` on `/files/{filename}` caches replaced files for 1 year**:
  - **Where**: [files/service.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/files/service.py#L72-L112).
  - **Problem**: If you delete `report.png` and upload a new `report.png`, the browser still shows the old image for up to a year because the response header says `max-age=31536000, immutable` on a mutable filename URL.
  - **Fix**: Use `ETag` with `Cache-Control: private, no-cache` on filename routes (or serve immutable URLs by unique `file_id`).
- **Giant 500–800 line frontend files doing too many jobs**:
  - **Where**: [chat-session.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/chat-session.tsx) (812 lines), [providers-tab.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/settings/ui/admin-settings/providers-tab.tsx) (784 lines), [chat-input.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/chat-input.tsx) (536 lines), [settings/service.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/settings/service.py) (900+ lines).
  - **Fix**: Split into focused sub-components and domain modules when touching these areas.

---

## 5. Overengineering & Dead Weight (Unused Code & Unnecessary Complexity)

### 5.1 388 Lines of Unused Retrieval Code + 8 Heavy Unused Python Packages (`llama-cpp-python`, `scikit-learn`, etc.)

- **Where**:
  - [tools/builtin/retrieval.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/tools/builtin/retrieval.py#L1-L388)
  - [pyproject.toml](file:///Users/david/prj/asterism/apps/backend/pyproject.toml#L9-L49)
- **What the problem is**:
  `apps/backend/asterism/domains/tools/builtin/retrieval.py` contains 6 different retriever classes (`PassageRetriever`, `SummarizingRetriever`, `BM25Retriever`, `HeadingRetriever`, `TextRankRetriever`, `IntentBasedRetriever`) totaling 388 lines of code—and **none of it is imported or used anywhere in the app** (it was replaced by `domains/retrieval/service.py`).
  Even worse, `pyproject.toml` installs 8 heavy libraries that are never used by the live application:
  - `llama-cpp-python` (a huge C++ LLM compiler package!)
  - `scikit-learn`, `bm25s`, `networkx`, `pystemmer` (only referenced by the dead `retrieval.py` file)
  - `asyncpg`, `websocket`, `httpx2` (never imported anywhere)
- **What it affects**:
  Massive, slow Docker builds and `uv sync` installs, gigabytes of wasted disk space, and confusing dead code.
- **What the fix is**:
  Delete [apps/backend/asterism/domains/tools/builtin/retrieval.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/tools/builtin/retrieval.py) and remove `llama-cpp-python`, `scikit-learn`, `bm25s`, `networkx`, `pystemmer`, `asyncpg`, `websocket`, and `httpx2` from [apps/backend/pyproject.toml](file:///Users/david/prj/asterism/apps/backend/pyproject.toml).

---

### 5.2 Custom AST Source-Code Scanner Just to Import 8 Built-In Files (Which Re-Executes Already-Loaded Modules!)

- **Where**:
  - [package_walker.py](file:///Users/david/prj/asterism/apps/backend/asterism/common/package_walker.py#L1-L68) (`load_decorators`)
  - [lifespan.py](file:///Users/david/prj/asterism/apps/backend/asterism/core/lifespan.py#L32-L39)
- **What the problem is**:
  Instead of simply importing the 8 built-in tool and search provider files at startup, `load_decorators()` walks through **every folder and `.py` file in the entire backend**, parses the Python source code into an Abstract Syntax Tree (`ast.parse`), searches for `@tool` or `@component_provider` decorators, and then forcefully re-runs those files using `spec.loader.exec_module(module)` and overwrites `sys.modules[full_name]`.
- **What it affects**:
  Slower startup, unnecessary complexity, and a subtle Python bug where re-executing an already-imported module creates duplicate classes and singletons in memory.
- **What the fix is**:
  Delete `package_walker.py` and explicitly import the built-in tool and component modules in `domains/tools/builtin/__init__.py` and `domains/components/builtin/__init__.py`.

---

### 5.3 130+ Lines of Unreachable Code Behind an Early `return` in `domains/llm/helpers.py`

- **Where**: [helpers.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/llm/helpers.py#L23-L55) and [helpers.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/llm/helpers.py#L67-L151)
- **What the problem is**:
  In `sanitize_api_messages`, line 67 unconditionally returns:
  ```python
  return [msg.to_api_message() for msg in messages]
  ```
  Right after that `return` statement sit **83 more lines of code** inside the same function (plus the 33-line `_stringify_content` helper above it) that can never, ever run! Even funnier, that unreachable code references deleted config settings (`config.LLM_SUPPORTS_SYSTEM_ROLE`) that would crash if they ever did run.
- **What it affects**:
  Dead code that misleads anyone reading the LLM message formatting logic.
- **What the fix is**:
  Delete `_stringify_content` and lines 69–151 in [apps/backend/asterism/domains/llm/helpers.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/llm/helpers.py).

---

### 5.4 React Contexts, Zustand Stores, and Database Tables That Nothing Ever Reads

- **Where**:
  - **Frontend Contexts/Stores written to, but never read**:
    - [active-chat-session.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/active-chat-session.tsx) & [use-active-chat-session.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/hooks/use-active-chat-session.ts) (components call `setSession`, but nothing in the entire app ever reads `id` or `title`!)
    - [sidebar-width.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/dashboard/components/sidebar-width.tsx) & [use-sidebar-width.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/dashboard/hooks/use-sidebar-width.ts) (`Sidebar` calls `setWidth`, but nothing ever reads `width`!)
  - **Frontend Dead Files & Duplicate Registries**:
    - [admin-settings/index.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/settings/ui/admin-settings/index.tsx) (`getAdminSettingsSections` duplicates `getLazyAdminSettingsSections` in `lazy-sections.tsx` and is never used outside its own file)
    - [use-publish-global-event.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/sse/hooks/use-publish-global-event.ts), [use-publish-local-event.ts](file:///Users/david/prj/asterism/apps/frontend/src/features/sse/hooks/use-publish-local-event.ts), [loading-button.tsx](file:///Users/david/prj/asterism/apps/frontend/src/components/loading-button.tsx), and `ContextUsageMeter` in [chat-session.tsx](file:///Users/david/prj/asterism/apps/frontend/src/features/chat/components/chat-session.tsx#L537-L589) (all unused in the app)
  - **Backend Empty Database Table & Unused Classes**:
    - [tools/models.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/tools/models.py#L1-L21) (`ToolModel` creates an empty `tools` table in SQLite that is never read or written anywhere, along with unused `TOOL_CREATED`/`TOOL_UPDATED`/`TOOL_DELETED` events in [events.py](file:///Users/david/prj/asterism/apps/backend/asterism/core/events.py#L23-L25))
    - [chat/typedefs.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/typedefs.py#L1-L66) (`ChatState` — 66 lines, completely unused)
    - [job_queue.py](file:///Users/david/prj/asterism/apps/backend/asterism/common/job_queue.py#L60-L103) (`JobQueue` — completely unused)
    - [db/columns.py](file:///Users/david/prj/asterism/apps/backend/asterism/db/columns.py#L64-L114) (`PydanticPGJSONB` copy-pastes `PydanticSQLiteJSONB` line-for-line, while `config.py` hard-blocks non-SQLite database URLs)
- **What it affects**:
  Extra providers wrapping the React tree on every page, extra tables in SQLite, and hundreds of lines of unused scaffolding to maintain.
- **What the fix is**:
  Remove the unused React providers/stores (`ActiveChatSessionProvider`, `SidebarWidthProvider`), delete the unused frontend hooks/components, and remove `ToolModel`, `ChatState`, and `JobQueue` from the backend.

---

## 6. Pending Known Issues Already Tracked in `todo.md`

For completeness, the following items from the previous review (`docs/reviews/2026-10-17-codebase-review.md`) remain open in [todo.md](file:///Users/david/prj/asterism/todo.md):

1. **Full-Text Search loads all matching IDs into Python memory before filtering/paginating** ([search_index.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/search_index.py) & [search.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/search.py) — tracked in **US-34.1**): Instead of letting SQLite filter by project and paginate inside one SQL query, the backend fetches *every* matching chat ID for the user into a Python list and builds a giant `WHERE id IN (...)` query.
2. **No global cap on active concurrent chat jobs** ([jobs.py](file:///Users/david/prj/asterism/apps/backend/asterism/domains/chat/jobs.py) — tracked in **US-34.2**): Idle jobs are cleaned up, but there is no upper bound on how many active chat jobs can run simultaneously across the server.
3. **Two Playwright E2E browser tests have outdated label/role selectors** (tracked in **US-34.3**): `authenticated-workspace.spec.ts` looks for a heading named `"Main configuration"` (now `"Main Agent"`), and `new-chat-agent.spec.ts` looks for an `alert` role instead of `status`.
4. **Persona / `USER.md` profiles are not yet implemented as a separate database model** (tracked in **US-35.2**): Currently `user_profile_id` is always `None` on executions, and the sidebar profile selector (`nav-profile-selector.tsx`) is commented out.

