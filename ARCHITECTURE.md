# PrintSafe — Architecture

This document explains how the system fits together: request flow, state
machines, database schema, real-time events, and the security model. See
`README.md` for setup/usage instead.

---

## 1. High-level shape

```
                    ┌──────────────────────────┐
   Phone (walk-up)  │        Frontend           │   Staff laptop (operator)
   scans QR ───────>│   React + Vite + Tailwind │<─── logs in, manages queue
                    │  (Dashboard/Upload/Queue) │
                    └────────────┬──────────────┘
                                 │ REST (axios) + WebSocket (socket.io-client)
                                 ▼
                    ┌──────────────────────────┐
                    │        Backend            │
                    │  Express + Socket.IO      │
                    │  routes -> controllers ->  │
                    │  services -> db/printers   │
                    └────────────┬──────────────┘
                          │             │
                          ▼             ▼
                    ┌──────────┐  ┌──────────────┐
                    │  SQLite   │  │  Filesystem   │
                    │ (metadata)│  │ (uploaded docs)│
                    └──────────┘  └──────────────┘
                                        │
                                        ▼
                                ┌───────────────┐
                                │ Printer layer  │
                                │ mock | CUPS    │
                                └───────────────┘
```

Two client roles hit the same backend: an anonymous phone (session-scoped,
capability-token access via an unguessable session ID) and authenticated
staff (JWT + role-based access). The backend never distinguishes them by
IP or origin — only by whether a request carries a valid session ID
(public routes) or a valid JWT (staff routes).

## 2. Backend layering

```
routes/        -> thin: validates shape of the URL/params, delegates
controllers/   -> parses req, calls one service function, shapes the response
services/      -> all business logic, the only layer allowed to enforce rules
db/*.repo.js   -> parameterized SQL only, no business logic
middleware/    -> auth, error handling, upload, rate limiting
sockets/       -> connection handling + an event-name catalog + an emitter
printers/      -> one interface, two backends (mock, system/CUPS)
security/      -> file signature/hash/safe-storage helpers, used by services
```

