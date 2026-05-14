// Hub B — DUAL-SCREEN CONSOLE
// Two stacked screens with a "hinge" in between. Top screen: themed month
// grid + system status (weather, clock, streak). Bottom: today's mission
// timeline + quest log side-panel.

function HubB({ theme = 'cyan', density = 'cozy', scanlines = 0.4, glow = 0.4, boot = true, modules = {} }) {
  const palette = HUB_B_PALETTES[theme] || HUB_B_PALETTES.cyan;
  const phase = useBoot(boot);
  const now = useNow();
  const [tasks, setTasks] = React.useState(TASKS);
  const [selectedDay, setSelectedDay] = React.useState(13);
  const [pops, setPops] = React.useState([]);

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
  const css = `
    .hubb { font-family: 'VT323', ui-monospace, monospace; color: ${palette.fg}; }
    .hubb .px { font-family: 'Press Start 2P', monospace; letter-spacing: 1px; }
    .hubb .blink { animation: blink 1s steps(2) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    @keyframes xppop { from { transform: translate(-50%, 0); opacity: 1; }
                        to   { transform: translate(-50%, -28px); opacity: 0; } }
    @keyframes hingeShine { 0%, 100% { opacity: .25; } 50% { opacity: .55; } }
    .hubb ::-webkit-scrollbar { width: 4px; height: 4px; }
    .hubb ::-webkit-scrollbar-thumb { background: ${palette.fg}; opacity: .5; }
  `;

  return (
    <div className="hubb" style={{
      width: '100%', height: '100%',
      background: palette.bezel,
      position: 'relative', overflow: 'hidden',
      imageRendering: 'pixelated',
      padding: 14,
      display: 'flex', flexDirection: 'column', gap: 0,
      boxShadow: 'inset 0 0 0 3px rgba(0,0,0,.2)',
    }}>
      <style>{css}</style>

      {/* Console label */}
      <div className="px" style={{
        fontSize: 7, color: palette.bezelFg, opacity: 0.65,
        marginBottom: 6, padding: '0 6px',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>FIELD CONSOLE · DS</span>
        <span>SAVE FILE 01</span>
      </div>

      {/* TOP SCREEN ─────────────────────────────────── */}
      <Screen palette={palette} flex={1.05}>
        <BootOverlay phase={phase} themeBg={palette.bg} themeFg={palette.fg} />

        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
          {visibleModules.status && (
            <div style={{ display: 'flex', gap: 8 }}>
              <BoxB palette={palette} style={{ flex: 1, padding: 8 }}>
                <div className="px" style={{ fontSize: 7, opacity: .65, marginBottom: 4 }}>TIME</div>
                <div style={{ fontSize: 28, lineHeight: 1, fontFamily: 'VT323, monospace' }}>{fmtTime(now)}</div>
                <div className="px" style={{ fontSize: 7, marginTop: 2, opacity: .7 }}>WED · MAY 13</div>
              </BoxB>
              <BoxB palette={palette} style={{ width: 70, padding: 8, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div className="px" style={{ fontSize: 7, opacity: .65, marginBottom: 4 }}>WX</div>
                <PixelSprite kind="cloud" size={28} color={palette.fg} />
                <div style={{ fontSize: 16, lineHeight: 1, marginTop: 2 }}>{WEATHER.temp}°</div>
              </BoxB>
              <BoxB palette={palette} style={{ width: 86, padding: 8 }}>
                <div className="px" style={{ fontSize: 7, opacity: .65, marginBottom: 4 }}>STREAK</div>
                <div style={{ fontSize: 22, lineHeight: 1 }}>14 <span style={{ fontSize: 11, opacity: .7 }}>DAYS</span></div>
                <div className="px" style={{ fontSize: 6, opacity: .7, marginTop: 4 }}>LV.27</div>
                <PixelBar value={68} max={100} color={palette.accent} track={palette.darker} blocks={12} height={4} />
              </BoxB>
            </div>
          )}

          {visibleModules.calendar && (
            <BoxB palette={palette} style={{ flex: 1, padding: 10, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="px" style={{ fontSize: 7, opacity: .65, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>◀ {MONTH.label} ▶</span>
                <span style={{ opacity: .5 }}>DAY {selectedDay}</span>
              </div>
              <MonthGridB palette={palette} selectedDay={selectedDay} onPick={(d) => { blip({ freq: 720 }); setSelectedDay(d); }} />
              <DaySummaryB palette={palette} day={selectedDay} />
            </BoxB>
          )}
        </div>

        <ScreenFx scanlines={scanlines} glow={glow} />
      </Screen>

      {/* HINGE */}
      <Hinge palette={palette} />

      {/* BOTTOM SCREEN ─────────────────────────────── */}
      <Screen palette={palette} flex={1.2}>
        <BootOverlay phase={phase} themeBg={palette.bg} themeFg={palette.fg} />

        <div style={{ display: 'flex', gap: 8, height: '100%' }}>
          {visibleModules.schedule && (
            <BoxB palette={palette} style={{ flex: 1.1, padding: 10, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="px" style={{ fontSize: 7, opacity: .65, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>MISSION TIMELINE</span>
                <span className="blink" style={{ color: palette.accent }}>● LIVE</span>
              </div>
              <ScheduleColumnB now={now} palette={palette} cozy={cozy} />
            </BoxB>
          )}

          {visibleModules.tasks && (
            <BoxB palette={palette} style={{ width: 200, padding: 10, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="px" style={{ fontSize: 7, opacity: .65, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>QUEST LOG</span>
                <span style={{ opacity: .5 }}>{tasks.filter(t => !t.done).length}/{tasks.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: cozy ? 6 : 2, overflowY: 'auto', flex: 1 }}>
                {tasks.map((t) => (
                  <TaskRowB key={t.id} task={t} palette={palette} onToggle={() => toggleTask(t.id)} />
                ))}
              </div>
              <div style={{ marginTop: 6, position: 'relative', height: 20 }}>
                {pops.map((p) => (
                  <XpPop key={p.id} amount={p.amount} color={p.color} onDone={() => {}} />
                ))}
              </div>
            </BoxB>
          )}
        </div>

        <ScreenFx scanlines={scanlines} glow={glow} />
      </Screen>

      {/* Console controls (decorative) */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 8, padding: '0 6px',
      }}>
        <div style={{
          width: 30, height: 30, background: palette.bezelDark,
          borderRadius: 15, boxShadow: `inset 0 0 0 2px ${palette.bezelFg}33`,
        }} />
        <div className="px" style={{ fontSize: 6, color: palette.bezelFg, opacity: .55 }}>
          A · B · X · Y &nbsp; START · SELECT
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 4, width: 36, height: 36 }}>
          {['Y','A','B','X'].map((k, i) => (
            <div key={i} style={{
              background: palette.bezelDark,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Press Start 2P, monospace', fontSize: 6, color: palette.bezelFg, opacity: .65,
            }}>{k}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Screen({ children, palette, flex }) {
  return (
    <div style={{
      flex, position: 'relative',
      background: palette.bg,
      padding: 10,
      boxShadow: `inset 0 0 0 2px ${palette.bezelDark}, inset 0 0 0 5px ${palette.bezelMid}`,
      overflow: 'hidden',
      minHeight: 0,
    }}>{children}</div>
  );
}

function Hinge({ palette }) {
  return (
    <div style={{
      height: 16,
      margin: '6px 0',
      display: 'flex', alignItems: 'center',
      gap: 8,
    }}>
      <div style={{ flex: 1, height: 4, background: palette.bezelDark, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.1)' }} />
      <div style={{
        width: 60, height: 12,
        background: palette.bezelDark,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.15), inset 0 -1px 0 rgba(0,0,0,.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: palette.accent, animation: 'hingeShine 1.5s ease-in-out infinite' }} />
        <div style={{ width: 4, height: 4, borderRadius: 2, background: palette.fg, opacity: 0.5 }} />
        <div style={{ width: 4, height: 4, borderRadius: 2, background: palette.fg, opacity: 0.3 }} />
      </div>
      <div style={{ flex: 1, height: 4, background: palette.bezelDark, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.1)' }} />
    </div>
  );
}

function BoxB({ palette, children, style }) {
  return (
    <div style={{
      background: palette.surface,
      boxShadow: `inset 0 0 0 1px ${palette.fg}33, 0 0 0 1px ${palette.darker}`,
      color: palette.fg,
      ...style,
    }}>{children}</div>
  );
}

function MonthGridB({ palette, selectedDay, onPick }) {
  const cells = [];
  for (let i = 0; i < MONTH.firstDow; i++) cells.push(null);
  for (let d = 1; d <= MONTH.days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <>
      <div className="px" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', fontSize: 6, opacity: .55, gap: 2, marginBottom: 4 }}>
        {['SUN','MON','TUE','WED','THU','FRI','SAT'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, flex: 1 }}>
        {cells.map((d, i) => {
          if (d == null) return <div key={i} style={{ background: 'transparent' }} />;
          const events = CAL_EVENTS[d] || [];
          const isToday = d === 13;
          const isSel = d === selectedDay;
          return (
            <button key={i} onClick={() => onPick(d)} style={{
              border: 'none', padding: 2, cursor: 'pointer',
              background: isSel ? palette.fg : isToday ? palette.accent + '22' : palette.darker,
              color: isSel ? palette.bg : palette.fg,
              fontFamily: 'VT323, monospace', fontSize: 12,
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start',
              minHeight: 28, boxShadow: isToday && !isSel ? `inset 0 0 0 1px ${palette.accent}` : 'none',
              position: 'relative',
            }}>
              <span style={{ lineHeight: 1, fontWeight: isToday ? 'bold' : 'normal' }}>{d}</span>
              <div style={{ display: 'flex', gap: 1, marginTop: 'auto', flexWrap: 'wrap' }}>
                {events.slice(0, 4).map((kind, j) => (
                  <div key={j} style={{
                    width: 4, height: 4,
                    background: KIND_COLOR_B[kind] || palette.fg,
                  }} />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

const KIND_COLOR_B = {
  training: '#e85d3a',
  meeting:  '#4a90d9',
  focus:    '#9b59b6',
  social:   '#f0c419',
  errand:   '#5cab4f',
  routine:  '#7a8a78',
};

function DaySummaryB({ palette, day }) {
  const evs = CAL_EVENTS[day] || [];
  return (
    <div style={{
      marginTop: 8, paddingTop: 6,
      borderTop: `1px dashed ${palette.fg}44`,
      display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <span className="px" style={{ fontSize: 6, opacity: .65 }}>{day} MAY:</span>
      {evs.length === 0 && <span style={{ fontSize: 13, opacity: .55 }}>nothing scheduled</span>}
      {evs.map((k, i) => (
        <span key={i} style={{
          fontSize: 11, padding: '2px 5px',
          background: KIND_COLOR_B[k] || palette.fg,
          color: '#fff',
          fontFamily: 'Press Start 2P, monospace',
          letterSpacing: 1,
        }}>{k.toUpperCase()}</span>
      ))}
    </div>
  );
}

function ScheduleColumnB({ now, palette, cozy }) {
  const nowM = minutesOfDay(now);
  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: cozy ? 4 : 1 }}>
      {SCHEDULE.map((s, i) => {
        const m = parseHM(s.time);
        const past = m <= nowM;
        const next = !past && (i === 0 || parseHM(SCHEDULE[i - 1].time) <= nowM);
        return (
          <div key={i} style={{
            display: 'flex', gap: 8, alignItems: 'stretch', position: 'relative',
            opacity: past && !next ? 0.4 : 1,
          }}>
            <div style={{
              width: 4,
              background: next ? palette.accent : KIND_COLOR_B[s.kind] || palette.fg,
              boxShadow: next ? `0 0 6px ${palette.accent}` : 'none',
            }} />
            <div style={{
              flex: 1,
              padding: cozy ? '5px 6px' : '3px 6px',
              background: next ? palette.darker : 'transparent',
              boxShadow: next ? `inset 0 0 0 1px ${palette.accent}` : 'none',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span className="px" style={{ fontSize: 7, width: 32 }}>{s.time}</span>
              <span style={{ flex: 1, fontSize: 14, lineHeight: 1 }}>{s.title}</span>
              {next && <span className="px blink" style={{ fontSize: 6, color: palette.accent }}>▶ NEXT</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskRowB({ task, palette, onToggle }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '2px 0',
      opacity: task.done ? 0.45 : 1,
    }}>
      <PixelCheck on={task.done} onToggle={onToggle} size={13} color={palette.fg} accent={palette.accent} />
      <div style={{
        width: 14, fontFamily: 'Press Start 2P, monospace', fontSize: 7,
        textAlign: 'center', padding: '2px 0',
        background: RANK_COLORS[task.rank], color: '#fff',
      }}>{task.rank}</div>
      <div style={{
        flex: 1, fontSize: 12, lineHeight: 1.1,
        textDecoration: task.done ? 'line-through' : 'none',
      }}>{task.title}</div>
    </div>
  );
}

const HUB_B_PALETTES = {
  cyan: {
    bezel:      '#1a2533',
    bezelDark:  '#070b14',
    bezelMid:   '#0c1422',
    bezelFg:    '#8fd6ff',
    bg:         '#0a1929',
    surface:    '#11243a',
    darker:     '#1e3a5f',
    fg:         '#a8e6ff',
    accent:     '#ff7a59',
  },
  green: {
    bezel:      '#2c3528',
    bezelDark:  '#0e120a',
    bezelMid:   '#161c13',
    bezelFg:    '#b8c89e',
    bg:         '#121a13',
    surface:    '#1c2519',
    darker:     '#2a3624',
    fg:         '#b8c89e',
    accent:     '#e87c5c',
  },
  amber: {
    bezel:      '#3a2a18',
    bezelDark:  '#120b06',
    bezelMid:   '#1f150b',
    bezelFg:    '#ffb000',
    bg:         '#1a1207',
    surface:    '#2a1d0e',
    darker:     '#3d2c12',
    fg:         '#ffcd5a',
    accent:     '#ff5a3a',
  },
  magenta: {
    bezel:      '#2a1530',
    bezelDark:  '#100515',
    bezelMid:   '#1c0a22',
    bezelFg:    '#ff8fee',
    bg:         '#15071a',
    surface:    '#240c2a',
    darker:     '#3a1645',
    fg:         '#ffa8f6',
    accent:     '#9aff5a',
  },
};

window.HubB = HubB;
