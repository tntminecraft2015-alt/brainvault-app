---
status: done
title: "Smart Tile Hierarchy: Variable-Size Cards for Financial KPIs"
date: "2026-08-12"
requested_via: "Design Lab"
---

## What the user asked for

Unlike equal-width card layouts, a bento grid uses tile size to signal importance — hero KPIs anchor in large tiles, category breakdowns sit in smaller secondary tiles, guiding attention without relying on labels alone. Applied to Mission Control's GIL WALLET: the period spent total is now a 2-column hero card with its progress bar, REMAINING is a secondary tile, and per-category spend (food, transport, etc.) renders as small sorted tiles below.

Source: [Bento Grid Dashboard Design: Complete Guide 2026](https://www.orbix.studio/blogs/bento-grid-dashboard-design-aesthetics)

## Implementation notes

Implemented directly in mission-control.html: new categoryBreakdown(txns) computes per-category expense totals (excludes income) sorted descending; bentoCatTilesHtml() renders up to 4 category tiles using existing BUDGET_CATS icons/labels. buildBudgetGilHTML() (desktop) and buildMobBudgetGilHTML() (mobile) both replaced their equal-width SPENT/REMAINING row with a .bento-grid: a .bento-hero tile (period spent + bar) spanning full width, a REMAINING tile, then the category tiles. New CSS classes: .bento-grid/.bento-tile/.bento-hero/.bento-cat/.bento-label/.bento-val/.bento-bar-wrap/.bento-sub, with #mobBudgetView overrides for larger phone type.
