# Log

## [2026-08-12] note | Mission Control — ED gets a real removal tool, fixed a live data-loss bug, closed out Red's clarity request

**Operation:** note
**Pages updated:** [[mission-control]]

User asked ED to remove something from the queue; ED claimed it did, but had no tool for that — a hallucinated action. Investigating turned up a real bug: `ghPut()` silently discarded failed GitHub writes on a sha conflict (no error, no retry), which had already caused `app-data.json`'s `changeRequests` list and the actual `change-requests/*.md` files to drift out of sync under concurrent live activity — one item existed only as a file, others only as list entries. Also solved the "Ded" mystery: a real queued item, "Add Ded (Design Agent) to BrainVault," which the user explicitly does not want implemented.

Fixed `ghPut()` (log + auto-retry-once on 409/422), added `ghDelete()`/`deleteVault()` (no delete primitive existed before), and added `removeQueuedChange()` restricted to pending items only. Gave ED a real `remove_queued_change` tool plus visibility into the current pending queue (with exact ids) so it can reference items accurately, added a `DELETE /api/change-requests/:id` REST route as a non-chat path, and generalized `runChatTurn`'s tool loop (previously hardcoded to only recognize `queue_code_change`) to dispatch across both tools. Updated ED's persona to never claim an action succeeded unless a tool call actually returned success in that same turn, and to say plainly when it can't do something — directly addressing the hallucination. Updated `mission-control.html` to match the new `toolActions` response shape and fully refresh the Change Queue modal's list (not just the badge) when open.

Implemented the one queue item with a real spec — "Improve Red's design presentation clarity and visual quality" — by strengthening Red's shared mockup-generation instructions (visual hierarchy, purposeful color/typography, 5-second scannability) and marking its file done. The other two pending items ("Auto-reload design revisions in Design Lab," "Smart Tile Hierarchy") had lost their real spec content to the same `ghPut` bug — per the user's instruction, didn't reconstruct them from title alone; instead queued fresh, focused Red research runs on both topics so real findings exist for the user to review and accept properly this time.

Verified everything with syntax checks on both files, plus isolated logic tests (no real API calls or live writes): `ghPut`'s retry logic against a mocked `fetch` across three scenarios, `removeQueuedChange` against a scratch local-mode copy across six scenarios, and `runChatTurn`'s dispatch against a mocked Anthropic client across three scenarios. A Plan agent validated the design before implementation, and the user reviewed the full plan (code already written, live actions pending) via plan mode before I proceeded to commit/push/execute the live steps.

## [2026-08-12] note | Mission Control — ED now gets live app facts too

**Operation:** note
**Pages updated:** [[mission-control]]

User asked whether ED can see the app's actual code, same as Red. It couldn't — `buildSystemPrompt()` (ED's chat context in `server.js`) only ever read wiki pages, never `mission-control.html` itself, unlike Red's research prompt which already called `buildLiveAppFacts()` (a compact regex-extraction of real CSS vars, class-name-prefix inventory, and function names) on every run. Added the same `buildLiveAppFacts()` block to ED's context, with persona instructions to trust it over stale-sounding wiki text and to ground `queue_code_change` specs in real function/CSS-variable names. Verified by patching a scratch copy of `server.js` to skip `main()` (so nothing starts listening or calls the Anthropic API) and calling `buildSystemPrompt()` directly — confirmed the LIVE APP FACTS section is present and its function list includes `openTimeWheel`, proving it reads the real, current file rather than a stale cache.

## [2026-08-12] note | Mission Control — timeline section + streak card removed, custom time-wheel picker

**Operation:** note
**Pages updated:** [[mission-control]]

Follow-up to the same-day quest/calendar merge, per direct user feedback after trying it:
1. Removed the Cal tab's "TODAY'S TIMELINE" section from mobile entirely (a separate, older recurring-daily-routine feature, not part of the quest system) — freed up room on the Cal tab. Desktop's equivalent "Weekly Schedule" panel and the underlying `data.schedule` are untouched.
2. Removed the STREAK card from Home's bento grid (desktop's separate header streak stat is untouched); reordered GIL WALLET/POKÉDEX to avoid a layout gap; increased the quest list's max-height to use the freed space.
3. Replaced the plain time input for quests with a custom iOS-style scroll-wheel time picker (hour/15-min-increment-minute/AM-PM) on mobile, built with native CSS scroll-snap. Desktop's quick-add keeps its original native time input.

