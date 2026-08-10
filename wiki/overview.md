---
type: overview
last_updated: "2026-05-08"
source_count: 3
---

# BrainVault — Overview

*The entry point for a cold-start read of this wiki. Updated after every significant ingest or synthesis.*

---

## What This Wiki Is

BrainVault is a personal LLM-maintained knowledge base implementing the [[llm-wiki-pattern]] described by [[andrej-karpathy]] in 2026. It is built in [[obsidian]], with Claude Code as the LLM maintainer. The human curates sources and asks questions; Claude reads, synthesizes, and maintains all wiki content.

The core principle: **knowledge is compiled once and kept current**, rather than re-derived from raw documents on every query. Every new source is integrated into the existing wiki — updating entity and concept pages, noting confirmations and contradictions, strengthening the synthesis. Over time the wiki becomes richer and more useful with each addition.

---

## Current State

**Sources ingested:** 3  
**Wiki pages:** 15  
**Last ingest:** 2026-05-08 — *2028 Summit St. Apartment Listing*

---

## Main Themes

### Knowledge Management Architecture

The central intellectual thread so far: how should an individual manage accumulating knowledge across many sources? The dominant paradigm — [[rag]] — re-derives answers at query time and doesn't accumulate. The [[llm-wiki-pattern]] is the proposed alternative: compile knowledge into a persistent wiki, maintained by the LLM, that compounds over time.

This idea connects back to [[memex|Vannevar Bush's Memex (1945)]] — a personal, associative knowledge store. The Memex was never built because no one could solve the maintenance problem. The LLM solves it.

### Human-LLM Collaboration Model

A recurring theme: the right division of labor between human and LLM. The human curates sources, directs analysis, and asks good questions. The LLM does bookkeeping, cross-referencing, synthesis maintenance, and filing. This model is more sustainable than either pure human maintenance (too burdensome) or pure LLM autonomy (no human judgment).

---

## Key Concepts

- [[llm-wiki-pattern]] — the core architectural pattern this wiki implements
- [[rag]] — the alternative to understand and contrast
- [[memex]] — the 1945 precursor that this pattern realizes

## Key Entities

- [[andrej-karpathy]] — originated the LLM Wiki pattern
- [[obsidian]] — the reading/browsing interface for this wiki
- [[marp]] — slide output format
- [[qmd]] — search engine for larger wikis

---

## Housing Search

A second use of this vault: tracking apartments under consideration near OSU. Each property gets an entity page (slug: `<address>`) with a details table, pros/cons, and a `status` field (`considering → toured → applied → leased/rejected`). Each listing document gets a source summary page (slug: `<address>-listing`).

Current properties:
- [[2040-iuka-ave-5b]] — `considering` — 1BR on Iuka Ravine; $850/mo, nice location, free parking, no in-unit W/D
- [[2028-summit-st]] — `considering` — 1BR on Iuka Ravine; $800/mo, balcony, AC, pet friendly, a little dirty

---

## Career Search

A third use of this vault: tracking music-career job leads around Columbus. Resume on file at `raw/thomas-terrell-resume.pdf`. See [[2026-08-10-columbus-music-career-job-leads]] for the current realistic lead list (venue bartending, church accompanist work, freelance arranging outreach, music retail, event staff, wedding gig work) with direct apply links.

---

## How to Use This Wiki

**To explore:** Start with [[index]] to see all pages. Use Obsidian's graph view to see the shape of the knowledge.

**To ingest a new source:** Drop a file in `raw/`, open a Claude Code session, and say "ingest `raw/filename.md`". Claude reads CLAUDE.md first, then follows the ingest workflow.

**To ask a question:** Open a Claude Code session and ask directly. Claude will read the index, find relevant pages, and synthesize an answer. Good answers get saved to `wiki/analyses/`.

**To lint the wiki:** Ask Claude to "lint the wiki" in a session. It will check for orphans, contradictions, gaps, and stale content.
