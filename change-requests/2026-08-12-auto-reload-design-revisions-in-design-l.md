---
status: done
title: "Auto-reload design revisions in Design Lab"
date: "2026-08-12"
requested_via: "ED chat"
---

## What the user asked for

Design Lab required manually reopening the slideshow to see revised findings after rating one — no indication a revision had even shipped. This implements auto-reload: the Design Lab list and any open slideshow poll for new research/revisions while open, a small pulsing dot shows live-checking is active, a banner announces a ready revision and cross-fades it in automatically after a few seconds, and a pause button in the slideshow footer lets the user freeze auto-refresh mid-read.

## Implementation notes

Implemented directly in mission-control.html: checkDlListForNewRuns()/checkSlideshowForRevision() poll GET /api/design-research every 10s only while the relevant modal has the .active class; dl-live-dot pulses via CSS animation; new list rows fade in with dl-row-new; #dlRevisionBanner shows on a fresh isRevision run and swaps the #dlSlideshowFrame src with an opacity fade unless _slideshowPaused is true; #dlPauseBtn toggles that flag. No backend changes needed — reuses the existing design-research/rate endpoints.

_Note: this file's original spec text was lost to a since-fixed sync bug (see commit b468642) — this content was reconstructed from the chat log and Red's own research on the topic before implementation._
