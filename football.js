// ── FOOTBALL COACH ──────────────────────────────────────────────────────────
// Live NFL data + fantasy trade values for the "Coach" helper job on the Farm.
// Modeled on the tools people already use:
//   • ESPN scoreboard / news      → live scores, records, odds, headlines (public JSON, no key)
//   • FantasyCalc trade values    → market values from real trades, tuned by league settings
//   • Sleeper trending            → most-added / most-dropped players in the last 24h
//   • KTC / PFN-style trade math  → stars count extra ("two nickels ≠ a quarter") and a
//                                   "what evens it out" suggestion
// Everything is cached in memory so phones refreshing the Farm don't hammer the sources,
// and a stale copy is served if a source is briefly down.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const FC   = 'https://api.fantasycalc.com/values/current';
const SLP  = 'https://api.sleeper.app/v1';
const mine = require('./fantasy-leagues');
const fs = require('fs');
const path = require('path');

// Researched season background. The daily research job rewrites it into app-data
// (coachBrain.notes, persisted to GitHub on Render); coach-season-2026.md is the seed copy
// used until the first refresh lands — re-read when the file changes.
const SEASON_NOTES = path.join(__dirname, 'coach-season-2026.md');
let seasonNotes = { mtime: 0, text: '' };
function getSeasonNotesFile() {
  try {
    const m = fs.statSync(SEASON_NOTES).mtimeMs;
    if (m !== seasonNotes.mtime) seasonNotes = { mtime: m, text: fs.readFileSync(SEASON_NOTES, 'utf8').slice(0, 40000) };
  } catch { seasonNotes = { mtime: 0, text: '' }; }
  return seasonNotes.text;
}

const cache = new Map();
async function cachedJson(url, ttlMs) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttlMs) return hit.data;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { 'User-Agent': 'MissionControl/1.0', Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    cache.set(url, { t: Date.now(), data });
    return data;
  } catch (e) {
    if (hit) return hit.data;           // stale beats nothing
    throw e;
  }
}

// ── scores ──
function slimTeam(c) {
  const t = c?.team || {};
  return {
    abbr: t.abbreviation || '', name: t.displayName || t.name || '', short: t.shortDisplayName || t.name || '',
    logo: t.logo || '', color: t.color ? `#${t.color}` : '', score: c?.score ?? '',
    record: (c?.records || []).find(r => r.type === 'total' || r.name === 'overall')?.summary || c?.records?.[0]?.summary || '',
    winner: !!c?.winner,
  };
}
async function getScoreboard(week) {
  const url = week ? `${ESPN}/scoreboard?week=${encodeURIComponent(week)}&seasontype=2` : `${ESPN}/scoreboard`;
  const d = await cachedJson(url, 45 * 1000);
  const games = (d.events || []).map(ev => {
    const comp = ev.competitions?.[0] || {};
    const cs = comp.competitors || [];
    const st = ev.status?.type || comp.status?.type || {};
    const odds = comp.odds?.[0];
    return {
      id: ev.id, date: ev.date, name: ev.shortName || ev.name,
      state: st.state || 'pre',                 // pre | in | post
      detail: st.shortDetail || st.detail || '',
      home: slimTeam(cs.find(c => c.homeAway === 'home')),
      away: slimTeam(cs.find(c => c.homeAway === 'away')),
      odds: odds ? { line: odds.details || '', total: odds.overUnder ?? null } : null,
      tv: (comp.broadcasts || []).flatMap(b => b.names || []).join(', '),
      situation: comp.situation?.downDistanceText || '',
    };
  });
  return { season: d.season?.year || null, week: d.week?.number || null, games };
}

// ── standings (ESPN, grouped by division) ──
async function getStandings() {
  const d = await cachedJson('https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3', 30 * 60 * 1000);
  const stat = (e, n) => (e.stats || []).find(s => s.name === n)?.displayValue ?? '';
  const divisions = [];
  for (const conf of (d.children || [])) for (const dv of (conf.children || [])) {
    divisions.push({
      conference: conf.abbreviation || '', division: dv.name || '',
      teams: (dv.standings?.entries || []).map(e => ({
        abbr: e.team?.abbreviation || '', name: e.team?.displayName || '', logo: e.team?.logos?.[0]?.href || '',
        record: stat(e, 'overall'), seed: stat(e, 'playoffSeed'), div: stat(e, 'vs. Div.'), conf: stat(e, 'vs. Conf.'),
        pf: stat(e, 'pointsFor'), pa: stat(e, 'pointsAgainst'), diff: stat(e, 'pointDifferential'), streak: stat(e, 'streak'),
      })),
    });
  }
  return { season: d.children?.[0]?.children?.[0]?.standings?.season || null, divisions };
}

// ── news ──
const slimArticle = a => ({
  headline: a.headline || '', description: a.description || '', published: a.published || '',
  url: a.links?.web?.href || '', image: a.images?.[0]?.url || '',
});
async function getNews(limit = 10) {
  const d = await cachedJson(`${ESPN}/news?limit=${limit}`, 10 * 60 * 1000);
  return (d.articles || []).slice(0, limit).map(slimArticle);
}

