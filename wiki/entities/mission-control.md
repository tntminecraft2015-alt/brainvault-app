---
type: entity
entity_type: project
title: "Mission Control Dashboard"
last_updated: "2026-08-12"
tags: [dashboard, tools, obsidian, html, personal-ops]
---

# Mission Control Dashboard

A single-file HTML dashboard (`mission-control.html`) backed by an Express server (`server.js`). Runs locally (`start-server.bat` / `launch.vbs`) or deployed to Render (https://brainvault-app.onrender.com/) in "cloud mode," where all vault reads/writes go through the GitHub Contents API instead of local disk. Superseded the original localStorage-only version.

> [!note] Page is stale in places
> Most of this page (Layout, localStorage Keys section) still describes the original browser-only build from 2026-05-13. Sections below marked with a date have been updated since; the rest reflects the vault as of the 2026-05-13 build and hasn't been re-audited against the current `mission-control.html` (now containing a merged mobile 5-tab redesign, ED chat, push notifications, wiki browse, and the Design Lab below). Worth a full re-sync next session.

---

## 2026-08-12 update: mobile nav is now 4 tabs, quests merged into the calendar

The mobile bottom nav is **Home / Cal / Gil / ED** — the separate TASKS tab was removed. Quests (still ranked S/B, same XP values `S=50, B=15`) now carry a real `date` and optional `time` field instead of resetting daily:
- **S-rank quests require a time** and behave like a planned calendar event for that day.
- **B-rank quests only require a date**; time is optional via a small clock-icon toggle next to the add row.
- A quest **stays pinned to the date it was added for** — it does not roll forward if left unchecked, and does not get purged after completion. Viewing a past or future day on the calendar shows exactly what was planned/done that day.
- Quests are fully manageable (add / check / delete) directly from the Home card ("TODAY'S QUESTS", today only) and from the Cal tab's new "🎯 QUESTS" section (whichever day is selected on the month grid) — no dedicated tab needed anymore.
- The desktop dashboard's quest panel was **not redesigned**, but was changed to show only today's quests (previously showed all quests undated) so it stays in sync with the same underlying data mobile now uses. Desktop's quick-add row gained the same optional time field for S-rank quests.
- The Home screen's numeric **LEVEL counter was removed** (dead code and its XP-bar/level-up-flash cleaned out too) — Home now just shows the day streak, no level number. A gamification replacement is intentionally not yet decided; see the Design Lab research run titled "Streaks Over Points: Grace-Based Motivation + Collectible Unlocks" for candidate directions.
- Rating a Design Lab finding **"Not even close" now permanently discards it** — no revision gets generated (previously any non-5 rating triggered a rework loop). The feedback is still recorded so future research steers away from similar ideas.

## 2026-08-12 update #2: timeline section and Home's streak card removed, custom scroll-wheel time picker

Follow-up pass, same day, mobile only:
- The Cal tab's separate "TODAY'S TIMELINE" block (the older fixed daily-routine feature — header, list, daily-completion progress bar, and its "Add mission..." row) was **removed from mobile entirely**, including its dead CSS. This was a *different* feature from quests (a recurring same-every-day schedule, e.g. "6am Morning Routine"), not something quests replaced — it's just gone from the phone UI now to make room. The underlying `data.schedule` and its desktop "Weekly Schedule" panel are untouched and still fully functional; only the mobile Cal tab's copy of this UI was deleted.
- Home's **STREAK card was removed** from the bento grid (GIL WALLET and POKÉDEX were reordered to pair up so there's no layout gap); the desktop header's separate streak stat box is untouched. The freed space went to a taller quest list (`max-height` 260px → 380px).
- The quest time field is now a **custom scroll-wheel picker** (hour / minute in 15-min increments / AM-PM, iOS-style, built with native CSS `scroll-snap`) on mobile only — tapping the 🕐 trigger on either add-row opens it. Desktop's quick-add still uses a plain native `<input type="time">` behind its toggle button; it was not changed.

## 2026-08-12 update #3: ED now gets the same live-code grounding Red does

