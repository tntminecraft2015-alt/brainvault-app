---
type: concept
title: "Retrieval-Augmented Generation (RAG)"
aliases: ["RAG", "retrieval-augmented generation"]
source_count: 1
last_updated: "2026-05-07"
tags: [llm, rag, retrieval, knowledge-management]
---

# Retrieval-Augmented Generation (RAG)

A technique where an LLM retrieves relevant chunks from a document collection at query time and uses them to generate an answer, rather than relying on knowledge baked into its weights.

## Overview

RAG is the dominant paradigm for LLM+document systems. The workflow: documents are chunked and embedded into a vector store; when a query arrives, the most relevant chunks are retrieved and passed to the LLM as context; the LLM generates an answer grounded in the retrieved chunks.

Systems like NotebookLM, ChatGPT file uploads, and most enterprise document Q&A tools work this way.

## Key Properties

- **Query-time retrieval** — knowledge is not pre-compiled; the LLM rediscovers it on every query
- **Flat value curve** — the 100th query is no richer than the 1st; nothing accumulates
- **Works best for** — factual lookup, where a single chunk contains the answer
- **Struggles with** — synthesis questions that require combining information across many documents

## Limitations (per Karpathy)

> "The LLM is rediscovering knowledge from scratch on every question. There's no accumulation."

Ask a question requiring synthesis across five documents and the LLM must find and piece together the relevant fragments every time. Nothing is built up. Contradictions between sources are never flagged in advance. Cross-references are never pre-computed.

## Contrast with LLM Wiki Pattern

| Dimension | RAG | [[llm-wiki-pattern\|LLM Wiki]] |
|---|---|---|
| Knowledge compilation | Query-time | Ingest-time |
| Accumulation | No | Yes |
| Synthesis | Re-derived each time | Pre-compiled and current |
| Contradiction detection | Never | Flagged during ingest |
| Cross-references | None | Maintained by LLM |
| Value over time | Flat | Compounding |
| Infrastructure | Vector store + embeddings | Markdown files |

## When RAG Is Still Appropriate

- Very large corpora (millions of documents) where ingest-time synthesis is impractical
- Corpora that change constantly (news feeds, live databases)
- Cases where the user needs a direct quote from a specific source, not synthesis
- When the latency/cost of ingest-time processing is prohibitive

## Relationships

- **Contrasts with:** [[llm-wiki-pattern]] — the key alternative this concept is defined against
- **Used by:** NotebookLM, ChatGPT file uploads, most enterprise Q&A systems
- **Related to:** vector databases, embedding models, BM25 search

## Sources

- [[karpathy-llm-wiki]] — primary framing of RAG as the foil to the LLM Wiki pattern
