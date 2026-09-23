# SmartPrint — Changelog & Hardening Audit Log

All notable bug fixes, security hardening, driver enhancements, and architectural refinements are documented here.

---

## [Unreleased] — Master Hardening Pass (2026-09-24)

### 1. Printer Driver & Spooler Execution
- **Fixed Silent Bypass of Real Windows Printers (`backend/src/printers/windowsPrinters.js`)**:
  - *Bug*: The driver previously checked `printerId.startsWith('printer-') || device.portName === 'DEMO_PORT'` to decide whether to simulate a fast 300ms print. Since custom printers registered via `connectPrinter` generate IDs like `printer-1727...`, all real printers were silently trapped in demo mode and never sent print commands to Windows Spooler.
  - *Fix*: Narrowed demo check strictly to `device.isDemo === true || printerId === 'demo-smartprint-laserjet'`. Real printers target their genuine system name `(device.name || printerId)`. Abstracted execution into `powerShellRunner` and exported control hooks (`setPowerShellRunner`, `resetPowerShellRunner`) for deterministic testing.
  - *Consequence Prevented*: Real printers connected to the station actually print physical paper now instead of silently faking success.
- **Added CUPS / Linux Page Range Flag Support (`backend/src/printers/systemPrinters.js`)**:
  - *Bug*: The Linux/CUPS driver ignored `pageRange`, printing the whole document even if the operator selected a single page or range.
  - *Fix*: Implemented `buildLpArgs` which attaches `-o page-ranges=<range>` when `pageRange !== 'all'`, respecting native CUPS syntax and supporting two-sided duplex edge options. Added unit tests verifying command flag generation.
  - *Consequence Prevented*: Avoided paper waste and erroneous whole-document printouts when an operator requested specific page ranges under Linux/CUPS.

### 2. Authentication & Station Network Security
- **Gated Public LAN Operator Self-Registration (`backend/src/services/auth.service.js`, `backend/src/controllers/auth.controller.js`, `backend/src/config/env.js`, `frontend/src/pages/Signup.jsx`)**:
  - *Bug*: `POST /api/auth/register` and `/api/auth/signup` were open to any client on the local Wi-Fi, allowing unauthorized customers to create staff accounts with queue management permissions.
  - *Fix*: Introduced `OPERATOR_SIGNUP_CODE` in `.env`. Registration requests now strictly require a valid `inviteCode` matching the station operator key, returning `403 Forbidden` if missing or invalid. Added an "Invite Code / Station Key" input field on the Signup UI.
  - *Consequence Prevented*: Prohibits malicious or accidental account escalation by customers connected to the station Wi-Fi.
- **Gated Hardcoded 1-Click Dev Logins (`frontend/src/pages/Login.jsx`)**:
  - *Bug*: Hardcoded "1-Click Sign In (admin / changeme123)" button was exposed unconditionally to all users, with a broken reference to `redirectTo` that caused a client error when clicked.
  - *Fix*: Wrapped 1-click login inside `{import.meta.env.DEV && (...)}` and corrected navigation target to `from`.
  - *Consequence Prevented*: Production deployments will not display default credentials or 1-click admin access to unauthorized visitors.

### 3. Customer Document Lifecycle & Trust Experience
- **Live Reactive Document Lifecycle Tracker (`frontend/src/components/DocumentLifecycleTracker.jsx`, `frontend/src/pages/Upload.jsx`)**:
  - *Bug*: Previously rendered 4 static, visually identical boxes with no correlation to the document's actual progression through the station.
  - *Fix*: Transformed the component into a live reactive pipeline accepting `files` and `currentStage`. Automatically derives stage (0: Idle / Awaiting Upload, 1: Ingest RAM buffer, 2: Spooling to tray, 3: Hardware check / Verification, 4: Zero-Trace Shred / Wipe). Completed stages render emerald checkmarks and borders; the active stage glows with a pulsing badge.
  - *Consequence Prevented*: Customers can clearly follow when their document is buffered in RAM, sent to the printer, verified, and shredded from disk.

### 4. Media & Binary Signature Alignment
- **Canonical Extension & Magic Byte Verification (`backend/src/security/fileSignature.js`, `backend/src/config/env.js`, `backend/tests/env.setup.js`, `frontend/src/components/UploadForm.jsx`)**:
  - *Bug*: WebP, HEIC, and AVIF image signatures were mapped internally to `ext: 'jpg'`, while `.env.example` listed distinct extensions without matching test environment allowances.
  - *Fix*: Standardized canonical extensions (`webp`, `heic`, `avif`) in `fileSignature.js`. Updated `env.js`, `.env.example`, `env.setup.js`, and `CLIENT_ACCEPT` in `UploadForm.jsx` to uniformly allow `pdf, jpg, jpeg, png, webp, heic, heif, avif, doc, docx`.
  - *Consequence Prevented*: Supported high-resolution smartphone uploads (iPhone HEIC, modern Android AVIF, web-optimized WebP) up to 200MB without signature mismatches or false rejections.

### 5. Telemetry, Audit Logs & Testing
- **Audit Log Dispatch Mode (`backend/src/services/printJob.service.js`)**:
  - *Improvement*: Added `PRINT_JOB_DISPATCHED` audit log entries tracking `servedBy: 'demo' | 'windows' | 'cups' | 'mock'`.
- **Prominent DEMO Hardware Badging (`frontend/src/components/PrintDialog.jsx`, `frontend/src/pages/Dashboard.jsx`)**:
  - *Improvement*: Attached high-contrast `[DEMO]` badges to the virtual printer in both the print dialog radio list and the dashboard printer fleet cards.
- **Added Comprehensive Test Suites (`backend/tests/`)**:
  - `tests/windowsPrintersDriver.test.js`: Verified PowerShell command execution for real hardware vs instant completion for demo printer.
  - `tests/pdfSlicer.test.js`: Verified page range parsing and non-destructive PDF page extraction.
  - `tests/analyticsPdf.test.js`: Verified automated executive PDF telemetry export generation.
  - Expanded `tests/auth.test.js`, `tests/printers.test.js`, `tests/upload.test.js`, and `tests/analyticsAndAudit.test.js`.
  - Full test suite: **14 passed suites, 120 passed tests, 0 failed**.
