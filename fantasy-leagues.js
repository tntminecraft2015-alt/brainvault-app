// ── MY FANTASY LEAGUES (Sleeper + ESPN) ─────────────────────────────────────
// Reads the user's own fantasy teams so the Coach can see rosters, records and
// this week's matchups.
//   • Sleeper: fully public API — only a username is needed.
//   • ESPN:    league id (+ which team is theirs). Public leagues need nothing
//              else; PRIVATE leagues need the user's espn_s2 + SWID cookies,
//              which live ONLY in Render env vars (ESPN_S2, ESPN_SWID) — never in
//              app-data.json, since /api/data is readable without a login.
// Everything is cached briefly so the Home card refreshing doesn't hammer either site.

const SLP = 'https://api.sleeper.app/v1';
const ESPN_FF = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const cache = new Map();
async function getJson(url, ttlMs, { headers = {}, timeout = 10000 } = {}) {
  const key = url + '|' + (headers.Cookie ? 'c' : '');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.data;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    const data = await r.json();
    cache.set(key, { t: Date.now(), data });
    return data;
  } catch (e) {
    if (hit && !e.status) return hit.data;   // network blip → stale copy; real 4xx → surface it
    throw e;
  }
}

const round1 = n => (typeof n === 'number' && isFinite(n) ? Math.round(n * 10) / 10 : null);
const BENCHY = /^(BN|IR|TAXI)$/;

// ── NFL week (Sleeper's state endpoint is the cleanest source) ──
async function nflState() {
  try {
    const s = await getJson(`${SLP}/state/nfl`, 30 * 60 * 1000);
    return { season: String(s.league_season || s.season || new Date().getFullYear()), week: Number(s.display_week || s.week) || 1, type: s.season_type || 'regular' };
  } catch {
    const now = new Date();
    return { season: String(now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear()), week: 1, type: 'regular' };
  }
}

