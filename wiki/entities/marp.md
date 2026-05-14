---
type: entity
entity_type: tool
title: "Marp"
last_updated: "2026-05-07"
tags: [tool, markdown, slides, presentation]
---

# Marp

A markdown-based slide deck format and toolchain. Write slides in plain markdown; Marp renders them as HTML or PDF presentations. An [[obsidian]] plugin renders Marp slides directly in the vault.

## Background

Marp (Markdown Presentation Ecosystem) allows presentation slides to be authored in plain markdown with a small set of directives for layout and theming. Because slides are markdown, an LLM can generate them directly from wiki content — turning a concept page or analysis into a presentation without leaving the text format.

## Relevance to This Wiki

When a query answer is best expressed as a structured presentation rather than a single page, the LLM can output it in Marp format and save it to `wiki/analyses/`. The Obsidian Marp plugin renders it in-vault.

## Relationships

- **Used by:** [[llm-wiki-pattern]] — as an output format for wiki content
- **Runs in:** [[obsidian]] — via plugin

## Appearances in Sources

- [[karpathy-llm-wiki]] — listed as an output format for query answers