// ── one team: record, next game, its news ──
// ESPN's news endpoint ignores ?team=, so team news = the league feed filtered by the
// article's team tags (falling back to the nickname in the headline/description).
async function getTeam(abbr) {
  const a = String(abbr || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
  if (!a) throw new Error('team required');
  const d = await cachedJson(`${ESPN}/teams/${a}`, 10 * 60 * 1000);
  const t = d.team || {};
  const ev = t.nextEvent?.[0], comp = ev?.competitions?.[0];
  const next = ev ? {
    id: ev.id, date: ev.date, name: ev.shortName || ev.name || '',
    state: comp?.status?.type?.state || ev.status?.type?.state || 'pre',
    detail: comp?.status?.type?.shortDetail || '',
    home: slimTeam((comp?.competitors || []).find(c => c.homeAway === 'home')),
    away: slimTeam((comp?.competitors || []).find(c => c.homeAway === 'away')),
    tv: (comp?.broadcasts || []).map(b => b.media?.shortName || (b.names || []).join(', ')).filter(Boolean).join(', '),
  } : null;
  const nick = t.name || '', id = String(t.id || '');
  const feed = await cachedJson(`${ESPN}/news?limit=50`, 10 * 60 * 1000).catch(() => ({}));
  const nickRe = nick ? new RegExp(`\\b${nick}\\b`, 'i') : null;
  // articles that name the team come first; ones that merely tag it (e.g. "all 32 teams'
  // odds") only fill in after
  const arts = feed.articles || [];
  const named = arts.filter(x => nickRe && nickRe.test(`${x.headline} ${x.description}`));
  const tagged = arts.filter(x => !named.includes(x) && (x.categories || []).filter(c => c.type === 'team').length <= 2
    && (x.categories || []).some(c => c.type === 'team' && String(c.teamId ?? c.team?.id ?? '') === id));
  const news = [...named, ...tagged].slice(0, 6).map(slimArticle);
  return {
    abbr: t.abbreviation || a.toUpperCase(), name: t.displayName || '', short: nick,
    logo: t.logos?.[0]?.href || '', color: t.color ? `#${t.color}` : '',
    record: t.record?.items?.find(r => r.type === 'total')?.summary || t.record?.items?.[0]?.summary || '',
    standing: t.standingSummary || '', next, news,
  };
}

// ── one game: line score, team stats, leaders, every offensive player's line ──
// Before kickoff ESPN only has season averages/leaders, so `kind` says which you got.
const GAME_STATS = [['totalYards', 'Total yards'], ['netPassingYards', 'Passing'], ['rushingYards', 'Rushing'], ['firstDowns', 'First downs'], ['thirdDownEff', '3rd down'], ['turnovers', 'Turnovers'], ['possessionTime', 'Possession']];
const SEASON_STATS = [['totalPointsPerGame', 'Points / game'], ['yardsPerGame', 'Yards / game'], ['passingYardsPerGame', 'Pass yds / game'], ['rushingYardsPerGame', 'Rush yds / game'], ['totalPointsPerGameAllowed', 'Pts allowed / game']];
const LEADER_CATS = [['passingYards', 'PASS'], ['rushingYards', 'RUSH'], ['receivingYards', 'REC']];
async function getGame(id) {
  const gid = String(id || '').replace(/\D/g, '').slice(0, 12);
  if (!gid) throw new Error('game id required');
  const d = await cachedJson(`${ESPN}/summary?event=${gid}`, 30 * 1000);
  const comp = d.header?.competitions?.[0] || {};
  const st = comp.status?.type || {};
  const side = ha => {
    const c = (comp.competitors || []).find(x => x.homeAway === ha) || {};
    return { ...slimTeam(c), logo: c.team?.logos?.[0]?.href || c.team?.logo || '', lines: (c.linescores || []).map(l => l.displayValue ?? l.value ?? '') };
  };
  const away = side('away'), home = side('home');
  const kind = st.state === 'pre' ? 'season' : 'game';
  const statsFor = abbr => (d.boxscore?.teams || []).find(t => t.team?.abbreviation === abbr)?.statistics || [];
  const sa = statsFor(away.abbr), sh = statsFor(home.abbr), val = (s, n) => s.find(x => x.name === n)?.displayValue ?? '';
  const stats = (kind === 'game' ? GAME_STATS : SEASON_STATS).map(([n, label]) => ({ label, away: val(sa, n), home: val(sh, n) })).filter(s => s.away !== '' || s.home !== '');
  const leaders = [];
  for (const t of (d.leaders || [])) for (const [n, cat] of LEADER_CATS) {
    const l = (t.leaders || []).find(x => x.name === n)?.leaders?.[0];
    if (l) leaders.push({ cat, team: t.team?.abbreviation || '', name: l.athlete?.displayName || '', line: l.displayValue || '' });
  }
  // per-player lines from the box score (game only) — used to flag the user's fantasy players
  const players = new Map();
  for (const p of (d.boxscore?.players || [])) for (const cat of (p.statistics || [])) {
    if (!['passing', 'rushing', 'receiving'].includes(cat.name)) continue;
    const lab = cat.labels || [];
    for (const a of (cat.athletes || [])) {
      const nm = a.athlete?.displayName; if (!nm) continue;
      const s = Object.fromEntries(lab.map((l, i) => [l, a.stats?.[i]]));
      const part = cat.name === 'passing' ? `${s['C/ATT'] || ''}, ${s.YDS || 0} yds${+s.TD ? `, ${s.TD} TD` : ''}${+s.INT ? `, ${s.INT} INT` : ''}`
        : cat.name === 'rushing' ? `${s.CAR || 0} car, ${s.YDS || 0} yds${+s.TD ? `, ${s.TD} TD` : ''}`
        : `${s.REC || 0} rec, ${s.YDS || 0} yds${+s.TD ? `, ${s.TD} TD` : ''}`;
      const k = nm + '|' + (p.team?.abbreviation || '');
      const prev = players.get(k);
      players.set(k, { name: nm, team: p.team?.abbreviation || '', line: prev ? `${prev.line} · ${part}` : part });
    }
  }
  return {
    id: gid, state: st.state || 'pre', detail: st.shortDetail || st.detail || '', date: comp.date || '',
    tv: (comp.broadcasts || []).map(b => b.media?.shortName).filter(Boolean).join(', '),
    away, home, kind, stats, leaders, players: [...players.values()],
  };
}

// ── injuries (ESPN league-wide report) ──
async function getInjuries() {
  const d = await cachedJson(`${ESPN}/injuries`, 20 * 60 * 1000);
  const out = [];
  for (const t of (d.injuries || [])) {
    const team = t.abbreviation || t.team?.abbreviation || (t.displayName || '').split(' ').pop();
    for (const i of (t.injuries || [])) {
      const a = i.athlete || {};
      out.push({
        name: a.displayName || '', pos: a.position?.abbreviation || '', team: a.team?.abbreviation || team || '', teamName: t.displayName || '',
        status: i.status || i.type?.description || '', injury: i.details?.type || i.type?.abbreviation || '',
        note: i.shortComment || '', ret: i.details?.returnDate || '', date: i.date || '',
      });
    }
  }
  return out.filter(x => x.name);
}

// ── values ──
function leagueParams(q = {}) {
  const ppr = [0, 0.5, 1].includes(Number(q.ppr)) ? Number(q.ppr) : 1;
  const teams = [8, 10, 12, 14, 16].includes(Number(q.teams)) ? Number(q.teams) : 12;
  const qbs = Number(q.qbs) === 2 ? 2 : 1;
  const dynasty = q.dynasty === true || q.dynasty === 'true' || q.dynasty === '1' || q.dynasty === 1;
  return { ppr, teams, qbs, dynasty };
}
async function getValues(q) {
  const L = leagueParams(q);
  const url = `${FC}?isDynasty=${L.dynasty}&numQbs=${L.qbs}&numTeams=${L.teams}&ppr=${L.ppr}`;
  const d = await cachedJson(url, 30 * 60 * 1000);
  const players = (Array.isArray(d) ? d : []).map(x => ({
    id: String(x.player?.sleeperId || x.player?.id || ''),
    name: x.player?.name || '', pos: x.player?.position || '', team: x.player?.maybeTeam || '',
    age: x.player?.maybeAge ? Math.round(x.player.maybeAge) : null,
    value: Math.round(x.value || 0), rank: x.overallRank || null, posRank: x.positionRank || null,
    trend: Math.round(x.trend30Day || 0),
  })).filter(p => p.name && p.value > 0);
  return { league: L, players };
}

// ── trade math (same formula the page uses, so the coach and the bar always agree) ──
const STAR = 1.35;                      // >1 → one great player beats several good ones
const effOf = v => Math.pow(Math.max(0, v), STAR);
const backOf = e => Math.pow(Math.max(0, e), 1 / STAR);
function evaluateTrade(sideA, sideB, players) {
  const sum = s => s.reduce((t, p) => t + p.value, 0);
  const eff = s => backOf(s.reduce((t, p) => t + effOf(p.value), 0));
  const A = eff(sideA), B = eff(sideB);
  const hi = Math.max(A, B) || 1, gap = Math.abs(A - B), pct = Math.round((gap / hi) * 100);
  const winner = gap / hi < 0.05 ? 'even' : A > B ? 'a' : 'b';
  const verdict = winner === 'even' ? 'Fair trade' : pct < 12 ? 'Slight edge' : pct < 25 ? 'Clear edge' : 'Lopsided';
  // what player, added to the short side, would even it out
  let evenOut = [];
  if (winner !== 'even' && players?.length) {
    const lo = winner === 'a' ? sideB : sideA, loE = lo.reduce((t, p) => t + effOf(p.value), 0);
    const need = backOf(effOf(Math.max(A, B)) - loE);
    const used = new Set([...sideA, ...sideB].map(p => p.id));
    evenOut = players.filter(p => !used.has(p.id)).map(p => ({ ...p, d: Math.abs(p.value - need) }))
      .sort((x, y) => x.d - y.d).slice(0, 3).map(({ d, ...p }) => p);
  }
  return {
    a: { raw: sum(sideA), adjusted: Math.round(A) }, b: { raw: sum(sideB), adjusted: Math.round(B) },
    winner, verdict, edgePct: pct, evenOutForSide: winner === 'a' ? 'b' : winner === 'b' ? 'a' : null, evenOut,
  };
}

const norm = s => String(s || '').toLowerCase().replace(/[.'’,-]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();
function findPlayer(players, q) {
  const n = norm(q); if (!n) return null;
  return players.find(p => norm(p.name) === n)
      || players.find(p => norm(p.name).startsWith(n) || norm(p.name).endsWith(' ' + n))
      || players.find(p => norm(p.name).includes(n)) || null;
}

// ── trending (Sleeper) mapped to names via FantasyCalc's Sleeper ids ──
async function getTrending(kind = 'add', q) {
  const t = await cachedJson(`${SLP}/players/nfl/trending/${kind === 'drop' ? 'drop' : 'add'}?lookback_hours=24&limit=25`, 15 * 60 * 1000);
  let byId = new Map();
  try { byId = new Map((await getValues(q)).players.map(p => [p.id, p])); } catch {}
  return (Array.isArray(t) ? t : []).map(x => {
    const p = byId.get(String(x.player_id));
    return p ? { name: p.name, pos: p.pos, team: p.team, value: p.value, count: x.count } : null;
  }).filter(Boolean).slice(0, 10);
}

// injuries joined to fantasy values so the list is sorted by who matters
async function fantasyInjuries(league, names) {
  const inj = await getInjuries();
  let players = [];
  try { players = (await getValues(league)).players; } catch {}
  const vByName = new Map(players.map(p => [norm(p.name), p]));
  let rows = inj.map(x => { const v = vByName.get(norm(x.name)); return { ...x, value: v?.value || 0, posRank: v?.posRank || null }; });
  if (names?.length) { const want = names.map(norm); rows = rows.filter(r => want.some(w => norm(r.name).includes(w))); }
  else if (players.length) rows = rows.filter(r => r.value > 0);
  return rows.sort((a, b) => b.value - a.value).slice(0, 150);
}

// ── coach chat ──
const COACH_TOOLS = [
  { name: 'get_standings', description: 'Live NFL standings from ESPN, by division: each team\'s record, playoff seed, division and conference record, points for/against, differential and streak. Use for playoff picture, division races, seeding and "how is team X doing".',
    input_schema: { type: 'object', properties: {} } },
  { name: 'get_scoreboard', description: 'Live NFL scoreboard from ESPN: every game this week (or a given week) with score, quarter/clock, records, betting line and TV. Use for anything about scores, schedule, or who plays whom.',
    input_schema: { type: 'object', properties: { week: { type: 'integer', description: 'Regular-season week number. Omit for the current week.' } } } },
  { name: 'get_nfl_news', description: 'Latest NFL headlines from ESPN.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_trade_values', description: "Current fantasy trade values (FantasyCalc, tuned to the user's league settings) for the named players: value, overall rank, position rank, team, age and 30-day trend.",
    input_schema: { type: 'object', properties: { players: { type: 'array', items: { type: 'string' } } }, required: ['players'] } },
  { name: 'evaluate_trade', description: "Score a fantasy trade with the same calculator the user sees. side_a is what the USER receives, side_b is what the user gives away. Returns raw and star-adjusted totals, verdict, edge % and players who would even it out.",
    input_schema: { type: 'object', properties: { side_a: { type: 'array', items: { type: 'string' } }, side_b: { type: 'array', items: { type: 'string' } } }, required: ['side_a', 'side_b'] } },
  { name: 'get_injuries', description: "Today's league-wide NFL injury report from ESPN (status like Out/Questionable/IR, injury, short note, expected return), limited to fantasy-relevant players and sorted by fantasy value. Pass names to check specific players.",
    input_schema: { type: 'object', properties: { players: { type: 'array', items: { type: 'string' } } } } },
  { name: 'get_trending', description: 'Most-added or most-dropped players across Sleeper leagues in the last 24 hours — the waiver wire pulse.',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['add', 'drop'] } } } },
  { name: 'get_my_teams', description: "The user's OWN fantasy teams, read live from their linked ESPN and Sleeper leagues: each league's scoring format, their team's record and standing, full lineup (starters by slot, bench, IR) with injury tags and points, and this week's head-to-head matchup including the opponent's lineup and the live/projected score. Pass a week to look at another week's matchup. Call this before any start/sit, waiver, trade or 'how's my team doing' answer.",
    input_schema: { type: 'object', properties: { week: { type: 'integer', description: 'NFL week. Omit for the current week.' } } } },
  { name: 'get_league', description: "Scout one of the user's leagues: EVERY team's record, rank, points for and full roster (starters, bench, IR, injury tags), plus the adds/drops/trades you've seen each manager make. Use for trade targets (who is deep where the user is thin, who needs what the user has), who's rostered, league standings and sizing up any manager.",
    input_schema: { type: 'object', properties: { league: { type: 'string', description: 'League name (or id). Omit if the user has only one league.' } } } },
];

