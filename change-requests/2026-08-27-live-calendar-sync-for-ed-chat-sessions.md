---
status: pending
title: "Live calendar sync for ED chat sessions"
date: "2026-08-27"
requested_via: "ED chat"
---

## What the user asked for

ED currently reads calendar events from a static markdown file that can lag hours or days behind what's actually in Mission Control. The user's asking why ED can't see their updated class schedule. ED should fetch live calendar data from the Render API at session start, the same way the app's own UI does, so ED always sees current events instead of stale context.

## Implementation notes

Add an endpoint or extend an existing one in `server.js` that returns the current calendar events from `appData.calendarEvents` as JSON. At the start of each ED chat session, fetch this endpoint and use the live data to populate the calendar context instead of reading from the static markdown file in the wiki. This ensures ED always sees what's actually in the app, matching the user's expectation that ED has access to "the calendar."