Previously only Red's research prompt included `buildLiveAppFacts()` (a fresh regex-extraction of real CSS variables, class-name-prefix inventory, and function names straight from `mission-control.html`) — ED's chat context (`buildSystemPrompt()` in `server.js`) only ever saw wiki pages, never the actual code. ED now gets the same `buildLiveAppFacts()` block on every chat turn, with persona instructions to trust it over anything stale-sounding in the wiki context, and to ground any `queue_code_change` spec in the real function/CSS-variable names instead of guessing. This page (the one you're reading) is still separately included via ED's keyword-matched "relevant wiki pages" lookup, same as before — the live-facts addition is on top of that, not a replacement for it.

## 2026-08-12 update #4: ED can now remove queued changes, a real data-loss bug got fixed, Red's mockups got a clarity bar

Prompted by the user asking ED to remove a queued item — ED claimed it did, but had no tool to actually do that, so it was hallucinating a successful action. Investigating also surfaced a real, live data-corruption bug: `ghPut()` (the function that commits any vault file write to GitHub in cloud mode) silently discarded failed writes on a sha conflict — no error, no retry — so `data.changeRequests` (the badge/list) and the actual `change-requests/*.md` files had drifted out of sync with each other under concurrent live activity.

- **Fixed `ghPut()`**: failures are now logged, and a 409/422 sha conflict triggers one automatic refetch-and-retry.
- **Added `ghDelete()`/`deleteVault()`** (no delete primitive existed before) and **`removeQueuedChange({id})`**, which deletes both the change-request file and its list entry, restricted to `status: pending` items only.
- **ED got a real `remove_queued_change` tool**, plus a `# PENDING CHANGE QUEUE` context block listing current pending items with their exact ids so it can reference one accurately instead of guessing. There's also a `DELETE /api/change-requests/:id` REST route now, so removal isn't chat-only.
- **ED's persona was updated for honesty**: it's now explicitly instructed to never claim it did something (queued, removed, changed a setting) unless a tool call actually succeeded in that same turn, and to say plainly when it can't do something rather than role-play compliance. This directly targets the hallucination that started this.
- **`runChatTurn`'s tool loop was generalized** — it used to hardcode recognition of only `queue_code_change`; it now dispatches by name across both tools and returns a `toolActions` array (was a single `queuedChange`). `mission-control.html`'s chat handler was updated to match, and now fully re-renders the Change Queue modal's list (not just the badge count) if it happens to be open when a removal comes through chat.
- **Implemented the "Improve Red's design presentation clarity and visual quality" queue item**: Red's shared mockup instructions (used by both a fresh research run and a revision) now explicitly require strong visual hierarchy, purposeful color/typography, obvious grouping, and 5-second scannability — not just "visually representative." Also consolidated a pre-existing duplicate schema string between the two functions into one shared constant while touching this.

## Purpose

Personal daily ops HUD: track todos, upcoming reminders, the weekly schedule, and a full monthly calendar — all in one place, styled as a JRPG battle menu.

---

## Design Language

Applies the **Hub C "Trainer HUD"** design from `raw/hub-c.jsx`:
- Dark cyan palette (`#0a1322` bg, `#12233a` surface, `#1e3a5f` darker, `#d3f0ff` fg, `#ff7a59` accent)
- Fonts: **Press Start 2P** (7–9px labels/headers) + **VT323** (16–24px body)
- Triple inset box-shadow JRPG dialog borders on all modals: `inset 0 0 0 3px color, inset 0 0 0 5px bg, inset 0 0 0 7px color`
- Boot overlay with animated fill blocks (2-second sequence, fades on load)
- Bottom ticker bar scrolling vault stats via CSS `ticker` animation
- Scanlines overlay via `body::after` repeating-linear-gradient

---

## Layout

Three-column grid (`264px | 1fr | 288px`), matching Hub C's `PanelC` structure:

| Left | Center | Right |
|---|---|---|
| Today's Todos | Weekly Schedule (expandable) | Upcoming Reminders |
| (rank badges, XP pop) | (inline events, expand toggle) | (time, location, kind chip) |

Header bar: date/time clock, XP total, streak counter, quick-launch buttons.

---

## Key Features

### Rank System (Todos)
- Ranks: **S / A / B / C** with XP values `50 / 25 / 15 / 10`
- Colors: S=`#e85d3a`, A=`#f0a020`, B=`#4a90d9`, C=`#7a8a78`
- XP pop animation (`+N XP` bubble floats up and fades) on checkbox

### Event Kind System
Applies to reminders, calendar events, and weekly schedule entries:
`training / meeting / focus / social / errand / routine`
Each has a color chip rendered inline.

### Seeded Weekly Pokémon
- 7 unique Pokémon shown in a scrolling marquee at the top
- Seed = `year * 1000 + isoWeek` → same 7 all week, new set every Monday
- Uses a mulberry32-style PRNG (`Math.imul` xorshift)

### Calendar View
- Full monthly view, toggled in-page (no new tab) via `showView(id)` / `.hidden` class
- Add/view/delete calendar events with title, time, location, kind
- Back button returns to main hub

### CLI Launch Button
- "Claude CLI" button opens Windows Terminal pointed at BrainVault via `wt:` URI scheme:
  `wt:-d C:\Users\thoma\OneDrive\Desktop\BrainVault`

### Design Lab (added 2026-08-10)
A research feature living inside the ED tab (🎨 DESIGN LAB button, desktop and mobile), run by **Red** — a separate agent persona from ED. ED answers questions about the vault in chat; Red's only job is design research. Two ways to trigger it:
- **On-demand:** type an optional focus (e.g. "mobile nav", "gamification") and hit Research. Calls Claude with the server-side `web_search_20250305` tool (max 3 searches per run), grounded in this page's design-language section, and asks for exactly 3 UI/UX findings each with a Claude-drawn HTML/CSS mockup illustrating the idea in Mission Control's own palette.
- **Automatic:** the server checks every 6h and auto-runs a general (no-focus) research pass every Monday if one hasn't run yet that day (`maybeAutoRunDesignResearch` in `server.js`), and push-notifies ("🎨 Red's weekly design research is ready") if push is enabled.

**Model (updated 2026-08-10):** both ED's chat and Red's research run on `claude-haiku-4-5-20251001` (swapped from `claude-sonnet-4-6`) to keep token/cost usage low, since Red runs unattended on a schedule and ED runs on every chat turn. Research output was also trimmed — 3 findings instead of 4–6, `max_tokens` 3000 instead of 8000, 3 web searches instead of 6 — as part of the same cost-conscious pass. Worth revisiting if Haiku's mockups/finding quality turns out too shallow for the research use case.

Each run produces two artifacts:
- A self-contained HTML slideshow (`design-research/<id>.html`, served via `GET /api/design-research/:id`) — click-through cards with the finding, source link, and mockup in a sandboxed iframe. Opened in a modal from the DESIGN LAB panel's "past research" list.
- A wiki analysis page (`wiki/analyses/<id>.md`) written the same way `syncTasks`/`syncSchedule` write theirs — via `saveDesignResearchWiki`, which also logs to `log.md` and links itself into `index.md`.

Endpoints: `POST /api/design-research` (run), `GET /api/design-research` (list, backed by `app-data.json`'s `designResearch` array), `GET /api/design-research/:id` (serve the slideshow HTML).

**Live-tested and working as of 2026-08-10.** First two attempts (pre-Haiku-swap) hit a 429 rate limit on the shared Claude Code OAuth token. After the model swap to Haiku, retried: the API call succeeded, but a real bug surfaced — `writeVault()` didn't create parent directories before writing (unlike `writeWiki()`, which does), so the first successful run failed at `writeVault('design-research/<id>.html', ...)` with `ENOENT` because `design-research/` didn't exist yet. Fixed by adding `fs.mkdirSync(path.dirname(full), { recursive: true })` to `writeVault`, matching `writeWiki`'s pattern. Retried again: both the on-demand run (topic: "mobile home tab widgets") and the Monday auto-run succeeded end to end — real findings with real sources, a real slideshow served correctly via `/api/design-research/:id`, and a real wiki analysis page written and logged. `app-data.json`'s `designResearch` list, `wiki/log.md`, and `wiki/index.md` all updated correctly.

One open item: `design-research/*.html` files live outside `wiki/`, `raw/`, `app-data.json`, `CLAUDE.md`, `templates/` — the paths `.gitignore` currently routes to the vault remote — so as generated content they'd default to landing in the `app` repo instead unless `.gitignore`/the push workflow is adjusted. Not yet decided.

---

## localStorage Keys

| Key | Value |
|---|---|
| `week_events` | `{"YYYY-MM-DD": true}` — marked days |
| `todos_YYYY-MM-DD` | `[{text, done, rank}]` — daily todo lists |
| `reminders` | `[{text, date, time, location, kind}]` |
| `cal_events` | `{"YYYY-MM-DD": [{title, time, location, kind}]}` |

---

## Pending Work

- ~~Local sync server~~ — done, differently than originally scoped: `server.js` (Node/Express, not Python) now serves the dashboard and syncs dashboard state into `wiki/analyses/` on every change via `/api/data` and `/api/sync`. See log entries throughout May–July 2026.
- **Design Lab live test**: run a real research pass (costs an API call with web search) and confirm the slideshow/mockups render as intended, then decide if the weekly Monday auto-run cadence is the right one.

---

## File Location

`C:\Users\thoma\OneDrive\Desktop\BrainVault\mission-control.html`

Design source references (read-only): `raw/hub-c.jsx`, `raw/hub-a.jsx`, `raw/hub-b.jsx`, `raw/shared.jsx`, `raw/Mission Control Hub.html`

---

*See also: [[llm-wiki-pattern]], [[obsidian]]*
