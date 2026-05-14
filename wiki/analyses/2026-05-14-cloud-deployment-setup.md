---
type: analysis
title: "Cloud Deployment Setup — 2026-05-14"
date: "2026-05-14"
tags: [setup, infrastructure, cloud, github, render]
---

## What Was Done

This session fixed the desktop shortcut and deployed BrainVault to the cloud so it's accessible from iPhone without the PC being on.

---

## Desktop Shortcut Fix

The shortcut was opening the browser but the Node server wasn't starting. Root causes:
- `MSXML2.ServerXMLHTTP` (used to check if server was running) silently failed on this machine
- The node start command used `start /b` inside a hidden cmd window, which is unreliable

**Fix:** `launch.vbs` now uses `WinHttp.WinHttpRequest.5.1` for the health check and `powershell Start-Process` to launch Node as a fully independent background process. The script polls up to 15 seconds until the server responds before opening the browser.

---

## Cloud Architecture

BrainVault now runs in two modes based on environment variables:

| Mode | When | File storage | URL |
|------|------|-------------|-----|
| Local | PC, no env vars | `C:\Users\thoma\OneDrive\Desktop\BrainVault\` | `localhost:3000` |
| Cloud | Render, env vars set | `brainvault-vault` GitHub repo via API | `https://brainvault-app.onrender.com` |

`server.js` detects the mode automatically. All file reads/writes go through `readWiki()` / `writeWiki()` helpers that switch between local `fs` calls and GitHub API calls.

---

## GitHub Repos

| Repo | Visibility | Contents |
|------|-----------|----------|
| `tntminecraft2015-alt/brainvault-vault` | Private | `wiki/`, `raw/`, `CLAUDE.md`, `app-data.json`, `templates/` |
| `tntminecraft2015-alt/brainvault-app` | Public | `server.js`, `mission-control.html`, `package.json` |

---

## Render Deployment

- **URL:** `https://brainvault-app.onrender.com`
- **Free tier** — sleeps after 15 min idle, ~30s cold start on first load
- **Env vars set on Render:** `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_VAULT_REPO`, `ANTHROPIC_API_KEY`
- On startup, the server fetches all vault files from GitHub into memory. Writes are debounced 600ms then pushed back to GitHub.

---

## Syncing PC → Phone

The PC server (local mode) writes to disk only. To sync changes to the cloud site after an ingest:

```powershell
cd "C:\Users\thoma\OneDrive\Desktop\BrainVault"
git add -f wiki/ CLAUDE.md app-data.json templates/
git commit -m "ingest: <source-title>"
git push vault master
```

This is now part of the ingest workflow (step 9 in `CLAUDE.md`) and Claude runs it automatically at the end of every ingest.

---

## Shortcuts

| Device | Shortcut | Opens |
|--------|---------|-------|
| PC desktop | "BrainVault Mission Control.lnk" | `https://brainvault-app.onrender.com` |
| iPhone home screen | "BrainVault" (Shortcuts app) | `https://brainvault-app.onrender.com` |
