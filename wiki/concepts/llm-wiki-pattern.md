---
type: concept
title: "LLM Wiki Pattern"
aliases: ["LLM Wiki", "wiki-as-knowledge-base"]
source_count: 1
last_updated: "2026-05-07"
tags: [llm, knowledge-management, wiki, pattern]
---

# LLM Wiki Pattern

A method for building personal knowledge bases where an LLM incrementally maintains a persistent, interlinked wiki of markdown files — rather than re-deriving answers from raw documents at query time.

## Overview

The core insight is that most LLM+document systems (RAG, NotebookLM, ChatGPT file uploads) re-derive knowledge from scratch on every query. They don't accumulate. Ask a question requiring synthesis across five documents and the LLM has to hunt for the relevant fragments every time.

The LLM Wiki pattern inverts this. When a new source arrives, the LLM **compiles** it into the wiki: writing summary pages, updating entity and concept pages, noting where new data confirms or contradicts existing claims. By the time you ask a question, the synthesis has already been done. The wiki is a persistent, compounding artifact — richer every time you add a source or ask a question.

The human's role is to curate sources, direct the analysis, and ask good questions. The LLM's role is everything else: summarizing, cross-referencing, filing, maintaining consistency across dozens of pages. LLMs are ideally suited for this because they have near-zero maintenance cost and don't forget to update cross-references.

## Three Layers

1. **Raw sources** (`raw/`) — Immutable. The LLM reads but never modifies.
2. **Wiki** (`wiki/`) — LLM-owned. The persistent, compounding knowledge artifact.
3. **Schema** (CLAUDE.md) — Co-evolved by human and LLM. Defines structure, conventions, and workflows.

The schema is the key enabler: it's what makes the LLM a disciplined maintainer rather than a generic chatbot. It should be refined iteratively as the wiki grows and the human's needs become clearer.

## Three Operations

**Ingest** — process a new source into the wiki. One source typically touches 5–15 pages: a summary page, updated concept pages, updated entity pages, an index update, and a log entry. Prefer ingesting one source at a time with human oversight.

**Query** — ask questions against the wiki. The LLM reads the index, drills into relevant pages, synthesizes an answer with citations. Answers worth keeping should be saved as analysis pages — this is how explorations compound.

**Lint** — periodic health check. Find orphan pages, contradictions between pages, stale claims, concepts lacking their own page, missing cross-references, and gaps to fill with web searches.

## Indexing and Navigation

Two special files handle navigation:

- **`index.md`** — content-oriented catalog. Every page listed with a link and one-line summary, organized by category. Read first when answering a query.
- **`log.md`** — chronological, append-only record of all operations. The `## [YYYY-MM-DD]` prefix makes it greppable.

At moderate scale (~100 sources, ~hundreds of pages), the index is sufficient for navigation. At larger scale, a search engine like [[qmd]] is useful.

## Compounding Value

The wiki becomes more valuable over time in two ways:
- **Source compounding**: each new source is integrated into existing pages, strengthening or challenging the synthesis
- **Query compounding**: good answers are filed as analysis pages, building a library of synthesized insights

This is in contrast to RAG systems where value is flat — the 100th query is no faster or richer than the 1st.

## Tooling Stack

| Tool | Role |
|---|---|
| [[obsidian]] | Wiki reader / browser (graph view, backlinks, Dataview) |
| Claude Code / LLM agent | Wiki writer / maintainer |
| [[marp]] | Slide output from wiki content |
| [[qmd]] | Search engine at scale (optional) |
| Git | Version history, branching, collaboration |
| Obsidian Web Clipper | Convert web articles to markdown for `raw/` |

## Relationships

- **Contrasts with:** [[rag]] — the dominant alternative; re-derives at query time, doesn't accumulate
- **Realizes:** [[memex]] — Bush's 1945 vision of associative, curated personal knowledge
- **Uses:** [[obsidian]] as the reading/browsing layer
- **Related to:** fan wikis (Tolkien Gateway), internal team wikis

## Sources

- [[karpathy-llm-wiki]] — origin of the pattern; this page is the primary synthesis of that source

## Open Questions

- At what source count does `index.md` navigation break down and require a search engine?
- How should the schema handle domain-specific page types (e.g., for a medical wiki vs. a research wiki)?
- What's the best way to handle conflicts when two sources make mutually exclusive claims?
- How does this pattern extend to multi-user or team wikis with human review loops?
