---
status: pending
title: "Improve Change Queue UI: Dropdown & Text Readability"
date: "2026-08-12"
requested_via: "ED chat"
---

## What the user asked for

The change queue dropdown is clunky and hard to use — text is hard to read and opening the dropdown to see queued change details requires too much friction. User wants it to be easier to see what's actually in the queue at a glance without jumping through hoops.

## Implementation notes

Redesign the change queue dropdown/modal to improve readability and accessibility. Make it easier to open, scan, and understand what changes are pending. Consider: larger/clearer text, better contrast, a more prominent or persistent queue panel, or a cleaner modal layout. Look at the current CSS variables (--fg, --accent, --surface, etc.) and use them to make the queue info pop without breaking the existing design language.
