---
status: pending
title: "Show Current Day Events on Home Screen"
date: "2026-10-04"
requested_via: "ED chat"
---

## What the user asked for

User wants the home screen to display their calendar events for today. Currently the home screen doesn't show a day view or event summary; adding a card or section that lists today's scheduled events would give quick visibility into the day's agenda at a glance.

## Implementation notes

Add a new card or section to the home screen (after the Gil Wallet or Calendar tile) that displays all calendar events for today. Include time, title, and kind/color-coding. Use the existing `eventsForDate()` function to pull today's events. Style it to match the existing bento grid aesthetic with neumorphic borders. If no events are scheduled, show a minimal "clear day" state. Consider making it clickable to open the full Calendar tab for more detail.
