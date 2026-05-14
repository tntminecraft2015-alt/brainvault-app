# Handoff — Mission Control · Field Console (dual-screen hub)

## Overview

A personal "mission control" dashboard styled as a retro dual-screen handheld game console. Inspired by classic monster-trainer / handheld-RPG UI vocabulary (without reproducing any copyrighted IP). One screen, four modules:

- **Today's schedule** — vertical timeline with a live "▶ NEXT" cursor
- **Month calendar** — themed grid; clicking a day shows that day's events
- **Quest log (to-dos)** — checkbox list with rank badges (S/A/B/C); checking a quest plays a chord blip and pops "+XP"
- **System status** — clock, weather, streak/XP bar

The whole thing is wrapped in a faux device bezel with a "hinge" separating top and bottom screens, and an optional CRT scanline/glow overlay.

## About the Design Files

The files in this bundle are **design references created in HTML/React** — prototypes showing the intended look and behavior, not production code to copy directly. The task is to **recreate these HTML designs in the target codebase's environment** (React, Vue, SwiftUI, native, etc.) using its established patterns and libraries. If no environment exists yet, pick the most appropriate framework for the project and implement there.

`hub-b.jsx` is the authoritative source for Option B (dual-screen). `shared.jsx` contains shared data, hooks, and pixel-UI primitives used across all three explored options — Option B uses most of them. Ignore `hub-a.jsx` and `hub-c.jsx` unless you want to revisit alternatives.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, and interactions are intended to ship as shown. Recreate pixel-perfectly using the target codebase's existing libraries.

## Layout

Outer frame: ~560 × 820 px (vertical handheld proportions). Resizes — content scales but maintain the dual-screen + hinge composition.

```
┌──────────────────────────────────────────────┐  bezel padding: 14px
│  FIELD CONSOLE · DS    |    SAVE FILE 01     │  console label row (6px label, 65% opacity)
│  ┌────────────────────────────────────────┐  │
│  │ TOP SCREEN  (flex 1.05)                │  │  inner padding: 10px
│  │                                        │  │  inner shadow: 2-tone bezel inset
│  │  [TIME box]  [WX box]   [STREAK box]   │  │  row of 3 status boxes, gap 8
│  │  ┌──────────────────────────────────┐  │  │
│  │  │ MAY 2026 · month grid (7×n)      │  │  │  flex 1, calendar fills remaining
│  │  │ ...                              │  │  │
│  │  │ Day-summary chip row (footer)    │  │  │
│  │  └──────────────────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
│         ─── hinge bar (16px tall) ───        │  decorative; pulsing LED + 2 dots
│  ┌────────────────────────────────────────┐  │
│  │ BOTTOM SCREEN  (flex 1.2)              │  │
│  │  ┌───────────────────┐  ┌──────────┐   │  │
│  │  │ MISSION TIMELINE  │  │ QUEST LOG│   │  │  2-col, gap 8
│  │  │  schedule rows... │  │ tasks... │   │  │
│  │  │                   │  │          │   │  │
│  │  └───────────────────┘  └──────────┘   │  │
│  └────────────────────────────────────────┘  │
│   [D-pad]   A·B·X·Y · START · SELECT   [Y/A/B/X]   decorative controls
└──────────────────────────────────────────────┘
```

## Color Tokens (default "cyan" theme)

| Token        | Hex        | Use                                       |
|--------------|------------|-------------------------------------------|
| `bezel`      | `#1a2533`  | Outer device housing                       |
| `bezelDark`  | `#070b14`  | D-pad / button wells / inner bezel ring    |
| `bezelMid`   | `#0c1422`  | Middle bezel ring                          |
| `bezelFg`    | `#8fd6ff`  | Bezel-printed text ("FIELD CONSOLE · DS")  |
| `bg`         | `#0a1929`  | Screen background                          |
| `surface`    | `#11243a`  | Box surfaces inside the screen             |
| `darker`     | `#1e3a5f`  | Active/selected fill, headers              |
| `fg`         | `#a8e6ff`  | Primary text (screen)                      |
| `accent`     | `#ff7a59`  | Live indicators, NEXT marker, XP pop       |

Additional themes (palettes provided in `hub-b.jsx` → `HUB_B_PALETTES`):
- **green** (softer sage — not Game Boy saturated): bg `#121a13`, fg `#b8c89e`, accent `#e87c5c`
- **amber**: bg `#1a1207`, fg `#ffcd5a`, accent `#ff5a3a`
- **magenta**: bg `#15071a`, fg `#ffa8f6`, accent `#9aff5a`

Event-kind colors (used in calendar tile dots + schedule rails):

| kind     | hex       |
|----------|-----------|
| training | `#e85d3a` |
| meeting  | `#4a90d9` |
| focus    | `#9b59b6` |
| social   | `#f0c419` |
| errand   | `#5cab4f` |
| routine  | `#7a8a78` |

Rank chip colors (S/A/B/C task priority badges):

