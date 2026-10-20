---
status: pending
title: "Google Calendar Sync Integration"
date: "2026-10-20"
requested_via: "ED chat"
---

## What the user asked for

User wants Mission Control calendar events to sync bidirectionally with Google Calendar so that updates in one automatically reflect in the other. Currently all calendar data is stored locally in localStorage with no cloud sync capability.

## Implementation notes

Add Google Calendar OAuth integration to Mission Control. Required changes:

**Backend (server.js):**
- Implement Google OAuth 2.0 flow (authorization code grant)
- Store user's Google Calendar credentials securely
- Periodic sync job to push Mission Control events to Google Calendar and pull Google Calendar events back
- Handle conflict resolution (e.g., if same event edited in both places)
- Endpoints for: `/auth/google`, `/auth/google/callback`, `/sync/google-calendar`

**Frontend (mission-control.html):**
- Add "Connect Google Calendar" button in settings modal
- Show sync status (last synced, connected/disconnected)
- Toggle to enable/disable sync
- Handle OAuth redirect back to app after user authorizes

**Data:**
- Store Google Calendar credentials in app-data.json alongside existing calendar events
- Track sync metadata (lastSyncTime, googleCalendarId, etc.)

Start with one-way sync (Mission Control → Google Calendar) if bidirectional is complex. Preserve existing localStorage calendar behavior as fallback if sync fails.
