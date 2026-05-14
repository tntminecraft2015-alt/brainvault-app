// Hub C — TRAINER'S FIELD CONSOLE
// Modern HUD. 3-column layout:
//   • LEFT  — Trainer header + Party (today's quests as elemental cards)
//   • MID   — World-map month calendar with mini tile-icons per day
//   • RIGHT — Today's mission timeline (battle-log style)
// Bottom strip — keybinds / status line.

function HubC({ theme = 'cyan', density = 'cozy', scanlines = 0.3, glow = 0.3, boot = true, modules = {} }) {
  const palette = HUB_C_PALETTES[theme] || HUB_C_PALETTES.cyan;
  const phase = useBoot(boot);
  const now = useNow();
  const [tasks, setTasks] = React.useState(TASKS);
  const [selectedDay, setSelectedDay] = React.useState(13);
  const [hovered, setHovered] = React.useState(null);
  const [pops, setPops] = React.useState([]);

  const popKey = React.useRef(0);
  const addPop = (amount, color, anchor = 'list') => {
    const id = ++popKey.current;
    setPops((p) => [...p, { id, amount, color, anchor }]);
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
    .hubc { font-family: 'VT323', ui-monospace, monospace; color: ${palette.fg}; }
    .hubc .px { font-family: 'Press Start 2P', monospace; letter-spacing: 1px; }
    .hubc .blink { animation: blink 1s steps(2) infinite; }
    @keyframes blink { 50% { opacity: .35; } }
    @keyframes xppop { from { transform: translate(-50%, 0); opacity: 1; }
                        to   { transform: translate(-50%, -32px); opacity: 0; } }
    @keyframes pulseAccent { 0%, 100% { box-shadow: 0 0 0 0 ${palette.accent}88; } 50% { box-shadow: 0 0 0 6px ${palette.accent}00; } }
    @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    .hubc ::-webkit-scrollbar { width: 4px; height: 4px; }
    .hubc ::-webkit-scrollbar-thumb { background: ${palette.fg}55; }
  `;

  return (
    <div className="hubc" style={{
      width: '100%', height: '100%',
      background: palette.bg,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      imageRendering: 'pixelated',
    }}>
      <style>{css}</style>

      {/* TOP STATUS BAR ───────────────────────────── */}
      <TopBarC palette={palette} now={now} status={visibleModules.status} />

      {/* MAIN ────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', gap: 10, padding: '10px 12px', minHeight: 0 }}>
        {/* LEFT — Party (tasks) */}
        {visibleModules.tasks && (
          <PanelC palette={palette} style={{ width: 280, display: 'flex', flexDirection: 'column' }}>
            <PanelHeader palette={palette} label="PARTY · ACTIVE QUESTS" right={
              <span style={{ fontSize: 11, opacity: .7 }}>
                {tasks.filter(t => !t.done).length}/{tasks.length}
              </span>
            } />
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: cozy ? 6 : 3, overflowY: 'auto', flex: 1 }}>
              {tasks.map((t) => (
                <PartyCard key={t.id} task={t} palette={palette} onToggle={() => toggleTask(t.id)} />
              ))}
              <div style={{ position: 'relative', height: 24, marginTop: 4 }}>
                {pops.map((p) => (
                  <XpPop key={p.id} amount={p.amount} color={p.color} onDone={() => {}} />
                ))}
              </div>
            </div>
            <Tutorial palette={palette} text="◆ CHECK A QUEST TO CLAIM XP" />
          </PanelC>
        )}

        {/* MID — Calendar map */}
        {visibleModules.calendar && (
          <PanelC palette={palette} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <PanelHeader palette={palette} label={MONTH.label + ' · REGION MAP'} right={
              <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
                <span style={{ opacity: .7 }}>◀</span>
                <span style={{ opacity: .7 }}>▶</span>
              </div>
            } />
            <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <MonthMapC
                palette={palette} selectedDay={selectedDay}
                hovered={hovered} setHovered={setHovered}
                onPick={(d) => { blip({ freq: 720 + d * 4 }); setSelectedDay(d); }}
              />
              <DayPanelC palette={palette} day={hovered || selectedDay} />
            </div>
          </PanelC>
        )}

        {/* RIGHT — Schedule */}
        {visibleModules.schedule && (
          <PanelC palette={palette} style={{ width: 280, display: 'flex', flexDirection: 'column' }}>
            <PanelHeader palette={palette} label="MISSION LOG · TODAY" right={
              <span className="blink" style={{ fontSize: 10, color: palette.accent }}>● LIVE</span>
            } />
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              <BattleLogC now={now} palette={palette} cozy={cozy} />
            </div>
            <Tutorial palette={palette} text="▼ PRESS A TO ADVANCE" />
          </PanelC>
        )}
      </div>

      {/* BOTTOM STATUS TICKER ─────────────────────── */}
      <BottomBarC palette={palette} />

      <BootOverlay phase={phase} themeBg={palette.bg} themeFg={palette.fg} />
      <ScreenFx scanlines={scanlines} glow={glow} />
    </div>
  );
}

// ── Top status bar ───────────────────────────────────────────────────────

function TopBarC({ palette, now, status }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px',
      background: palette.surface,
      borderBottom: `2px solid ${palette.fg}33`,
    }}>
      {/* Trainer badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 42, height: 42,
          background: palette.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.25)',
        }}>
          <PixelSprite kind="trainer" size={28} color="#fff" />
        </div>
        <div>
          <div className="px" style={{ fontSize: 8, opacity: .65 }}>TRAINER</div>
          <div style={{ fontSize: 16, lineHeight: 1, marginTop: 2 }}>VIVIAN H. · LV.27</div>
        </div>
      </div>

      <div style={{ width: 1, height: 30, background: palette.fg, opacity: .15 }} />

      {/* XP bar */}
      <div style={{ minWidth: 180, flex: '0 0 auto' }}>
        <div className="px" style={{ fontSize: 7, opacity: .65, marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
          <span>XP · NEXT LV</span>
          <span style={{ opacity: .55 }}>680/1000</span>
        </div>
        <PixelBar value={68} max={100} color={palette.accent} track={palette.darker} blocks={20} height={6} />
      </div>

      {status && (
        <>
          <div style={{ flex: 1 }} />
          {/* Status modules */}
          <StatBadge palette={palette} icon="bolt" label="STREAK" value="14d" />
          <StatBadge palette={palette} icon="coin" label="COINS" value="2,480" />
          <StatBadge palette={palette} icon="cloud" label={WEATHER.label.split(' ')[0]} value={WEATHER.temp + '°'} />
          <div style={{
            padding: '6px 10px', background: palette.darker, color: palette.fg,
            fontFamily: 'VT323, monospace', fontSize: 22, lineHeight: 1,
            boxShadow: `inset 0 0 0 1px ${palette.fg}33`,
          }}>{fmtTime(now)}</div>
        </>
      )}
    </div>
  );
}

function StatBadge({ palette, icon, label, value }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 8px',
      background: palette.surface, color: palette.fg,
      boxShadow: `inset 0 0 0 1px ${palette.fg}22`,
    }}>
      <PixelSprite kind={icon} size={18} color={palette.accent} />
      <div>
        <div className="px" style={{ fontSize: 6, opacity: .6 }}>{label}</div>
        <div style={{ fontSize: 14, lineHeight: 1, marginTop: 1 }}>{value}</div>
      </div>
    </div>
  );
}

// ── Panels ────────────────────────────────────────────────────────────────

function PanelC({ palette, children, style }) {
  return (
    <div style={{
      background: palette.surface,
      boxShadow: `inset 0 0 0 1px ${palette.fg}22, 0 2px 0 ${palette.darker}`,
      ...style,
    }}>{children}</div>
  );
}

function PanelHeader({ palette, label, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 10px',
      background: palette.darker,
      borderBottom: `2px solid ${palette.fg}22`,
    }}>
      <div className="px" style={{ fontSize: 8, color: palette.fg }}>{label}</div>
      {right}
    </div>
  );
}

function Tutorial({ palette, text }) {
  return (
    <div style={{
      padding: '6px 10px',
      borderTop: `2px solid ${palette.fg}22`,
      background: palette.darker,
    }}>
      <span className="blink" style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 7, color: palette.accent }}>{text}</span>
    </div>
  );
}

// ── LEFT panel: Party (tasks as elemental cards) ─────────────────────────

function PartyCard({ task, palette, onToggle }) {
  const type = TYPE_COLORS[task.element] || TYPE_COLORS.normal;
  const sprite = { fire: 'bolt', water: 'cloud', grass: 'crystal', electric: 'bolt', normal: 'coin' }[task.element] || 'coin';
  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      background: palette.bg,
      boxShadow: `inset 0 0 0 1px ${palette.fg}33`,
      opacity: task.done ? 0.45 : 1,
      transition: 'opacity .15s',
      position: 'relative',
    }}>
      {/* Element gem */}
      <div style={{
        width: 36, background: type.bg, color: type.fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.25), inset 0 2px 0 rgba(255,255,255,.2)',
      }}>
        <PixelSprite kind={sprite} size={22} color={type.fg} />
      </div>
      {/* Body */}
      <div style={{ flex: 1, padding: '6px 8px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{
            fontFamily: 'Press Start 2P, monospace', fontSize: 7,
            padding: '2px 4px',
            background: RANK_COLORS[task.rank], color: '#fff',
          }}>RANK {task.rank}</span>
          <span className="px" style={{ fontSize: 6, opacity: .55, textTransform: 'uppercase' }}>{task.element}</span>
        </div>
        <div style={{
          fontSize: 14, lineHeight: 1.15,
          textDecoration: task.done ? 'line-through' : 'none',
          color: palette.fg,
        }}>{task.title}</div>
      </div>
      {/* Check */}
      <div style={{ display: 'flex', alignItems: 'center', paddingRight: 8 }}>
        <PixelCheck on={task.done} onToggle={onToggle} size={18} color={palette.fg} accent={palette.accent} />
      </div>
    </div>
  );
}

// ── MID panel: World-map calendar ────────────────────────────────────────

const KIND_ICON_C = {
  training: { icon: 'bolt',    color: '#ff7a59' },
  meeting:  { icon: 'crystal', color: '#4a90d9' },
  focus:    { icon: 'sun',     color: '#9b59b6' },
  social:   { icon: 'coin',    color: '#f0c419' },
  errand:   { icon: 'cloud',   color: '#5cab4f' },
  routine:  { icon: 'sun',     color: '#a8a878' },
};

function MonthMapC({ palette, selectedDay, hovered, setHovered, onPick }) {
  const cells = [];
  for (let i = 0; i < MONTH.firstDow; i++) cells.push(null);
  for (let d = 1; d <= MONTH.days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minHeight: 0 }}>
      <div className="px" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, fontSize: 7, opacity: .55 }}>
        {['SUN','MON','TUE','WED','THU','FRI','SAT'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', padding: 2 }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, flex: 1 }}>
        {cells.map((d, i) => {
          if (d == null) return <div key={i} style={{
            background: palette.bg, opacity: .35,
            boxShadow: `inset 0 0 0 1px ${palette.fg}11`,
          }} />;
          const events = CAL_EVENTS[d] || [];
          const isToday = d === 13;
          const isSel = d === selectedDay;
          return (
            <button key={i} onClick={() => onPick(d)}
              onMouseEnter={() => setHovered(d)} onMouseLeave={() => setHovered(null)}
              style={{
                background: isSel ? palette.accent + '33' : palette.bg,
                color: palette.fg,
                border: 'none',
                boxShadow: isSel
                  ? `inset 0 0 0 2px ${palette.accent}`
                  : isToday
                    ? `inset 0 0 0 2px ${palette.fg}`
                    : `inset 0 0 0 1px ${palette.fg}33`,
                cursor: 'pointer',
                padding: 5,
                display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'space-between',
                position: 'relative',
                minHeight: 56,
                transition: 'background .12s',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{
                  fontFamily: 'VT323, monospace',
                  fontSize: 16, lineHeight: 1,
                  fontWeight: isToday ? 'bold' : 'normal',
                  color: isToday ? palette.accent : palette.fg,
                }}>{d}</span>
                {isToday && <span className="px" style={{ fontSize: 5, color: palette.accent }}>NOW</span>}
              </div>
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignSelf: 'flex-end' }}>
                {events.slice(0, 4).map((k, j) => {
                  const ic = KIND_ICON_C[k] || KIND_ICON_C.routine;
                  return (
                    <div key={j} style={{
                      width: 12, height: 12, background: ic.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: 'inset 0 -1px 0 rgba(0,0,0,.3)',
                    }}>
                      <PixelSprite kind={ic.icon} size={10} color="#fff" />
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayPanelC({ palette, day }) {
  const evs = CAL_EVENTS[day] || [];
  return (
    <div style={{
      marginTop: 10,
      padding: '8px 10px',
      background: palette.bg,
      boxShadow: `inset 0 0 0 1px ${palette.fg}22`,
      display: 'flex', alignItems: 'center', gap: 10, minHeight: 40,
    }}>
      <div className="px" style={{
        fontSize: 9, color: palette.accent,
        padding: '6px 8px',
        background: palette.darker,
        boxShadow: 'inset 0 -2px 0 rgba(0,0,0,.25)',
      }}>
        MAY {String(day).padStart(2,'0')}
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {evs.length === 0 && (
          <span style={{ fontSize: 14, opacity: .5, fontStyle: 'italic' }}>· empty tile ·</span>
        )}
        {evs.map((k, i) => {
          const ic = KIND_ICON_C[k] || KIND_ICON_C.routine;
          return (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 6px',
              background: ic.color, color: '#fff',
              fontFamily: 'Press Start 2P, monospace', fontSize: 7,
              letterSpacing: 1, textTransform: 'uppercase',
              boxShadow: 'inset 0 -2px 0 rgba(0,0,0,.25)',
            }}>
              <PixelSprite kind={ic.icon} size={10} color="#fff" />
              {k}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── RIGHT panel: Mission battle log ─────────────────────────────────────

function BattleLogC({ now, palette, cozy }) {
  const nowM = minutesOfDay(now);
  let nextIdx = SCHEDULE.findIndex(s => parseHM(s.time) > nowM);
  if (nextIdx === -1) nextIdx = SCHEDULE.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: cozy ? 4 : 1 }}>
      {SCHEDULE.map((s, i) => {
        const past = i < nextIdx - (nowM >= parseHM(s.time) ? 0 : 1);
        const ic = KIND_ICON_C[s.kind] || KIND_ICON_C.routine;
        const isCurrent = i === nextIdx - 1 && parseHM(s.time) <= nowM;
        const isNext = i === nextIdx;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'stretch', gap: 0,
            background: isCurrent ? palette.bg : isNext ? palette.darker : 'transparent',
            boxShadow: isCurrent ? `inset 0 0 0 1px ${palette.accent}` : 'none',
            opacity: parseHM(s.time) <= nowM && !isCurrent ? 0.4 : 1,
          }}>
            <div style={{
              width: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: ic.color,
              boxShadow: 'inset 0 -2px 0 rgba(0,0,0,.25)',
            }}>
              <PixelSprite kind={ic.icon} size={14} color="#fff" />
            </div>
            <div style={{ flex: 1, padding: '5px 8px', minWidth: 0 }}>
              <div className="px" style={{ fontSize: 7, opacity: .65, marginBottom: 2 }}>
                {s.time} {isCurrent && <span className="blink" style={{ color: palette.accent, marginLeft: 4 }}>◀ NOW</span>}
                {isNext && <span style={{ color: palette.accent, marginLeft: 4 }}>▶ NEXT</span>}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.1 }}>{s.title}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Bottom ticker bar ─────────────────────────────────────────────────────

function BottomBarC({ palette }) {
  const items = [
    '◆ SAVE FILE 01',
    '◆ AUTOSAVE: ON',
    '◆ REGION: HOME',
    '◆ NEXT REVIEW · FRI MAY 15',
    '◆ TIP: PRESS START FOR MENU',
  ];
  const long = [...items, ...items, ...items].join('  ·  ');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 12px',
      background: palette.surface,
      borderTop: `2px solid ${palette.fg}33`,
      fontFamily: 'Press Start 2P, monospace', fontSize: 7,
      color: palette.fg, opacity: .8,
      overflow: 'hidden', whiteSpace: 'nowrap',
    }}>
      <span style={{ flex: '0 0 auto', color: palette.accent }}>● ONLINE</span>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'inline-block', animation: 'ticker 40s linear infinite' }}>{long}</div>
      </div>
      <span style={{ flex: '0 0 auto', opacity: .55 }}>v1.0.0</span>
    </div>
  );
}

const HUB_C_PALETTES = {
  cyan: {
    bg:      '#0a1322',
    surface: '#12233a',
    darker:  '#1e3a5f',
    fg:      '#d3f0ff',
    accent:  '#ff7a59',
  },
  amber: {
    bg:      '#1a0f02',
    surface: '#2a1a07',
    darker:  '#3d2810',
    fg:      '#ffd98a',
    accent:  '#ff5a3a',
  },
  magenta: {
    bg:      '#180a22',
    surface: '#251330',
    darker:  '#3a1c4a',
    fg:      '#ffd2f6',
    accent:  '#9aff5a',
  },
  green: {
    bg:      '#08160a',
    surface: '#0f2410',
    darker:  '#1c3a1f',
    fg:      '#c8f0a8',
    accent:  '#ff5a59',
  },
};

window.HubC = HubC;