function coachHandlers(league, accounts, ctx = {}) {
  const lookup = async names => {
    const { players } = await getValues(league);
    return names.map(n => ({ asked: n, match: findPlayer(players, n) }));
  };
  return {
    get_scoreboard: async i => { try { return await getScoreboard(i.week); } catch (e) { return { ok: false, message: `Scoreboard unavailable (${e.message}) — use web search.` }; } },
    get_standings: async () => { try { return await getStandings(); } catch (e) { return { ok: false, message: `Standings unavailable (${e.message}) — use web search.` }; } },
    get_nfl_news: async () => { try { return { articles: await getNews(8) }; } catch (e) { return { ok: false, message: `News unavailable (${e.message}) — use web search.` }; } },
    get_trade_values: async i => { try { return { league: leagueParams(league), results: await lookup(i.players || []) }; } catch (e) { return { ok: false, message: `Values unavailable (${e.message}).` }; } },
    evaluate_trade: async (i, actions) => {
      try {
        const { players } = await getValues(league);
        const pick = arr => (arr || []).map(n => findPlayer(players, n)).filter(Boolean);
        const A = pick(i.side_a), B = pick(i.side_b);
        const missing = [...(i.side_a || []), ...(i.side_b || [])].filter(n => !findPlayer(players, n));
        const res = evaluateTrade(A, B, players);
        actions.push({ type: 'trade_evaluated', a: A.map(p => p.name), b: B.map(p => p.name), verdict: res.verdict });
        return { league: leagueParams(league), user_receives: A, user_gives: B, result: res, not_found: missing };
      } catch (e) { return { ok: false, message: `Trade calculator unavailable (${e.message}).` }; }
    },
    get_injuries: async i => { try { return { players: await fantasyInjuries(league, i.players) }; } catch (e) { return { ok: false, message: `Injury report unavailable (${e.message}) — use web search.` }; } },
    get_trending: async i => { try { return { kind: i.kind || 'add', players: await getTrending(i.kind, league) }; } catch (e) { return { ok: false, message: `Trending unavailable (${e.message}).` }; } },
    get_my_teams: async i => {
      if (!mine.hasAccounts(accounts)) return { ok: false, message: 'No ESPN or Sleeper league linked yet. Tell the user to open the Coach → Teams tab and add their Sleeper username or ESPN league ID.' };
      try { return mine.slimTeams(await mine.getMyTeams(accounts, i.week)); } catch (e) { return { ok: false, message: `Couldn't load their leagues (${e.message}).` }; }
    },
    get_league: async i => {
      if (!mine.hasAccounts(accounts)) return { ok: false, message: 'No league linked yet.' };
      try {
        const t = ctx.teams || await mine.getMyTeams(accounts);
        const r = mine.leagueRosters(t, i.league);
        if (r.teams) r.recentMoves = (ctx.moves || []).filter(m => m.league === r.league).slice(0, 40);
        return r;
      } catch (e) { return { ok: false, message: `Couldn't load the league (${e.message}).` }; }
    },
  };
}

