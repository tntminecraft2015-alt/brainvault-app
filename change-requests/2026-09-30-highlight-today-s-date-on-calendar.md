---
status: pending
title: "Highlight today's date on calendar"
date: "2026-09-30"
requested_via: "ED chat"
---

## What the user asked for

User wants the calendar to visually highlight the current day so it's immediately obvious which day is today when looking at the month/week view.

## Implementation notes

In the calendar UI (buildCalGrid function and related calendar rendering), add a visual highlight to the cell/element representing today's date. Use the existing --accent color (#ff8a63) or --green (#7fffb0) for the highlight — apply it as a background color, border, or other prominent visual indicator. Make sure the highlight is distinctive enough to stand out from other dates but doesn't interfere with readability of the date number or any event labels.
