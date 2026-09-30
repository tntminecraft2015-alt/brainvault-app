---
status: pending
title: "Crossfade Card Swap with Mockup Persistence"
date: "2026-09-30"
requested_via: "Design Lab"
---

## What the user asked for

Liked this Design Lab finding from Red and queued it for implementation.

## Implementation notes

When a Design Lab finding gets revised, the old card fades out (150ms) while the new card fades in simultaneously, maintaining visual continuity. The iframe mockup beneath cross-fades rather than reloading, preserving scroll position so readers mid-inspection don't lose their place. This creates a sense of seamless update without jolting the viewer—alive but restrained, fitting the JRPG aesthetic of gradual state shifts.

Source: [Animated Slideshow Carousel Transitions](https://www.presentation-process.com/animated-slideshow-in-powerpoint.html)

Red's mockup for this finding — treat this as the concrete visual reference, not just the prose above:
```html
<style>body{margin:0;background:#0a1929;font-family:VT323,monospace;color:#dfeeff;padding:20px;}.card{background:#12253c;border:2px solid #ff8a63;border-radius:10px;padding:16px;margin-bottom:16px;opacity:1;transition:opacity 150ms ease-in-out;}.card.fade-out{opacity:0;}.card.fade-in{opacity:1;animation:fadeInCard 150ms ease-in-out;}.iframe-wrap{background:#1e3a5f;border:2px solid #7fffb0;border-radius:10px;height:120px;overflow:hidden;position:relative;margin-top:12px;}.iframe-wrap iframe{width:100%;height:100%;border:none;opacity:1;transition:opacity 150ms ease-in-out;}.iframe-wrap iframe.fade-out{opacity:0;}.iframe-wrap iframe.fade-in{animation:fadeInFrame 150ms ease-in-out;}.label{font-size:8px;text-transform:uppercase;color:#8fd6ff;letter-spacing:1px;margin-bottom:6px;}.title{font-size:14px;color:#ff8a63;margin:0;}.desc{font-size:12px;color:#dfeeff;margin:6px 0 0 0;line-height:1.3;}@keyframes fadeInCard{from{opacity:0;}to{opacity:1;}}@keyframes fadeInFrame{from{opacity:0;}to{opacity:1;}}</style><div class='card'><div class='label'>Finding #2</div><h2 class='title'>Crossfade Update</h2><p class='desc'>Old card fades. New card enters. Scroll preserved.</p><div class='iframe-wrap'><iframe src='about:blank'></iframe></div></div>
```
