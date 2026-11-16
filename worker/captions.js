// Burned-in captions as an ASS subtitle file (rendered by ffmpeg's libass).
// Word-by-word "TikTok style": 1–3 words on screen at a time, the spoken word highlighted,
// each group popping in. The hook line sits in its own band for the whole clip.

const WHITE = '&H00FFFFFF', YELLOW = '&H0000D6FF';   // ASS colors are &HAABBGGRR
// where things go on the 1080×1920 canvas, per layout (see filterFor in worker.js)
const POS = {
  blur:   { hook: [540, 360], cap: [540, 1460] },   // video band is centered; hook above it, captions below
  center: { hook: [540, 300], cap: [540, 1400] },
  split:  { hook: [540, 768], cap: [540, 1480] },   // hook sits on the facecam/gameplay seam
};

function ts(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
const clean = s => String(s || '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

// group words into short on-screen chunks: ≤3 words, break on pauses and sentence ends
function chunk(words) {
  const out = []; let cur = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (cur.length && (cur.length >= 3 || w[0] - prev[1] > 0.6 || /[.!?]$/.test(prev[2]))) { out.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) out.push(cur);
  return out;
}

function buildAss({ words, hook, layout, duration }) {
  const pos = POS[layout] || POS.blur;
  const ws = words.map(([s, e, w]) => [s, Math.max(e, s + 0.05), clean(w).toUpperCase()]).filter(w => w[2]);
  const lines = [];
  const groups = chunk(ws);
  groups.forEach((g, gi) => {
    const next = groups[gi + 1];
    const gEnd = Math.min(next ? next[0][0] : duration, g[g.length - 1][1] + 0.35);
    g.forEach((w, wi) => {
      const start = w[0];
      const end = wi < g.length - 1 ? g[wi + 1][0] : gEnd;
      if (end <= start) return;
      const text = g.map((x, xi) => xi === wi ? `{\\c${YELLOW}}${x[2]}{\\c${WHITE}}` : x[2]).join(' ');
      const pop = wi === 0 ? '{\\fscx112\\fscy112\\t(0,90,\\fscx100\\fscy100)}' : '';
      lines.push(`Dialogue: 0,${ts(start)},${ts(end)},Cap,,0,0,0,,{\\pos(${pos.cap[0]},${pos.cap[1]})}${pop}${text}`);
    });
  });
  const h = clean(hook);
  if (h) lines.unshift(`Dialogue: 1,${ts(0)},${ts(duration)},Hook,,0,0,0,,{\\pos(${pos.hook[0]},${pos.hook[1]})\\fad(150,0)}${h.toUpperCase()}`);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Anton,92,${WHITE},${WHITE},&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,7,2,5,60,60,0,1
Style: Hook,Anton,78,${YELLOW},${YELLOW},&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,8,3,5,70,70,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
}

module.exports = { buildAss, chunk, ts };