// ═══════════════════════════════ SLEEPER ═══════════════════════════════
// The full player DB is ~10MB, so fetch it at most once a day and keep a slim map.
let slpPlayers = null, slpPlayersAt = 0, slpPlayersLoading = null;
async function sleeperPlayers() {
  if (slpPlayers && Date.now() - slpPlayersAt < 24 * 3600 * 1000) return slpPlayers;
  if (slpPlayersLoading) return slpPlayersLoading;
  slpPlayersLoading = (async () => {
    try {
      const r = await fetch(`${SLP}/players/nfl`, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const raw = await r.json(), map = new Map();
      for (const [id, p] of Object.entries(raw)) {
        map.set(id, {
          name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || id,
          pos: p.position || (p.fantasy_positions || [])[0] || '',
          team: p.team || '', status: p.injury_status || '', bye: null,
        });
      }
      slpPlayers = map; slpPlayersAt = Date.now();
    } catch (e) { if (!slpPlayers) slpPlayers = new Map(); }
    slpPlayersLoading = null;
    return slpPlayers;
  })();
  return slpPlayersLoading;
}

function sleeperFormat(lg) {
  const ss = lg.scoring_settings || {}, rp = lg.roster_positions || [];
  return {
    ppr: Number(ss.rec) >= 1 ? 1 : Number(ss.rec) >= 0.5 ? 0.5 : 0,
    teams: Number(lg.total_rosters) || 12,
    qbs: rp.includes('SUPER_FLEX') || rp.filter(x => x === 'QB').length > 1 ? 2 : 1,
    dynasty: Number(lg.settings?.type) === 2,
  };
}

async function sleeperLeagues(username, week, season) {
  const user = await getJson(`${SLP}/user/${encodeURIComponent(username)}`, 6 * 3600 * 1000).catch(e => { throw new Error(e.status === 404 ? `Sleeper user “${username}” not found` : `Sleeper unreachable (${e.message})`); });
  if (!user || !user.user_id) throw new Error(`Sleeper user “${username}” not found`);
  const leagues = await getJson(`${SLP}/user/${user.user_id}/leagues/nfl/${season}`, 30 * 60 * 1000);
  const players = await sleeperPlayers();
  const P = id => players.get(String(id)) || { name: String(id), pos: /^[A-Z]{2,3}$/.test(id) ? 'DEF' : '', team: /^[A-Z]{2,3}$/.test(id) ? id : '', status: '' };
  const out = [];
  for (const lg of (Array.isArray(leagues) ? leagues : []).slice(0, 6)) {
    try {
      const [rosters, users, matchups] = await Promise.all([
        getJson(`${SLP}/league/${lg.league_id}/rosters`, 2 * 60 * 1000),
        getJson(`${SLP}/league/${lg.league_id}/users`, 30 * 60 * 1000),
        getJson(`${SLP}/league/${lg.league_id}/matchups/${week}`, 60 * 1000).catch(() => []),
      ]);
      const uById = new Map((users || []).map(u => [u.user_id, u]));
      const teamName = r => { const u = uById.get(r?.owner_id); return u?.metadata?.team_name || u?.display_name || `Team ${r?.roster_id}`; };
      const rec = r => { const s = r?.settings || {}; return { w: s.wins || 0, l: s.losses || 0, t: s.ties || 0, pf: round1((s.fpts || 0) + (s.fpts_decimal || 0) / 100) }; };
      const mine = (rosters || []).find(r => r.owner_id === user.user_id || (r.co_owners || []).includes(user.user_id));
      if (!mine) continue;
      const slots = (lg.roster_positions || []).filter(s => !BENCHY.test(s));
      const ranked = [...(rosters || [])].sort((a, b) => (rec(b).w - rec(a).w) || (rec(b).pf - rec(a).pf));
      const side = (r, m) => {
        if (!r) return null;
        const starters = (m?.starters || r.starters || []);
        const pts = m?.players_points || {};
        const sSet = new Set(starters);
        const ppl = id => { const p = P(id); return { name: p.name, pos: p.pos, team: p.team, status: p.status, pts: m ? round1(pts[id]) : null }; };
        return {
          name: teamName(r), record: rec(r), rank: ranked.indexOf(r) + 1,
          score: m ? round1(m.points) : null, proj: null,
          starters: starters.map((id, i) => id && id !== '0' ? { slot: slots[i] || 'FLEX', ...ppl(id) } : { slot: slots[i] || 'FLEX', name: '(empty)', pos: '', team: '', status: '', pts: null }),
          bench: (r.players || []).filter(id => !sSet.has(id) && !(r.reserve || []).includes(id) && !(r.taxi || []).includes(id)).map(ppl),
          ir: (r.reserve || []).map(ppl),
        };
      };
      const myM = (matchups || []).find(m => m.roster_id === mine.roster_id);
      const oppM = myM && myM.matchup_id != null ? (matchups || []).find(m => m.matchup_id === myM.matchup_id && m.roster_id !== mine.roster_id) : null;
      const oppR = oppM ? (rosters || []).find(r => r.roster_id === oppM.roster_id) : null;
      const allTeams = ranked.map((r, i) => {
        const st = new Set(r.starters || []), ir = new Set(r.reserve || []);
        return { name: teamName(r), record: rec(r), rank: i + 1, mine: r === mine,
          players: (r.players || []).map(id => { const p = P(id); return { name: p.name, pos: p.pos, team: p.team, status: p.status, slot: ir.has(id) ? 'IR' : st.has(id) ? 'start' : 'bench' }; }) };
      });
      out.push({
        platform: 'sleeper', id: lg.league_id, name: lg.name || 'Sleeper league', season, week,
        format: sleeperFormat(lg), status: lg.status,
        me: side(mine, myM), opp: side(oppR, oppM), allTeams,
      });
    } catch (e) {
      out.push({ platform: 'sleeper', id: lg.league_id, name: lg.name || 'Sleeper league', error: `Couldn’t load (${e.message})` });
    }
  }
  return { user: user.display_name || username, leagues: out };
}

// ═══════════════════════════════ ESPN ═══════════════════════════════
const ESPN_POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
const ESPN_SLOT = { 0: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'SFLEX', 16: 'DEF', 17: 'K', 20: 'BN', 21: 'IR', 23: 'FLEX', 24: 'ER' };
const ESPN_TEAM = { 0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU' };
const ESPN_STATUS = { ACTIVE: '', NORMAL: '', QUESTIONABLE: 'Questionable', DOUBTFUL: 'Doubtful', OUT: 'Out', INJURY_RESERVE: 'IR', SUSPENSION: 'Suspended', DAY_TO_DAY: 'Questionable' };

function espnCookies() {
  const s2 = (process.env.ESPN_S2 || '').trim(), swid = (process.env.ESPN_SWID || '').trim();
  if (!s2 || !swid) return null;
  const sw = swid.startsWith('{') ? swid : `{${swid.replace(/[{}]/g, '')}}`;
  return { s2, swid: sw.toUpperCase(), header: `espn_s2=${s2}; SWID=${sw}` };
}

async function espnLeague(leagueId, teamId, week, season) {
  const ck = espnCookies();
  const views = ['mTeam', 'mRoster', 'mMatchupScore', 'mSettings', 'mStatus'].map(v => `view=${v}`).join('&');
  const url = `${ESPN_FF}/seasons/${season}/segments/0/leagues/${encodeURIComponent(leagueId)}?${views}${week ? `&scoringPeriodId=${week}` : ''}`;
  let d;
  try { d = await getJson(url, 60 * 1000, { headers: ck ? { Cookie: ck.header } : {} }); }
  catch (e) {
    if (e.status === 401 || e.status === 403) throw new Error(ck ? 'ESPN refused the saved login — the ESPN_S2/ESPN_SWID cookies have probably expired' : 'This ESPN league is private — add ESPN_S2 and ESPN_SWID on Render so I can read it');
    if (e.status === 404) throw new Error(`ESPN league ${leagueId} not found for ${season}`);
    throw new Error(`ESPN unreachable (${e.message})`);
  }
  const s = d.settings || {};
  const curWeek = Number(week) || d.status?.currentMatchupPeriod || d.scoringPeriodId || 1;
  const sp = Number(week) || d.scoringPeriodId || curWeek;
  const teamName = t => t ? (t.name || [t.location, t.nickname].filter(Boolean).join(' ') || t.abbrev || `Team ${t.id}`) : '';
  const teams = d.teams || [];
  const rec = t => { const o = t?.record?.overall || {}; return { w: o.wins || 0, l: o.losses || 0, t: o.ties || 0, pf: round1(o.pointsFor || 0) }; };
  const ranked = [...teams].sort((a, b) => (rec(b).w - rec(a).w) || (rec(b).pf - rec(a).pf));

  let mine = null;
  if (ck) mine = teams.find(t => (t.owners || []).some(o => String(o).toUpperCase() === ck.swid));
  if (!mine && teamId != null && teamId !== '') mine = teams.find(t => String(t.id) === String(teamId));
  const format = {
    ppr: (() => { const r = (s.scoringSettings?.scoringItems || []).find(i => i.statId === 53); const v = r ? Number(r.points) : 0; return v >= 1 ? 1 : v >= 0.5 ? 0.5 : 0; })(),
    teams: s.size || teams.length || 12,
    qbs: ((s.rosterSettings?.lineupSlotCounts || {})['7'] > 0 || (s.rosterSettings?.lineupSlotCounts || {})['0'] > 1) ? 2 : 1,
    dynasty: false,
  };
  const base = { platform: 'espn', id: String(leagueId), name: s.name || `ESPN league ${leagueId}`, season, week: curWeek, format };
  if (!mine) return { ...base, needsTeam: true, teams: teams.map(t => ({ id: t.id, name: teamName(t) })) };

  const ptsFor = (pl, src) => {
    const st = (pl.stats || []).find(x => x.scoringPeriodId === sp && x.statSourceId === src && x.statSplitTypeId === 1);
    return st ? round1(st.appliedTotal) : null;
  };
  const side = (t, m) => {
    if (!t) return null;
    const ppl = e => {
      const pl = e.playerPoolEntry?.player || {};
      return {
        slot: ESPN_SLOT[e.lineupSlotId] || 'FLEX', name: pl.fullName || `#${e.playerId}`,
        pos: ESPN_POS[pl.defaultPositionId] || '', team: ESPN_TEAM[pl.proTeamId] || '',
        status: ESPN_STATUS[pl.injuryStatus] ?? (pl.injured ? 'Injured' : ''),
        pts: ptsFor(pl, 0), proj: ptsFor(pl, 1),
      };
    };
    const ent = t.roster?.entries || [];
    const all = ent.map(ppl);
    return {
      name: teamName(t), record: rec(t), rank: ranked.indexOf(t) + 1,
      score: m ? round1(m.totalPointsLive ?? m.totalPoints) : null,
      proj: m ? round1(m.totalProjectedPointsLive ?? null) : null,
      starters: all.filter(p => p.slot !== 'BN' && p.slot !== 'IR'),
      bench: all.filter(p => p.slot === 'BN'), ir: all.filter(p => p.slot === 'IR'),
    };
  };
  const game = (d.schedule || []).find(g => g.matchupPeriodId === curWeek && (g.home?.teamId === mine.id || g.away?.teamId === mine.id));
  const meSide = game ? (game.home?.teamId === mine.id ? game.home : game.away) : null;
  const opSide = game ? (game.home?.teamId === mine.id ? game.away : game.home) : null;
  const opp = opSide ? teams.find(t => t.id === opSide.teamId) : null;
  const allTeams = ranked.map((t, i) => ({
    name: teamName(t), record: rec(t), rank: i + 1, mine: t === mine,
    players: (t.roster?.entries || []).map(e => { const pl = e.playerPoolEntry?.player || {}; const sl = ESPN_SLOT[e.lineupSlotId] || 'FLEX';
      return { name: pl.fullName || `#${e.playerId}`, pos: ESPN_POS[pl.defaultPositionId] || '', team: ESPN_TEAM[pl.proTeamId] || '', status: ESPN_STATUS[pl.injuryStatus] ?? '', slot: sl === 'BN' ? 'bench' : sl === 'IR' ? 'IR' : 'start' }; }),
  }));
  return { ...base, me: side(mine, meSide), opp: side(opp, opSide), allTeams };
}

// Every league without the all-teams rosters (what the phone and get_my_teams need)
function slimTeams(t) { return t ? { ...t, leagues: (t.leagues || []).map(({ allTeams, ...l }) => l) } : t; }

// One league's full picture for scouting: every team's record, rank and roster
function leagueRosters(t, which) {
  const q = String(which || '').toLowerCase();
  const lgs = (t?.leagues || []).filter(l => l.allTeams);
  const l = lgs.find(x => x.id === which || x.name.toLowerCase() === q) || lgs.find(x => x.name.toLowerCase().includes(q)) || (lgs.length === 1 ? lgs[0] : null);
  if (!l) return { ok: false, message: lgs.length ? `Which league? ${lgs.map(x => `"${x.name}"`).join(', ')}` : 'No league rosters available.' };
  return { league: l.name, platform: l.platform, week: l.week, format: l.format,
    teams: l.allTeams.map(tm => ({ team: tm.name, yours: tm.mine, record: `${tm.record.w}-${tm.record.l}${tm.record.t ? `-${tm.record.t}` : ''}`, rank: tm.rank, pointsFor: tm.record.pf,
      roster: tm.players.map(p => `${p.name}${p.pos ? ` ${p.pos}` : ''}${p.team ? ` ${p.team}` : ''}${p.status ? ` [${p.status}]` : ''}${p.slot === 'bench' ? ' (bench)' : p.slot === 'IR' ? ' (IR)' : ''}`) })) };
}

// Compare every team's roster to the last snapshot and return what changed. A player who
// left one team and joined another in the same league is logged as a trade.
// snaps: { [platform:leagueId]: { [teamName]: [playerName] } } — updated in place.
function diffRosters(t, snaps, dateStr) {
  const moves = [];
  for (const l of (t?.leagues || [])) {
    if (!l.allTeams) continue;
    const k = `${l.platform}:${l.id}`, prev = snaps[k], now = {};
    for (const tm of l.allTeams) now[tm.name] = tm.players.map(p => p.name);
    if (prev) {
      const added = {}, dropped = {};
      for (const [team, names] of Object.entries(now)) {
        if (!prev[team]) continue;                     // renamed team: just re-baseline it
        const was = new Set(prev[team]), is = new Set(names);
        added[team] = names.filter(n => !was.has(n)); dropped[team] = prev[team].filter(n => !is.has(n));
      }
      const gone = new Map(); for (const [team, ns] of Object.entries(dropped)) for (const n of ns) gone.set(n, team);
      for (const [team, ns] of Object.entries(added)) {
        const fromTrade = ns.filter(n => gone.has(n) && gone.get(n) !== team);
        if (fromTrade.length) moves.push({ date: dateStr, league: l.name, team, type: 'trade', players: fromTrade, from: [...new Set(fromTrade.map(n => gone.get(n)))].join(', ') });
        const adds = ns.filter(n => !fromTrade.includes(n));
        if (adds.length) moves.push({ date: dateStr, league: l.name, team, type: 'add', players: adds });
      }
      const traded = new Set(moves.filter(m => m.type === 'trade').flatMap(m => m.players));
      for (const [team, ns] of Object.entries(dropped)) { const d = ns.filter(n => !traded.has(n)); if (d.length) moves.push({ date: dateStr, league: l.name, team, type: 'drop', players: d }); }
    }
    snaps[k] = now;
  }
  return moves;
}

// ═══════════════════════════════ BOTH ═══════════════════════════════
// accounts = { sleeper: 'username', espn: [{ id: '123456', team: 4 }] }
function cleanAccounts(a = {}) {
  const sleeper = String(a.sleeper || '').trim().replace(/^@/, '').slice(0, 40);
  const espn = (Array.isArray(a.espn) ? a.espn : []).map(x => ({ id: String(x?.id || '').replace(/\D/g, '').slice(0, 12), team: x?.team ?? null })).filter(x => x.id).slice(0, 4);
  return { sleeper, espn };
}
function hasAccounts(a) { const c = cleanAccounts(a); return !!(c.sleeper || c.espn.length); }

async function getMyTeams(accounts, weekArg) {
  const acc = cleanAccounts(accounts);
  const st = await nflState();
  const week = Number(weekArg) || st.week;
  const leagues = [], errors = [];
  const jobs = [];
  if (acc.sleeper) jobs.push(sleeperLeagues(acc.sleeper, week, st.season).then(r => { leagues.push(...r.leagues); if (!r.leagues.length) errors.push(`No ${st.season} Sleeper leagues found for “${acc.sleeper}”`); }).catch(e => errors.push(e.message)));
  for (const e of acc.espn) jobs.push(espnLeague(e.id, e.team, weekArg ? week : null, st.season).then(l => leagues.push(l)).catch(err => errors.push(`ESPN ${e.id}: ${err.message}`)));
  await Promise.all(jobs);
  leagues.sort((a, b) => (a.platform === b.platform ? 0 : a.platform === 'espn' ? -1 : 1));
  return { season: st.season, week, leagues, errors, espnLogin: !!espnCookies() };
}

// Short text version for the coach's system prompt.
function teamsSummary(t) {
  if (!t || !t.leagues?.length) return '';
  const fmt = f => f ? `${f.teams}-team ${f.ppr === 1 ? 'PPR' : f.ppr === 0.5 ? 'half-PPR' : 'standard'}${f.qbs === 2 ? ' superflex' : ''}${f.dynasty ? ' dynasty' : ''}` : '';
  const pl = p => `${p.name}${p.pos ? ` ${p.pos}` : ''}${p.team ? ` (${p.team})` : ''}${p.status ? ` [${p.status}]` : ''}`;
  return t.leagues.map(l => {
    if (l.error) return `- ${l.platform.toUpperCase()} “${l.name}”: ${l.error}`;
    if (l.needsTeam) return `- ESPN “${l.name}”: user hasn't picked which team is theirs yet.`;
    const r = l.me?.record;
    let s = `- ${l.platform.toUpperCase()} “${l.name}” (${fmt(l.format)}) — their team “${l.me.name}”, ${r.w}-${r.l}${r.t ? `-${r.t}` : ''}, rank ${l.me.rank}/${l.format?.teams || '?'}, ${r.pf} PF.`;
    if (l.opp) s += ` Week ${l.week} vs “${l.opp.name}” (${l.opp.record.w}-${l.opp.record.l}): ${l.me.score ?? 0}–${l.opp.score ?? 0}${l.me.proj ? ` (proj ${l.me.proj}–${l.opp.proj ?? '?'})` : ''}.`;
    else s += ` No matchup this week (bye or offseason).`;
    s += `\n  Starters: ${l.me.starters.map(p => `${p.slot}: ${pl(p)}`).join('; ')}`;
    s += `\n  Bench: ${l.me.bench.map(pl).join('; ') || '—'}${l.me.ir?.length ? `\n  IR: ${l.me.ir.map(pl).join('; ')}` : ''}`;
    if (l.opp) s += `\n  Opponent starters: ${l.opp.starters.map(p => `${p.slot}: ${pl(p)}`).join('; ')}`;
    return s;
  }).join('\n');
}

module.exports = { getMyTeams, teamsSummary, cleanAccounts, hasAccounts, espnCookies, nflState, slimTeams, leagueRosters, diffRosters };
