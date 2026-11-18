// ── CLIP TIMING ─────────────────────────────────────────────────────────────
// The AI picks rough start/end times from the transcript. These helpers turn them into clean cuts
// using the word timestamps: start on the first word of a sentence, end right after the payoff,
// no dead air at either end, and always 10–45 seconds (cut at a pause, never mid-word).
// Pure functions, so they can be tested without ffmpeg or the network.

const MIN_LEN = 10, MAX_LEN = 45;
const LEAD = 0.25;      // seconds kept before the first word
const TAIL = 0.7;       // seconds kept after the last word (room for the reaction)
const PAUSE = 0.35;     // a gap between words at least this long counts as a natural cut point

// All words in [a, b), each [start, end, text], sorted by start
function wordsIn(segs, a, b) {
  const out = [];
  for (const s of segs) {
    if (s.e < a || s.s > b) continue;
    for (const w of s.w || []) if (w[1] > a && w[0] < b) out.push(w);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

// Cut points: places where speech pauses (between words) or a sentence ends.
// Each point is { t, kind: 'start' | 'end', strength } — a start point is just before a word that follows a pause,
// an end point is just after a word that is followed by a pause. Sentence punctuation makes a point stronger.
function cutPoints(words) {
  const starts = [], ends = [];
  for (let i = 0; i < words.length; i++) {
    const [ws, we, txt] = words[i];
    const gapBefore = i ? ws - words[i - 1][1] : Infinity;
    const gapAfter = i < words.length - 1 ? words[i + 1][0] - we : Infinity;
    const prevTxt = i ? String(words[i - 1][2]) : '';
    const sentenceStart = !i || /[.!?…]["')\]]*$/.test(prevTxt);
    const sentenceEnd = /[.!?…]["')\]]*$/.test(String(txt));
    if (gapBefore >= PAUSE || sentenceStart) starts.push({ t: ws, strength: (sentenceStart ? 2 : 0) + Math.min(2, gapBefore) });
    if (gapAfter >= PAUSE || sentenceEnd) ends.push({ t: we, strength: (sentenceEnd ? 2 : 0) + Math.min(2, gapAfter) });
  }
  return { starts, ends };
}

// Pick the best point near `target` within [lo, hi]: close to the target, but a stronger break wins a near-tie.
function nearest(points, target, lo, hi) {
  let best = null, bestCost = Infinity;
  for (const p of points) {
    if (p.t < lo || p.t > hi) continue;
    const cost = Math.abs(p.t - target) - 0.6 * p.strength;
    if (cost < bestCost) { bestCost = cost; best = p; }
  }
  return best;
}

/**
 * Tighten one AI-picked moment.
 * @param {{start:number,end:number}} m  rough times (seconds, same clock as the segments)
 * @param {Array<{s:number,e:number,t:string,w:Array}>} segs  transcript with word timings
 * @param {number} dur  source length (seconds)
 * @returns {{start:number,end:number,fit:string}}  fit says what was changed, for the logs
 */
function fitMoment(m, segs, dur) {
  const max = dur > 0 ? dur : Infinity;
  let s = Math.max(0, +m.start || 0), e = Math.min(max, +m.end || s + 20);
  if (!(e > s)) e = Math.min(max, s + 20);
  const notes = [];
  // look a little outside the AI's window, so a sentence it clipped can be finished
  const words = wordsIn(segs, s - 6, e + 6);
  if (!words.length) {
    // no speech to go on (a silent or music-only stretch): only enforce the length rules
    if (e - s > MAX_LEN) { e = s + MAX_LEN; notes.push('capped'); }
    if (e - s < MIN_LEN) { e = Math.min(max, s + MIN_LEN); s = Math.max(0, Math.min(s, e - MIN_LEN)); notes.push('padded'); }
    return { start: round(s), end: round(e), fit: notes.join(',') || 'no-words' };
  }
  const { starts, ends } = cutPoints(words);

  // start: the sentence start nearest the AI's pick (up to 4s earlier to catch the setup, 3s later to skip dead air)
  const sp = nearest(starts, s, s - 4, s + 3);
  if (sp) { const ns = Math.max(0, sp.t - LEAD); if (Math.abs(ns - s) > 0.2) notes.push(`start ${ns < s ? '-' : '+'}${Math.abs(ns - s).toFixed(1)}s`); s = ns; }
  // dead air at the start: jump to the first word if it's more than a second in
  const first = words.find(w => w[1] > s);
  if (first && first[0] - s > 1) { notes.push('trimmed silence'); s = Math.max(0, first[0] - LEAD); }
  // a long silence in the first few seconds means the clip would open with a stray line and then nothing: start after it
  for (let i = words.findIndex(w => w[0] >= s); i >= 0 && i < words.length - 1 && words[i][0] < s + 8; i++) {
    const next = words[i + 1];
    if (next[0] - words[i][1] >= 2.5 && next[0] + MIN_LEN < e + 3) { s = Math.max(0, next[0] - LEAD); notes.push('skipped opening silence'); break; }
  }

  // end: the sentence end nearest the AI's pick, but never past the length limit
  const hardEnd = Math.min(max, s + MAX_LEN);
  let ep = nearest(ends, e, Math.max(s + MIN_LEN, e - 4), Math.min(hardEnd - TAIL, e + 3));
  if (!ep && e - s > MAX_LEN) {
    // the AI ran long: end at the strongest pause before the limit
    ep = nearest(ends, hardEnd - TAIL, s + MIN_LEN, hardEnd - TAIL);
    if (ep) notes.push('shortened to a pause');
  }
  if (ep) { const ne = Math.min(max, ep.t + TAIL); if (Math.abs(ne - e) > 0.2) notes.push(`end ${ne < e ? '-' : '+'}${Math.abs(ne - e).toFixed(1)}s`); e = ne; }
  // dead air at the end: stop shortly after the last word
  const lastWord = [...words].reverse().find(w => w[0] < e);
  if (lastWord && e - lastWord[1] > 2.5 && lastWord[1] + TAIL - s >= MIN_LEN) { e = lastWord[1] + TAIL; notes.push('trimmed tail'); }

  // length rules, as a last resort
  if (e - s > MAX_LEN) { e = s + MAX_LEN; notes.push('capped'); }
  if (e - s < MIN_LEN) {
    // too short: run on to the next sentence end, else just pad to the minimum
    const more = nearest(ends, s + MIN_LEN + 2, s + MIN_LEN, Math.min(max, s + MAX_LEN - TAIL));
    e = more ? Math.min(max, more.t + TAIL) : Math.min(max, s + MIN_LEN);
    if (e - s < MIN_LEN) s = Math.max(0, e - MIN_LEN);
    notes.push('lengthened');
  }
  return { start: round(s), end: round(e), fit: notes.join(', ') || 'kept' };
}
const round = x => Math.round(x * 100) / 100;

/**
 * Loud stretches of the audio, from ffmpeg's ametadata print file (one RMS reading per window).
 * Returns the windows clearly louder than the stream's usual level, loudest first: [[second, dB above typical], ...]
 */
function loudPeaks(printText, { windowSec = 2, from = 0, top = 40 } = {}) {
  const rows = [];
  let t = null;
  for (const line of String(printText).split('\n')) {
    const mt = line.match(/pts_time:([\d.]+)/); if (mt) { t = +mt[1]; continue; }
    const mv = line.match(/RMS_level=(-?[\d.]+|-inf)/);
    if (mv && t != null) { const v = mv[1] === '-inf' ? -120 : +mv[1]; rows.push([t, v]); t = null; }
  }
  const voiced = rows.filter(r => r[1] > -60);
  if (voiced.length < 20) return [];
  const sorted = voiced.map(r => r[1]).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  // merge neighbouring loud windows into one stretch, keep its peak
  const loud = rows.filter(r => r[1] - median >= 6), out = [];
  for (const [ts, v] of loud) {
    const last = out[out.length - 1];
    if (last && ts - last.end <= windowSec * 1.5) { last.end = ts + windowSec; if (v > last.peak) last.peak = v; }
    else out.push({ start: ts, end: ts + windowSec, peak: v });
  }
  // [start second, dB above typical, length in seconds]
  return out.sort((a, b) => b.peak - a.peak).slice(0, top)
    .map(x => [Math.round(x.start + from), +(x.peak - median).toFixed(1), Math.round(x.end - x.start)]);
}

module.exports = { fitMoment, loudPeaks, wordsIn, cutPoints, MIN_LEN, MAX_LEN };
