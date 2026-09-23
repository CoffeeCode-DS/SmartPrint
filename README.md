# PrintSafe

A secure, session-based document printing system. Scan a QR code, upload a
document straight from your phone, watch it print in real time, and the
file is deleted from the server the moment the job is done.

No app to install, no account needed to print, and nothing left behind
afterwards — that's the whole point.

---

## Table of contents

- [What it does](#what-it-does)
- [Features](#features)
- [Technology stack](#technology-stack)
- [Requirements](#requirements)
- [Installation](#installation)
- [Environment setup](#environment-setup)
- [Database setup](#database-setup)
- [Running the app](#running-the-app)
- [Scanning the QR code from a real phone](#scanning-the-qr-code-from-a-real-phone)
- [Running tests](#running-tests)
- [How to use PrintSafe](#how-to-use-printsafe)
- [Project structure](#project-structure)
- [Printer modes (mock vs. real hardware)](#printer-modes-mock-vs-real-hardware)
- [Production notes](#production-notes)
- [Troubleshooting](#troubleshooting)

---

## What it does

A print station (a laptop connected to one or more printers) displays a QR
code. A person scans it with their phone, uploads a PDF or image straight
from their camera roll — no app, no login — and watches the upload and
print progress live on their own screen. An operator manages the print
queue, picks a printer, configures print settings, and confirms the job.
Once printing is confirmed, the file is deleted. Sessions and QR codes are
single-use and expire on their own.

## Features

**Public (anonymous) flow**
- Dynamic QR code generation, encoding only an opaque session ID — never
  document data
- Secure, cryptographically random, one-time session IDs and QR codes
- Session timeout with a limited number of extensions
- Secure upload: file-signature (magic byte) validation, MIME/extension
  allowlist, size limits, path-traversal-safe storage, SHA-256 integrity
  hashing, duplicate-content detection
- Live upload progress and real-time status via Socket.IO
- PDF/image preview (via `pdfjs-dist`)
- Browser refresh recovery — reloading the page re-verifies the session
  with the backend rather than trusting local state

**Staff / operator flow (requires login)**
- Print queue: `PENDING -> PROCESSING -> PRINTING -> COMPLETED`, with
  `FAILED -> RETRYING` and `FAILED -> CANCELLED` paths
- **Multi-printer support** - printers are auto-detected with real
  status (Ready/Offline/Busy) and capabilities (color, duplex, paper
  sizes); only options a printer actually supports are shown before
  printing
- Print confirmation is only marked complete once the printer backend
  actually confirms it — never just because a command was sent
- Retry (capped attempts) and duplicate-print prevention (an identical
  file already queued/printed is blocked unless explicitly overridden)
- Role-based access control (`ADMIN` / `OPERATOR`), enforced server-side
- Activity log + immutable audit trail
- Analytics dashboard (sessions, uploads, print success rate, duplicate
  rate, upload trend)
- Automatic TTL cleanup: expired sessions and files past their retention
  window are deleted on a schedule — never a file with an active print job
- Server crash recovery: print jobs stuck mid-flight from a prior crash
  are detected on startup and safely marked failed (retryable), not left
  stuck forever

## Technology stack

**Frontend:** React 19 + Vite, Tailwind CSS v4, React Router, Axios,
Socket.IO client, `pdfjs-dist`.

**Backend:** Node.js + Express 5, Socket.IO, Multer, SQLite
(`better-sqlite3`), JWT + bcrypt for auth, Helmet + `express-rate-limit`
for security headers/rate limiting, `node-cron` for scheduled cleanup.

**Testing:** Jest + Supertest (79 automated backend tests covering
sessions, uploads, sockets, print jobs, printers, RBAC, cleanup,
analytics/audit).

A few choices deliberately differ from a "standard" package list for this
kind of project — see [Project structure](#project-structure) for why
(e.g. hand-rolled file-signature checking instead of the `file-type`
package, which is ESM-only and didn't fit this CommonJS backend cleanly).

## Requirements

- Node.js 18+ and npm
- No separate database server — SQLite is just a file
- A phone with a camera, on the same Wi-Fi as the machine running the
  backend (or a tunnel — see below) to actually scan a QR code

## Installation

```bash
git clone <this-repo>
cd printsafe

# installs root, backend, and frontend dependencies
npm run install:all
```

## Environment setup

Both `backend/` and `frontend/` have a `.env.example`. Copy each to `.env`
before running anything:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

**Backend (`backend/.env`)** - every value has a sensible default for
local development, but two matter if you're doing anything beyond a demo
on your own machine:

| Variable | What it's for |
|---|---|
| `JWT_SECRET` | Signs staff login tokens. Generate a real one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and never reuse the placeholder value outside local dev. |
| `ADMIN_SEED_USERNAME` / `ADMIN_SEED_PASSWORD` | The first ADMIN account is created automatically on first startup with these credentials (only if no users exist yet). Change the password before any real use. |

Other variables (session TTL, upload size/type limits, rate limits,
cleanup intervals, mock-printer timing) are documented inline in
`backend/.env.example`.

**Frontend (`frontend/.env`)** - `VITE_API_URL` and `VITE_SOCKET_URL` just
need to point at wherever the backend is running (defaults assume both on
`localhost`).

## Database setup

Nothing to install or run manually — the SQLite database file and its
full schema (7 tables: users, sessions, files, print_jobs, notifications,
activity_logs, audit_logs) are created automatically the first time the
backend starts, at the path set by `DATABASE_PATH`. If you're upgrading a
database from an older version of this project, additive column
migrations also run automatically and safely on startup (see
`backend/src/db/index.js`) — existing rows aren't touched.

## Running the app

From the project root, after environment setup above:

```bash
npm run dev
```

This runs the backend (`http://localhost:5000`) and frontend
(`http://localhost:5173`) together in one terminal, color-coded. Open
`http://localhost:5173` in a browser — you should land on the PrintSafe
landing page.

To run them separately instead (two terminals):

```bash
npm run dev:backend
npm run dev:frontend
```

## Scanning the QR code from a real phone

**This works automatically** — when the backend starts, it detects your
machine's LAN IP address and embeds that in QR codes instead of
`localhost` (a QR code pointing at "localhost" would only ever resolve to
the phone itself, never your laptop, which is why that fails with "this
site can't be reached"). Check the backend startup log:

```
QR codes will point phones to: http://192.168.1.23:5173
Make sure your phone is on the same Wi-Fi as this machine.
```

As long as your **phone is on the same Wi-Fi** as the machine running the
backend, scanning the QR code should just work.

**If auto-detection doesn't find the right network** (multiple network
interfaces, VPN active, Docker, etc. — the log will warn you if nothing
was found at all), override it explicitly in `backend/.env`:

- **Same Wi-Fi, manual IP:** find your machine's LAN IP (`ipconfig` on
  Windows, `ifconfig` / `ip addr` on Mac/Linux), and set
  `PUBLIC_URL=http://192.168.x.x:5173` in `backend/.env`. Restart the
  backend.
- **A tunnel (works anywhere, gives you HTTPS too):** run
  [ngrok](https://ngrok.com) (`ngrok http 5173`) or similar, and set
  `PUBLIC_URL` to the HTTPS URL it gives you.

`PUBLIC_URL` is what actually gets embedded in the QR code (see
`backend/src/services/qr.service.js` and `backend/src/config/env.js`), so
it must be reachable by the scanning phone, not just by your own browser.

## Running tests

```bash
npm test
```

Runs the full backend Jest/Supertest suite (79 tests) - sessions, QR
lifecycle, uploads (including attack attempts: fake file signatures, path
traversal, oversized files), sockets (including reconnection), print
queue/retry/duplicate-prevention, multi-printer capability validation,
auth/RBAC, TTL cleanup, crash recovery, analytics, and audit logging.

There is no automated frontend/browser test suite (e.g. Playwright or
Cypress) in this project — frontend behavior has instead been verified
through the backend contract tests plus extensive manual/real end-to-end
verification during development. Manual browser testing (refresh
recovery, mobile layout, the print dialog flow) is recommended before
relying on this in production.

## How to use PrintSafe

**As a walk-up user:**
1. Open the landing page, or go straight to the QR dashboard.
2. Scan the QR code with your phone.
3. Choose a PDF or image and upload it.
4. Watch the status update live — you'll see when it's picked up,
   printing, and done.

**As staff (operator/admin):**
1. Sign in at `/login` (seeded admin credentials are in your `.env`).
2. Open the **Queue** to see uploaded files.
3. Click **Print**, choose a printer, configure copies/paper/orientation/
   color/duplex (only options that printer actually supports are shown),
   preview the document, and confirm.
4. Track status in the queue; retry failed jobs or cancel pending ones.
5. **Analytics** shows aggregate stats; **Audit & Staff** (admin only)
   shows the security audit trail and lets you create more staff
   accounts.

## Project structure

```
printsafe/
|-- backend/
|   |-- src/
|   |   |-- config/        # env var loading/validation
|   |   |-- controllers/    # HTTP request handlers
|   |   |-- services/       # business logic
|   |   |-- db/              # DB connection, schema, repositories
|   |   |-- middleware/      # auth, error handling, upload, rate limits
|   |   |-- printers/        # printer abstraction (mock + real CUPS backend)
|   |   |-- routes/          # Express route definitions
|   |   |-- security/        # file validation, safe storage, hashing
|   |   |-- sockets/          # Socket.IO event handling
|   |   |-- utils/            # ID generation, serializers
|   |   |-- app.js            # Express app (no listen - used by tests too)
|   |   |-- createServer.js   # HTTP + Socket.IO server factory
|   |   |-- server.js         # actual entrypoint (listens + starts cleanup)
|   |   `-- scheduler.js      # recurring TTL/cleanup sweep
|   |-- tests/                 # Jest/Supertest suite
|   `-- .env.example
|-- frontend/
|   |-- src/
|   |   |-- pages/             # Landing, Dashboard, Upload, Queue, Login, Analytics, AuditLog
|   |   |-- components/        # PrintDialog, FilePreview, StaffHeader, etc.
|   |   |-- hooks/              # useSessionSocket, useQueueSocket, useCountdown, etc.
|   |   |-- services/           # API layer (axios)
|   |   |-- context/             # AuthContext
|   |   `-- utils/
|   `-- .env.example
|-- package.json                 # root - runs both apps together
`-- .gitignore
```

### Why a few dependencies differ from the "obvious" choices

- **`bcryptjs` instead of `bcrypt`** - pure JS, no native build step, more
  portable across dev environments.
- **Hand-rolled file-signature checking instead of the `file-type`
  package** - that package is ESM-only and didn't integrate cleanly with
  this CommonJS backend; `backend/src/security/fileSignature.js` checks
  magic bytes directly.
- **No `zod`/`joi`** - validation is explicit per-route (regex patterns,
  targeted checks) rather than a schema library, to avoid an extra
  dependency for a moderate amount of validation logic.
- **No `winston`** - structured logging lives in the `activity_logs` and
  `audit_logs` SQLite tables (which the audit-trail feature needed
  anyway), plus plain `console` output.
- **No `react-dropzone` / `react-hot-toast`** - the upload dropzone and
  live notifications are small enough that hand-rolling them (native
  HTML5 drag events; a Socket.IO-driven notification feed) avoided two
  extra dependencies for fairly simple UI.

## Printer modes (mock vs. real hardware)

Set via `PRINTER_MODE` in `backend/.env`:

- **`mock` (default)** - three simulated printers with genuinely
  different capabilities (one intentionally offline), so the full
  printer-selection/print-settings UI has something real to exercise.
  This is the only mode that's actually been tested end-to-end in
  development.
- **`system`** - talks to real printers via CUPS (`lpstat`/`lp`) on
  Linux/macOS. **This has not been tested against real hardware** - there
  was no printer or CUPS installation available during development. See
  `backend/src/printers/README.md` for exactly how to verify it on your
  own machine before relying on it. Windows isn't supported by this mode.

## Production notes

This project is structured to run standalone in production, but a few
things are deliberately left as deployment choices rather than baked in:

- **Process supervision:** run the backend under a process manager like
  [PM2](https://pm2.keymetrics.io/) (`pm2 start src/server.js`) so it
  restarts automatically if it crashes — the app's own crash-recovery
  logic (stale print jobs, DB-persisted sessions) handles picking up
  cleanly after a restart, but something needs to actually restart the
  process.
- **HTTPS/reverse proxy:** put a reverse proxy (nginx, Caddy, etc.) in
  front of both the frontend and backend in production, and terminate
  TLS there.
- **`JWT_SECRET` and `ADMIN_SEED_PASSWORD`:** must be changed from the
  placeholder values before any real deployment.
- **SPA routing:** the frontend build (`npm run build`, output in
  `frontend/dist/`) is a single-page app using client-side routing — your
  static file server needs to serve `index.html` for unknown paths (a
  "SPA fallback"), not just the root.

## Troubleshooting

**QR code scans but the page won't load on my phone** - see
[Scanning the QR code from a real phone](#scanning-the-qr-code-from-a-real-phone).
`localhost` in `FRONTEND_URL` only works for the same machine.

**"Too many requests" errors during testing** - rate limits are
intentionally strict for login/upload. Adjust `RATE_LIMIT_*` values in
`backend/.env` for local testing if needed.

**Print jobs go straight to FAILED** - with `PRINTER_MODE=mock`, this is
expected sometimes: `MOCK_PRINT_FAILURE_RATE` (default 0.15) intentionally
fails ~15% of jobs to exercise the retry workflow. Retry it, or lower that
value in `.env` if it's getting in your way during a demo.

**`GET /api/printers` returns an empty list with `PRINTER_MODE=system`** -
expected if CUPS isn't installed or has no printers configured; run
`lpstat -p -d` in a terminal to check what CUPS itself sees first.

**Backend won't start / port already in use** - another process is
already using port 5000 (or 5173 for the frontend). Stop it, or change
`PORT` in `backend/.env` (and `VITE_API_URL`/`VITE_SOCKET_URL` in
`frontend/.env` to match).

**Database seems out of sync after pulling changes** - the schema and any
new columns are applied automatically on the next backend startup; no
manual migration step is needed. If something still looks wrong, deleting
the SQLite file at `DATABASE_PATH` and restarting recreates it from
scratch (you'll lose local data — fine for development, not for anything
you care about).
