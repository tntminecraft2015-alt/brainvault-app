---
status: pending
title: "Unified Quest/Calendar Sync with Dual Views"
date: "2026-08-12"
requested_via: "ED chat"
---

## What the user asked for

User wants quests and calendar events to be deeply integrated so that adding a task creates a calendar event and vice versa, keeping them synced. The quest view should show a filtered, daily-focused UI of today's items (tasks + events combined), while the calendar view shows the full month with all items visible across dates.

## Implementation notes

**Behavior:**
- When a task is added to quests, automatically create a corresponding calendar event on that date
- When a calendar event is added, automatically create a corresponding task in the quest list
- Both should reference each other so they update/delete together
- Editing one should update the other

**Quest View (Daily):**
- Show today's tasks and calendar events in a unified list
- Display both kinds of items in a single scrollable interface
- Keep the existing quest UI styling but include event items alongside tasks

**Calendar View (Monthly):**
- Show the full month grid as it does now
- Display all tasks and events across all dates in the month
- Both should be visually represented on the calendar tiles

**Implementation notes:**
- Add a `linkedEventId` field to tasks and `linkedTaskId` field to events in localStorage to maintain the sync relationship
- Update `addTask()` and `addDayEvent()` to create the paired item
- Update `deleteTask()` and `deleteDayEv()` to remove both linked items
- Filter quest view to show only today's date using existing date logic
- Ensure calendar rendering includes both event and task data
