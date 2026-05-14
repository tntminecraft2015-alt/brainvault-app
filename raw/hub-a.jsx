// Hub A — POCKET TRAINER
// 4-color handheld aesthetic. Single-screen scrollable. Vertical schedule,
// mini month grid, task log, system status block.
//
// Theme defaults to "green" (classic 4-shade greenscale) but accepts cyan /
// amber / magenta via tweak. Density toggles between cozy and dense.

function HubA({ theme = 'green', density = 'cozy', scanlines = 0.6, glow = 0.5, boot = true, modules = {} }) {
  const palette = HUB_A_PALETTES[theme] || HUB_A_PALETTES.green;
  const phase = useBoot(boot);
  const now = useNow();
  const [tasks, setTasks] = React.useState(TASKS);
  const [pops, setPops] = React.useState([]); // [{id, x, y, amount, color}]
  const [selectedDay, setSelectedDay] = React.useState(13);

  const popKey = React.useRef(0);
  const addPop = (amount, color) => {
    const id = ++popKey.current;
    setPops((p) => [...p, { id, amount, color }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 900);
  };

  const toggleTask = (id) => {
    setTasks((arr) => arr.map((t) => {
      if (t.id !== id) return t;
      const next = !t.done;
      if (next) addPop({ S: 50, A: 25, B: 15, C: 10 }[t.rank], RANK_COLORS[t.rank]);
      return { ...t, done: next };
    }));
  };

  const visibleModules = {
    status:   modules.status   !== false,
    schedule: modules.schedule !== false,
    calendar: modules.calendar !== false,
    tasks:    modules.tasks    !== false,
  };

  const cozy = density === 'cozy';
  const FONT_PIXEL = 'Press Start 2P, ui-monospace, monospace';
  const FONT_BODY  = 'VT323, ui-monospace, monospace';

  // Per-hub CSS (animations + font scope)
  const css = `
    .huba { font-family: ${FONT_BODY}; color: ${palette.fg}; background: ${palette.bg}; }
    .huba .px { font-family: ${FONT_PIXEL}; letter-spacing: 1px; line-height: 1.4; }
    .huba .blink { animation: blink 1s steps(2) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    @keyframes bootblink { 50% { opacity: .35; } }
    @keyframes bootfill { from { opacity: .15; } to { opacity: 1; } }
    @keyframes xppop { from { transform: translate(-50%, 0); opacity: 1; }
                        to   { transform: translate(-50%, -28px); opacity: 0; } }
    @keyframes nowpulse { 50% { transform: translateX(2px); } }
    .huba ::-webkit-scrollbar { width: 6px; }
    .huba ::-webkit-scrollbar-thumb { background: ${palette.fg}; }
    .huba ::-webkit-scrollbar-track { background: ${palette.darker}; }
  `;

  return (
    <div className="huba" style={{
      width: '100%', height: '100%',
      position: 'relative', overflow: 'hidden',
      imageRendering: 'pixelated',
    }}>
      <style>{css}</style>

      {/* Outer device bezel — like a pocket handheld housing */}
      <div style={{
        position: 'absolute', inset: 0,
        background: palette.bezel,
        padding: 16,
        boxShadow: 'inset 0 0 0 4px rgba(0,0,0,.25)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Status strip (above screen) */}
        <div className="px" style={{
          fontSize: 7, color: palette.bezelFg, opacity: 0.7,
          display: 'flex', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px',
        }}>
          <span>POCKET · TRAINER</span>
          <span className="blink">● POWER</span>
        </div>

        {/* Inner screen */}
        <div style={{
          flex: 1, position: 'relative',
          background: palette.bg,
          padding: cozy ? 14 : 10,
          overflowY: 'auto',
          boxShadow: 'inset 0 0 0 3px ' + palette.darker + ', inset 0 0 0 6px ' + palette.bezel,
        }}>
          <BootOverlay phase={phase} themeBg={palette.bg} themeFg={palette.fg} />

          {/* status block — trainer card */}
          {visibleModules.status && (
            <ScreenBlock palette={palette} title="TRAINER">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{
                  width: 56, height: 56, background: palette.darker,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `inset 0 0 0 2px ${palette.fg}`,
                }}>
                  <PixelSprite kind="trainer" size={40} color={palette.fg} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="px" style={{ fontSize: 9, marginBottom: 4 }}>YOU</div>
                  <div style={{ fontSize: 16, lineHeight: 1, marginBottom: 6 }}>LV.27 · 14-DAY STREAK</div>
                  <div className="px" style={{ fontSize: 6, marginBottom: 3, opacity: 0.7 }}>XP</div>
                  <PixelBar value={68} max={100} color={palette.fg} track={palette.darker} blocks={16} height={6} />
                </div>
              </div>
              <div style={{
                marginTop: 10,
                display: 'flex', justifyContent: 'space-between',
                fontSize: 14, lineHeight: 1,
              }}>
                <span>{fmtTimeAmPm(now)}</span>
                <span>WED · MAY 13</span>
                <span>{WEATHER.temp}°F · ☁</span>
              </div>
            </ScreenBlock>
          )}

          {/* schedule timeline */}
          {visibleModules.schedule && (
            <ScreenBlock palette={palette} title="TODAY'S ROUTE">
              <ScheduleTimeline now={now} palette={palette} />
            </ScreenBlock>
          )}

          {/* calendar */}
          {visibleModules.calendar && (
            <ScreenBlock palette={palette} title="MONTH MAP">
              <MonthGridA palette={palette} selectedDay={selectedDay} onPick={(d) => { blip({ freq: 660 }); setSelectedDay(d); }} />
              <DayDetails palette={palette} day={selectedDay} />
            </ScreenBlock>
          )}

          {/* tasks */}
          {visibleModules.tasks && (
            <ScreenBlock palette={palette} title="QUEST LOG">
              <div style={{ display: 'flex', flexDirection: 'column', gap: cozy ? 8 : 4 }}>
                {tasks.map((t) => (
                  <TaskRow key={t.id} task={t} palette={palette} onToggle={() => toggleTask(t.id)} />
                ))}
              </div>
              <div className="px" style={{
                marginTop: 10, fontSize: 7, opacity: 0.7,
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>{tasks.filter(t => t.done).length}/{tasks.length} COMPLETE</span>
                <span className="blink">▼ PRESS A</span>
              </div>
            </ScreenBlock>
          )}

          {/* xp pops, fixed to bottom right of screen */}
          <div style={{ position: 'absolute', bottom: 16, right: 16, height: 30, width: 80, pointerEvents: 'none' }}>
            {pops.map((p) => (
              <XpPop key={p.id} amount={p.amount} color={p.color} onDone={() => {}} />
            ))}
          </div>

          <ScreenFx scanlines={scanlines} glow={glow} />
        </div>

        {/* Below-screen controls (decorative) */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 14px)', gridTemplateRows: 'repeat(3, 14px)', gap: 2 }}>
            <div /><div style={{ background: palette.bezelDark }} /><div />
            <div style={{ background: palette.bezelDark }} /><div style={{ background: palette.bezelDark }} /><div style={{ background: palette.bezelDark }} />
            <div /><div style={{ background: palette.bezelDark }} /><div />
          </div>
          <div className="px" style={{ fontSize: 6, color: palette.bezelFg, opacity: 0.6 }}>SELECT &nbsp; START</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ width: 18, height: 18, background: palette.bezelDark, borderRadius: 9 }} />
            <div style={{ width: 18, height: 18, background: palette.bezelDark, borderRadius: 9 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Block within the handheld screen: thick-bordered dialogue box with title tab.
function ScreenBlock({ palette, title, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <div className="px" style={{
          background: palette.fg, color: palette.bg,
          fontSize: 8, padding: '5px 8px 4px',
          letterSpacing: 1.5,
        }}>{title}</div>
      </div>
      <div style={{
        background: 'transparent',
        boxShadow: `inset 0 0 0 2px ${palette.fg}`,
        padding: 10,
      }}>
        {children}
      </div>
    </div>
  );
}

function ScheduleTimeline({ now, palette }) {
  const nowM = minutesOfDay(now);
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {SCHEDULE.map((s, i) => {
        const m = parseHM(s.time);
        const upcoming = m > nowM;
        const current = i > 0 && m > nowM && parseHM(SCHEDULE[i - 1].time) <= nowM;
        const past = m <= nowM;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8, position: 'relative',
            padding: '3px 0', minHeight: 22,
            opacity: past && !current ? 0.45 : 1,
          }}>
            <div className="px" style={{ width: 38, fontSize: 8, color: palette.fg }}>{s.time}</div>
            <div style={{
              width: 8, height: 8,
              background: current ? palette.accent : palette.fg,
              boxShadow: current ? `0 0 0 2px ${palette.bg}, 0 0 0 4px ${palette.accent}` : 'none',
            }} />
            <div style={{ flex: 1, fontSize: 14, lineHeight: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {s.title}
            </div>
            <div className="px" style={{ fontSize: 6, opacity: 0.6 }}>{s.kind.toUpperCase()}</div>
          </div>
        );
      })}
      {/* now marker — between rows the cursor sits at the most recent past */}
      <NowMarker now={now} palette={palette} />
    </div>
  );
}

function NowMarker({ now, palette }) {
  const nowM = minutesOfDay(now);
  let idx = -1;
  SCHEDULE.forEach((s, i) => { if (parseHM(s.time) <= nowM) idx = i; });
  if (idx < 0) return null;
  // anchor next to the row idx
  return (
    <div style={{
      position: 'absolute',
      left: -10,
      top: idx * 22 + 8,
      animation: 'nowpulse 0.6s steps(2) infinite',
      color: palette.accent,
      fontFamily: 'Press Start 2P, monospace',
      fontSize: 8,
    }}>▶</div>
  );
}

function MonthGridA({ palette, selectedDay, onPick }) {
  const cells = [];
  for (let i = 0; i < MONTH.firstDow; i++) cells.push(null);
  for (let d = 1; d <= MONTH.days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const today = 13;

  return (
    <div>
      <div className="px" style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        fontSize: 6, opacity: 0.65, marginBottom: 4, gap: 2,
      }}>
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const hasEv = (CAL_EVENTS[d] || []).length > 0;
          const isToday = d === today;
          const isSel = d === selectedDay;
          return (
            <button key={i} onClick={() => onPick(d)} style={{
              aspectRatio: '1',
              background: isSel ? palette.fg : 'transparent',
              color: isSel ? palette.bg : palette.fg,
              border: 'none', padding: 0, cursor: 'pointer',
              boxShadow: isToday ? `inset 0 0 0 2px ${palette.accent}` : `inset 0 0 0 1px ${palette.fg}`,
              fontFamily: 'VT323, monospace', fontSize: 14, lineHeight: 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
              fontWeight: isToday ? 'bold' : 'normal',
            }}>
              <span>{d}</span>
              {hasEv && (
                <div style={{ display: 'flex', gap: 1 }}>
                  {(CAL_EVENTS[d] || []).slice(0, 3).map((_, j) => (
                    <div key={j} style={{
                      width: 3, height: 3,
                      background: isSel ? palette.bg : palette.accent,
                    }} />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayDetails({ palette, day }) {
  const evs = CAL_EVENTS[day] || [];
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `2px solid ${palette.fg}` }}>
      <div className="px" style={{ fontSize: 7, marginBottom: 4, opacity: 0.7 }}>MAY {day}</div>
      {evs.length === 0 && (
        <div style={{ fontSize: 13, opacity: 0.6 }}>No encounters scheduled.</div>
      )}
      {evs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {evs.map((e, i) => (
            <div key={i} style={{ fontSize: 13, lineHeight: 1.1, textTransform: 'uppercase' }}>
              ◆ {e.toUpperCase()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, palette, onToggle }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '3px 0',
      opacity: task.done ? 0.5 : 1,
    }}>
      <PixelCheck on={task.done} onToggle={onToggle} size={16} color={palette.fg} accent={palette.accent} />
      <div style={{
        width: 18, textAlign: 'center',
        fontFamily: 'Press Start 2P, monospace', fontSize: 9,
        background: RANK_COLORS[task.rank], color: '#fff',
        padding: '3px 0',
        boxShadow: 'inset 0 -1px 0 rgba(0,0,0,.3)',
      }}>{task.rank}</div>
      <div style={{
        flex: 1, fontSize: 14, lineHeight: 1.1,
        textDecoration: task.done ? 'line-through' : 'none',
        textTransform: 'uppercase',
      }}>{task.title}</div>
    </div>
  );
}

const HUB_A_PALETTES = {
  green: {
    bezel:     '#c4cfa1',
    bezelDark: '#4a533a',
    bezelFg:   '#1a1409',
    bg:        '#9bbc0f',
    fg:        '#0f380f',
    darker:    '#306230',
    accent:    '#e85d3a',
  },
  cyan: {
    bezel:     '#1a2a3a',
    bezelDark: '#000814',
    bezelFg:   '#7fdbff',
    bg:        '#0a1929',
    fg:        '#7fdbff',
    darker:    '#1e3a5f',
    accent:    '#ff7a59',
  },
  amber: {
    bezel:     '#2a2118',
    bezelDark: '#100b06',
    bezelFg:   '#ffb000',
    bg:        '#1a1207',
    fg:        '#ffb000',
    darker:    '#3a2a10',
    accent:    '#ff5252',
  },
  magenta: {
    bezel:     '#2a1a2a',
    bezelDark: '#100410',
    bezelFg:   '#ff77ee',
    bg:        '#1a071a',
    fg:        '#ff77ee',
    darker:    '#3a103a',
    accent:    '#9aff52',
  },
};

window.HubA = HubA;
