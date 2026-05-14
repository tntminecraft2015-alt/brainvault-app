---
type: entity
entity_type: tool
title: "qmd"
last_updated: "2026-05-07"
tags: [tool, search, markdown, bm25, vector-search]
---

# qmd

A local search engine for markdown files using hybrid BM25/vector search with LLM re-ranking. Runs entirely on-device. Provides both a CLI (for LLM shell-out) and an MCP server (for native LLM tool use).

## Background

qmd is designed for searching large collections of markdown files — the exact use case of the [[llm-wiki-pattern]] at scale. At moderate wiki size (~100 sources, ~hundreds of pages), the `index.md` catalog is sufficient for navigation. As the wiki grows, proper search becomes necessary.

## Key Features

- **Hybrid search** — combines BM25 (keyword) and vector (semantic) search
- **LLM re-ranking** — results are re-ranked by an LLM for relevance to the query
- **On-device** — no cloud dependencies; all processing local
- **CLI** — LLM agents can shell out to it for search results
- **MCP server** — exposes search as a native tool for MCP-compatible LLM clients

## When to Use

Karpathy recommends adding qmd when the wiki grows to a size where the index file alone is insufficient for reliable navigation. This is optional and modular — start with the index, add qmd when needed.

## Relationships

- **Used by:** [[llm-wiki-pattern]] — as optional search infrastructure at scale
- **Alternative to:** index.md navigation (at small scale, index is sufficient)

## Appearances in Sources

- [[karpathy-llm-wiki]] — recommended as the search solution for larger wikis
