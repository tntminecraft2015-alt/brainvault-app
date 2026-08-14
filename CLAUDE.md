# BrainVault — Wiki Schema & Operating Instructions

This file is the schema for Claude (or any LLM agent) operating in this Obsidian vault. It defines the directory structure, file conventions, and workflows to follow. Read it at the start of every session.

---

## What This Vault Is

BrainVault is a **personal LLM-maintained wiki** following Andrej Karpathy's LLM Wiki pattern. The human curates sources and asks questions. The LLM reads, synthesizes, and maintains all wiki content. Knowledge accumulates and compounds over time — it is never re-derived from scratch.

The vault has three layers:
1. **`raw/`** — Immutable source documents. The LLM reads from here; never writes or modifies.
2. **`wiki/`** — LLM-generated markdown pages. The LLM owns this entirely.
3. **`CLAUDE.md`** (this file) — The schema. Human and LLM co-evolve it over time.

---

## Directory Structure

```
BrainVault/
├── CLAUDE.md                  ← This file. Read first every session.
├── raw/                       ← Immutable sources (human adds; LLM reads only)
│   ├── assets/                ← Downloaded images (set as Obsidian attachment folder)
│   └── *.md                   ← Clipped articles, papers, transcripts, notes
├── wiki/                      ← LLM-maintained knowledge base
│   ├── index.md               ← Catalog of all wiki pages (update every ingest)
│   ├── log.md                 ← Append-only record of all operations
│   ├── overview.md            ← High-level synthesis of the whole wiki
│   ├── sources/               ← One summary page per ingested source
│   ├── concepts/              ← Ideas, frameworks, patterns, topics
│   ├── entities/              ← People, organizations, tools, projects
│   └── analyses/              ← Syntheses, comparisons, Q&A pages worth keeping
└── templates/                 ← Page templates (reference when creating new pages)
    ├── source.md
    ├── concept.md
    ├── entity.md
    └── analysis.md
```

---

## File Naming Conventions

- All filenames: lowercase, hyphen-separated, no spaces. E.g. `llm-wiki-pattern.md`
- Source pages: match the raw filename. E.g. `raw/karpathy-llm-wiki.md` → `wiki/sources/karpathy-llm-wiki.md`
- Entity pages: `<name>.md` for people, `<tool-name>.md` for tools
- Concept pages: the concept's canonical name, hyphenated
- Analysis pages: descriptive slug, optionally prefixed with date: `2026-05-07-rag-vs-wiki.md`

---

## Frontmatter Schema

Every wiki page must open with YAML frontmatter. Use these fields:

**Source pages:**
```yaml
---
type: source
title: "Human-readable title"
author: "Author name(s)"
date_ingested: "YYYY-MM-DD"
source_file: "raw/filename.md"
url: "https://..."          # if applicable
tags: [tag1, tag2]
---
```

**Concept pages:**
```yaml
---
type: concept
title: "Concept Name"
aliases: ["alternate name"]  # optional
source_count: N              # number of sources contributing to this page
last_updated: "YYYY-MM-DD"
tags: [tag1, tag2]
---
```

**Entity pages:**
```yaml
---
type: entity
entity_type: person | org | tool | project | property
title: "Entity Name"
last_updated: "YYYY-MM-DD"
tags: [tag1, tag2]
---
```

**Analysis pages:**
```yaml
---
type: analysis
title: "Analysis Title"
date: "YYYY-MM-DD"
tags: [tag1, tag2]
---
```

---

## Cross-Linking Rules

- Always use Obsidian wiki-links: `[[page-name]]` or `[[page-name|Display Text]]`
- Link to pages in subdirectories with their filename only (Obsidian resolves automatically): `[[llm-wiki-pattern]]`
- Every page should have at least 2 inbound links from other wiki pages
- When creating a new page for a concept already mentioned elsewhere, go back and add links in those older pages

---

## Workflow: Ingest

When the human drops a new file in `raw/` and says "ingest":

1. **Read** the source file fully
2. **Discuss** key takeaways with the human — clarify emphasis, flag surprising claims
3. **Write** a source summary page in `wiki/sources/`
4. **Update or create** relevant concept pages in `wiki/concepts/`
5. **Update or create** relevant entity pages in `wiki/entities/`
6. **Update** `wiki/overview.md` if the source shifts the synthesis
7. **Update** `wiki/index.md` — add new pages, update summaries of changed pages
8. **Append** an entry to `wiki/log.md` (see Log Format below)
9. **Push to GitHub** so the cloud site updates — run this in the BrainVault directory:
   ```
   git add -f wiki/ CLAUDE.md app-data.json templates/
   git commit -m "ingest: <source-title>"
   git push vault master
   ```

A single source typically touches 5–15 wiki pages. Bias toward updating existing pages over creating new stubs.

When creating or updating concept/entity pages, explicitly note if the new source **confirms**, **contradicts**, or **extends** what was previously there.