`app.js` builds the Express app (used directly by tests, no `listen()`
call). `createServer.js` wraps it with an HTTP server + Socket.IO
instance. `server.js` is the actual process entrypoint — it calls
`createServer()`, starts listening, and kicks off the cleanup scheduler.
This split exists specifically so tests can spin up a real server on a
random port without needing the singleton config, and so the cleanup
scheduler never runs during tests (it would keep Jest's process alive).

## 3. Request lifecycle: QR scan to printed page

1. **Dashboard loads** -> `POST /api/sessions` creates a session row
   (`sessions` table) with a 24-byte random ID (`crypto.randomBytes`,
   base64url) and a TTL-based `expires_at`. `GET /api/sessions/:id/qr`
   encodes `${FRONTEND_URL}/upload/:id` — nothing else — into a QR image
   server-side via the `qrcode` package.
2. **Phone scans it**, lands on `/upload/:sessionId`, which calls
   `GET /api/sessions/:id` to verify the session is still `ACTIVE` before
   showing an upload form. Client state (a session ID in `localStorage`
   on the Dashboard side) is never trusted on its own — every reconnect
   re-verifies against the backend.
3. **Upload** -> `POST /api/sessions/:id/upload` (Multer, memory storage).
   `file.service.js` runs every check in order, and only writes to disk
   after ALL of them pass:
   - session usable (`assertSessionUsable`)
   - non-empty, under `MAX_UPLOAD_SIZE_MB`
   - **magic-byte signature detection** (`security/fileSignature.js`) —
     never trusts the browser's declared MIME type or the extension
   - detected type against the `ALLOWED_EXTENSIONS`/`ALLOWED_MIME_TYPES`
     allowlist
   - SHA-256 hash computed; checked against existing file hashes for
     duplicate detection
   - safe server-side filename generated (`security/storage.js`) — the
     original filename is stored as metadata only, never used as a path
   - one-time sessions transition to `USED` here, not before
4. **Socket.IO push**: the upload result (`upload:completed` or
   `validation:failed`) is pushed to everyone in that session's room —
   the Dashboard sees it live without polling. A persisted `notifications`
   row is created in parallel so a page refresh still shows history.
5. **Operator queues a print**: `POST /api/print-jobs` with `fileId`,
   `printerId`, and settings (copies/pageRange/paperSize/orientation/
   colorMode/duplex). `printJob.service.js` validates the settings
   against the selected printer's actual reported capabilities before
   creating anything.
6. **Processing**: the job is picked up in-process (`processJob`),
   walking `PENDING -> PROCESSING -> PRINTING -> COMPLETED|FAILED` (state
   machine detailed below), calling the active printer backend at the
   `PRINTING` step.
7. **Cleanup**: once the file is old enough and has no print job still in
   flight, the scheduled cleanup sweep deletes it from disk and marks the
   DB row `DELETED`.

## 4. State machines

### Session

```
ACTIVE --(TTL expires)--> EXPIRED
ACTIVE --(one-time upload succeeds)--> USED
ACTIVE --(explicit cancel)--> CANCELLED
```
Expiry is checked both lazily (on any read, in `session.service.js`) and
proactively (the cleanup sweep), so it's caught even if nobody happens to
touch that specific session again.

### File

```
UPLOADED -> VALIDATED   (the only two currently used; REJECTED is
                          modeled but rejections never create a row at
                          all — see below)
VALIDATED -> DELETED    (via TTL cleanup, once no active print job
                          references it)
```
Rejected uploads never reach the database — validation happens entirely
in-memory (Multer buffers to memory, not disk) before any row is created
or any file is written, so a rejected upload leaves zero trace on disk.

### Print job

```
PENDING -> PROCESSING -> PRINTING -> COMPLETED
                                  \-> FAILED -> RETRYING -> PROCESSING (loop)
                                            \-> CANCELLED
PENDING -> CANCELLED
```
Every transition goes through a **compare-and-swap** update
(`printJobsRepo.transition`: `UPDATE ... WHERE id = ? AND status = ?`,
checking `changes === 1`) so the same job can never be double-processed
even if triggered twice (e.g. a duplicate retry click, or a race between
the scheduler and a manual retry).

"Completed" only happens when the printer backend's `print()` promise
actually resolves — never just because a command was issued. See
`backend/src/printers/README.md` for exactly what "confirmed" means for
each backend (mock vs. real CUPS).

## 5. Database schema

7 tables, SQLite, WAL mode, foreign keys on:

| Table | Purpose |
|---|---|
| `users` | Staff accounts (ADMIN/OPERATOR), bcrypt password hashes |
| `sessions` | One per QR code; TTL, status, one-time flag, extension count |
| `files` | Metadata + filesystem path + SHA-256 hash. Never blob storage. |
| `print_jobs` | State machine + selected printer + print settings (copies, page_range, paper_size, orientation, color_mode, duplex) |
| `notifications` | Persisted, session-scoped, also pushed live over sockets |
| `activity_logs` | Lightweight session/user-facing history |
| `audit_logs` | Security-relevant trail (logins, RBAC actions, file rejections, cleanup sweeps) — admin-only to read |

Migrations are additive and idempotent: `db/index.js` checks
`PRAGMA table_info` before running any `ALTER TABLE`, and only runs them
against a table that already exists (a fresh install gets the full
schema straight from `schema.sql` instead). This was tested against both
a simulated pre-existing database and a fresh one.

## 6. Real-time events (Socket.IO)

All event names live in one place (`sockets/events.js`) to avoid
duplicate/inconsistent naming. Two rooms exist:

- `session:<id>` — joined by both the Dashboard ("viewer" role) and the
  Upload page ("uploader" role) for one specific session.
- `queue:global` — joined by staff viewing the Queue page; requires a
  valid JWT passed in the `queue:join` payload (checked server-side in
  `sockets/index.js`), so the operator-only print queue can't be watched
  anonymously just by opening a websocket.

| Event | Direction | Payload |
|---|---|---|
| `session:join` | client->server | `{ sessionId, role }` |
| `queue:join` | client->server | `{ token }` |
| `upload:started` / `upload:progress` | client->server, relayed | `{ sessionId }` / `{ sessionId, percent }` |
| `session:joined` | server->client | ack |
| `client:connected` / `client:disconnected` | server->client | presence |
| `upload:completed` | server->client | `{ file, isDuplicate }` |
| `validation:failed` | server->client | `{ reason, message }` |
| `session:expired` / `session:used` / `session:extended` / `session:cancelled` | server->client | lifecycle |
| `notification:created` | server->client | persisted notification, same shape as the REST list |
| `print:created` / `print:started` / `print:completed` / `print:failed` / `print:retry` / `print:cancelled` | server->client | serialized print job |
| `queue:updated` | server->client | generic "refresh your list" signal |

## 7. Security model

- **Capability-token access for the anonymous flow**: session and file
  IDs are 192+ bits of `crypto.randomBytes`, never sequential/predictable.
  Knowing the ID *is* the authorization for that one resource — there's
  no separate "ownership" check because nothing else identifies the
  anonymous uploader.
- **RBAC for staff**: JWT bearer tokens, `ADMIN`/`OPERATOR` roles,
  enforced in Express middleware (`middleware/auth.js`) on every
  protected route — never just hidden in the frontend. The same check
  exists again at the Socket.IO layer for the queue room.
- **File security**: allowlist + magic-byte signature check (not just
  extension/MIME), path-traversal-safe filename generation and safe-read/
  safe-delete (both verify the resolved path is still inside the
  configured upload root before touching the filesystem), SHA-256
  integrity hashing.
- **Rate limiting**: global limit on `/api`, a stricter one on
  `/api/auth/login`, another on the upload route.
- **Headers**: Helmet defaults (CSP-adjacent headers, `X-Frame-Options`,
  etc.).
- **No secrets in source**: `.env.example` files document every variable;
  real `.env` files are gitignored. `JWT_SECRET` and the seeded admin
  password both ship with placeholder values and explicit "change this"
  warnings.
- **Privacy**: document contents are never logged (`activity_logs`/
  `audit_logs` store filenames, hashes, and sizes — never file bytes or
  extracted text); the QR code encodes only a session ID, never anything
  about the document.

## 8. Printer abstraction

One interface (`listPrinters`, `findPrinter`, `print`), two backends,
selected by `PRINTER_MODE`:

- **`mock`** — a static fleet of 3 simulated printers with genuinely
  different capabilities (see `printers/mockPrinters.js`). This is what's
  actually been exercised end-to-end during development.
- **`system`** — shells out to CUPS (`lpstat`/`lpoptions`/`lp`) for real
  printer detection and printing on Linux/macOS. Written defensively
  (missing CUPS degrades to "no printers" rather than crashing) but
  **not verified against real hardware** in this environment — see
  `backend/src/printers/README.md`.

`printJob.service.js` only ever talks to the `printers/index.js` facade,
so adding a third backend (e.g. a different OS's print subsystem) doesn't
require touching anything else.

## 9. Cleanup & crash recovery

`scheduler.js` runs one sweep immediately on backend startup (this is
what performs crash recovery) and then on a configurable interval
(`CLEANUP_INTERVAL_SECONDS`). Each sweep does three independent things:

1. **`recoverStaleJobs`** — any job stuck in `PROCESSING`/`PRINTING` for
   longer than `STALE_JOB_TIMEOUT_MINUTES` (meaning the process almost
   certainly crashed mid-job) is marked `FAILED` with an explanatory
   message and becomes retryable. It is never silently assumed to have
   succeeded.
2. **`sweepExpiredSessions`** — proactively expires sessions whose TTL
   has passed, rather than waiting for someone to happen to request that
   exact session again.
3. **`sweepOrphanedFiles`** — deletes files past
   `FILE_RETENTION_MINUTES_AFTER_SESSION_END` from upload time, but only
   if no print job for that file is still active
   (`PENDING`/`PROCESSING`/`PRINTING`/`RETRYING`) — a file mid-print is
   never deleted out from under a job.

Because all state (sessions, files, print jobs) lives in SQLite rather
than in-memory variables, a restart never loses track of what was
happening — it just needs this sweep to reconcile anything left
inconsistent by an unclean shutdown.

## 10. Frontend structure

- **Pages** map 1:1 to routes: `Landing` (`/`), `Dashboard` (`/dashboard`,
  the QR/session view), `Upload` (`/upload/:sessionId`), `Login`,
  `Queue`, `Analytics`, `AuditLog` (the last three behind
  `ProtectedRoute`, which checks both authentication and, for
  `AuditLog`, the `ADMIN` role).
- **Hooks** encapsulate anything stateful/reusable:
  `useSessionSocket`/`useQueueSocket` (Socket.IO room lifecycle),
  `useCountdown` (session TTL display), `useDocumentPreview` (shared by
  the standalone preview modal and the print dialog's preview step, so
  the `pdfjs-dist` loading logic exists exactly once).
- **Services** are the only layer allowed to call `axios` — components
  never construct requests directly. The shared `api.js` instance
  attaches the auth token automatically and normalizes error shapes
  (including preserving structured `details` like a duplicate-print
  conflict's file ID, which a naive interceptor would otherwise drop).
- **`pdfjs-dist` is lazy-loaded** (dynamic `import()`) specifically so it
  never bloats the bundle the phone downloads on the anonymous upload
  flow — it only loads when a staff member actually opens a preview.

## 11. Known limitations (stated plainly, not hidden)

- The `system` printer backend is implemented but unverified against
  real hardware (no CUPS/printer available during development).
- No browser-automation test suite (Playwright/Cypress) — covered
  instead by backend contract tests (Jest/Supertest, 79 tests) plus
  manual/curl-based end-to-end verification during development.
- Single backend process/in-memory job runner (`processJob` fires
  without a message queue). Fine for one instance; a multi-instance
  deployment would need a real job queue (e.g. BullMQ) — the state
  machine itself wouldn't need to change, just how jobs get picked up.
