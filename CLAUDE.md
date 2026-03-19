# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

Automated browser-based form submission tool for the multi-step web form at https://sixmo.ru/ (Adaptive Flow Challenge). The form has dynamic fields that change names and positions on each load, includes file upload, and has anti-bot detection (FingerprintJS, webdriver checks, Playwright binding detection, behavioral telemetry).

## Architecture

- **`src/automate-form.js`** — Core automation engine. Uses `playwright-extra` + `puppeteer-extra-plugin-stealth` to bypass anti-bot checks. Handles: landing page → start flow → fill each step's fields → upload file → extract result. Fields are located via `[data-field-key]` DOM attribute (stable, unlike randomized CSS classes/IDs). Telemetry is injected by overriding `window.fetch` before form submission.
- **`src/mcp-server.js`** — MCP (Model Context Protocol) tool server over stdio. Exposes `fill_sixmo_form` tool for agent invocation. JSON-RPC 2.0 protocol.
- **`src/cli.js`** — CLI wrapper for direct invocation and testing.
- **`.mcp.json`** — MCP server registration config for Claude Code.

## Commands

```bash
# Run automation (headless)
node src/cli.js

# Run with visible browser for debugging
node src/cli.js --visible

# Pass custom field values and file
node src/cli.js --field first_name=Иван --file ./myfile.txt

# Pass bulk form data as JSON
node src/cli.js -d '{"field_name":"value"}' --file ./upload.json

# Start MCP tool server (for agent integration)
node src/mcp-server.js
```

## How the Form Works (Key Details)

1. POST `/api/start.php` with browser fingerprint → returns `flowId`, `flowKey`, `csrfToken`
2. GET `/api/step.php?flow_id=X&step=N` (with `X-Flow-Key` + `X-CSRF-Token` headers) → returns dynamic field definitions + `stepToken`. May return `status: "pending"` requiring polling.
3. POST `/api/submit.php` as `multipart/form-data` with fields + `flow_id` + `step` + `step_token` + `telemetry` JSON → returns `{ nextStep }` or `{ next: "result" }`
4. GET `/api/result.php?flow_id=X` → final result with generated identifier

## Anti-Bot Measures and How They're Handled

- `navigator.webdriver` → patched via `addInitScript` to return `false`
- `window.__playwright__binding__` / `__pwInitScripts` → deleted in init script
- `window.chrome` → spoofed with runtime object
- Behavioral telemetry (keystroke intervals, mouse moves, dwell time) → generated with realistic random distributions and injected via fetch override
- FingerprintJS → stealth plugin handles most evasion; real browser context mimics genuine Chrome

## Anti-Bot Measures and How They're Handled (cont.)

- `__playwright__binding__` / `__pwInitScripts` → not just deleted but also trapped via `Object.defineProperty` with no-op setter to prevent re-creation
- Telemetry is injected via a hidden DOM element (`#__pw_telemetry__`) read by a monkey-patched `fetch` in `addInitScript` — done ONCE, not per-step, avoiding the `page.route` crash in headed mode

## Important Notes

- Field names are **dynamic** — they change every session. The code discovers fields at runtime via `[data-field-key]` attributes. Never hardcode field names.
- Between steps, the server shows "Этап N подготавливается" (preparing) with a loading spinner. `waitForStepReady()` polls for this state to clear and new fields to appear, comparing field names against the previous step to avoid acting on stale DOM.
- File upload accepts `.txt`, `.md`, `.json`. If no file is provided, a default `upload-file.txt` is auto-created.
- Zod validation on the client: text fields need 2–60 chars, selects need non-empty value, file must be a File instance.
- `pressSequentially` must be used instead of `press` for typing — `press` doesn't support Unicode/Cyrillic characters.
- `page.route` for request interception crashes Chromium in headed mode — use `addInitScript` fetch patching instead.
