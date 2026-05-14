---
type: source
title: "LLM Wiki — A Pattern for Personal Knowledge Bases"
author: "Andrej Karpathy"
date_ingested: "2026-05-07"
source_file: "raw/karpathy-llm-wiki.md"
url: "https://gist.github.com/karpathy/..."
tags: [llm, knowledge-management, obsidian, wiki, rag]
---

# LLM Wiki — A Pattern for Personal Knowledge Bases

**Author:** Andrej Karpathy  
**Source:** `raw/karpathy-llm-wiki.md`  
**Ingested:** 2026-05-07

## Summary

This gist describes a pattern for building personal knowledge bases where an LLM acts as the wiki maintainer rather than a query-time retriever. Instead of the standard [[rag|RAG]] approach — where every question re-derives answers from raw documents — the LLM incrementally builds and maintains a persistent, interlinked wiki of markdown files. The wiki accumulates and compounds over time. The human curates sources and asks questions; the LLM does all the filing, cross-referencing, and bookkeeping.

Karpathy describes this as a realization of Vannevar Bush's [[memex]] vision from 1945: a personal, curated knowledge store with associative trails. The part Bush couldn't solve was maintenance. The LLM solves that.

## Key Takeaways

- The fundamental shift: **compile knowledge once**, keep it current — don't re-derive it on every query.
- The wiki is a **persistent, compounding artifact**. Cross-references and contradictions are already resolved before you ask a question.
- A **schema file** (CLAUDE.md / AGENTS.md) is what makes the LLM a disciplined wiki maintainer rather than a generic chatbot. It should be co-evolved between human and LLM.
- Good query answers should be **filed back into the wiki** as analysis pages — explorations compound just like ingested sources.
- **Obsidian** is the recommended IDE for reading the wiki; the LLM is the programmer; the wiki is the codebase.
- At scale (~100+ sources), a search tool like [[qmd]] is useful; at moderate scale, `index.md` alone is sufficient.

## Key Claims

- One source may touch 10–15 wiki pages during ingest.
- The maintenance burden is why humans abandon wikis — LLMs have near-zero maintenance cost.
- LLMs can't natively read markdown with inline images in one pass; workaround is read text first, then view images separately.
- The wiki is just a git repo of markdown files — version history, branching, and collaboration are free.

## Architecture Layers

| Layer | Owner | Mutability |
|---|---|---|
| `raw/` — source documents | Human | Immutable |
| `wiki/` — synthesized pages | LLM | LLM writes/updates |
| Schema (CLAUDE.md) | Human + LLM | Co-evolved |

## Operations Defined

- **Ingest** — read source, discuss, write summary, update entity/concept pages, update index, append to log
- **Query** — read index, read relevant pages, synthesize answer with citations; optionally save as analysis page
- **Lint** — health-check: find orphans, contradictions, stale claims, missing pages, gaps for web search

## Connections

- **Contrasts with:** [[rag]] — the core alternative this pattern replaces at query time
- **Realizes:** [[memex]] — Bush's 1945 vision, now solvable because the LLM handles maintenance
- **Uses:** [[obsidian]] as the reading/browsing interface
- **Uses:** [[marp]] for slide output format
- **Uses:** [[qmd]] as optional search engine at scale
- **Enables:** [[llm-wiki-pattern]] — the full pattern as a concept page

## Quotes

> "The wiki keeps getting richer with every source you add and every question you ask."

> "The tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping."

> "Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase."

> "The part [Bush] couldn't solve was who does the maintenance. The LLM handles that."
