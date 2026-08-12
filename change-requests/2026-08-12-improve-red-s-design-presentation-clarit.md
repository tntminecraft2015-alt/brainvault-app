---
status: done
title: "Improve Red's design presentation clarity and visual quality"
date: "2026-08-12"
requested_via: "ED chat"
---

## What the user asked for

Red (the design research agent) currently outputs findings that are hard to comprehend visually. User wants Red to focus on making the designs it presents look better — clearer layouts, better visual hierarchy, more polished mockups so the ideas are actually understandable at a glance rather than requiring heavy explanation.

## Implementation notes

This is a note for Red's system prompt / instructions, not a Mission Control code change. When Red next runs, update its instructions to prioritize visual clarity and polish in design presentations:

- Use better visual hierarchy (sizes, spacing, contrast) to guide the eye
- Create cleaner mockups/wireframes that are self-explanatory
- Use color and typography purposefully, not arbitrarily
- Ensure layouts are scannable at a glance
- Add subtle visual cues (icons, whitespace, grouping) that make intent obvious
- Test comprehensibility: would someone understand this design in 5 seconds without reading notes?
- Treat presentation as part of the design work, not an afterthought

Red should spend more time on making ideas *visually communicable* before presenting them to the human.
