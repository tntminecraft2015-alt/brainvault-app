// ── CLIP SIGNALS ────────────────────────────────────────────────────────────
// Where in a VOD did people react? Combines every signal Cled has into "hot spots" for the moment picker:
//   • viewer clips  — Twitch clips viewers made, at their exact VOD position, weighted by views (strongest)
//   • chat          — messages per 30s from a YouTube live-chat replay, vs. a typical window
//   • loud audio    — stretches clearly louder than the stream's usual level (yelling, big reactions)
//   • speech energy — fast talking, ALL CAPS, "no way", "clip that", laughter in the transcript
// Also builds the transcript the picker reads: everything when it fits, otherwise the hot spots in full plus
// samples of the rest, so long VODs aren't cut off after the first few hours.
// Pure functions (no network), so they can be tested on their own.

const BUCKET = 30;
const HYPE = /\b(no way|clip (that|it)|let'?s go+|oh my god|omg|what the|bro what|are you serious|i'?m dead|lmao+|hahaha+|holy|insane|crazy|yo+o+|nah+|wtf|chat)\b|!{2,}/gi;

function median(xs) { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }

// per-bucket speech energy: words per second, share of ALL-CAPS words, hype phrases
function speechEnergy(segs, nb) {
  const words = new Array(nb).fill(0), caps = new Array(nb).fill(0), hype = new Array(nb).fill(0), cues = Array.from({ length: nb }, () => []);
  for (const s of segs) {
    const b = Math.floor(s.s / BUCKET); if (b < 0 || b >= nb) continue;
    const toks = String(s.t || '').split(/\s+/).filter(Boolean);
    words[b] += toks.length;
    caps[b] += toks.filter(w => w.length >= 3 && /[A-Z]/.test(w) && w === w.toUpperCase()).length;
    const h = String(s.t || '').match(HYPE); if (h) { hype[b] += h.length; if (cues[b].length < 2) cues[b].push(h[0].toLowerCase()); }
  }
  const raw = words.map((w, i) => w / BUCKET + 4 * (w ? caps[i] / w : 0) + 0.8 * hype[i]);
  const voiced = raw.filter(x => x > 0), m = median(voiced), sd = Math.sqrt(voiced.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, voiced.length)) || 1;
  return raw.map((x, i) => ({ z: x ? (x - m) / sd : 0, cues: cues[i] }));
}

/**
 * @param {object} o
 * @param {number} o.duration                 seconds (job-relative)
 * @param {Array<[number,number]>} [o.chat]   [[bucketStart, messages], ...] in 30s buckets
 * @param {Array<[number,number,number]>} [o.loud]  [[start, dB above typical, length], ...]
 * @param {Array<{t,d,views,title}>} [o.viewerClips]  job-relative seconds
 * @param {Array<{s,e,t}>} [o.segs]
 * @returns {{ spots: Array<{start,end,heat,reasons:string[]}>, heatOf: (s:number,e:number)=>{heat:number,pct:number,reasons:string[]}, signals: string[] }}
 */
