---
status: pending
title: "Redesign add quest/event modal for cleaner UX"
date: "2026-09-30"
requested_via: "ED chat"
---

## What the user asked for

User wants the add quest/event modal to be cleaner and easier to use. Research on structured calendar apps (Apple Calendar, Todoist, Things 3, Fantastical) shows patterns: make "add event" one-tap and always visible; use vertical list layout instead of complex grids; show clean calendar picker instead of text input; consider floating action button for fast entry; use subtle visual cues (gradients, highlighting) to mark current date without clutter.

## Implementation notes

Redesign the add event/quest modal to:
1. Simplify the modal form to essentials only: title, date (via visual calendar picker), time, and type/kind selector
2. Replace text-based date input with an inline calendar grid picker
3. Use vertical list layout for event type options instead of radio buttons/grid
4. Consider adding a floating "+" button for quick access to add events (currently only accessible via menu)
5. Add subtle visual highlight (gradient or background color) to mark today's date in the calendar picker
6. Keep the modal accessible but make common actions (add event, set time, pick type) require fewer taps

Reference patterns from: Apple Calendar (one-tap visible add button), Todoist (clean form hierarchy), Things 3 (vertical list layout, gradient on current date), Fantastical (split calendar/timeline views for clarity).