// What the coach has learned, grouped for the prompt
const MEM_CATS = [['you', 'About the user (how they like advice, risk appetite, habits)'], ['league', 'Their leagues (rules, quirks, history)'], ['manager', 'Other managers (tendencies, needs, how to deal with them)'], ['lesson', 'Lessons from your own past calls'], ['player', 'Player notes worth carrying forward']];
function coachMemoryText(memory, moves, graded) {
  const mem = memory || [];
  const groups = MEM_CATS.map(([c, label]) => { const ms = mem.filter(m => (m.cat || 'you') === c); return ms.length ? `${label}:\n${ms.map(m => `- ${m.text}`).join('\n')}` : ''; }).filter(Boolean);
  const other = mem.filter(m => m.cat && !MEM_CATS.some(([c]) => c === m.cat));
  if (other.length) groups.push(`Other:\n${other.map(m => `- ${m.text}`).join('\n')}`);
  const mv = (moves || []).slice(0, 25).map(m => `- ${m.date} · ${m.league} · ${m.team} ${m.type === 'trade' ? `traded for ${m.players.join(', ')} (from ${m.from})` : `${m.type === 'add' ? 'added' : 'dropped'} ${m.players.join(', ')}`}`);
  const rec = (graded || []).slice(0, 12).map(a => `- Wk ${a.week} ${a.type} "${a.call}" → ${a.grade}${a.note ? `: ${a.note}` : ''}`);
  return [groups.length ? groups.join('\n\n') : '', mv.length ? `Recent moves you've seen in their leagues (newest first):\n${mv.join('\n')}` : '', rec.length ? `Your recent calls, graded against what actually happened:\n${rec.join('\n')}` : ''].filter(Boolean).join('\n\n');
}

