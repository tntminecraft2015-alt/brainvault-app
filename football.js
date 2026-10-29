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

// ── news ──
async function getNews(limit = 10) {
  const d = await cachedJson(`${ESPN}/news?limit=${limit}`, 10 * 60 * 1000);
  return (d.articles || []).slice(0, limit).map(a => ({
    headline: a.headline || '', description: a.description || '', published: a.published || '',
    url: a.links?.web?.href || '', image: a.images?.[0]?.url || '',
  }));
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

// ── coach chat ──
const COACH_TOOLS = [
  { name: 'get_scoreboard', description: 'Live NFL scoreboard from ESPN: every game this week (or a given week) with score, quarter/clock, records, betting line and TV. Use for anything about scores, schedule, or who plays whom.',
    input_schema: { type: 'object', properties: { week: { type: 'integer', description: 'Regular-season week number. Omit for the current week.' } } } },
  { name: 'get_nfl_news', description: 'Latest NFL headlines from ESPN.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_trade_values', description: "Current fantasy trade values (FantasyCalc, tuned to the user's league settings) for the named players: value, overall rank, position rank, team, age and 30-day trend.",
    input_schema: { type: 'object', properties: { players: { type: 'array', items: { type: 'string' } } }, required: ['players'] } },
  { name: 'evaluate_trade', description: "Score a fantasy trade with the same calculator the user sees. side_a is what the USER receives, side_b is what the user gives away. Returns raw and star-adjusted totals, verdict, edge % and players who would even it out.",
    input_schema: { type: 'object', properties: { side_a: { type: 'array', items: { type: 'string' } }, side_b: { type: 'array', items: { type: 'string' } } }, required: ['side_a', 'side_b'] } },
  { name: 'get_trending', description: 'Most-added or most-dropped players across Sleeper leagues in the last 24 hours — the waiver wire pulse.',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['add', 'drop'] } } } },
];

function coachHandlers(league) {
  const lookup = async names => {
    const { players } = await getValues(league);
    return names.map(n => ({ asked: n, match: findPlayer(players, n) }));
  };
  return {
    get_scoreboard: async i => { try { return await getScoreboard(i.week); } catch (e) { return { ok: false, message: `Scoreboard unavailable (${e.message}) — use web search.` }; } },
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
    get_trending: async i => { try { return { kind: i.kind || 'add', players: await getTrending(i.kind, league) }; } catch (e) { return { ok: false, message: `Trending unavailable (${e.message}).` }; } },
  };
}

function coachSystem({ name, league, board, roster, todayStr }) {
  const L = leagueParams(league);
  const fmt = `${L.teams}-team ${L.ppr === 1 ? 'PPR' : L.ppr === 0.5 ? 'half-PPR' : 'standard'} ${L.qbs === 2 ? 'superflex' : '1QB'} ${L.dynasty ? 'dynasty' : 'redraft'}`;
  const games = board?.games?.length
    ? board.games.map(g => `- ${g.away.abbr} ${g.away.record ? `(${g.away.record})` : ''} @ ${g.home.abbr} ${g.home.record ? `(${g.home.record})` : ''}: ${g.state === 'pre' ? g.detail + (g.odds?.line ? ` · line ${g.odds.line}` : '') : `${g.away.score}-${g.home.score} · ${g.detail}`}`).join('\n')
    : '(scoreboard not loaded — call get_scoreboard or web search)';
  return `You are ${name}, a Pokémon who works the "Coach" job on the user's Mission Control farm. You are a genuine NFL and fantasy football expert — think a sharp beat writer crossed with a top fantasy analyst — and you talk like a friendly, confident coach. Keep replies short and phone-sized: lead with the answer (start/sit call, accept/decline, the score), then 1–3 short reasons. Use **bold** for player names and the call. A little Pokémon flavor is fine, never more than a word or two.

Today is ${todayStr}. The NFL changes daily, so never answer from memory about injuries, depth charts, trades, signings, suspensions, coaching changes or anything "current" — use your tools and web_search first, and say how fresh the info is if it matters. Your training knowledge is older than this season.

Tools: get_scoreboard (live ESPN scores), get_nfl_news, get_trade_values and evaluate_trade (FantasyCalc market values — the same numbers the user's trade calculator shows), get_trending (Sleeper adds/drops), and web_search for injuries, beat reports, snap counts, matchups, weather, Vegas lines and anything else.

Trades: always call evaluate_trade with the actual players before giving a verdict, quote the edge %, then add the context numbers miss — injuries, bye weeks, roster fit, playoff schedule, the user's positional needs. Stars are worth more than the sum of depth pieces. If it's close, say what to ask for to tip it.

User's league: ${fmt}.${roster ? `\nUser's roster (as they typed it): ${roster}` : ''}

Current scoreboard (Week ${board?.week ?? '?'}, ${board?.season ?? ''}):
${games}`;
}

module.exports = function mountFootball(app, { getApiKey, makeClient, runChatTurn }) {
  const send = (res, fn) => fn().then(d => res.json(d)).catch(e => res.status(502).json({ error: 'SOURCE_DOWN', message: e.message }));

  app.get('/api/nfl/scoreboard', (req, res) => send(res, () => getScoreboard(req.query.week)));
  app.get('/api/nfl/news', (req, res) => send(res, async () => ({ articles: await getNews(10) })));
  app.get('/api/fantasy/values', (req, res) => send(res, () => getValues(req.query)));
  app.get('/api/fantasy/trending', (req, res) => send(res, async () => ({ players: await getTrending(req.query.kind, req.query) })));
  app.post('/api/fantasy/trade', (req, res) => send(res, async () => {
    const { players } = await getValues(req.body.league || {});
    const ids = arr => (arr || []).map(String);
    const pick = arr => ids(arr).map(id => players.find(p => p.id === id)).filter(Boolean);
    return evaluateTrade(pick(req.body.a), pick(req.body.b), players);
  }));

  app.post('/api/coach-chat', async (req, res) => {
    const key = getApiKey();
    if (!key) return res.status(401).json({ error: 'NO_KEY', message: 'No API key found.' });
    const { message = '', history = [], name = 'Coach', league = {}, roster = '' } = req.body || {};
    if (!message.trim()) return res.status(400).json({ error: 'Empty message' });
    try {
      let board = null; try { board = await getScoreboard(); } catch {}
      const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: process.env.APP_TZ || 'America/New_York' });
      const system = coachSystem({ name: String(name).slice(0, 40), league, board, roster: String(roster).slice(0, 1200), todayStr });
      const messages = [...history.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })), { role: 'user', content: message }];
      const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }, ...COACH_TOOLS];
      const out = await runChatTurn(makeClient(key), system, tools, messages, coachHandlers(league), 6, 1600);
      res.json({ response: out.text, tokens: out.usage, toolActions: out.toolActions });
    } catch (err) {
      const msg = String(err.message || '');
      const status = err.status === 429 ? 429 : err.status === 401 ? 401 : (err.status === 529 || err.status === 503) ? 503 : 500;
      res.status(status).json({ error: status === 429 ? 'RATE_LIMIT' : status === 401 ? 'AUTH_ERROR' : 'UNKNOWN', message: status === 503 ? "Claude's servers are busy — try again in a minute." : msg || 'Something went wrong.' });
    }
  });
};
module.exports.evaluateTrade = evaluateTrade;
module.exports.findPlayer = findPlayer;
