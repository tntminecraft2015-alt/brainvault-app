# Log

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