| rank | hex       |
|------|-----------|
| S    | `#e85d3a` |
| A    | `#f0a020` |
| B    | `#4a90d9` |
| C    | `#7a8a78` |

## Typography

Two fonts, both Google Fonts:

- **Press Start 2P** — chunky 8-bit display font. Used for ALL CAPS labels, badges, ranks, kind chips. Sizes used: 6, 7, 8, 9 px (yes, deliberately tiny — it's pixel art).
- **VT323** — terminal-style monospace; comfortably readable. Used for body text and large numbers. Sizes: 11–28 px.

Helpers:
- `.px` class → applies Press Start 2P + 1px letter-spacing
- Default `font-family` on the hub root → VT323
- `image-rendering: pixelated` on the hub root so any future sprites stay crisp

Text inside boxes: 13–16 px VT323 body, 6–8 px Press Start 2P micro-labels.

## Spacing

| Token            | Value |
|------------------|-------|
| Bezel padding    | 14 px |
| Screen padding   | 10 px |
| Box padding      | 8–10 px |
| Inter-box gap    | 8 px  |
| Module gap (vert)| 8 px  |
| Row padding      | 2–5 px (cozy vs. dense) |

Density tweak toggles the schedule/task row vertical gap and padding between cozy (more breathable) and dense (more rows visible at once).

## Borders, Shadows, Borders-as-Shadows

This UI deliberately uses `box-shadow: inset 0 0 0 Npx ...` instead of CSS borders, so:
1. Layout boxes don't shift when "borders" toggle on/off
2. Layered insets can simulate chunky pixel-art double borders

Recurring patterns:

- **Screen well**: `inset 0 0 0 2px bezelDark, inset 0 0 0 5px bezelMid` (two-tone inset frame)
- **Box (BoxB)**: `inset 0 0 0 1px {fg}33, 0 0 0 1px {darker}` (subtle inner + outer hairline)
- **Active "NEXT" schedule row**: `inset 0 0 0 1px {accent}` + accent-colored left rail with `0 0 6px {accent}` glow
- **Hinge LED**: pulsing 8×8 dot, `animation: hingeShine 1.5s ease-in-out infinite` (opacity .25 → .55)

No CSS `border-radius` anywhere in Option B — every corner is sharp. This is intentional and core to the pixel-art aesthetic.

## Modules — Detail

### 1. Top status row (3 boxes, gap 8)

| Box     | Width  | Contents |
|---------|--------|----------|
| TIME    | flex 1 | `TIME` micro-label, big VT323 28px `HH:MM`, `WED · MAY 13` micro-label |
| WX      | 70 px  | `WX` label, cloud sprite (28 px), temp `68°` |
| STREAK  | 86 px  | `STREAK` label, big `14 DAYS`, `LV.27` micro-label, XP `PixelBar` (12 blocks × 4px) |

### 2. Month calendar

- 7-column grid, gap 2
- Day-of-week header: `SUN MON TUE WED THU FRI SAT` in 6px Press Start 2P, 55% opacity
- Empty leading cells render as transparent placeholders
- Day cell: 28px min height, padding 2px, day number top-left in VT323 12px
- Event dots: up to 4 per day, 4×4 px, colored per `kind`, bottom-left
- **Today** (May 13): inset 1px accent border, no fill change
- **Selected**: filled with `fg` color, day number inverted to `bg` color
- Clicking a day → `setSelectedDay(d)` + plays a `blip({ freq: 720 })`
- Below the grid: 1px dashed `fg44` separator, then a chip row showing the selected day's event kinds (Press Start 2P 11px chips, kind-color filled, white text)

### 3. Mission timeline (bottom-left of bottom screen)

- Header: `MISSION TIMELINE` + `● LIVE` blinking accent dot
- Scrollable list of `SCHEDULE` items, each row:
  - **4px colored rail** on the left (event-kind color; `accent` if this is the next-up item, with `0 0 6px accent` glow)
  - **Time** (Press Start 2P 7px, 32px wide)
  - **Title** (VT323 14px, flex 1)
  - **▶ NEXT** indicator (Press Start 2P 6px accent, blinking) on the upcoming row
- Past items: opacity 0.4
- Current/next item: row background `darker`, with inset accent rail glow

The "next" row is computed as: first item whose start time > now, OR the row right after the most recent past row. Re-evaluated every second by `useNow()`.

### 4. Quest log (bottom-right of bottom screen, 200 px wide)

- Header: `QUEST LOG` + `{undone}/{total}` count
- Scrollable list. Each row:
  - **Pixel checkbox** (13px) — `PixelCheck` from `shared.jsx`. Toggles state, bumps with a scale animation, plays a chord blip on check + lower blip on uncheck.
  - **Rank chip** — 14px wide, Press Start 2P 7px, white on rank color
  - **Task title** — VT323 12px; strike-through + 45% opacity when done
- Below the list: 20px reserved area where `XpPop` particles render (+10/15/25/50 XP per rank, floating up 28px and fading over 900ms)

## Interactions & Behavior

| Trigger                  | Effect                                                                 |
|--------------------------|-----------------------------------------------------------------------|
| Page load                | Boot overlay (`BootOverlay`) covers both screens for ~1.9s. Shows `READY?` (blinking) + `LOADING SAVE · FILE 01` + 12-cell progress fill. Fades out over 350ms. |
| Click calendar day       | Updates `selectedDay`. Plays `blip({ freq: 720 })`. Day-summary chip row updates. |
| Click quest checkbox     | Toggles `done`. On check: chord `[880, 1320]` Hz, scale-bump animation, `XpPop` floats up. On uncheck: single 440 Hz blip. |
| Every second             | `useNow()` advances the clock; "next" indicator on schedule moves automatically. |
| Hinge LED                | Pulses opacity .25↔.55 on a 1.5s ease loop (decorative). |
| Live indicator           | `● LIVE` blinks 1Hz step. |

## State Management

```ts
type State = {
  tasks:       Task[];        // local copy of TASKS, mutable via toggle
  selectedDay: number;        // 1..31
  pops:        XpPop[];       // ephemeral, auto-removed after 900ms
  // implicit:
  now:         Date;          // from useNow(), ticks every 1s
  bootPhase:   0 | 1 | 2 | 3; // from useBoot(), 3 = done
};

type Task = {
  id:      number;
  title:   string;
  rank:    'S' | 'A' | 'B' | 'C';
  element: 'fire' | 'water' | 'grass' | 'electric' | 'normal';
  done:    boolean;
};
```

In a real app the dataset should come from your data layer (server, local store, etc.); replace the constants in `shared.jsx` (`SCHEDULE`, `TASKS`, `MONTH`, `CAL_EVENTS`, `WEATHER`) with real fetched/persisted data.

## Audio

Quests and day-clicks play short WebAudio blips for "game feel." Implemented in `shared.jsx`:

```js
blip({ freq, dur, kind, vol })  // single tone with exponential pitch + gain envelope
chord(freqs, gap, vol)          // sequence of blips
```

Uses a lazy shared `AudioContext`; auto-resumes on first user gesture. Volume is intentionally low (0.04–0.06 gain). If your platform has a sound-pack convention, swap these out — the cue points are: task-check, task-uncheck, calendar-day-click.

## Tweaks (parameterization)

The design is parameterized via a tweaks object so themes/density/CRT can be flipped without code changes:

```ts
type HubTweaks = {
  theme:     'cyan' | 'green' | 'amber' | 'magenta';
  density:   'cozy' | 'dense';
  scanlines: number;   // 0..1 — opacity of CRT scanline overlay
  glow:      number;   // 0..1 — strength of vignette glow
  boot:      boolean;  // play boot overlay on mount?
  modules:   { status: bool; schedule: bool; calendar: bool; tasks: bool };
};
```

In your codebase these can be user prefs, theme toggles, or fixed defaults.

## Assets

No image, icon, or font files ship with this design — everything is rendered via CSS, inline SVG (`PixelSprite` paths), or Google Fonts loaded via `<link>`. Sprites used in Option B: `cloud` (weather). Other sprites available in `shared.jsx`: `trainer`, `sun`, `bolt`, `crystal`, `coin`.

## Files in this bundle

- `Mission Control Hub.html` — root prototype (mounts all 3 hubs in a `<DesignCanvas>`). Useful to see Option B in context.
- `hub-b.jsx` — **the design source for Option B.** All layout, palettes, and per-module components.
- `shared.jsx` — Cross-hub primitives: data constants, `useNow`, `useBoot`, `blip`/`chord`, `DialogBox`, `PixelCheck`, `PixelBar`, `PixelSprite`, `TypeChip`, `XpPop`, `BootOverlay`, `ScreenFx`.
- `hub-a.jsx`, `hub-c.jsx` — Sibling options (Pocket Trainer, Trainer HUD). Not required to ship Option B; included for context.
- `design-canvas.jsx`, `tweaks-panel.jsx` — Prototype scaffolding (pan/zoom canvas, tweak controls). **Do not port these** — they exist only to present the design in the prototype.

## Things NOT to port verbatim

- `design-canvas.jsx` (pan/zoom wrapper) and `tweaks-panel.jsx` (tweak UI) are prototype-only.
- The fake `SCHEDULE`/`TASKS`/`CAL_EVENTS`/`WEATHER` constants — wire to your real data.
- `useBoot()` is fun for a first-load splash but consider whether your app should show it on every navigation or only on launch.

## IP note

This design is **inspired by** the visual vocabulary of retro handheld trainer games (chunky borders, pixel fonts, type-coded badges, dual-screen device chassis) but contains no copyrighted names, characters, logos, or marks. Keep it that way during implementation: no brand names, no licensed monster art, no official-looking marks. The element labels (`fire`, `water`, `grass`, `electric`, `normal`) are generic enough to be safe; if you want to be extra cautious, rename them (`urgent`, `flow`, `growth`, `quick`, `chore`).
