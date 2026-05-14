---
type: entity
entity_type: tool
title: "Obsidian"
last_updated: "2026-05-07"
tags: [tool, note-taking, markdown, pkm, obsidian]
---

# Obsidian

A local-first, markdown-based note-taking application used as the reading and browsing interface for the [[llm-wiki-pattern]]. Built on an open file format (plain markdown), making it interoperable with any LLM agent that can read and write files.

## Background

Obsidian stores notes as plain markdown files in a local directory called a vault. It renders backlinks, a graph view of connections between notes, and supports plugins for extended functionality. Because files are plain markdown on disk, an LLM agent can read and write them directly — making Obsidian an ideal "IDE" for the LLM Wiki pattern.

## Key Features Relevant to This Wiki

- **Graph view** — visualizes connections between wiki pages; best way to see which pages are hubs and which are orphans
- **Backlinks panel** — shows all pages that link to the current page; useful for checking cross-link coverage
- **Dataview plugin** — runs queries over YAML frontmatter; enables dynamic tables and lists from wiki metadata
- **Marp plugin** — renders [[marp|Marp]]-formatted markdown as slide decks
- **Web Clipper browser extension** — converts web articles to markdown; primary tool for populating `raw/`
- **Image download hotkey** — Settings → Hotkeys → "Download attachments for current file"; downloads inline images to `raw/assets/`

## Recommended Settings for This Wiki

- **Attachment folder:** `raw/assets/` (Settings → Files and links)
- **Default new file location:** `wiki/` (or leave as vault root and move manually)

## Relationships

- **Used by:** [[llm-wiki-pattern]] — as the human-facing reading layer
- **Related to:** [[memex]] — Obsidian is sometimes described as a modern personal Memex
- **Pairs with:** Dataview plugin, Marp plugin, Web Clipper extension

## Appearances in Sources

- [[karpathy-llm-wiki]] — recommended as the reading/browsing interface; "Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase"
