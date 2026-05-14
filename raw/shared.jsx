// Shared data, pixel-UI primitives, sound-fx-feel utilities.

// ── DATA ──────────────────────────────────────────────────────────────────

const TODAY = new Date(2026, 4, 13); // Wed May 13 2026

const SCHEDULE = [
  { time: '07:30', title: 'Wake & water plants',     kind: 'routine' },
  { time: '08:30', title: 'Morning training',        kind: 'training' },
  { time: '10:00', title: 'Standup — Gym Leaders',   kind: 'meeting'  },
  { time: '11:30', title: 'Deep work · spec doc',    kind: 'focus'    },
  { time: '13:00', title: 'Lunch w/ Aya',            kind: 'social'   },
  { time: '14:30', title: 'Field route patrol',      kind: 'errand'   },
  { time: '16:00', title: '1:1 with Mara',           kind: 'meeting'  },
  { time: '17:30', title: 'Gym · leg day',           kind: 'training' },
  { time: '19:30', title: 'Dinner · ramen',          kind: 'social'   },
  { time: '21:00', title: 'Reading · 30 pages',      kind: 'routine'  },
];

const TASKS = [
  { id: 1, title: 'Submit travel reimbursement',   rank: 'S', element: 'fire',     done: false },
  { id: 2, title: 'Review Q2 roadmap doc',         rank: 'A', element: 'water',    done: false },
  { id: 3, title: 'Reply to recruiter (Linnea)',   rank: 'A', element: 'electric', done: false },
  { id: 4, title: 'Schedule eye-doctor visit',     rank: 'B', element: 'grass',    done: false },
  { id: 5, title: 'Pick up dry cleaning',          rank: 'C', element: 'normal',   done: true  },
  { id: 6, title: 'Pay phone bill',                rank: 'B', element: 'electric', done: false },
  { id: 7, title: 'Backup laptop to drive',        rank: 'C', element: 'normal',   done: true  },
  { id: 8, title: 'Plan weekend hike route',       rank: 'B', element: 'grass',    done: false },
];

// 0=Sun … 6=Sat. May 2026 starts on a Fri (4).
const MONTH = { year: 2026, month: 4, label: 'MAY 2026', firstDow: 5, days: 31 };

const CAL_EVENTS = {
  3:  ['training'],
  5:  ['meeting', 'social'],
  7:  ['focus'],
  10: ['errand'],
  12: ['training'],
  13: ['meeting', 'training', 'social', 'focus'], // today
  14: ['focus'],
  15: ['social'],
  17: ['training'],
  18: ['meeting'],
  20: ['errand', 'meeting'],
  22: ['social', 'social'],
  24: ['training'],
  26: ['focus', 'meeting'],
  28: ['errand'],
  30: ['training', 'social'],
};

const WEATHER = { temp: 68, label: 'PARTLY CLOUDY', element: 'water' };

// ── ELEMENT TYPE THEME (used as task priority "types") ────────────────────

const TYPE_COLORS = {
  fire:     { bg: '#e85d3a', fg: '#fff' },
  water:    { bg: '#4a90d9', fg: '#fff' },
  grass:    { bg: '#5cab4f', fg: '#fff' },
  electric: { bg: '#f0c419', fg: '#1a1409' },
  normal:   { bg: '#a8a878', fg: '#1a1409' },
};

const RANK_COLORS = {
  S: '#e85d3a',
  A: '#f0a020',
  B: '#4a90d9',
  C: '#7a8a78',
};

// ── HOOKS ────────────────────────────────────────────────────────────────

function useNow(intervalMs = 1000) {
  // Anchor "now" inside today at 10:42 for screenshotability, then tick real time.
  const [now, setNow] = React.useState(() => {
    const d = new Date(TODAY); d.setHours(10); d.setMinutes(42); d.setSeconds(0);
    return d;
  });
  React.useEffect(() => {
    const start = Date.now();
    const base = new Date(now);
    const id = setInterval(() => {
      const delta = Date.now() - start;
      setNow(new Date(base.getTime() + delta));
    }, intervalMs);
    return () => clearInterval(id);
  }, []);
  return now;
}

function fmtTime(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fmtTimeAmPm(d) {
  const h = d.getHours(), m = d.getMinutes();
  const hh = ((h + 11) % 12) + 1;
  return hh + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
}
function minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }
function parseHM(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }

// ── BOOT SEQUENCE ────────────────────────────────────────────────────────

