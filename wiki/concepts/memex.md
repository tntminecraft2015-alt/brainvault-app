---
type: concept
title: "Memex"
aliases: ["memex", "Vannevar Bush Memex"]
source_count: 1
last_updated: "2026-05-07"
tags: [knowledge-management, history, vannevar-bush, hypertext]
---

# Memex

A hypothetical personal knowledge device described by Vannevar Bush in his 1945 essay *As We May Think*. The Memex would store a person's books, records, and communications, and allow them to create associative "trails" linking related documents — a precursor to hypertext and the web.

## Overview

Bush imagined the Memex as a desk-sized device with microfilm reels storing a person's entire library. The key feature wasn't storage — it was **associative indexing**: the ability to link any document to any other, creating trails of thought that could be saved, revisited, and shared. Bush believed this associative structure mirrored how the human mind actually works, unlike the hierarchical classification systems of his time.

The Memex was never built. Its ideas were influential on Doug Engelbart's work, Ted Nelson's hypertext, and eventually the World Wide Web — though the web became more public and less personal than Bush envisioned.

## Key Properties

- **Personal and private** — a person's own curated collection, not a public resource
- **Associative trails** — links between documents are as valuable as the documents themselves
- **Actively curated** — the human decides what goes in and how it's connected
- **Persistent** — trails and associations accumulate over time

## What Bush Couldn't Solve

Bush's vision required a human to maintain all the cross-references, file new documents into the trail network, and keep everything current. In practice, this is too labor-intensive for individuals to sustain. Wikis and the web solved the public version of this with distributed crowds — but personal wikis have historically been abandoned because the maintenance burden exceeds the value for a single person.

> "The part [Bush] couldn't solve was who does the maintenance. The LLM handles that." — Karpathy

## The LLM Resolution

The [[llm-wiki-pattern]] is a direct realization of the Memex vision. The key ingredient Bush lacked was an automated maintainer. The LLM fills this role: it updates cross-references, notes contradictions, keeps summaries current, and never gets bored. The human remains the curator and thinker; the LLM is the librarian and bookkeeper.

## Relationships

- **Inspired:** hypertext (Ted Nelson), the World Wide Web, Engelbart's NLS
- **Realized by:** [[llm-wiki-pattern]] — the LLM provides the missing maintenance layer
- **Related to:** personal knowledge management (PKM), Zettelkasten, Roam Research, [[obsidian]]

## Sources

- [[karpathy-llm-wiki]] — cited the Memex as the conceptual precursor to the LLM Wiki pattern

## Open Questions

- How does the LLM Wiki pattern differ from the Memex in the treatment of "trails" vs. structured pages?
- What did Bush's vision get wrong? (The web became public and link-based, not personal and trail-based.)