function coachSystem({ name, league, board, roster, todayStr, teams, notes, memory }) {
  const L = leagueParams(league);
  const fmt = `${L.teams}-team ${L.ppr === 1 ? 'PPR' : L.ppr === 0.5 ? 'half-PPR' : 'standard'} ${L.qbs === 2 ? 'superflex' : '1QB'} ${L.dynasty ? 'dynasty' : 'redraft'}`;
  const games = board?.games?.length
    ? board.games.map(g => `- ${g.away.abbr} ${g.away.record ? `(${g.away.record})` : ''} @ ${g.home.abbr} ${g.home.record ? `(${g.home.record})` : ''}: ${g.state === 'pre' ? g.detail + (g.odds?.line ? ` · line ${g.odds.line}` : '') : `${g.away.score}-${g.home.score} · ${g.detail}`}`).join('\n')
    : '(scoreboard not loaded — call get_scoreboard or web search)';
  return `You are ${name}, a Pokémon who works the "Coach" job on the user's Mission Control farm. You are a genuine NFL and fantasy football expert — think a sharp beat writer crossed with a top fantasy analyst — and you talk like a friendly, confident coach. Keep replies short and phone-sized: lead with the answer (start/sit call, accept/decline, the score), then 1–3 short reasons. Use **bold** for player names and the call. A little Pokémon flavor is fine, never more than a word or two.

Today is ${todayStr}. The NFL changes daily, so never answer from memory about injuries, depth charts, trades, signings, suspensions, coaching changes or anything "current" — use your tools and web_search first, and say how fresh the info is if it matters. Your training knowledge is older than this season.

Tools: get_scoreboard (live ESPN scores), get_standings (live division standings + seeds), get_nfl_news, get_injuries (ESPN injury report — check it before any start/sit or trade call), get_trade_values and evaluate_trade (FantasyCalc market values — the same numbers the user's trade calculator shows), get_trending (Sleeper adds/drops), get_my_teams (the user's own linked ESPN/Sleeper rosters and matchups), get_league (every team's roster in one of their leagues + each manager's recent moves — use it to find trade partners and targets), and web_search for injuries, beat reports, snap counts, matchups, weather, Vegas lines and anything else.

You keep learning: everything under YOUR MEMORY below is what you've picked up from past conversations, from watching the other managers, and from grading your own old calls. Use it — tailor advice to how this user likes to play, lean on what you know about each manager when suggesting trades, and don't repeat mistakes your lessons warn about. Notes are saved for you automatically after each chat, so you don't need to announce that you'll remember something. When you make a clear start/sit, add/drop or trade call, state it plainly (player + verdict) so it can be graded later.

Trades: always call evaluate_trade with the actual players before giving a verdict, quote the edge %, then add the context numbers miss — injuries, bye weeks, roster fit, playoff schedule, the user's positional needs. Stars are worth more than the sum of depth pieces. If it's close, say what to ask for to tip it.

${teams ? `The user's REAL fantasy teams, read live from their linked ESPN/Sleeper accounts (week ${teams.week}). This is ground truth for who is on their roster and who they're playing — use it instead of asking. If they have more than one league and the question doesn't say which, answer for each briefly or ask which one:
${teams.summary}${teams.errors?.length ? `\n(Couldn't load: ${teams.errors.join('; ')})` : ''}
When you value trades for one of these leagues, keep its own format in mind; the calculator below is set to the user's default.` : "The user hasn't linked an ESPN or Sleeper league yet — if they ask about \"my team\", use the roster below if any, and mention they can link their leagues in the Coach's Teams tab."}