function useBoot(enabled, durationMs = 1900) {
  const [phase, setPhase] = React.useState(enabled ? 0 : 3);
  React.useEffect(() => {
    if (!enabled) { setPhase(3); return; }
    setPhase(0);
    const t1 = setTimeout(() => setPhase(1), 350);
    const t2 = setTimeout(() => setPhase(2), durationMs - 350);
    const t3 = setTimeout(() => setPhase(3), durationMs);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [enabled]);
  return phase; // 0 splash, 1 progress, 2 fading, 3 done
}

// ── SFX-FEEL ─────────────────────────────────────────────────────────────
// A tiny WebAudio blip for task-check / day-click. Lazy AudioContext;
// suspends/resumes as needed; volume tweak-controlled.

let __ac = null;
function blip({ freq = 880, dur = 0.06, kind = 'square', vol = 0.06 }) {
  try {
    if (!__ac) __ac = new (window.AudioContext || window.webkitAudioContext)();
    if (__ac.state === 'suspended') __ac.resume();
    const t = __ac.currentTime;
    const o = __ac.createOscillator();
    const g = __ac.createGain();
    o.type = kind;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.5), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(__ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* no audio */ }
}
function chord(freqs, gap = 0.05, vol = 0.06) {
  freqs.forEach((f, i) => setTimeout(() => blip({ freq: f, vol }), i * gap * 1000));
}

// ── PIXEL UI PRIMITIVES ──────────────────────────────────────────────────
// Chunky retro borders use multiple inset box-shadows so they render
// crisply at any size and survive theming.

const PIXEL_BORDER = (color = '#1a1409', w = 3) =>
  `inset 0 0 0 ${w}px ${color}, inset 0 0 0 ${w + 2}px #fff, inset 0 0 0 ${w + 4}px ${color}`;

function DialogBox({ children, style = {}, theme = '#1a1409', bg = '#fff', radius = 0, pad = 14 }) {
  return (
    <div style={{
      background: bg,
      color: theme,
      boxShadow: `inset 0 0 0 3px ${theme}, inset 0 0 0 5px ${bg}, inset 0 0 0 7px ${theme}`,
      padding: pad,
      borderRadius: radius,
      ...style,
    }}>{children}</div>
  );
}

// 8-bit checkbox: empty square → filled with X (chunky). Animates on toggle.
function PixelCheck({ on, onToggle, size = 18, color = '#1a1409', accent = '#e85d3a' }) {
  const [bumping, setBumping] = React.useState(false);
  const click = () => {
    setBumping(true);
    setTimeout(() => setBumping(false), 220);
    if (!on) chord([880, 1320], 0.06, 0.05); else blip({ freq: 440, vol: 0.04 });
    onToggle && onToggle(!on);
  };
  return (
    <button onClick={click} aria-pressed={on} style={{
      width: size, height: size, padding: 0, border: 'none',
      background: on ? accent : '#fff',
      boxShadow: `inset 0 0 0 2px ${color}`,
      cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      transform: bumping ? 'scale(1.25)' : 'scale(1)',
      transition: 'transform .12s cubic-bezier(.3,1.8,.4,1), background .12s',
    }}>
      {on && (
        <svg width={size} height={size} viewBox="0 0 16 16" style={{ imageRendering: 'pixelated' }}>
          <path d="M3 4h2v2h2v2h2V6h2V4h2v2h-2v2h-2v2h2v2h2v2h-2v-2h-2v-2H7v2H5v2H3v-2h2v-2h2V8H5V6H3z"
                fill="#fff" />
        </svg>
      )}
    </button>
  );
}

// Pixel HP/XP bar made of discrete blocks.
function PixelBar({ value, max = 100, color = '#5cab4f', track = '#1a1409', height = 10, blocks = 20 }) {
  const filled = Math.round((value / max) * blocks);
  return (
    <div style={{ display: 'flex', gap: 1, background: track, padding: 2, height: height + 4, boxSizing: 'border-box' }}>
      {Array.from({ length: blocks }).map((_, i) => (
        <div key={i} style={{
          flex: 1,
          background: i < filled ? color : 'rgba(255,255,255,.08)',
          boxShadow: i < filled ? `inset -1px -1px 0 rgba(0,0,0,.25), inset 1px 1px 0 rgba(255,255,255,.25)` : 'none',
        }} />
      ))}
    </div>
  );
}

// Sprite placeholder: a chunky monochrome silhouette in a colored tile.
// Used for trainer avatar, weather, party slots — never tries to render
// recognizable IP, just a generic blocky figure.
function PixelSprite({ kind = 'trainer', size = 48, color = '#1a1409', bg = 'transparent' }) {
  const path = {
    trainer:
      'M6 2h4v2h2v2h-2v2h-2v2H6V8H4V6h2zM4 10h8v2h2v4h-2v2H4v-2H2v-4h2zM4 16v2h2v-2zm6 0v2h2v-2z',
    sun:
      'M7 1h2v2H7zM3 3h2v2H3zM11 3h2v2h-2zM1 7h2v2H1zM13 7h2v2h-2zM3 11h2v2H3zM11 11h2v2h-2zM7 13h2v2H7zM6 5h4v2H6zM5 6h6v4H5zM6 9h4v2H6z',
    cloud:
      'M4 8h2V6h2V4h4v2h2v2h2v4H2V8zM2 12h12v2H2z',
    bolt:
      'M8 1h3v6h3l-5 8v-6H6z',
    crystal:
      'M6 1h4v2h2v4H4V3h2zM2 7h12v2h-2v4h-2v2H6v-2H4V9H2z',
    coin:
      'M5 2h6v2h2v8h-2v2H5v-2H3V4h2zM7 4h2v8H7zM5 4h2v8H5zM9 4h2v8H9z',
  }[kind];
  return (
    <div style={{
      width: size, height: size,
      background: bg,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <svg width={size} height={size} viewBox="0 0 16 16" style={{ imageRendering: 'pixelated' }}>
        <path d={path} fill={color} />
      </svg>
    </div>
  );
}

// Type chip
function TypeChip({ type, label, small = false }) {
  const c = TYPE_COLORS[type] || TYPE_COLORS.normal;
  return (
    <span style={{
      background: c.bg, color: c.fg,
      fontFamily: 'Press Start 2P, monospace',
      fontSize: small ? 7 : 8,
      padding: small ? '3px 5px' : '4px 6px',
      letterSpacing: 1,
      boxShadow: 'inset 0 -2px 0 rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.25)',
      textTransform: 'uppercase',
    }}>{label || type}</span>
  );
}

// "+N XP" pop that floats up and fades.
function XpPop({ amount = 5, color = '#f0c419', onDone }) {
  React.useEffect(() => { const t = setTimeout(onDone, 900); return () => clearTimeout(t); }, []);
  return (
    <span style={{
      position: 'absolute', top: 0, left: '50%',
      transform: 'translate(-50%, 0)',
      animation: 'xppop 900ms ease-out forwards',
      color, fontFamily: 'Press Start 2P, monospace', fontSize: 9,
      textShadow: '2px 2px 0 #1a1409',
      pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 2,
    }}>+{amount} XP</span>
  );
}

// Boot overlay: chunky pixel "BOOTING" then progress dots.
function BootOverlay({ phase, themeBg = '#0f380f', themeFg = '#9bbc0f' }) {
  if (phase >= 3) return null;
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: themeBg,
      color: themeFg,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16,
      opacity: phase === 2 ? 0 : 1,
      transition: 'opacity .35s',
      zIndex: 10,
      fontFamily: 'Press Start 2P, monospace',
    }}>
      <div style={{ fontSize: 22, letterSpacing: 4, animation: 'bootblink 0.6s steps(2) infinite' }}>READY?</div>
      <div style={{ fontSize: 9, letterSpacing: 2, opacity: 0.8 }}>LOADING SAVE · FILE 01</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} style={{
            width: 10, height: 10,
            background: themeFg,
            opacity: i < (phase === 0 ? 3 : 11) ? 1 : 0.15,
            animation: `bootfill 1.5s ${i * 0.08}s steps(2) forwards`,
          }} />
        ))}
      </div>
    </div>
  );
}

// CRT scanlines + glow overlay applied per-hub.
function ScreenFx({ scanlines = 0, glow = 0 }) {
  if (scanlines <= 0 && glow <= 0) return null;
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5,
      backgroundImage: scanlines > 0
        ? `repeating-linear-gradient(to bottom, rgba(0,0,0,${0.25 * scanlines}) 0 1px, transparent 1px 3px)`
        : 'none',
      boxShadow: glow > 0
        ? `inset 0 0 ${80 * glow}px rgba(255,255,255,${0.18 * glow}), inset 0 0 ${160 * glow}px rgba(0,0,0,${0.4 * glow})`
        : 'none',
      mixBlendMode: 'multiply',
    }} />
  );
}

Object.assign(window, {
  SCHEDULE, TASKS, MONTH, CAL_EVENTS, WEATHER, TODAY,
  TYPE_COLORS, RANK_COLORS, PIXEL_BORDER,
  useNow, fmtTime, fmtTimeAmPm, minutesOfDay, parseHM,
  useBoot, blip, chord,
  DialogBox, PixelCheck, PixelBar, PixelSprite, TypeChip, XpPop, BootOverlay, ScreenFx,
});