Asked clarifying questions before touching anything (which "add mission" section, whether "streak section" meant the Home card, dropdown vs. custom wheel picker, time increment) rather than guessing from the shorthand request. Verified with a syntax check, div/CSS-brace balance check, a duplicate-id sweep, a leftover-reference sweep, and an isolated test of the 12h/24h wheel time-conversion math (including midnight/noon edge cases) before reporting back for push approval.

## [2026-08-12] note | Mission Control — Design Lab discard fix, level counter removed, quests merged into calendar

**Operation:** note
**Pages updated:** [[mission-control]]

Implemented directly (not via the change-request queue) at the user's request, step by step with confirmation before each push:
1. Rating a Design Lab finding "Not even close" now permanently discards it instead of queuing a revision.
2. Set up a daily Claude cloud routine that pings the live Render URL each morning so Red's existing daily auto-research actually fires on Render's free tier (which sleeps when idle) without the user opening the app.
3. Removed the Home screen's numeric LEVEL counter (and dead code/CSS behind it — level-up flash, XP bar, calcLevel/triggerLevelUp); kicked off a Red research run scoped to gamification alternatives ("Streaks Over Points: Grace-Based Motivation + Collectible Unlocks") for the user to pick a replacement direction from.
4. Merged quests into the calendar on mobile: quests now carry a real date + optional time (S-rank requires a time, B-rank optional via a toggle), stay pinned to the day they were added (no more daily reset/purge), and are manageable inline from both the Home card and a new Cal tab section. The mobile TASKS tab and its nav button were removed (5 tabs → 4: Home/Cal/Gil/ED). Desktop's quest panel was left as-is visually but switched to show only today's quests so it stays in sync with the same underlying data.

Updated [[mission-control]] with a dated changelog note so Red's research context reflects the new layout. Full diff pushed to the `app` remote (Render) after each step, with a local syntax/logic check run before every push.

---

## [2026-05-14] note | Cloud Deployment Setup

**Operation:** note
**Pages created:** [[2026-05-14-cloud-deployment-setup]]
**Pages updated:** [[index]]

Fixed the desktop shortcut (launch.vbs), refactored server.js for dual local/cloud mode, created two GitHub repos (brainvault-vault + brainvault-app), deployed to Render at https://brainvault-app.onrender.com, updated both PC and iPhone shortcuts to use the cloud URL. Ingest workflow now includes a git push step so PC ingests sync to the phone automatically.

*Append-only record of all wiki operations. Each entry starts with `## [YYYY-MM-DD]` for greppability.*

*To get the last 5 entries: `grep "^## \[" wiki/log.md | tail -5`*

---

## [2026-05-07] ingest | Karpathy LLM Wiki Gist

**Operation:** ingest  
**Source:** `raw/karpathy-llm-wiki.md`  
**Author:** Andrej Karpathy  

**Pages created:**
- [[karpathy-llm-wiki]] (sources)
- [[llm-wiki-pattern]] (concepts)
- [[rag]] (concepts)
- [[memex]] (concepts)
- [[andrej-karpathy]] (entities)
- [[obsidian]] (entities)
- [[marp]] (entities)
- [[qmd]] (entities)
- [[overview]]
- [[index]]

**Pages updated:** *(initial ingest — no prior pages to update)*

This was the founding ingest of BrainVault. The Karpathy gist describes the LLM Wiki pattern that this entire vault implements — making it both the first source and the meta-document explaining what the vault is for.

Key things noted during ingest:
- The pattern cleanly separates three roles: human (curation, questions), LLM (maintenance), schema (coordination)
- The Memex connection is intellectually significant — this is a 80-year-old idea now made practical by LLMs
- The RAG vs. LLM Wiki distinction is the conceptual crux; worth revisiting with each new source that touches knowledge management
- Karpathy is deliberately vague about tooling, encouraging each user to instantiate the pattern to their needs — this vault's CLAUDE.md is our instantiation

