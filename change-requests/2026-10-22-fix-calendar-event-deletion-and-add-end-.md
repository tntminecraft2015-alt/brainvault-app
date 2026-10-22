---
status: pending
title: "Fix calendar event deletion and add end time support"
date: "2026-10-22"
requested_via: "ED chat"
---

## What the user asked for

User's calendar data has overlapping/duplicate work events that can't be deleted through the normal delete flow. They need two fixes: (1) a way to actually see and delete duplicate/corrupt events directly in the UI (either a calendar data browser or a manual cleanup tool), and (2) add support for event end times throughout the app — currently only start times are stored, which makes it hard to manage overlapping events and display them properly.

## Implementation notes

1. **Calendar Data Cleaner/Browser:** Add a view in Mission Control (maybe under Settings or a new Calendar Admin tab) that lists all calendar events with their full data (title, date, time, recurrence rule, id). Let users see duplicates and one-off events clearly, with a delete button per event. This helps users manually clean up corrupt data.

2. **Event End Times:** Extend the calendar event model to store an `endTime` field (24h HH:MM format, optional). Update add_calendar_event and edit_calendar_event to accept this. Display events with both start and end times in the calendar view (e.g., "4:00 PM – 5:30 PM"). This prevents overlapping events from being confusing and makes the calendar more usable.
