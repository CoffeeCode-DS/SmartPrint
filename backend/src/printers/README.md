# Printer abstraction

PrintSafe talks to printers through one interface, implemented by two
interchangeable backends selected via `PRINTER_MODE`:

```js
listPrinters()              -> [{ id, name, status, isDefault, capabilities }, ...]
findPrinter(printerId)      -> { id, name, status, isDefault, capabilities } | null
print({ printerId, jobId, filePath, copies, paperSize, orientation, colorMode, duplex })
                             -> Promise<{ confirmedAt, printerId, printerName }>
```

`capabilities` is `{ color: bool, duplex: bool, paperSizes: string[], maxCopies: number }`
— the frontend uses this to hide print options a given printer doesn't
actually support (e.g. no "Double-sided" toggle for a printer that can't
do duplex).

## `PRINTER_MODE=mock` (default, and the only mode tested in this environment)

`mockPrinters.js` defines three simulated devices with genuinely different
capabilities and statuses (one is intentionally OFFLINE), so the
printer-selection UI, capability-based option hiding, and offline-rejection
logic all have something real to exercise. Jobs are simulated with a
configurable random delay and failure rate (`MOCK_PRINT_*` env vars) and
every result is stamped with a printer name that makes clear it's a mock
device — PrintSafe never reports a mock print as a real hardware
confirmation.

## `PRINTER_MODE=system` (Linux/macOS with CUPS — NOT tested in this sandbox)

`systemPrinters.js` shells out to the standard CUPS command-line tools
(`lpstat`, `lpoptions`, `lp`) to detect real printers and send real jobs.

**This has not been run against real hardware during development** — this
sandbox has no CUPS installation or printer to test against. It's written
defensively (missing commands / no CUPS / no printers all degrade to "no
printers available" instead of crashing), but verify it yourself before
relying on it:

1. Set `PRINTER_MODE=system` in `.env`.
2. Confirm `lpstat -p -d` lists your printer(s) from a terminal.
3. Restart the backend and check `GET /api/printers`.
4. Send a real print job and confirm paper actually comes out.

Its "confirmed" signal means "CUPS accepted the job" (the `lp` command
exited successfully) — from that point physical printing is owned by
CUPS/the OS and can't be synchronously verified. That's an intentionally
honest boundary, not a claim that paper has definitely printed.

Windows is not supported by this backend (no CUPS tools by default); it
will simply report zero printers rather than error out.

## Adding another backend

Implement the same four-function interface in a new file, register it in
`index.js`'s `BACKENDS` map, and point `PRINTER_MODE` at it. Nothing else
in the codebase needs to change — `printJob.service.js` only ever talks to
`src/printers/index.js`.
