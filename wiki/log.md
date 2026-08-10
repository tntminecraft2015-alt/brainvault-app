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

## [2026-05-16] sync | Mission Control Sync

**Operation:** sync
**Pages created:** [[calendar-events]]

Calendar events synced

## [2026-08-10] note | Mission Control Sync

**Operation:** note
**Pages created:** [[2026-08-10-design-research-weekly]]

Design research: Mission Control General Improvements: Cognitive Load, White Hat Gamification, Responsive Bento Evolution (3 findings)

## [2026-08-10] query | Mission Control Sync

**Operation:** query
**Pages created:** [[chat-2026-08-10]]

Chat session on 2026-08-10