User's default calculator league: ${fmt}.${roster ? `\nUser's roster (as they typed it): ${roster}` : ''}

# YOUR MEMORY
${memory || '(nothing learned yet — this is one of your first conversations)'}

Current scoreboard (Week ${board?.week ?? '?'}, ${board?.season ?? ''}):
${games}${notes ? `

The user is a Buffalo Bills fan — bring Bills context in when it's relevant, and know the Bills section below cold.

Below are your researched notes on the ${board?.season || 'current'} season: who's starting, who's hurt, trades, coaching changes, usage trends, rankings and the Bills. Use them as background so you reason like someone who has followed every week — name the injury replacements, bye-week crunches and role changes without being asked. They're a dated snapshot: live tool results and web_search beat them whenever they disagree, and verify anything a start/sit or trade call hinges on.

<season_notes>
${notes}
</season_notes>` : ''}`;
}

module.exports = function mountFootball(app, { getApiKey, makeClient, runChatTurn, getAppData, saveAppData, brain, today }) {
  const send = (res, fn) => fn().then(d => res.json(d)).catch(e => res.status(502).json({ error: 'SOURCE_DOWN', message: e.message }));

  // ── the coach's brain: memory, scouting log, advice log, daily notes ──
  // data.coachMemory = [{ id, date, text, cat }]  (cat: you | league | manager | lesson | player)
  // data.coachBrain  = { notes:{ text, date }, rosters:{…snapshots}, moves:[…], advice:[…] }
  const coachBrain = d => { d.coachBrain = d.coachBrain || {}; const b = d.coachBrain; b.rosters = b.rosters || {}; b.moves = b.moves || []; b.advice = b.advice || []; return b; };
  const getSeasonNotes = () => getAppData().coachBrain?.notes?.text || getSeasonNotesFile();
  const savedAccounts = () => getAppData().farm?.coach?.accounts || {};
  const COACH_AGENT = {
    name: 'Coach', memoryKey: 'coachMemory', idPrefix: 'cmem-', cap: 200,
    cats: ['you', 'league', 'manager', 'lesson', 'player'],
    focus: "the user's fantasy football style and preferences (risk appetite, how they like advice delivered, players they love or refuse to start, their goals in each league), facts about their leagues (scoring quirks, rivals, history, trade deadlines), what you learn about other managers in their leagues (who they are, what they need, how they trade), and lessons about your own advice (calls the user disagreed with, things that turned out wrong). The user is a Buffalo Bills fan.",
    extraKey: 'advice',
    extraInstructions: `- Also list every clear recommendation ${'the Coach'} made in its LAST reply under "advice": [{"type":"start|sit|add|drop|trade|other","league":"league name or ''","players":["…"],"call":"one short line, e.g. Start Cook over Shakir"}]. Empty if it made no concrete call.`,
  };
  // roster snapshots → moves log (no extra API calls: reuses the league data already fetched)
  function recordMoves(fullTeams) {
    if (!fullTeams?.leagues?.some(l => l.allTeams)) return [];
    const d = getAppData(), b = coachBrain(d), before = JSON.stringify(b.rosters);
    const moves = mine.diffRosters(fullTeams, b.rosters, today());
    b.moves = [...moves, ...b.moves].slice(0, 200);
    if (moves.length || JSON.stringify(b.rosters) !== before) saveAppData(d);   // the Home card refreshes every 90s — only write on change
    return moves;
  }
  function addAdvice(d, items, wk, season) {
    const b = coachBrain(d);
    let n = 0;
    for (const a of items.slice(0, 6)) {
      const call = String(a.call || '').trim().slice(0, 160); if (!call) continue;
      b.advice.unshift({ id: `adv-${Date.now()}${n}`, date: today(), season, week: wk, type: String(a.type || 'other').slice(0, 10), league: String(a.league || '').slice(0, 80), players: (a.players || []).map(String).slice(0, 6), call, graded: false });
      n++;
    }
    b.advice = b.advice.slice(0, 150);
    return n;
  }

  // Daily: rewrite the season notes with fresh web research
  async function coachResearch() {
    const prev = getSeasonNotes(), st = await mine.nflState();
    let mineTxt = '';
    if (mine.hasAccounts(savedAccounts())) { try { mineTxt = mine.teamsSummary(await mine.getMyTeams(savedAccounts())); } catch {} }
    const text = await brain.research({
      maxSearches: 10, maxTokens: 8000,
      system: `You are the research desk for a fantasy football coach. Today is ${today()} (NFL ${st.season}, week ${st.week}). You keep a living briefing the coach reads before every conversation. Search the web for what changed since the previous briefing — injuries and return timelines, depth chart and role changes, trades/signings/cuts, coaching changes, bye weeks, breakout and slumping players, waiver targets, and everything about the Buffalo Bills (the user's team). Prioritize players on the user's rosters. Then output the COMPLETE updated briefing in markdown (not a diff): keep what's still true, fix what changed, drop what's stale, date anything time-sensitive, and mark unconfirmed items "(verify)". Max ~12,000 characters. Output only the briefing.`,
      prompt: `${mineTxt ? `The user's rosters right now:\n${mineTxt}\n\n` : ''}PREVIOUS BRIEFING:\n${prev || '(none yet — write one from scratch)'}`,
    });
    if (text.length < 1500) throw new Error('research came back too short');
    const d = getAppData(); coachBrain(d).notes = { text: text.slice(0, 40000), date: today() }; saveAppData(d);
    console.log('  Coach: season notes refreshed', text.length, 'chars');
  }

  // Daily: snapshot every league, log moves, and update what it knows about each manager
  async function coachScout() {
    const acc = savedAccounts(); if (!mine.hasAccounts(acc)) return;
    const t = await mine.getMyTeams(acc);
    recordMoves(t);
    const d = getAppData(), b = coachBrain(d);
    const recent = b.moves.filter(m => m.date >= new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10));
    const standings = (t.leagues || []).filter(l => l.allTeams).map(l => `${l.name}: ${l.allTeams.map(tm => `${tm.name}${tm.mine ? ' (USER)' : ''} ${tm.record.w}-${tm.record.l}`).join(', ')}`).join('\n');
    if (!recent.length && !standings) return;
    const mem = (d.coachMemory || []).filter(m => m.cat === 'manager');
    const resp = await makeClient(getApiKey()).messages.create({
      model: brain.MODEL, max_tokens: 900,
      system: `You keep a fantasy coach's notes on the OTHER managers in the user's leagues. From their standings and recent roster moves, write or update one short note per manager when there's something useful: their record/situation, positional needs or surpluses, and tendencies (active on waivers, chases last week's points, trades a lot, panics after losses). Skip managers with nothing notable. Never write notes about the user's own team. Reply ONLY JSON: {"add":[{"text":"…","cat":"manager"}],"update":[{"id":"…","text":"…"}],"remove":[]}`,
      messages: [{ role: 'user', content: `STANDINGS:\n${standings}\n\nRECENT MOVES (last 3 weeks):\n${recent.map(m => `${m.date} ${m.league} — ${m.team}: ${m.type} ${m.players.join(', ')}${m.from ? ` from ${m.from}` : ''}`).join('\n') || '(none)'}\n\nCURRENT MANAGER NOTES:\n${mem.map(m => `${m.id} | ${m.text}`).join('\n') || '(none)'}` }],
    });
    const ops = brain.parseJson(brain.textOf(resp)); if (!ops) return;
    const fresh = getAppData();
    if (brain.applyMemoryOps(fresh, 'coachMemory', 'cmem-', ops, COACH_AGENT.cap)) saveAppData(fresh);
  }

  // Weekly: grade last week's calls against the real points and keep the lessons
  async function coachGrade() {
    const acc = savedAccounts(); const d0 = getAppData(), b0 = coachBrain(d0), st = await mine.nflState();
    const due = b0.advice.filter(a => !a.graded && a.week && a.week < st.week && String(a.season) === String(st.season));
    if (!due.length || !mine.hasAccounts(acc)) return;
    const weeks = [...new Set(due.map(a => a.week))].slice(0, 3), pts = {};
    for (const w of weeks) {
      try {
        const t = await mine.getMyTeams(acc, w);
        for (const l of t.leagues || []) for (const p of [...(l.me?.starters || []), ...(l.me?.bench || []), ...(l.opp?.starters || [])]) if (p.pts != null) pts[`${w}|${p.name}`] = p.pts;
      } catch {}
    }
    const lines = due.map(a => `${a.id} | week ${a.week} | ${a.type} | ${a.league} | "${a.call}" | points that week: ${a.players.map(n => `${n}=${pts[`${a.week}|${n}`] ?? '?'}`).join(', ')}`).join('\n');
    const resp = await makeClient(getApiKey()).messages.create({
      model: brain.MODEL, max_tokens: 1200,
      system: `You grade a fantasy football coach's past recommendations against what actually happened, so it gets better. For each call give grade "right", "wrong", "mixed" or "unknown" (unknown when the points don't settle it, e.g. trades — judge those only if obvious) and a short note. Then write 0-3 general lessons worth remembering (patterns, not one-offs), e.g. "Overrated rookies in tough matchups twice — weigh matchup more." Reply ONLY JSON: {"grades":[{"id":"…","grade":"…","note":"…"}],"lessons":[{"text":"…"}]}`,
      messages: [{ role: 'user', content: lines }],
    });
    const out = brain.parseJson(brain.textOf(resp)); if (!out) return;
    const d = getAppData(), b = coachBrain(d);
    for (const g of out.grades || []) { const a = b.advice.find(x => x.id === g.id); if (a) { a.graded = true; a.grade = String(g.grade || 'unknown').slice(0, 10); a.note = String(g.note || '').slice(0, 200); } }
    for (const a of b.advice) if (due.some(x => x.id === a.id)) a.graded = true;   // don't retry forever
    brain.applyMemoryOps(d, 'coachMemory', 'cmem-', { add: (out.lessons || []).map(l => ({ text: l.text, cat: 'lesson' })) }, COACH_AGENT.cap);
    saveAppData(d);
  }

  // Called by server.js on a timer and lazily from chats; each job runs once per period
  async function runCoachJobs() {
    if (!getApiKey()) return;
    const st = await mine.nflState().catch(() => null);
    await brain.once('coachScout', today(), coachScout);
    await brain.once('coachResearch', today(), coachResearch);
    if (st) await brain.once('coachGrade', `${st.season}-w${st.week}`, coachGrade);
  }

  app.get('/api/nfl/scoreboard', (req, res) => send(res, () => getScoreboard(req.query.week)));
  app.get('/api/nfl/standings', (req, res) => send(res, () => getStandings()));
  app.get('/api/nfl/team', (req, res) => send(res, () => getTeam(req.query.abbr)));
  app.get('/api/nfl/game/:id', (req, res) => send(res, () => getGame(req.params.id)));
  app.get('/api/nfl/news', (req, res) => send(res, async () => ({ articles: await getNews(10) })));
  app.get('/api/nfl/injuries', (req, res) => send(res, async () => ({ players: req.query.all === '1' ? await getInjuries() : await fantasyInjuries(req.query) })));
  app.get('/api/fantasy/values', (req, res) => send(res, () => getValues(req.query)));
  app.get('/api/fantasy/trending', (req, res) => send(res, async () => ({ players: await getTrending(req.query.kind, req.query) })));
  // the user's own leagues (accounts come from the client; ESPN private-league cookies from env only)
  app.post('/api/fantasy/my-teams', (req, res) => send(res, async () => {
    const t = await mine.getMyTeams(req.body?.accounts || {}, req.body?.week);
    if (!req.body?.week) { try { recordMoves(t); } catch {} }   // every refresh doubles as a scouting snapshot
    return mine.slimTeams(t);
  }));
  app.get('/api/fantasy/espn-login', (req, res) => res.json({ configured: !!mine.espnCookies() }));
  app.post('/api/fantasy/trade', (req, res) => send(res, async () => {
    const { players } = await getValues(req.body.league || {});
    const ids = arr => (arr || []).map(String);
    const pick = arr => ids(arr).map(id => players.find(p => p.id === id)).filter(Boolean);
    return evaluateTrade(pick(req.body.a), pick(req.body.b), players);
  }));

  app.post('/api/coach-chat', async (req, res) => {
    const key = getApiKey();
    if (!key) return res.status(401).json({ error: 'NO_KEY', message: 'No API key found.' });
    const { message = '', history = [], name = 'Coach', league = {}, roster = '', accounts = {} } = req.body || {};
    if (!message.trim()) return res.status(400).json({ error: 'Empty message' });
    try {
      let board = null, teams = null, full = null;
      await Promise.all([
        getScoreboard().then(b => { board = b; }).catch(() => {}),
        mine.hasAccounts(accounts)
          ? Promise.race([mine.getMyTeams(accounts), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))])
              .then(t => { full = t; teams = { week: t.week, summary: mine.teamsSummary(t), errors: t.errors }; }).catch(() => {})
          : null,
      ]);
      try { recordMoves(full); } catch {}
      const d = getAppData(), b = coachBrain(d), moves = b.moves;
      const memory = coachMemoryText(d.coachMemory, moves, b.advice.filter(a => a.graded && a.grade && a.grade !== 'unknown'));
      const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: process.env.APP_TZ || 'America/New_York' });
      const system = coachSystem({ name: String(name).slice(0, 40), league, board, roster: String(roster).slice(0, 1200), todayStr, teams, notes: getSeasonNotes(), memory });
      const hist = history.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
      const messages = [...hist, { role: 'user', content: message }];
      const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }, ...COACH_TOOLS];
      const out = await runChatTurn(makeClient(key), system, tools, messages, coachHandlers(league, accounts, { teams: full, moves }), 6, 1600);
      res.json({ response: out.text, tokens: out.usage, toolActions: out.toolActions });
      // learn from this exchange in the background, then catch up on any due daily/weekly jobs
      const week = full?.week || board?.week || null, season = full?.season || board?.season || null;
      brain.reflect(COACH_AGENT, [...hist.slice(-4), { role: 'user', content: message }, { role: 'assistant', content: out.text }], (dd, items) => addAdvice(dd, items, week, season))
        .then(() => runCoachJobs()).catch(() => {});
    } catch (err) {
      const msg = String(err.message || '');
      const status = err.status === 429 ? 429 : err.status === 401 ? 401 : (err.status === 529 || err.status === 503) ? 503 : 500;
      res.status(status).json({ error: status === 429 ? 'RATE_LIMIT' : status === 401 ? 'AUTH_ERROR' : 'UNKNOWN', message: status === 503 ? "Claude's servers are busy — try again in a minute." : msg || 'Something went wrong.' });
    }
  });

  return { runCoachJobs };
};
module.exports.evaluateTrade = evaluateTrade;
module.exports.findPlayer = findPlayer;