**Open questions flagged:**
- At what scale does `index.md` navigation break down?
- How to handle team/multi-user extensions of the pattern?

---

## [2026-05-08] ingest | 2040 Iuka Ave., 5B — Apartment Listing

**Operation:** ingest  
**Source:** `raw/2040 Iuka Ave., 5B, Columbus, OH 43201.md`  
**Listed by:** Here & There OSU  

**Pages created:**
- [[2040-iuka-ave-5b-listing]] (sources)
- [[2040-iuka-ave-5b]] (entities)

**Pages updated:**
- [[index]] — counts updated, new entries added
- [[overview]] — housing search section added
- `CLAUDE.md` — `property` added as a valid entity_type

**Templates created:**
- `templates/apartment-source.md`
- `templates/apartment-entity.md`

This was the first non-knowledge ingest — a personal apartment listing rather than an article or paper. Established a pattern for housing search tracking: one source summary page per listing (slug: `<address>-listing`) and one entity page per property (slug: `<address>`). The entity page tracks status (`considering | toured | applied | rejected | leased`) and separates Pros/Cons explicitly.

Human notes added: location is nice (Iuka Ravine), no in-unit washer/dryer, close to OSU.

---

## [2026-05-08] ingest | 2028 Summit St. — Apartment Listing

**Operation:** ingest  
**Source:** `raw/2028 Summit St., Columbus, OH 43201.md`  
**Listed by:** Here & There OSU / Ravine Ridge  

**Pages created:**
- [[2028-summit-st-listing]] (sources)
- [[2028-summit-st]] (entities)

**Pages updated:**
- [[index]] — counts updated, new entries added
- [[overview]] — second property added to housing search section

Price was present in the raw file ($800/mo). Second apartment in the same Iuka Ravine area, same landlord as 2040 Iuka Ave. $50 cheaper, adds balcony, AC, and pet policy. Human notes: same general impressions as Iuka Ave (nice location, close to OSU, no in-unit W/D) plus a cleanliness concern.

---

## [2026-05-13] note | Mission Control Dashboard — Build Session

**Operation:** note  
**Source:** N/A (dashboard development, not a raw ingest)

**Pages created:**
- [[mission-control]] (entities)

**Pages updated:**
- [[index]] — mission-control added to Entities

Two-session build of `mission-control.html`, a single-file personal ops dashboard living in the BrainVault root. No server, no build step — pure vanilla HTML/CSS/JS with localStorage persistence.

**Session 1 (JRPG pass):** Added time/location fields to reminders, full in-page monthly calendar with back-button navigation, expandable weekly schedule with inline events, removed "Open in Obsidian" button, wired "Claude CLI" button to `wt:` URI opening Windows Terminal at BrainVault, seeded weekly Pokémon marquee (7 unique per week, PRNG seed = year×1000+isoWeek), JRPG battle-menu aesthetic (triple inset dialog borders, scanlines, Press Start 2P + VT323 fonts, boot overlay).

**Session 2 (design handoff):** User placed Hub C design files (`raw/hub-c.jsx`, `raw/shared.jsx`, `raw/hub-a.jsx`, `raw/hub-b.jsx`, `raw/Mission Control Hub.html`) in `raw/` and asked to replicate the design language. Full rewrite applied: dark cyan Hub C palette, `PanelC`-style three-column layout, `PanelHeader` section bars, rank badge system (S/A/B/C with XP values), event kind color chips (training/meeting/focus/social/errand/routine), XP pop animation, bottom ticker bar.

**Pending / deferred:** Local Python sync server at `localhost:8765` so dashboard state auto-writes to `wiki/mission-control-state.json`, enabling Claude to ingest dashboard data at session start. User said "yes but not now."

## [2026-05-13] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-13]]


Tasks synced for 2026-05-13: 0/0 complete

## [2026-05-13] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[calendar-events]]


Calendar events synced (0 total)

## [2026-05-13] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]


