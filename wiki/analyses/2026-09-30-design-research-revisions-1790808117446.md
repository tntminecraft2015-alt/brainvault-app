---
type: analysis
title: "Revisions: \"Crossfade Card Swap with Mockup Persistence\", \"Lock Screen Pre-Filled Income S…"
date: "2026-09-30"
tags: [design, ui-ux, mission-control]
---

## Design Research

2 ideas Red reworked based on your feedback.

### 1. Crossfade Card Swap with Mockup Persistence

When a Design Lab finding gets revised, the old card fades out (150ms) while the new card fades in simultaneously, maintaining visual continuity. The iframe mockup beneath cross-fades rather than reloading, preserving scroll position so readers mid-inspection don't lose their place. This creates a sense of seamless update without jolting the viewer—alive but restrained, fitting the JRPG aesthetic of gradual state shifts.

Source: [Animated Slideshow Carousel Transitions](https://www.presentation-process.com/animated-slideshow-in-powerpoint.html)

### 2. Lock Screen Pre-Filled Income Snap: Native OS Fast-Path Logging

Apps like Moneko intercept notifications from enabled payment or income apps and auto-capture transactions via native shortcuts or notification processing. Rather than a generic "confirm or adjust" dialog, this pattern surfaces a pre-filled micro-form directly on the lock screen or notification center (iOS Live Activity or Android rich notification), letting users log routine income in a single tap—or unlock to adjust if the pre-fill is wrong. The key difference from the previous idea: uses native OS affordances (not a custom in-app notification), which means zero friction to reach the entry point.

_Mission Control tie-in: Mission Control could adopt a native Web Push + service-worker pattern to surface pre-filled income confirmations on the user's desktop notification center, bypassing the need to click into the app. The 'Confirm' button becomes an action button deep-linking to a quick-confirm flow; 'Adjust' opens the full form. This complements the existing quest/calendar quick-log feature._

Source: [Moneko: AI Budgeting App for iOS & Android](https://moneko.io/)

_Researched by Red · slideshow: open the Design Lab in ED to view the interactive version._

_Generated: 9/30/2026, 10:41:57 PM_