function hotSpots({ duration, chat = [], loud = [], viewerClips = [], segs = [] }) {
  const nb = Math.max(1, Math.ceil((duration || 1) / BUCKET));
  const heat = new Array(nb).fill(0), why = Array.from({ length: nb }, () => ({}));
  const signals = [];
  // viewer clips: spread each clip's weight over the buckets it covers
  if (viewerClips.length) {
    signals.push(`${viewerClips.length} viewer clips`);
    for (const c of viewerClips) {
      const w = 1 + Math.log10(1 + (c.views || 0));
      for (let b = Math.floor(c.t / BUCKET); b <= Math.floor((c.t + (c.d || 30)) / BUCKET) && b < nb; b++) {
        if (b < 0) continue;
        heat[b] += 2 * w;
        const y = why[b]; y.clips = (y.clips || 0) + 1; if (!y.top || c.views > y.top.views) y.top = c;
      }
    }
  }
  // chat: how many times busier than a typical window
  if (chat.length >= 10) {
    signals.push('chat replay');
    const m = median(chat.map(x => +x[1])) || 1;
    for (const [t, n] of chat) { const b = Math.floor(t / BUCKET); if (b < 0 || b >= nb) continue; const r = n / m; if (r >= 1.5) { heat[b] += Math.min(4, r - 1.5 + 0.5); why[b].chat = Math.max(why[b].chat || 0, r); } }
  }
  // loud stretches
  if (loud.length) {
    signals.push('audio loudness');
    for (const [t, db, len] of loud) for (let b = Math.floor(t / BUCKET); b <= Math.floor((t + (len || 2)) / BUCKET) && b < nb; b++) {
      if (b < 0) continue;
      heat[b] += Math.min(3, Math.max(0, (db - 6) / 5) + 0.5); why[b].loud = Math.max(why[b].loud || 0, db);
    }
  }
  // speech energy
  if (segs.length) {
    signals.push('speech energy');
    speechEnergy(segs, nb).forEach((x, b) => { if (x.z > 1) { heat[b] += Math.min(2, (x.z - 1) * 0.7); why[b].speech = x.cues; } });
  }
  const reasonsFor = (b0, b1) => {
    let clips = 0, top = null, chatR = 0, loudDb = 0, cues = [];
    for (let b = b0; b <= b1; b++) { const y = why[b]; clips = Math.max(clips, y.clips || 0); if (y.top && (!top || y.top.views > top.views)) top = y.top; chatR = Math.max(chatR, y.chat || 0); loudDb = Math.max(loudDb, y.loud || 0); if (y.speech) cues.push(...y.speech); }
    const r = [];
    if (clips) r.push(`${clips} viewer clip${clips > 1 ? 's' : ''}${top?.title ? ` (top: "${top.title}", ${top.views} views)` : ''}`);
    if (chatR) r.push(`chat ${chatR.toFixed(1)}× busier`);
    if (loudDb) r.push(`loud +${Math.round(loudDb)} dB`);
    if (cues.length) r.push(`hype: "${[...new Set(cues)].slice(0, 2).join('", "')}"`);
    return r;
  };
  // merge neighbouring hot buckets into spots
  // a bucket is "hot" with at least one real signal (heat ≥ 1); on busy streams where many buckets qualify, only the
  // top quarter counts, so spots stay tight instead of merging into hour-long stretches
  const nonzero = heat.filter(h => h >= 1).sort((a, b) => a - b);
  const thresh = nonzero.length > 40 ? Math.max(1, nonzero[Math.floor(nonzero.length * 0.75)]) : 1;
  const spots = [];
  for (let b = 0; b < nb; b++) {
    if (heat[b] < thresh) continue;
    const last = spots[spots.length - 1];
    if (last && b - last.b1 <= 1) { last.b1 = b; last.heat = Math.max(last.heat, heat[b]); }
    else spots.push({ b0: b, b1: b, heat: heat[b] });
  }
  const out = spots.map(s => ({ start: s.b0 * BUCKET, end: Math.min(duration || Infinity, (s.b1 + 1) * BUCKET), heat: +s.heat.toFixed(1), reasons: reasonsFor(s.b0, s.b1) }))
    .sort((a, b) => b.heat - a.heat).slice(0, 15);
  const sortedHeat = heat.slice().sort((a, b) => a - b);
  // heat of any stretch, as a 0–10 percentile against the whole video (for re-ranking the AI's picks)
  const heatOf = (s, e) => {
    const b0 = Math.max(0, Math.floor(s / BUCKET)), b1 = Math.min(nb - 1, Math.floor(Math.max(s, e - 1) / BUCKET));
    let h = 0; for (let b = b0; b <= b1; b++) h = Math.max(h, heat[b]);
    if (!h) return { heat: 0, pct: 0, reasons: [] };
    let below = 0; for (const x of sortedHeat) if (x < h) below++;
    return { heat: +h.toFixed(1), pct: +(10 * below / sortedHeat.length).toFixed(1), reasons: reasonsFor(b0, b1) };
  };
  return { spots: out, heatOf, signals };
}

const fmt = s => `[${Math.round(s.s)}-${Math.round(s.e)}] ${String(s.t || '').slice(0, 400)}\n`;

/**
 * The transcript the picker reads, within `budget` characters. Everything when it fits; otherwise the lines around
 * each hot spot (hottest first), then evenly spaced samples of the rest, in time order with "[… skipped …]" markers.
 */
function transcriptFor(segs, spots, budget = 120000) {
  const all = segs.map(fmt), total = all.reduce((n, l) => n + l.length, 0);
  if (total <= budget) return { text: all.join(''), full: true };
  const take = new Set();
  let used = 0;
  const addRange = (a, b, cap) => { for (let i = 0; i < segs.length; i++) { if (segs[i].e < a || segs[i].s > b || take.has(i)) continue; if (used + all[i].length > cap) return false; take.add(i); used += all[i].length; } return true; };
  for (const sp of spots) if (!addRange(sp.start - 90, sp.end + 60, budget * 0.72)) break;
  // samples: a minute every few minutes across the whole video (5% is left for the "not shown" markers)
  const dur = segs.length ? segs[segs.length - 1].e : 0;
  for (let step = 600; step >= 120 && used < budget * 0.93; step /= 2) for (let t = 0; t < dur; t += step) if (!addRange(t, t + 60, budget * 0.95)) break;
  let text = '', prevEnd = null;
  for (let i = 0; i < segs.length; i++) {
    if (!take.has(i)) continue;
    if (prevEnd != null && segs[i].s - prevEnd > 20) text += `[… ${Math.round((segs[i].s - prevEnd) / 60)} min not shown …]\n`;
    text += all[i]; prevEnd = segs[i].e;
  }
  return { text, full: false };
}

module.exports = { hotSpots, transcriptFor, speechEnergy, BUCKET };