Schedule synced (8 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (7 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (5 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (2 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (0 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (1 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (3 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (4 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (5 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (6 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (7 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (8 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (9 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (0 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (1 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (2 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (3 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (4 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (5 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (6 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (7 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (8 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (9 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (10 missions)

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-14]]

Tasks synced for 2026-05-14: 0/1 complete

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-14]]

Tasks synced for 2026-05-14: 0/0 complete

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-14]]

Tasks synced for 2026-05-14: 0/2 complete

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-14]]

Tasks synced for 2026-05-14: 0/3 complete

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[calendar-events]]

Calendar events synced

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-14]]

Tasks synced for 2026-05-14: 1/3 complete

## [2026-05-14] query | Mission Control Sync

**Operation:** query
**Pages created:** [[chat-2026-05-14]]

Chat session on 2026-05-14

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-14]]

Tasks synced for 2026-05-14: 2/3 complete

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-14]]

Tasks synced for 2026-05-14: 3/3 complete

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-14]]

Tasks synced for 2026-05-14: 3/4 complete

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-14]]

Tasks synced for 2026-05-14: 3/5 complete

## [2026-05-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-05-14]]

Tasks synced for 2026-05-14: 4/5 complete

## [2026-05-14] query | Mission Control Sync

**Operation:** query
**Pages created:** [[chat-2026-05-14]]

Chat session on 2026-05-14

## [2026-05-16] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[calendar-events]]

Calendar events synced

## [2026-07-08] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-07-08]]

Tasks synced for 2026-07-08: 0/4 complete

## [2026-07-08] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[mission-schedule]]

Schedule synced (10 missions)

## [2026-08-10] note | Design Lab feature — ED research assistant

**Operation:** note
**Source:** N/A (feature build, not a raw ingest)
**Pages updated:** [[mission-control]]

Built the "Design Lab" feature the human asked for: a UI/UX research assistant living inside the ED tab. On-demand (button + optional topic focus) and automatic (weekly, Mondays, via a 6h server interval check) triggers both call `runDesignResearch()` in `server.js`, which asks Claude (with the `web_search_20250305` server tool) for 4–6 UI/UX findings grounded in Mission Control's actual design language, each with a Claude-drawn HTML mockup in the app's own palette. Output is dual per the human's choice: a self-contained click-through HTML slideshow (`design-research/<id>.html`, served via a new `/api/design-research/:id` route) and a wiki analysis page (written the same way the existing `syncTasks`/`syncSchedule` functions write theirs).

Added to `server.js`: `runDesignResearch`, `buildSlideshowHtml`, `saveDesignResearchWiki`, `runAndSaveDesignResearch`, `maybeAutoRunDesignResearch`, plus three new routes. Added to `mission-control.html`: a 🎨 DESIGN LAB button in both the desktop and mobile ED tabs, a research/list modal, and a slideshow-viewer modal.

**Not yet live-tested.** Syntax-checked (`node -c`, extracted `<script>` block parse) but never run against a real API key or the real `app-data.json` — per prior guidance about the local dev server writing real data, held off on a live trigger without checking in first. Also unverified: whether `web_search_20250305` is actually enabled on whatever key ends up configured (OAuth token vs. console API key may differ). Working tree changes from this session (including this log/index/entity update, plus stranded changes from earlier — 2026-07-08 sync and the 2026-08-10 career-leads analysis) are not yet committed or pushed to either remote.

## [2026-08-10] note | Design Lab live test + Haiku model swap + "Red" persona

**Operation:** note
**Source:** N/A (feature follow-up, not a raw ingest)
**Pages updated:** [[mission-control]]

Ran the Design Lab live for the first time: started the local server, backed up `app-data.json`/`log.md`/`index.md` to a scratchpad first as a safety net, then POSTed `/api/design-research` twice. Both attempts (plus the Monday auto-run, which correctly self-triggered on server startup) hit a 429 rate limit on the shared Claude Code OAuth token — same failure mode `/api/chat` already handles with a friendly message. Confirmed via diff that the failed runs left zero trace in `app-data.json` or `log.md` — the write path only fires after a successful parse, so the failure mode is safe, just blocked. Root cause is probably OAuth-token contention with the concurrently-running CLI session, not the request itself.

Separately, the human asked to swap Mission Control's model to something less complex/cheaper and to give the design-research agent its own name, "Red," distinct from ED (the existing chat assistant). Changed both `/api/chat` (ED) and `runDesignResearch` (Red) from `claude-sonnet-4-6` to `claude-haiku-4-5-20251001`, and trimmed Red's research footprint: 3 findings instead of 4–6, `max_tokens` 3000 instead of 8000, 3 web searches instead of 6. Renamed Red throughout — system prompt persona line, Design Lab modal copy, slideshow kicker, push notification title, and the wiki-page byline Red's runs generate. This was a cost change, not a fix for the 429 — the rate limit is still unresolved and needs either a retest without a concurrent CLI session, or a real `console.anthropic.com` API key.

## [2026-08-10] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-10-design-research-weekly]]

Design research: Dashboard Clarity & Gamification Engagement (3 findings)

## [2026-08-10] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-10-design-research-mobile-home-tab-widgets]]

Design research: Mobile Widget Interaction & Retro Gamification in Personal Dashboards (3 findings)

## [2026-08-10] note | Design Lab retest — passed, one real bug found and fixed

**Operation:** note
**Source:** N/A (feature retest, not a raw ingest)
**Pages updated:** [[mission-control]]

Retried the live test after the Haiku swap. The 429 cleared, but the first successful API response then failed to save: `writeVault()` (unlike `writeWiki()`) never created parent directories, so writing `design-research/<id>.html` threw `ENOENT` since that folder didn't exist yet. Confirmed via diff that this failure, too, left `app-data.json`/`log.md`/`index.md` untouched — the write ordering is safe. Fixed `writeVault` to `mkdirSync(..., {recursive:true})` first, matching `writeWiki`, and retried again: both the on-demand run above and the Monday auto-run (`[[2026-08-10-design-research-weekly]]`) completed cleanly end to end, findings and slideshows included. Design Lab is now confirmed working, not just built.

One thing this surfaced: `design-research/*.html` lives outside the paths `.gitignore` currently routes to the `vault` remote (`wiki/`, `raw/`, `app-data.json`, `CLAUDE.md`, `templates/`), so as things stand these generated slideshow files would default into the `app` repo rather than `vault` if committed as-is. Flagged for the human to decide, not resolved.

## [2026-08-10] query | Mission Control Sync

**Operation:** query
**Pages created:** [[chat-2026-08-10]]

Chat session on 2026-08-10

## [2026-08-11] note | Mission Control Sync

**Operation:** note

Mission Control change requested via Design Lab: Tile-Based Streak Grid (Gamification via Color, Not Just Numbers)

## [2026-08-11] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-11-design-research-weekly]]

Design research: General Improvements: Micro-Interactions, Real-Time Feedback & Cognitive Load (3 findings)

## [2026-08-11] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-11-design-research-to-do-list]]

Design research: To-Do List Interaction & Feedback Refinement (3 findings)

## [2026-08-11] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-11-design-research-revisions-1786428223878]]

Design research: Revisions — Ready for Another Look (2 findings)

## [2026-08-11] note | Mission Control Sync

**Operation:** note

Mission Control change requested via ED chat: Prevent duplicate design responses and show viewed status

## [2026-08-11] query | Mission Control Sync

**Operation:** query
**Pages created:** [[chat-2026-08-11]]

Chat session on 2026-08-11

## [2026-08-12] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-08-12]]

Tasks synced for 2026-08-12: 0/2 complete

## [2026-08-12] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-08-12]]

Tasks synced for 2026-08-12: 0/0 complete

## [2026-08-12] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-12-design-research-budget-tracker-designs]]

Design research: Budget Dashboard Clarity: Hierarchy, Visual Grouping & Micro-Rewards (3 findings)

## [2026-08-12] note | Mission Control Sync

**Operation:** note

Mission Control change requested via Design Lab: Smart Tile Hierarchy: Variable-Size Cards for Financial KPIs

## [2026-08-12] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-12-design-research-revisions-1786514575356]]

Design research: Revisions: "Competence Over Points: Mastery-Proof Dashboard Pattern", "Category Labels on … (2 findings)

## [2026-08-12] note | Mission Control Sync

**Operation:** note

Mission Control change requested via ED chat: Auto-reload design revisions in Design Lab

## [2026-08-12] query | Mission Control Sync

**Operation:** query
**Pages created:** [[chat-2026-08-12]]

Chat session on 2026-08-12

## [2026-08-12] note | Mission Control Sync

**Operation:** note

Mission Control change request removed via ED chat: Add Ded (Design Agent) to BrainVault

## [2026-08-12] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-12-design-research-auto-reloading-or-auto-refreshing-design]]

Design research: Real-Time Revision Delivery: Auto-Reload & Live Refresh for Design Lab Slideshows (3 findings)

## [2026-08-12] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-12-design-research-a-smart-tile-hierarchy-with-variable-siz]]

Design research: Smart Tile Hierarchy: Variable-Size Cards for Financial KPIs (3 findings)

## [2026-08-12] note | Mission Control — queue overhaul, Smart Tile + auto-reload shipped, ED gets memory and real tools

**Operation:** note
**Pages updated:** [[2026-08-12-design-research-a-smart-tile-hierarchy-with-variable-siz]], [[2026-08-12-design-research-auto-reloading-or-auto-refreshing-design]]

Ran the two pending change requests plus a broader queue/ED pass, all at the user's direction (not an unattended queue run):

- **Change Queue UI overhaul**: modal now shows full description + implementation notes per item (expand/collapse), a cancel button per pending row, pending/done sections, and a full-screen mobile layout. Backend now stores each request's description/details directly in app-data.json instead of only in the debounced .md file, so a spec can never again be lost to a restart racing the GitHub write (see the ghPut bug fixed in b468642, which is exactly how these two requests' original spec text was lost).
- **Smart Tile Hierarchy** (Design Lab, resolved thread): GIL WALLET now uses a bento grid — hero tile for period spent, secondary REMAINING tile, category tiles sized/sorted by spend — on both desktop and mobile.
- **Auto-reload for Design Lab** (ED chat): combined all 3 of Red's unrated candidate designs for this — live-polling dot, fade-in on new content, and a pause control — since the user asked for all three rather than picking one.
- Both change-requests/*.md files were reconstructed (their original content had been lost to the same ghPut bug) and flipped to status: done alongside the app-data.json queue entries.
- **ED now has persistent cross-session memory** (save_memory/forget_memory tools, backed by a new edMemory field, read into every system prompt) and two new action tools (add_task, log_expense) so it can act on direct requests instead of only talking.

No code has been pushed to the `app` remote yet — pending the user's review of a local preview.

## [2026-08-12] note | Mission Control Sync

**Operation:** note

Mission Control change requested via Design Lab: Category Labels on Donut Slices (Enhanced)

## [2026-08-12] query | Mission Control Sync

**Operation:** query
**Pages created:** [[chat-2026-08-12]]

Chat session on 2026-08-12

## [2026-08-12] note | Mission Control Sync

**Operation:** note

Mission Control change requested via ED chat: Budget Tracker Overhaul: Vision & Coordination

## [2026-08-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-08-14]]

Tasks synced for 2026-08-14: 0/1 complete

## [2026-08-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[calendar-events]]

Calendar events synced

## [2026-08-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-08-14]]

Tasks synced for 2026-08-14: 0/2 complete

## [2026-08-14] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[daily-tasks-2026-08-14]]

Tasks synced for 2026-08-14: 0/0 complete

## [2026-08-25] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-25-design-research-daily]]

Design research: General Improvements: Visual Clarity, Habit Durability, & Context-Aware Micro-Feedback (3 findings)

## [2026-08-25] note | Ran Mission Control change queue

**Operation:** note

Ran the 2026-08-25 change queue (4 items, none of which had synced from Render to GitHub — discovered live writes were failing silently, see below). Walked each item with the user before implementing rather than trusting ED's specs as-is:
- Fixed the change-queue dropdown bug (CSS.escape misused for an element-id lookup in toggleCqDetail — every row failed to expand). Marked done.
- Added GitHub-sync diagnostics to server.js (ghGet failure logging, syncStatus tracking, exposed via /api/status) so future silent write failures are visible instead of invisible — root cause of today's non-synced items still needs the user to check Render's GITHUB_TOKEN/logs.
- Expanded Red's research scope: real persistent memory (redMemory) + its own tool set (save_red_memory/forget_red_memory/start_red_research), a new /api/red-chat briefing endpoint, Mission Control kept as a secondary lens on open-topic research, and a hard code-level boundary so Red's tools can never overlap ED's action-taking scope. Verified end-to-end with a real open-topic research run. Marked done.
- Calendar modernization and Gil Wallet N26 redesign left pending — built a mockup instead of implementing directly, since both were vague UI asks; published as an Artifact for the user to react to before any real code changes.

Not yet pushed to either remote — holding for the user's OK given the open sync issue.

## [2026-08-25] note | Implemented Gil Wallet + Calendar redesign

**Operation:** note

User approved the Gil Wallet/Calendar mockup ("it looks beautiful") and asked to implement + push. Before implementing, found the mockup only covered a fraction of the real Gil Wallet (5 sub-tabs: GIL/TRENDS/ACCOUNTS/BILLS/GOALS, plus weekly/monthly mode — none shown in the mockup); confirmed with the user to restyle all 5 consistently rather than just the main view. Implemented both redesigns in mission-control.html — balance+sparkline hero and two-tap quick actions for Gil Wallet, always-visible week-strip for Calendar — scoped so the new look only touches Gil Wallet and Calendar (verified the relevant CSS classes are exclusive to those tabs before restyling, so Home/ED/Design Lab are untouched). No data logic changed, only rendering/presentation. Verified via syntax checks (node --check on the extracted inline script, CSS brace-balance check) and a local server smoke test; could not do live visual browser testing (Chrome extension not connected in this environment) — flagged to the user. Marked both items done in the queue.

## [2026-08-25] note | Browser-verified Gil Wallet + Calendar redesign

**Operation:** note

Chrome connected on retry, so did full live browser verification of the redesign (previous note above was written before that was available). All 5 Gil Wallet sub-tabs (GIL/TRENDS/ACCOUNTS/BILLS/GOALS) render correctly with real account/goal/bill data intact; a real test transaction confirmed the balance, delta chip, sparkline, category breakdown, and icon-chip transaction row all update live and correctly. Found and fixed one real bug during testing: selecting a day via the new week-strip updated selectedKey but never re-rendered the (hidden) month grid behind the toggle, so opening "Browse dates" afterward showed the wrong day highlighted as selected — fixed by having the week-strip's click handler call renderMobMonthGrid() (which also refreshes the day summary/event list) instead of a narrower set of calls. Re-verified after the fix: month grid, week-strip, and day summary all stay in sync. Also confirmed the existing month-grid day-cell tap still opens the day-event modal unchanged, and a real test event rendered correctly in the restyled event list. No console errors from the redesign itself (one pre-existing, unrelated chrono-node CDN warning). All test data (transaction, event) was added and removed during verification; app-data.json and the wiki sync pages showed no net diff afterward.

## [2026-08-25] note | Site-wide theme consistency pass + Red chat consolidation

**Operation:** note

Two more rounds of feedback after the Gil Wallet/Calendar redesign shipped:
1. "Still too many buttons" — removed Gil Wallet's redundant detailed add-row, collapsed the calendar event modal's Title/Time/Location/Kind/Notify fields behind a "+ More options" toggle (quick-add field + Enter is now enough on its own), and decluttered the Home tab by merging GIL WALLET + QUICK GIL into one card and pairing Pokédex + ED side by side — Home now fits without scrolling.
2. "Make the Gil page's look consistent throughout the whole site" — converted the entire app from Press Start 2P/VT323 (JRPG pixel-font aesthetic) to Inter, and flattened every hard-shadow "bento" card/button/nav surface to match Gil Wallet's flat treatment. Did this via a programmatic sweep of all ~140 font-family declarations (CSS rules + inline styles) with a size/weight heuristic (small pixel-font labels bumped up for legibility, VT323 conversions got font-weight:600), then fixed what the sweep couldn't catch: a body-level font-family was missing entirely, so a few elements (like the Change Queue modal's description text) were silently falling back to the browser's serif default — fixed by setting Inter at the html/body level so nothing can fall through. Also caught and fixed a real overflow bug the sweep introduced: `.mob-inp`'s bigger Inter-bold text made flex rows want more width than they had, pushing the Add button off-screen on the quest-add row — fixed with `min-width:0` on the flex input.

Also consolidated Design Lab's two separate Red inputs (the original "Optional focus + RESEARCH button" and the newer briefing chat box) into just the chat — removed the old button/input and its now-dead client-side `runDesignResearch()` function entirely.

Verified everything live in a real browser across Home, Calendar (day-modal add flow, week-strip, month grid), Gil Wallet (all 5 sub-tabs, a real transaction), ED chat, Design Lab (chat + past research), Change Queue (including the expand-detail interaction), Pokédex, and Settings — no console errors beyond one pre-existing unrelated chrono-node CDN issue (chrono-node@2's UMD build throws `exports is not defined` when loaded via a plain script tag, so the calendar quick-add's natural-language date parsing currently always falls back to using the raw text as the title — noted as a known follow-up, not fixed this session to avoid risking a CDN swap under time pressure).

## [2026-08-25] note | Bug-hunt pass: fixed chrono-node, a hidden-quests regression, and a Red revision gap

**Operation:** note

User asked to "fix everything you might've broke and look for bugs" after the site-wide theme pass, so did a thorough live-browser regression pass rather than just a code review. Found and fixed four real issues:

1. **chrono-node CDN actually fixed this time** — root-caused it properly: chrono-node@2 dropped its UMD/browser bundle entirely (only ships cjs/esm), so the old `<script src=".../dist/chrono.min.js">` was throwing `exports is not defined` on every load and silently never working. Fixed by loading it as a real ES module (`<script type="module">` + dynamic `import()` from jsdelivr's `+esm` endpoint) and exposing it as `window.chrono`. Verified live: "dentist tomorrow 2pm" and "gym next thursday 6am" now correctly parse into title/time/kind instead of falling back to raw text.

2. **Real regression found via that same test**: fixing chrono-node's date-shifting behavior exposed that `resolveQuickAddTitle()` updated the day-modal's header (`dayModalTitle`) when quick-add shifted the target day (e.g. "tomorrow") but never updated the body's own date label (`pdxDateLabel`) — so the modal showed two different dates at once (header said "AUG 26", body said "AUG 14"). Fixed by updating both together.

3. **A real hidden-content bug from the calendar redesign**: quests added via the Calendar tab's add-row were being saved correctly (and correctly created a linked calendar event, visible in the day's encounter list) but never visually appeared in the QUESTS list itself — `.mob-quest-list`'s computed height was a hard 0px despite containing a real 68px-tall task row. Root cause: `.mob-quest-list` had `min-height:0` (opting out of the browser's default flex-item shrink protection) but no `flex-grow`/`flex:1` to counteract it, so once the new week-strip added enough content to the same flex column to exceed the pane's available height, the flex-shrink algorithm crushed this one un-protected sibling to zero instead of letting the pane's own `overflow-y:auto` kick in. Fixed with `flex-shrink:0`. Checked every other `min-height:0` usage in the file — all of them pair it with `flex:1` (the correct pattern), so this was an isolated case, not a systemic one. This bug would not have been caught by a code review — it only surfaced by actually adding a quest and looking at the rendered page.

4. **A quieter completeness gap in Red's revision pipeline**: `mc_relevance` (the "how this ties back to Mission Control" field, only present on open-topic findings) was computed correctly on a revision but never persisted onto the thread record or carried into a shipped revision bundle — so revising an open-topic finding would silently drop that field. Fixed in `generateThreadRevision`/`maybeShipRevisionBundle`. Also improved revision-bundle wiki tagging to use `mission-control` only when it's NOT the case that every thread in the bundle was open-topic (previously always tagged `mission-control` regardless).

Also re-verified all 6 of ED's tools (queue_code_change, remove_queued_change, save_memory, forget_memory, add_task, log_expense) work correctly after the `runChatTurn` generalization — only `add_task` had been spot-checked before. Updated the `mission-control-features` memory with everything from this session (theme change, Gil/Calendar/Home redesign, Red's expansion, this bug-hunt) so a future session doesn't have to re-derive it or, worse, mistake the chrono-node error as "known and harmless" the way an earlier memory entry incorrectly said.
