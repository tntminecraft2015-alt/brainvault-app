---
type: entity
entity_type: project
title: "Mission Control Dashboard"
last_updated: "2026-05-13"
tags: [dashboard, tools, obsidian, html, personal-ops]
---

# Mission Control Dashboard

A local single-file HTML dashboard (`mission-control.html`) living in the BrainVault root. Opened directly in the browser — no server, no build step. All state persists in **browser localStorage** only.

---

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

- **Local sync server** (deferred): Small Python server at `localhost:8765` that serves `mission-control.html` and intercepts all data changes via a `/sync` POST endpoint, writing state to `wiki/mission-control-state.json`. Would allow Claude to auto-ingest dashboard state at session start.

---

## File Location

`C:\Users\thoma\OneDrive\Desktop\BrainVault\mission-control.html`

Design source references (read-only): `raw/hub-c.jsx`, `raw/hub-a.jsx`, `raw/hub-b.jsx`, `raw/shared.jsx`, `raw/Mission Control Hub.html`

---

*See also: [[llm-wiki-pattern]], [[obsidian]]*
