---
status: pending
title: "Remove \"NEXT UP\" mission button from Home screen"
date: "2026-08-26"
requested_via: "ED chat"
---

## What the user asked for

User wants the "NEXT UP" mission button removed from the Home screen — they say it serves no purpose. Just delete it from the UI.

## Implementation notes

Find the "NEXT UP" button/section on the Home screen in `mission-control.html` and remove it entirely. This is likely in the home rendering function (probably `renderMobHomeNext()` or similar based on the function-name inventory) — remove the button trigger, the modal it opens, and any related CSS.