**Property/apartment sources:** If the raw file does not include a rent/price, ask the human for it before finishing the ingest. Do not complete the wiki pages without it. Similarly, if distance from OSU is not clearly stated, ask the human before finishing the ingest.

---

## Workflow: Query

When the human asks a question:

1. Read `wiki/index.md` to find relevant pages
2. Read those pages in full
3. Synthesize an answer with citations to wiki pages (e.g. `see [[llm-wiki-pattern]]`)
4. **If the answer is non-trivial and reusable**, offer to save it as a page in `wiki/analyses/`
5. If the answer reveals a gap or contradiction, note it and offer to address it

---

## Workflow: Lint

When the human asks for a health check (or periodically suggest one):

Check for:
- Orphan pages (no inbound links from other wiki pages)
- Contradictions between pages (flag explicitly, don't silently resolve)
- Stale claims that newer sources have superseded
- Concepts mentioned in multiple pages but lacking their own page
- Missing cross-references between related pages
- Gaps that could be filled with a web search

Produce a lint report. Fix obvious structural issues (orphans, missing links). Flag contradictions and gaps for human review.

---

## Workflow: Mission Control Change Requests

Mission Control (`mission-control.html` + `server.js`) is a separate app living in this same repo, pushed to the `app` remote (see "Mission Control git remotes" — not the wiki). Neither ED (chat assistant) nor Red (design researcher) can edit code themselves, so both queue requests instead of acting on them directly, via `change-requests/*.md` (frontmatter `status: pending`, `requested_via: "ED chat"` or `"Design Lab"`):
- **ED** writes a full spec (what was asked + implementation notes) when the human asks it for a Mission Control change mid-conversation.
- **Red** — from the Design Lab slideshow, rating a finding "Got it ✓" auto-queues that finding as-is: title/description/source, plus Red's own mockup HTML embedded as a fenced code block under "Red's mockup for this finding" in the Implementation notes — treat that mockup as the concrete visual reference (real colors, real layout), not just the prose above it.

Both log a `note` entry in `wiki/log.md` when queued.

**Two places hold the same queue, and they can drift — `app-data.json`'s `changeRequests` array is authoritative for status; the `.md` file is a disposable, human-readable mirror of one request's spec.** The app's own UI (Change Queue modal, ED's pending-queue context) reads only from `app-data.json`, so if you flip a `.md` file's frontmatter without also updating its array entry, the app will keep showing it as pending forever.

**This is a pull queue, not an auto-run one — do not implement pending requests just because a session started.** At the start of a session it's fine to check what's waiting and mention the count/titles to the human, but only implement when the human explicitly says to run the queue (e.g. "run the queue," "do the queued changes"):
```
grep -l "status: pending" change-requests/*.md
```

When told to run the queue, for each pending request:
1. Read the file — it has a "What the user asked for" section (intent) and an "Implementation notes" section (spec, plus Red's mockup HTML if it came from Design Lab).
2. Implement the change in `mission-control.html` / `server.js`.
3. Mark it done in **both** places, together, as one step: delete the `change-requests/<id>.md` file, and in `app-data.json` find the matching entry in `changeRequests` (same `id`) and set its `status` to `"done"`. Skipping either half leaves the queue in a state that contradicts itself.
4. Ask the human before pushing to the `app` remote (pushing deploys live to Render).

Don't treat these specs as gospel — both ED and Red are Haiku-model agents improvising from one conversation or one finding, not a design doc; use judgment same as any other feature request.

---

## Log Format

`wiki/log.md` is append-only. Each entry:

```markdown
## [YYYY-MM-DD] <operation> | <title>

**Operation:** ingest | query | lint | note
**Source:** `raw/filename.md` (for ingests)
**Pages created:** [[page1]], [[page2]]
**Pages updated:** [[page3]], [[page4]]

Brief narrative of what happened, what was surprising, what was added.
```

The `## [YYYY-MM-DD]` prefix makes entries greppable: `grep "^## \[" wiki/log.md | tail -5`

---

## Index Format

`wiki/index.md` is organized by category. Each entry: one line with a link and a one-sentence summary.

```markdown
## Sources
- [[source-slug]] — What the source is and its main contribution

## Concepts
- [[concept-name]] — One-sentence definition or summary

## Entities
- [[entity-name]] — Who/what they are, why they're in this wiki

## Analyses
- [[analysis-slug]] — What question it answers
```

Update the index on every ingest. Keep summaries tight — one line each.

---

## Working Principles

- **The LLM writes the wiki. The human reads it.** Don't ask the human to maintain pages.
- **Synthesize, don't just summarize.** Concept pages should reflect the accumulated understanding from all sources, not just the latest one.
- **Flag contradictions explicitly.** Use a `> [!warning] Contradiction` callout when sources disagree.
- **Prefer updating over creating.** A richer existing page beats a new stub.
- **No orphans.** Every new page should be linked from at least one other page before the session ends.
- **Keep overview.md current.** It's the entry point for a cold-start read of the wiki.
