// ── CLIP STUDIO ─────────────────────────────────────────────────────────────
// Find streamer videos worth clipping, send them to the clip worker, review the results.
//   • Twitch Helix (free app token)   → trending streams, recent VODs + top clips of saved streamers
//   • Claude Haiku                    → "clip potential" scores, moment picks, hook titles, captions
//   • Clip worker (worker/ folder)    → download, transcribe, crop to 9:16, burn captions, store files
// Jobs are PUSHED to the worker (no polling) so Render's free tier can sleep between jobs.
// The worker reports back here, and sends the "clips ready" push itself so it never depends
// on this server being awake. Job state lives in app-data (data.clips), persisted like everything else.

const crypto = require('crypto');
const { Readable } = require('stream');

const HAIKU = 'claude-haiku-4-5-20251001';
const HAIKU_IN = 1 / 1e6, HAIKU_OUT = 5 / 1e6;           // $ per token
const WHOP_FEE = 0.09;                                     // conservative end of the 7–9% reported
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/+$/, '');
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const TW_ID = process.env.TWITCH_CLIENT_ID || '', TW_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const YT_ID = process.env.YT_CLIENT_ID || '', YT_SECRET = process.env.YT_CLIENT_SECRET || '';
const YT_REDIRECT = `${(process.env.PUBLIC_BASE_URL || 'https://brainvault-app.onrender.com').replace(/\/+$/, '')}/api/clips/youtube/callback`;
const TT_KEY = process.env.TIKTOK_CLIENT_KEY || '', TT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
const TT_REDIRECT = `${(process.env.PUBLIC_BASE_URL || 'https://brainvault-app.onrender.com').replace(/\/+$/, '')}/api/clips/tiktok/callback`;
const LAYOUTS = ['blur', 'center', 'split'];
const CORNERS = ['tl', 'tr', 'bl', 'br'];

const str = (v, n) => String(v ?? '').trim().slice(0, n);
const OPEN_STATUSES = ['review', 'approved', 'editing'];   // clips that still need you: their jobs are never pruned
const strList = v => (Array.isArray(v) ? v : []).map(x => str(x, 80)).filter(Boolean).slice(0, 4);
const num = (v, lo, hi, dflt) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt; };
const newId = p => `${p}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const isUrl = u => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
const secretOk = h => !!WORKER_SECRET && typeof h === 'string' && h.length === WORKER_SECRET.length &&
  crypto.timingSafeEqual(Buffer.from(h), Buffer.from(WORKER_SECRET));

// ── Twitch ──
let twToken = { v: '', exp: 0 };
async function twitchToken() {
  if (twToken.v && Date.now() < twToken.exp) return twToken.v;
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${TW_ID}&client_secret=${TW_SECRET}&grant_type=client_credentials`, { method: 'POST', signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`Twitch auth HTTP ${r.status}`);
  const d = await r.json();
  twToken = { v: d.access_token, exp: Date.now() + (d.expires_in - 300) * 1000 };
  return twToken.v;
}
const twCache = new Map();
async function helix(pathQs, ttlMs = 10 * 60 * 1000) {
  const hit = twCache.get(pathQs);
  if (hit && Date.now() - hit.t < ttlMs) return hit.data;
  try {
    const r = await fetch(`https://api.twitch.tv/helix/${pathQs}`, { headers: { 'Client-Id': TW_ID, Authorization: `Bearer ${await twitchToken()}` }, signal: AbortSignal.timeout(9000) });
    if (r.status === 401) twToken = { v: '', exp: 0 };
    if (!r.ok) throw new Error(`Twitch HTTP ${r.status}`);
    const data = (await r.json()).data || [];
    if (twCache.size > 400) for (const [k, v] of twCache) if (Date.now() - v.t > 6 * 3600 * 1000) twCache.delete(k);
    twCache.set(pathQs, { t: Date.now(), data });
    return data;
  } catch (e) { if (hit) return hit.data; throw e; }
}
// "1h2m3s" → seconds
const twDur = s => { const m = String(s || '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/) || []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };
const twThumb = (u, w, h) => String(u || '').replace('%{width}', w).replace('%{height}', h).replace('{width}', w).replace('{height}', h);

async function getTrending(streamers, topics = []) {
  const items = [];
  // topics (e.g. "GTA 6"): that Twitch category's most-watched VODs this week, from any streamer (runs alongside the streamer lookups)
  const topicsP = Promise.all(topics.filter(t => t.gameId).map(async t => {
    const vods = await helix(`videos?game_id=${t.gameId}&type=archive&sort=views&period=week&first=8`, 30 * 60 * 1000).catch(() => []);
    for (const v of vods) items.push({ id: `tv-${v.id}`, kind: 'vod', url: v.url, title: v.title, channel: v.user_name, login: v.user_login, views: v.view_count, duration: twDur(v.duration), date: v.created_at, thumb: twThumb(v.thumbnail_url, 480, 270), saved: streamers.includes(String(v.user_login).toLowerCase()), topic: t.q });
  }));
  const users = streamers.length ? await helix(`users?${streamers.slice(0, 50).map(l => `login=${encodeURIComponent(l)}`).join('&')}`, 6 * 3600 * 1000) : [];
  // rounded to the hour so the URL (= cache key) stays the same between loads
  const since = new Date(Math.floor((Date.now() - 72 * 3600 * 1000) / 3.6e6) * 3.6e6).toISOString();
  await Promise.all(users.map(async u => {
    const [vods, clips] = await Promise.all([
      helix(`videos?user_id=${u.id}&type=archive&first=3`).catch(() => []),
      helix(`clips?broadcaster_id=${u.id}&started_at=${encodeURIComponent(since)}&first=5`).catch(() => []),
    ]);
    for (const v of vods) items.push({ id: `tv-${v.id}`, kind: 'vod', url: v.url, title: v.title, channel: u.display_name, login: u.login, views: v.view_count, duration: twDur(v.duration), date: v.created_at, thumb: twThumb(v.thumbnail_url, 480, 270), saved: true });
    for (const c of clips) items.push({ id: `tc-${c.id}`, kind: 'clip', url: c.url, title: c.title, channel: c.broadcaster_name, login: u.login, views: c.view_count, duration: Math.round(c.duration), date: c.created_at, thumb: c.thumbnail_url, saved: true });
  }));
  await topicsP;
  // Top live streams right now (all of Twitch), for discovering who's hot
  const live = await helix('streams?first=20', 5 * 60 * 1000).catch(() => []);
  for (const s of live) items.push({ id: `tl-${s.id}`, kind: 'live', url: `https://www.twitch.tv/${s.user_login}`, title: s.title, channel: s.user_name, login: s.user_login, views: s.viewer_count, game: s.game_name, date: s.started_at, thumb: twThumb(s.thumbnail_url, 480, 270), saved: streamers.includes(s.user_login.toLowerCase()) });
  // views per hour since posting: what's moving right now
  for (const it of items) { const hrs = Math.max(1, (Date.now() - new Date(it.date)) / 3.6e6); it.velocity = it.kind === 'live' ? it.views : Math.round(it.views / hrs); }
  // a saved streamer's VOD can also match a topic: keep one copy, with the topic tag
  const seen = new Map(); for (const it of items) { const o = seen.get(it.id); if (!o) seen.set(it.id, it); else if (it.topic) o.topic = it.topic; }
  return [...seen.values()];
}

module.exports = function mountClipper(app, { getApiKey, makeClient, getAppData, saveAppData, webpush, pushEnabled }) {
  // data.clips = { streamers:[{login,layout,corner}], campaigns:[…], jobs:[…], spendUsd, scores:{id:{score,why,date}} }
  const clipsOf = d => { d.clips = d.clips || {}; const c = d.clips; c.streamers = c.streamers || []; c.campaigns = c.campaigns || []; c.jobs = c.jobs || []; c.scores = c.scores || {}; c.spendUsd = c.spendUsd || 0; return c; };
  const mutate = fn => { const d = getAppData(), c = clipsOf(d); const out = fn(c, d); saveAppData(d); return out; };
  const findJob = (c, id) => c.jobs.find(j => j.id === id);
  // Progress ticks (every ~15s while a job runs) live in memory only; persisting each one would
  // commit the whole app-data.json to GitHub hundreds of times per job. Status changes are saved.
  const live = new Map();       // jobId → { progress, msg, updatedAt }
  const picks = new Map();      // "jobId:attempt" → Promise of moments, so a timed-out retry reuses the same Haiku call
  const workerOnly = (req, res, next) => secretOk(req.get('x-worker-secret')) ? next() : res.status(401).json({ error: 'bad worker secret' });
  // a report from an attempt older than the latest "Try again" is ignored
  const staleAttempt = (j, b) => b.attempt != null && b.attempt !== (j.attempt || 1);

  async function haiku(system, prompt, maxTokens) {
    const key = getApiKey(); if (!key) throw new Error('No Anthropic API key set');
    const resp = await makeClient(key).messages.create({ model: HAIKU, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] });
    const cost = (resp.usage?.input_tokens || 0) * HAIKU_IN + (resp.usage?.output_tokens || 0) * HAIKU_OUT;
    mutate(c => { c.spendUsd = +(c.spendUsd + cost).toFixed(5); });
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (!m) throw new Error('AI reply had no JSON');
    return { json: JSON.parse(m[0]), cost };
  }

  // ── Trending feed (+ cached clip-potential scores, one Haiku call per batch of new items) ──
  let scoring = null;
  async function scoreNew(items) {
    const known = clipsOf(getAppData()).scores;
    const fresh = items.filter(i => i.kind !== 'live' && !known[i.id]).slice(0, 30);
    if (!fresh.length) return;
    const list = fresh.map((i, n) => `${n}. [${i.kind}] "${i.title}" by ${i.channel}, ${i.views} views, ${Math.round((i.duration || 0) / 60)} min, ${i.velocity}/hr`).join('\n');
    const { json } = await haiku(
      'You rate Twitch videos for how well they would clip into viral 15–30s TikTok/YouTube Shorts. Big reactions, funny moments, rage, clutch plays, drama and hot takes score high; quiet grinding, music streams and AFK score low. Reply ONLY with JSON: [{"n":0,"score":1-10,"why":"under 12 words"}].',
      list, 1500);
    mutate(c => {
      for (const r of Array.isArray(json) ? json : []) { const it = fresh[r.n]; if (it) c.scores[it.id] = { score: num(r.score, 1, 10, 5), why: str(r.why, 90), date: new Date().toISOString().slice(0, 10) }; }
      const cut = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);   // keep only recent scores
      for (const [k, v] of Object.entries(c.scores)) if (v.date < cut) delete c.scores[k];
    });
  }

  app.get('/api/clips/trending', async (req, res) => {
    if (!TW_ID || !TW_SECRET) return res.json({ needsSetup: 'twitch', items: [] });
    try {
      const c0 = clipsOf(getAppData()), streamers = c0.streamers.map(s => s.login);
      const items = await getTrending(streamers, c0.autopilot?.topics || []);
      if (!scoring) scoring = scoreNew(items).catch(e => console.error('Clip scoring failed:', e.message)).finally(() => { scoring = null; });
      if (req.query.wait) await scoring;
      const scores = clipsOf(getAppData()).scores;
      for (const it of items) { const s = scores[it.id]; if (s) { it.score = s.score; it.why = s.why; } }
      res.json({ items });
    } catch (e) { res.status(502).json({ error: 'SOURCE_DOWN', message: e.message }); }
  });

  // ── Streamers + campaigns ──
  app.get('/api/clips/state', (req, res) => {
    const c = clipsOf(getAppData());
    // newest 40, plus any older job still holding clips you haven't dealt with; live progress overlaid
    const jobs = c.jobs.filter((j, i) => i < 40 || j.clips?.some(x => OPEN_STATUSES.includes(x.status)))
      .map(j => live.has(j.id) && !['done', 'failed'].includes(j.status) ? { ...j, ...live.get(j.id) } : j);
    const y = c.youtube || {}, a = c.autopilot || {};
    res.json({ streamers: c.streamers, campaigns: c.campaigns, jobs, spendUsd: c.spendUsd, worker: !!(WORKER_URL && WORKER_SECRET), twitch: !!(TW_ID && TW_SECRET),
      youtube: { configured: !!(YT_ID && YT_SECRET), connected: !!y.tok && !y.error, channel: y.channel || null, error: y.error || null, today: (y.uploads || {})[new Date().toISOString().slice(0, 10)] || 0 },
      tiktok: { configured: !!(TT_KEY && TT_SECRET), connected: !!c.tiktok?.tok && !c.tiktok?.error, user: c.tiktok?.user || null, error: c.tiktok?.error || null },
      autopilot: { on: !!a.on, perDay: a.perDay || 10, youtube: a.youtube || [], topics: a.topics || [], lastRun: a.lastRun || null, lastPick: a.lastPick || null } });
  });
  app.post('/api/clips/streamers', (req, res) => {
    const login = str(req.body?.login, 80).toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '').slice(0, 25);
    if (!login) return res.status(400).json({ error: 'Twitch username required' });
    const layout = LAYOUTS.includes(req.body.layout) ? req.body.layout : 'blur';
    const corner = CORNERS.includes(req.body.corner) ? req.body.corner : 'br';
    const streamers = mutate(c => {
      const ex = c.streamers.find(s => s.login === login);
      if (req.body.remove) c.streamers = c.streamers.filter(s => s.login !== login);
      else if (ex) Object.assign(ex, { layout, corner });
      else c.streamers.push({ login, layout, corner });
      return c.streamers;
    });
    res.json({ ok: true, streamers });
  });
  app.post('/api/clips/campaigns', (req, res) => {
    const b = req.body || {};
    if (b.remove) return res.json({ ok: true, campaigns: mutate(c => (c.campaigns = c.campaigns.filter(x => x.id !== b.id))) });
    const name = str(b.name, 80);
    if (!name) return res.status(400).json({ error: 'Campaign name required' });
    const camp = {
      id: str(b.id, 40) || newId('camp'), name, rate: num(b.rate, 0, 100, 1), cap: num(b.cap, 0, 1e6, 0),
      minViews: num(b.minViews, 0, 1e8, 0), streamer: str(b.streamer, 40).toLowerCase(), sourceUrl: isUrl(b.sourceUrl) ? str(b.sourceUrl, 500) : '',
      platforms: (Array.isArray(b.platforms) ? b.platforms : []).filter(p => ['tiktok', 'youtube', 'instagram'].includes(p)),
      rules: str(b.rules, 1500), link: isUrl(b.link) ? str(b.link, 500) : '', active: b.active !== false,
    };
    res.json({ ok: true, campaigns: mutate(c => { const i = c.campaigns.findIndex(x => x.id === camp.id); if (i >= 0) c.campaigns[i] = camp; else c.campaigns.unshift(camp); return c.campaigns; }) });
  });

  // ── Jobs: create → push to worker ──
  async function sendToWorker(jobId) {
    if (!WORKER_URL || !WORKER_SECRET) return false;
    const d = getAppData(), c = clipsOf(d), job = findJob(c, jobId);
    if (!job || !['queued', 'sent'].includes(job.status)) return false;
    const streamer = c.streamers.find(s => s.login === job.source.login);
    const camp = c.campaigns.find(x => x.id === job.campaignId);
    try {
      const r = await fetch(`${WORKER_URL}/jobs`, {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', 'x-worker-secret': WORKER_SECRET },
        body: JSON.stringify({
          id: job.id, attempt: job.attempt || 1, type: job.type, source: job.source, range: job.range, moments: job.moments,
          layout: job.layout || streamer?.layout || 'blur', corner: job.corner || streamer?.corner || 'br',
          pushSubscriptions: d.pushSubscriptions || [],
        }),
      });
      if (!r.ok) throw new Error(`worker HTTP ${r.status}`);
      mutate(c2 => { const j = findJob(c2, jobId); if (j && ['queued', 'sent'].includes(j.status)) { j.status = 'sent'; j.msg = 'Clip worker has it'; j.sentAt = j.updatedAt = new Date().toISOString(); } });
      return true;
    } catch (e) {
      console.error(`Clip job ${jobId} not delivered to worker:`, e.message);
      mutate(c2 => { const j = findJob(c2, jobId); if (j && j.status === 'queued') j.msg = 'Waiting for the clip worker to come online…'; });
      return false;
    }
  }
  // Re-send anything the worker never acknowledged, or that went silent for 3h (worker restarted)
  async function resendStuck() {
    const now = Date.now();
    const stuck = clipsOf(getAppData()).jobs.filter(j =>
      (j.status === 'queued' && now - new Date(j.createdAt) > 2 * 60 * 1000) ||
      (j.status === 'sent' && now - new Date(j.updatedAt || j.createdAt) > 3 * 3600 * 1000));
    for (const j of stuck) await sendToWorker(j.id);
  }

  app.post('/api/clips/jobs', async (req, res) => {
    const b = req.body || {};
    if (!isUrl(b.url)) return res.status(400).json({ error: 'A video link (https://…) is required' });
    const start = b.start === '' || b.start == null ? null : num(b.start, 0, 864000, null);
    const end = b.end === '' || b.end == null ? null : num(b.end, 0, 864000, null);
    if (start != null && end != null && end - start < 20) return res.status(400).json({ error: 'Pick a range of at least 20 seconds' });
    const { job, delivered } = await createJob({ ...b, start, end });
    res.json({ ok: true, job, delivered, workerConfigured: !!(WORKER_URL && WORKER_SECRET) });
  });

  async function createJob(b, extra = {}) {
    const login = str(b.login, 40).toLowerCase() || (String(b.url).match(/twitch\.tv\/(?!videos\/)([a-z0-9_]+)/i)?.[1] || '').toLowerCase();
    const now = new Date().toISOString();
    const job = {
      id: newId('job'), type: 'full', status: 'queued', createdAt: now, updatedAt: now,
      source: { url: str(b.url, 500), title: str(b.title, 200) || 'Pasted link', channel: str(b.channel, 60), login, thumb: isUrl(b.thumb) ? str(b.thumb, 500) : '', kind: str(b.kind, 10) || 'link' },
      range: b.start != null || b.end != null ? { start: b.start ?? null, end: b.end ?? null } : null,
      campaignId: str(b.campaignId, 40) || null,
      layout: LAYOUTS.includes(b.layout) ? b.layout : null, corner: CORNERS.includes(b.corner) ? b.corner : null,
      topic: str(b.topic, 40) || null,
      progress: 0, msg: 'Queued', clips: [], costUsd: 0, ...extra,
    };
    mutate(c => {
      c.jobs.unshift(job);
      // keep the 60 newest, but never drop a job that still has clips waiting for review
      c.jobs = c.jobs.filter((j, i) => i < 60 || j.clips?.some(x => OPEN_STATUSES.includes(x.status)));
    });
    const delivered = await sendToWorker(job.id);
    return { job: findJob(clipsOf(getAppData()), job.id), delivered };
  }

  // ── AUTOPILOT: keep ~N clips a day waiting for review, from campaigns, saved streamers and YouTube ──
  // The worker is the always-on part (Render's free web service sleeps), so it calls /worker/autopilot
  // every couple of hours. YouTube channels are listed by the worker (it has yt-dlp) and sent along.
  // data.clips.autopilot = { on, perDay, youtube:[{url,name}], seen:{sourceKey:date}, lastRun }
  const apOf = c => { c.autopilot = c.autopilot || {}; const a = c.autopilot; a.perDay = a.perDay || 10; a.youtube = a.youtube || []; a.topics = a.topics || []; a.seen = a.seen || {}; return a; };
  // "GTA 6" → Twitch's matching category, so topic search can list that game's VODs. Not every topic is a game:
  // then it's a YouTube search only (and a hint for the picker).
  async function resolveTopic(q) {
    if (!TW_ID || !TW_SECRET) return { q };
    const cats = await helix(`search/categories?query=${encodeURIComponent(q)}&first=5`, 24 * 3600 * 1000);   // throws if Twitch is down
    // compare as words with Roman numerals turned into digits: "Grand Theft Auto VI" = "grandtheftauto6", initials "gta6"
    const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
    const words = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(w => ROMAN[w] || w);
    const full = s => words(s).join(''), initials = s => words(s).map(w => /^\d+$/.test(w) ? w : w[0]).join('');
    const want = full(q);
    // an exact name or initials match only: a near miss would quietly clip the wrong game (e.g. GTA V for "GTA 6")
    const hit = cats.find(c => full(c.name) === want || initials(c.name) === want);
    return hit ? { q, gameId: hit.id, gameName: hit.name } : { q };
  }
  const day = 864e5;

  app.get('/api/clips/autopilot', (req, res) => {
    const c = clipsOf(getAppData()), a = apOf(c);
    res.json({ on: !!a.on, perDay: a.perDay, youtube: a.youtube, topics: a.topics, lastRun: a.lastRun || null, lastPick: a.lastPick || null });
  });
  app.post('/api/clips/autopilot', async (req, res) => {
    const b = req.body || {};
    const addTopic = str(b.addTopic, 40);
    if (b.addTopic != null && !addTopic) return res.status(400).json({ error: 'Type a topic, like GTA 6' });
    let topic = null;
    if (addTopic) {
      const have = apOf(clipsOf(getAppData())).topics;
      if (have.some(t => t.q.toLowerCase() === addTopic.toLowerCase())) return res.status(400).json({ error: `"${addTopic}" is already a topic` });
      if (have.length >= 8) return res.status(400).json({ error: 'Up to 8 topics. Remove one first.' });
    }
    if (addTopic) { try { topic = await resolveTopic(addTopic); } catch (e) { return res.status(502).json({ error: `Couldn't reach Twitch to match that topic (${e.message}). Try again in a minute.` }); } }
    const out = mutate(c => {
      const a = apOf(c);
      if (b.on != null) a.on = !!b.on;
      if (b.perDay != null) a.perDay = num(b.perDay, 1, 40, 10);
      if (b.addYoutube) {
        const u = str(b.addYoutube, 200).replace(/\/(streams|videos|featured|live)\/?$/, '');
        if (!/^https:\/\/(www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]+|c\/[\w.-]+)$/.test(u)) return { error: 'Paste a YouTube channel link, like https://www.youtube.com/@name' };
        if (!a.youtube.some(y => y.url === u)) a.youtube.push({ url: u, name: u.split('/').pop() });
      }
      if (b.removeYoutube) a.youtube = a.youtube.filter(y => y.url !== b.removeYoutube);
      if (topic && !a.topics.some(t => t.q.toLowerCase() === topic.q.toLowerCase()) && a.topics.length < 8) a.topics.push(topic);
      if (b.removeTopic) a.topics = a.topics.filter(t => t.q !== b.removeTopic);
      return { on: !!a.on, perDay: a.perDay, youtube: a.youtube, topics: a.topics };
    });
    if (out.error) return res.status(400).json(out);
    res.json({ ok: true, ...out });
  });

  // What the worker needs to know before its tick: whether to look for work, and which YouTube channels to list
  function apNeed(c) {
    const a = apOf(c), now = Date.now();
    if (!a.on) return { need: false, why: 'off' };
    if (c.jobs.some(j => !['done', 'failed'].includes(j.status))) return { need: false, why: 'a job is already running' };
    const made = c.jobs.filter(j => j.type !== 'render' && now - new Date(j.finishedAt || j.createdAt) < day).reduce((n, j) => n + (j.clips?.length || 0), 0);
    const waiting = c.jobs.reduce((n, j) => n + (j.type === 'render' ? 0 : (j.clips || []).filter(x => x.status === 'review' || x.status === 'editing').length), 0);
    if (made >= a.perDay) return { need: false, why: `made ${made} today` };
    if (waiting >= a.perDay * 2) return { need: false, why: `${waiting} still waiting for review` };
    return { need: true };
  }
  app.get('/api/clips/worker/autopilot', workerOnly, (req, res) => {
    const c = clipsOf(getAppData());
    res.json({ ...apNeed(c), youtube: apOf(c).youtube.map(y => y.url), topics: apOf(c).topics.map(t => t.q) });
  });

  // The worker sends what it found on YouTube; this adds Twitch VODs + campaign links, picks one and queues it
  app.post('/api/clips/worker/autopilot', workerOnly, async (req, res) => {
    const c0 = clipsOf(getAppData()), a0 = apOf(c0), need = apNeed(c0);
    mutate(c => { apOf(c).lastRun = new Date().toISOString(); });
    if (!need.need) return res.json({ queued: false, why: need.why });
    const cands = [];
    for (const camp of c0.campaigns.filter(x => x.active && x.sourceUrl))
      cands.push({ key: `camp:${camp.id}:${camp.sourceUrl}`, url: camp.sourceUrl, title: `${camp.name} source`, login: camp.streamer, campaignId: camp.id, kind: 'link', rank: 1000 + camp.rate });
    for (const v of (Array.isArray(req.body?.youtube) ? req.body.youtube : []).slice(0, 250)) {
      if (!/^[\w-]{11}$/.test(v.id || '') || (v.duration && v.duration < 120)) continue;   // skip Shorts/trailers
      cands.push({ key: `yt:${v.id}`, url: `https://www.youtube.com/watch?v=${v.id}`, title: str(v.title, 200), channel: str(v.channel, 60), kind: 'vod', views: +v.views || 0, duration: +v.duration || 0, date: v.date || null, topic: str(v.topic, 40) || null });
    }
    // Twitch: your streamers' recent VODs + each topic's most-watched VODs this week (one list, duplicates merged)
    if (TW_ID && TW_SECRET && (c0.streamers.length || a0.topics.some(t => t.gameId))) {
      try { for (const it of (await getTrending(c0.streamers.map(s => s.login), a0.topics)).filter(i => i.kind === 'vod' && Date.now() - new Date(i.date) < 7 * day))
        cands.push({ key: it.id, url: it.url, title: it.title, channel: it.channel, login: it.login, thumb: it.thumb, kind: 'vod', views: it.views, duration: it.duration, date: it.date, topic: it.topic || null }); }
      catch (e) { console.error('Autopilot: Twitch lookup failed:', e.message); }
    }
    const fresh = cands.filter(x => !a0.seen[x.key]);
    if (!fresh.length) return res.json({ queued: false, why: 'nothing new to clip' });
    // campaigns first (they pay), then a quick AI read on which VOD clips best; recency + views break ties
    const groups = new Map();
    for (const x of fresh.filter(x => !x.campaignId)) { const g = x.topic ? `topic:${x.topic}` : x.key.startsWith('yt:') ? `yt:${x.channel}` : 'twitch'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); }
    const vods = [];
    for (let i = 0; vods.length < fresh.length && [...groups.values()].some(l => l.length > i); i++) for (const l of groups.values()) if (l[i]) vods.push(l[i]);
    if (vods.length > 1) {
      try {
        const { json } = await haiku('You rate stream VODs for how well they would clip into viral 15–30s TikTok/YouTube Shorts. Big reactions, funny moments, rage, clutch plays, drama and hot takes score high; quiet grinding, music streams and AFK score low. Reply ONLY with JSON: [{"n":0,"score":1-10}].',
          vods.slice(0, 60).map((v, n) => `${n}. "${v.title}" by ${v.channel || '?'}, ${v.views || 0} views, ${Math.round((v.duration || 0) / 60)} min${v.topic ? ` (topic: ${v.topic}; score low if the title looks unrelated to it)` : ''}`).join('\n'), 1500);
        for (const r of Array.isArray(json) ? json : []) if (vods[r.n]) vods[r.n].rank = num(r.score, 1, 10, 5) * 10;
      } catch (e) { console.error('Autopilot: scoring failed:', e.message); }
    }
    for (const v of vods) v.rank = (v.rank || 35) + Math.min(5, Math.log10((v.views || 0) + 1)) - (v.date ? (Date.now() - new Date(v.date)) / day : 3);
    const pick = fresh.sort((x, y) => y.rank - x.rank)[0];
    const streamer = c0.streamers.find(s => s.login === pick.login);
    mutate(c => { const a = apOf(c); a.seen[pick.key] = new Date().toISOString().slice(0, 10); a.lastPick = { title: pick.title, at: new Date().toISOString() };
      const cut = new Date(Date.now() - 45 * day).toISOString().slice(0, 10); for (const [k, d] of Object.entries(a.seen)) if (d < cut) delete a.seen[k]; });
    // long streams: a 3-hour window past the intro, so one VOD stays within Groq's free daily audio
    const win = pick.campaignId || (pick.duration && pick.duration <= 3.5 * 3600) ? {} : { start: 20 * 60, end: 20 * 60 + 3 * 3600 };
    const { job, delivered } = await createJob({ ...pick, ...win, layout: streamer?.layout, corner: streamer?.corner }, { autopilot: true });
    console.log(`  Autopilot: queued "${pick.title}" (${pick.key})`);
    res.json({ queued: true, jobId: job.id, delivered, title: pick.title });
  });

  app.post('/api/clips/jobs/:id/retry', async (req, res) => {
    // not for jobs the worker already has ('sent' and later): it would still be running the old attempt
    const ok = mutate(c => { const j = findJob(c, req.params.id); if (!j || !['failed', 'queued'].includes(j.status)) return false; Object.assign(j, { status: 'queued', error: null, msg: 'Queued', progress: 0, attempt: (j.attempt || 1) + 1, updatedAt: new Date().toISOString() });
      if (j.recutOf) { const old = findJob(c, j.parentId)?.clips.find(x => x.id === j.recutOf); if (old) old.recutting = j.id; }
      return true; });
    if (!ok) return res.status(404).json({ error: 'No retryable job' });
    res.json({ ok: true, delivered: await sendToWorker(req.params.id) });
  });
  app.delete('/api/clips/jobs/:id', (req, res) => {
    mutate(c => { c.jobs = c.jobs.filter(j => j.id !== req.params.id); });
    res.json({ ok: true });
  });

  // Review a clip: approve / reject / mark posted (with links + views for earnings)
  app.post('/api/clips/jobs/:id/clips/:cid', (req, res) => {
    const b = req.body || {};
    const clip = mutate(c => {
      const cl = findJob(c, req.params.id)?.clips.find(x => x.id === req.params.cid); if (!cl) return null;
      if (['review', 'approved', 'rejected', 'posted', 'editing'].includes(b.status)) cl.status = b.status;
      if (b.caption != null) cl.caption = str(b.caption, 2200);
      if (b.title != null) cl.title = str(b.title, 100);
      if (b.postLinks && typeof b.postLinks === 'object') for (const p of ['tiktok', 'youtube', 'instagram']) if (b.postLinks[p] !== undefined) cl.postLinks = { ...(cl.postLinks || {}), [p]: isUrl(b.postLinks[p]) ? str(b.postLinks[p], 500) : '' };
      if (b.views != null) cl.views = num(b.views, 0, 1e10, 0);
      if (cl.status === 'posted' && !cl.postedAt) cl.postedAt = new Date().toISOString();
      return cl;
    });
    if (!clip) return res.status(404).json({ error: 'Clip not found' });
    res.json({ ok: true, clip });
  });

  // Re-cut: Haiku turns a plain-English note into new timings, then a render-only job goes to the worker.
  // { same: true } skips Haiku and re-renders the clip exactly as it is (e.g. after a caption style change).
  app.post('/api/clips/jobs/:id/clips/:cid/recut', async (req, res) => {
    const e0 = req.body?.edit && typeof req.body.edit === 'object' ? req.body.edit : null;
    const same = req.body?.same === true || !!e0, note = e0 ? 'Edited by hand' : same ? 'Re-rendered with the current caption style' : str(req.body?.note, 300);
    if (!note) return res.status(400).json({ error: 'Say what to change' });
    const c0 = clipsOf(getAppData()), job = findJob(c0, req.params.id), cl = job?.clips.find(x => x.id === req.params.cid);
    if (!cl) return res.status(404).json({ error: 'Clip not found' });
    if (e0 && !['review', 'editing'].includes(cl.status)) return res.status(409).json({ error: 'Only clips in Review or Editing can be edited' });
    let manual = null;
    if (e0) {
      const max = job.duration || 864000, s = num(e0.start, 0, max, cl.start), e = num(e0.end, 0, max, cl.end);
      if (e - s < 3) return res.status(400).json({ error: 'A clip has to be at least 3 seconds long' });
      if (e - s > 180) return res.status(400).json({ error: 'Keep it under 3 minutes' });
      manual = { start: s, end: e, layout: LAYOUTS.includes(e0.layout) ? e0.layout : null, corner: CORNERS.includes(e0.corner) ? e0.corner : null };
    }
    if (same && !e0 && cl.status !== 'review') return res.status(409).json({ error: 'Only clips waiting for review can be re-rendered' });
    if (same && cl.recutting) return res.status(409).json({ error: 'Already re-cutting this clip' });
    try {
      const { json, cost } = same ? { json: {}, cost: 0 } : await haiku(
        'You adjust one short-form video clip based on the editor\'s note. Times are seconds in the source video. Keep length 10–45s (ideally 15–30s) unless the note says otherwise. Reply ONLY with JSON: {"start":n,"end":n,"title":"…","hook":"…","caption":"…"}. Keep fields unchanged unless the note asks.',
        `CURRENT: ${JSON.stringify({ start: cl.start, end: cl.end, title: cl.title, hook: cl.hook, caption: cl.caption })}\nSOURCE LENGTH: ${job.duration || 'unknown'}s\nTRANSCRIPT NEAR CLIP:\n${cl.context || '(none)'}\nNOTE: ${note}`, 600);
      const max = job.duration || 864000;
      const s = manual ? manual.start : num(json.start, 0, max, cl.start), e = manual ? manual.end : num(json.end, s + 5, max, cl.end);
      const moment = { start: s, end: e, title: str(json.title, 100) || cl.title, hook: str(json.hook, 60) || cl.hook, caption: str(json.caption, 2200) || cl.caption, hashtags: cl.hashtags, score: cl.score, why: cl.why, context: cl.context,
        // same footage: keep the AI's warnings (the worker re-checks music itself). New timing: the old warnings may not apply.
        flags: same && (!manual || Math.max(0, Math.min(manual.end, cl.end) - Math.max(manual.start, cl.start)) >= 0.5 * (cl.end - cl.start)) ? (cl.flags || []).filter(f => !/^Music in the audio/.test(f)) : [] };
      const now = new Date().toISOString();
      // The worker cuts from the full source, so the moment times stay in source seconds;
      // range-limited parents are re-downloaded with the same range so offsets still line up.
      const rj = {
        id: newId('job'), type: 'render', parentId: job.id, status: 'queued', createdAt: now, updatedAt: now,
        source: job.source, range: job.range, duration: job.duration, campaignId: job.campaignId, layout: manual?.layout || cl.layout || job.layout, corner: manual?.corner || cl.corner || job.corner,
        moments: [moment], recutOf: cl.id, note, progress: 0, msg: 'Queued re-cut', clips: [], costUsd: cost,
      };
      mutate(c => { c.jobs.unshift(rj); const p = findJob(c, job.id)?.clips.find(x => x.id === cl.id); if (p) p.recutting = rj.id; });
      res.json({ ok: true, job: rj, delivered: await sendToWorker(rj.id) });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // ── Worker callbacks (x-worker-secret) ──

  // Worker startup catch-up: it asks for anything it should be working on, and this re-sends it
  app.post('/api/clips/worker/hello', workerOnly, async (req, res) => {
    const have = new Set(Array.isArray(req.body?.have) ? req.body.have : []);
    // anything unfinished the worker doesn't have (e.g. its disk was wiped mid-job) gets sent again
    const ids = clipsOf(getAppData()).jobs.filter(j => !['done', 'failed'].includes(j.status) && !have.has(j.id)).map(j => j.id);
    mutate(c => { for (const id of ids) { const j = findJob(c, id); if (j) j.status = 'queued'; } });
    res.json({ ok: true, resending: ids.length });
    for (const id of ids) await sendToWorker(id);
  });

  app.post('/api/clips/worker/:id/progress', workerOnly, (req, res) => {
    const b = req.body || {};
    const j0 = findJob(clipsOf(getAppData()), req.params.id);
    if (!j0 || ['done', 'failed'].includes(j0.status) || staleAttempt(j0, b)) return res.json({ ok: false });
    const status = ['downloading', 'transcribing', 'picking', 'rendering', 'uploading'].includes(b.status) ? b.status : j0.status;
    const tick = { status, progress: num(b.progress, 0, 100, j0.progress), msg: str(b.msg, 140) || j0.msg, updatedAt: new Date().toISOString() };
    live.set(j0.id, tick);
    if (status !== j0.status || (b.duration && !j0.duration))
      mutate(c => { const j = findJob(c, j0.id); if (j) { Object.assign(j, tick); if (b.duration) j.duration = num(b.duration, 0, 864000, 0); } });
    res.json({ ok: true });
  });

  // Worker sends the transcript; Haiku picks the moments (the API key never leaves this server)
  app.post('/api/clips/worker/:id/pick', workerOnly, async (req, res) => {
    const segs = (Array.isArray(req.body?.segments) ? req.body.segments : []).filter(s => s && Number.isFinite(+s.s) && Number.isFinite(+s.e));
    const duration = num(req.body?.duration, 0, 864000, 0);
    const c0 = clipsOf(getAppData()), job = findJob(c0, req.params.id);
    if (!job) return res.status(404).json({ error: 'unknown job' });
    const key = `${job.id}:${job.attempt || 1}`;
    if (!picks.has(key)) {
      // chat: [[second, messages], ...] in 30s windows, from the VOD's chat replay when the worker could get one
      const chat = (Array.isArray(req.body?.chat) ? req.body.chat : []).filter(x => Array.isArray(x) && Number.isFinite(+x[0]) && Number.isFinite(+x[1])).slice(0, 5000);
      picks.set(key, pickMoments(job, c0, segs, duration, chat));
      setTimeout(() => picks.delete(key), 3600 * 1000);
    }
    try { res.json({ moments: await picks.get(key) }); }
    catch (e) { picks.delete(key); res.status(502).json({ error: e.message }); }
  });

  // the busiest 30s windows of chat, vs. a typical window: tells the picker where viewers reacted
  function chatSpikes(chat) {
    if (chat.length < 10) return '';
    const counts = chat.map(x => +x[1]).sort((a, b) => a - b), median = counts[Math.floor(counts.length / 2)] || 1;
    const top = chat.filter(x => +x[1] >= median * 2).sort((a, b) => b[1] - a[1]).slice(0, 25).sort((a, b) => a[0] - b[0]);
    if (!top.length) return '';
    const rows = top.map(([t, n]) => `[${Math.round(t)}-${Math.round(t) + 30}] ${n} msgs (${(n / median).toFixed(1)}×)`);
    return `\nCHAT SPIKES (30s windows where chat was busiest; a typical window has ~${median} messages):\n${rows.join('\n')}`;
  }
  async function pickMoments(job, c0, segs, duration, chat = []) {
    const spikes = chatSpikes(chat);
    const topicLine = job.topic ? ` This video was picked for the topic "${job.topic}": favor moments about it, and only fall back to other moments if nothing on-topic makes a good clip.` : '';
    const camp = c0.campaigns.find(x => x.id === job.campaignId);
    const short = duration > 0 && duration <= 95;
    // ~120k chars of transcript max: keeps one Haiku call to a few cents even on long VODs
    let tx = ''; for (const s of segs) { const line = `[${Math.round(s.s)}-${Math.round(s.e)}] ${str(s.t, 400)}\n`; if (tx.length + line.length > 120000) break; tx += line; }
    {
      const { json, cost } = await haiku(
        `You are an expert short-form editor who clips Twitch streamers for TikTok and YouTube Shorts. ${short ? 'This source is already a short clip: return exactly ONE moment covering the whole thing (start 0, end = its length), with your best title, hook and caption.' : 'Pick the 4–8 best self-contained moments that do not overlap each other. Keep them SHORT: aim for 15–30 seconds each (never under 10s or over 45s). Start a beat before the setup and cut right after the payoff, with no dead air at the start or end; one punchy reaction beats a long story. Gaming transcripts are often thin or repetitive: still return your best 3 picks, favoring the most energetic stretches (yelling, ALL CAPS, laughter, "no way", "clip that"). Only return [] if there is no speech at all.'}${topicLine}${spikes ? ' CHAT SPIKES show where live viewers reacted most: strongly favor moments that line up with a spike (the reaction usually lands a few seconds after the moment itself), but only if the transcript there makes a good self-contained clip.' : ''}
For each give: a "title" (≤70 chars, for YouTube), a "hook" (≤6 words, punchy on-screen text, ALL CAPS ok), a "caption" (1–2 lines for TikTok, no hashtags), 3–6 "hashtags" (no #), a "score" 1–10 for viral potential, "why" (≤12 words), and "flags": a list (usually empty) of short warnings for anything in the moment that could get it muted or removed on TikTok/YouTube: audible copyrighted music or song lyrics, slurs or hate speech, sexual content, dangerous stunts, gambling, graphic violence, minors in risky situations.${camp?.rules ? `\nThis clip is for a paid campaign, "${camp.name}". Follow its rules exactly in the caption/hashtags:\n${camp.rules}` : ''}
Timestamps in the transcript are seconds. Reply ONLY with JSON: [{"start":n,"end":n,"title":"","hook":"","caption":"","hashtags":[""],"score":n,"why":"","flags":[]}]`,
        `SOURCE: "${job.source.title}" by ${job.source.channel || 'unknown'} (${Math.round(duration)}s)${spikes}\nTRANSCRIPT:\n${tx || '(no speech detected)'}`, 2500);
      const max = duration || 864000;
      const moments = (Array.isArray(json) ? json : []).map(m => {
        // the model sometimes overshoots the 15–30s brief; nothing over 45s ships
        const s = num(m.start, 0, max, 0), e = Math.min(num(m.end, 0, max, Math.min(max, s + 25)), s + 45);
        const context = segs.filter(x => x.e >= s - 20 && x.s <= e + 20).map(x => `[${Math.round(x.s)}] ${str(x.t, 300)}`).join('\n').slice(0, 3000);
        return { start: s, end: e, title: str(m.title, 100), hook: str(m.hook, 60), caption: str(m.caption, 600), hashtags: (Array.isArray(m.hashtags) ? m.hashtags : []).map(h => str(h, 40).replace(/^#/, '')).filter(Boolean).slice(0, 8), score: num(m.score, 1, 10, 5), why: str(m.why, 90), flags: strList(m.flags), context };
      }).filter(m => m.end - m.start >= 8).sort((a, b) => b.score - a.score)
        // drop picks that are mostly the same footage as a better one
        .filter((m, i, all) => !all.slice(0, i).some(k => Math.min(k.end, m.end) - Math.max(k.start, m.start) > 0.5 * Math.min(k.end - k.start, m.end - m.start)))
        .slice(0, 8);
      mutate(c => { const j = findJob(c, job.id); if (j) { j.costUsd = +((j.costUsd || 0) + cost).toFixed(5); j.duration = duration || j.duration; } });
      return moments;
    }
  }

  app.post('/api/clips/worker/:id/done', workerOnly, (req, res) => {
    const b = req.body || {};
    let fresh = false;
    const job = mutate(c => {
      const j = findJob(c, req.params.id); if (!j) return null;
      if (j.status === 'done' || staleAttempt(j, b)) return j;             // retried callback, or an old attempt
      fresh = true;
      j.clips = (Array.isArray(b.clips) ? b.clips : []).filter(x => isUrl(x.url)).map(x => ({
        id: newId('clip'), url: str(x.url, 600), thumb: isUrl(x.thumb) ? str(x.thumb, 600) : '', start: num(x.start, 0, 864000, 0), end: num(x.end, 0, 864000, 0),
        layout: j.layout || null, corner: j.corner || null,
        title: str(x.title, 100), hook: str(x.hook, 60), caption: str(x.caption, 2200), hashtags: (Array.isArray(x.hashtags) ? x.hashtags : []).map(h => str(h, 40)).slice(0, 8),
        score: num(x.score, 1, 10, 5), why: str(x.why, 90), flags: strList(x.flags), context: str(x.context, 3000), status: 'review', views: 0, postLinks: {},
      }));
      j.status = j.clips.length ? 'done' : 'failed'; j.error = j.clips.length ? null : 'No clips came back';
      j.progress = 100; j.msg = j.clips.length ? `${j.clips.length} clip${j.clips.length > 1 ? 's' : ''} ready` : 'Failed';
      j.finishedAt = j.updatedAt = new Date().toISOString();
      if (j.recutOf) {        // a re-cut replaces the old clip inside its original job
        const parent = findJob(c, j.parentId), old = parent?.clips.find(x => x.id === j.recutOf);
        if (old) delete old.recutting;
        if (parent && j.clips[0]) { if (old && ['review', 'editing'].includes(old.status)) old.status = 'rejected'; parent.clips.push({ ...j.clips[0], recutNote: j.note }); }
        j.clips = [];         // the clip now lives in the parent; an empty re-cut job can be pruned like any other
      }
      live.delete(j.id);
      return j;
    });
    if (!job) return res.status(404).json({ error: 'unknown job' });
    // Backup push: only when the worker isn't sending its own (it does so right after this call succeeds)
    if (fresh && !b.workerPushes && pushEnabled && job.status === 'done') {
      const n = (b.clips || []).length;
      const payload = JSON.stringify({ title: '🎬 Cled: clips ready', body: `${n} clip${n > 1 ? 's' : ''} from "${job.source.title}". Tap to review.`, tag: `clips-${job.id}`, url: '/?open=clips' });
      for (const sub of (getAppData().pushSubscriptions || [])) webpush.sendNotification(sub, payload).catch(() => {});
    }
    res.json({ ok: true });
  });

  app.post('/api/clips/worker/:id/fail', workerOnly, (req, res) => {
    mutate(c => {
      const j = findJob(c, req.params.id); if (!j || j.status === 'done' || staleAttempt(j, req.body || {})) return;
      Object.assign(j, { status: 'failed', error: str(req.body?.error, 300) || 'Worker error', msg: 'Failed', updatedAt: new Date().toISOString() }); live.delete(j.id);
      if (j.recutOf) { const old = findJob(c, j.parentId)?.clips.find(x => x.id === j.recutOf); if (old) delete old.recutting; }
    });
    res.json({ ok: true });
  });

  // On Render the worker is a private service with no public address, so its finished clips are
  // passed through here. Range requests are forwarded: iOS won't play a video without them.
  app.get('/clipfiles/:name', async (req, res) => {
    if (!WORKER_URL || !/^[a-f0-9]{24}\.(mp4|jpg)$/.test(req.params.name)) return res.status(404).end();
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 30000);
    res.on('close', () => ac.abort());
    try {
      const r = await fetch(`${WORKER_URL}/files/${req.params.name}`, { headers: req.headers.range ? { Range: req.headers.range } : {}, signal: ac.signal });
      clearTimeout(t);
      res.status(r.status);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control']) { const v = r.headers.get(h); if (v) res.set(h, v); }
      if (!r.body) return res.end();
      Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
    } catch { clearTimeout(t); if (!res.headersSent) res.status(502).end(); }
  });

  // ── YOUTUBE SHORTS POSTING ──
  // You connect your channel once (OAuth); the refresh token is kept in app-data encrypted with a key
  // derived from YT_CLIENT_SECRET, since app-data is synced to GitHub. Until Google verifies the app,
  // YouTube keeps API uploads private; they flip to public on their own once it is verified.
  // keyed per platform from that platform's client secret (which only lives in Render's environment)
  const tokKey = salt => crypto.createHash('sha256').update(salt).digest();
  const seal = (obj, salt = 'clips-yt:' + YT_SECRET) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', tokKey(salt), iv); const d = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]); return [iv, c.getAuthTag(), d].map(b => b.toString('base64')).join('.'); };
  const unseal = (s, salt = 'clips-yt:' + YT_SECRET) => { const [iv, tag, d] = String(s).split('.').map(b => Buffer.from(b, 'base64')); const c = crypto.createDecipheriv('aes-256-gcm', tokKey(salt), iv); c.setAuthTag(tag); return JSON.parse(Buffer.concat([c.update(d), c.final()]).toString()); };
  const ytOf = c => (c.youtube = c.youtube || {});
  const oauthStates = new Map();   // state → expiry
  let ytAccessTok = { v: '', exp: 0 };

  app.get('/api/clips/youtube/connect', (req, res) => {
    if (!YT_ID || !YT_SECRET) return res.status(400).send('Set YT_CLIENT_ID and YT_CLIENT_SECRET on Render first.');
    const state = crypto.randomBytes(16).toString('hex'); oauthStates.set(state, Date.now() + 15 * 60 * 1000);
    const q = new URLSearchParams({ client_id: YT_ID, redirect_uri: YT_REDIRECT, response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly' });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  });
  app.get('/api/clips/youtube/callback', async (req, res) => {
    const exp = oauthStates.get(String(req.query.state || '')); oauthStates.delete(String(req.query.state || ''));
    if (!exp || exp < Date.now()) return res.status(400).send('This sign-in link expired. Go back to the Clips tab and tap Connect YouTube again.');
    if (!req.query.code) return res.redirect('/?open=clips&yt=cancelled');
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: String(req.query.code), client_id: YT_ID, client_secret: YT_SECRET, redirect_uri: YT_REDIRECT, grant_type: 'authorization_code' }) });
      const t = await r.json();
      if (!r.ok || !t.refresh_token) throw new Error(t.error_description || t.error || 'Google sent no refresh token');
      ytAccessTok = { v: t.access_token, exp: Date.now() + (t.expires_in - 120) * 1000 };
      const ch = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
      const it = ch.items?.[0];
      mutate(c => { const y = ytOf(c); y.tok = seal({ refresh_token: t.refresh_token }); y.channel = it ? { id: it.id, title: it.snippet?.title || '' } : null; y.connectedAt = new Date().toISOString(); y.error = null; });
      res.redirect('/?open=clips&yt=connected');
    } catch (e) { console.error('YouTube connect failed:', e.message); res.status(502).send(`YouTube connection failed: ${String(e.message).replace(/[<>&]/g, '')}`); }
  });
  app.post('/api/clips/youtube/disconnect', (req, res) => { mutate(c => { c.youtube = {}; }); ytAccessTok = { v: '', exp: 0 }; res.json({ ok: true }); });

  async function ytAccess() {
    if (ytAccessTok.v && Date.now() < ytAccessTok.exp) return ytAccessTok.v;
    const y = ytOf(clipsOf(getAppData()));
    if (!y.tok) throw new Error('YouTube isn\'t connected');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: unseal(y.tok).refresh_token, client_id: YT_ID, client_secret: YT_SECRET, grant_type: 'refresh_token' }) });
    const t = await r.json();
    if (!r.ok) {
      if (t.error === 'invalid_grant') mutate(c => { ytOf(c).error = 'YouTube sign-in expired. Connect again.'; });
      throw new Error(t.error === 'invalid_grant' ? 'YouTube sign-in expired. Connect YouTube again.' : `YouTube auth failed (${t.error || r.status})`);
    }
    ytAccessTok = { v: t.access_token, exp: Date.now() + (t.expires_in - 120) * 1000 };
    return ytAccessTok.v;
  }
  async function clipBytes(url) {
    // our own pass-through URL → fetch straight from the worker over the private network
    const m = String(url).match(/\/clipfiles\/([a-f0-9]{24}\.mp4)$/);
    const r = await fetch(m && WORKER_URL ? `${WORKER_URL}/files/${m[1]}` : url, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`Couldn't load the clip file (${r.status})${r.status === 404 ? '. It may have expired' : ''}`);
    return Buffer.from(await r.arrayBuffer());
  }
  async function ytUpload(job, cl) {
    const tok = await ytAccess(), buf = await clipBytes(cl.url);
    const tags = (cl.hashtags || []).filter(Boolean);
    const credit = job.source?.login ? `\n\nCredit: twitch.tv/${job.source.login}` : job.source?.channel ? `\n\nCredit: ${job.source.channel}` : '';
    const meta = {
      snippet: { title: (cl.title || cl.hook || 'Clip').slice(0, 100), description: `${cl.caption || ''}\n\n${tags.map(h => '#' + h).join(' ')} #Shorts${credit}`.trim().slice(0, 4900), tags: tags.slice(0, 15), categoryId: '20' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    };
    const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(buf.length), 'X-Upload-Content-Type': 'video/mp4' }, body: JSON.stringify(meta) });
    if (!init.ok) { const e = await init.json().catch(() => ({})); throw new Error(e.error?.errors?.[0]?.reason === 'quotaExceeded' ? 'YouTube\'s daily upload limit is used up (about 6 a day). Try again tomorrow.' : `YouTube refused the upload (${e.error?.message || init.status})`); }
    const up = await fetch(init.headers.get('location'), { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length) }, body: buf, signal: AbortSignal.timeout(300000) });
    const v = await up.json().catch(() => ({}));
    if (!up.ok || !v.id) throw new Error(`YouTube upload failed (${v.error?.message || up.status})`);
    return { id: v.id, privacy: v.status?.privacyStatus || 'public' };
  }

  // ── TIKTOK POSTING (Content Posting API, Direct Post) ──
  // Same pattern as YouTube: connect once (Login Kit OAuth), token sealed in app-data. TikTok's rules:
  // until the app passes TikTok's review every post is forced to "Only me", and the person posting
  // must pick the privacy level themselves on each post (no pre-filled default), so the app asks.
  const TT_SALT = () => 'clips-tt:' + TT_SECRET;
  const ttOf = c => (c.tiktok = c.tiktok || {});
  let ttAccessTok = { v: '', exp: 0 };
  const TT_API = process.env.TIKTOK_API_BASE || 'https://open.tiktokapis.com/v2';

  app.get('/api/clips/tiktok/connect', (req, res) => {
    if (!TT_KEY || !TT_SECRET) return res.status(400).send('Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET on Render first.');
    const state = crypto.randomBytes(16).toString('hex'); oauthStates.set(state, Date.now() + 15 * 60 * 1000);
    const q = new URLSearchParams({ client_key: TT_KEY, response_type: 'code', scope: 'user.info.basic,video.publish', redirect_uri: TT_REDIRECT, state });
    res.redirect(`https://www.tiktok.com/v2/auth/authorize/?${q}`);
  });
  async function ttToken(params) {
    const r = await fetch(`${TT_API}/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: TT_KEY, client_secret: TT_SECRET, ...params }) });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.access_token) throw Object.assign(new Error(t.error_description || t.error || `TikTok auth HTTP ${r.status}`), { code: t.error });
    ttAccessTok = { v: t.access_token, exp: Date.now() + (t.expires_in - 300) * 1000 };
    return t;
  }
  app.get('/api/clips/tiktok/callback', async (req, res) => {
    const exp = oauthStates.get(String(req.query.state || '')); oauthStates.delete(String(req.query.state || ''));
    if (!exp || exp < Date.now()) return res.status(400).send('This sign-in link expired. Go back to the Clips tab and tap Connect TikTok again.');
    if (!req.query.code) return res.redirect('/?open=clips&tt=cancelled');
    try {
      const t = await ttToken({ code: String(req.query.code), grant_type: 'authorization_code', redirect_uri: TT_REDIRECT });
      const u = await (await fetch(`${TT_API}/user/info/?fields=open_id,display_name,avatar_url`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json().catch(() => ({}));
      mutate(c => { const x = ttOf(c); x.tok = seal({ refresh_token: t.refresh_token, open_id: t.open_id }, TT_SALT()); x.user = { name: u.data?.user?.display_name || '', avatar: u.data?.user?.avatar_url || '' }; x.connectedAt = new Date().toISOString(); x.error = null; });
      res.redirect('/?open=clips&tt=connected');
    } catch (e) { console.error('TikTok connect failed:', e.message); res.status(502).send(`TikTok connection failed: ${String(e.message).replace(/[<>&]/g, '')}`); }
  });
  app.post('/api/clips/tiktok/disconnect', (req, res) => { mutate(c => { c.tiktok = {}; }); ttAccessTok = { v: '', exp: 0 }; res.json({ ok: true }); });

  async function ttAccess() {
    if (ttAccessTok.v && Date.now() < ttAccessTok.exp) return ttAccessTok.v;
    const x = ttOf(clipsOf(getAppData()));
    if (!x.tok) throw new Error('TikTok isn\'t connected');
    try {
      const t = await ttToken({ grant_type: 'refresh_token', refresh_token: unseal(x.tok, TT_SALT()).refresh_token });
      if (t.refresh_token) mutate(c => { const y = ttOf(c); y.tok = seal({ refresh_token: t.refresh_token, open_id: t.open_id }, TT_SALT()); });   // TikTok rotates it
      return t.access_token;
    } catch (e) {
      if (e.code === 'invalid_grant') mutate(c => { ttOf(c).error = 'TikTok sign-in expired. Connect again.'; });
      throw new Error(e.code === 'invalid_grant' ? 'TikTok sign-in expired. Connect TikTok again.' : e.message);
    }
  }
  async function ttCall(p, body) {
    const r = await fetch(`${TT_API}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${await ttAccess()}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || (d.error?.code && d.error.code !== 'ok')) {
      const code = d.error?.code || String(r.status);
      const msg = /unaudited/.test(code) ? 'only "Only me" posts work until TikTok approves the app' : d.error?.message || code;
      throw Object.assign(new Error(`TikTok: ${msg}`), { code });
    }
    return d.data || {};
  }
  // What TikTok says this account may do right now (privacy choices, comment/duet/stitch, max length)
  app.get('/api/clips/tiktok/creator', async (req, res) => {
    try { res.json(await ttCall('/post/publish/creator_info/query/')); } catch (e) { res.status(502).json({ error: e.message }); }
  });

  async function ttUpload(job, cl, o) {
    const buf = await clipBytes(cl.url);
    const tags = (cl.hashtags || []).filter(Boolean).map(h => '#' + h).join(' ');
    const credit = job.source?.login ? ` · credit: twitch.tv/${job.source.login}` : '';
    const initFor = privacy => ttCall('/post/publish/video/init/', {
      post_info: {
        title: `${cl.caption || cl.title || ''} ${tags}${credit}`.trim().slice(0, 2200),
        privacy_level: privacy, disable_comment: !o.comment, disable_duet: !o.duet, disable_stitch: !o.stitch,
        brand_content_toggle: !!o.brandedContent, brand_organic_toggle: !!o.yourBrand,
      },
      // one chunk: clips are well under TikTok's 64 MB chunk limit
      source_info: { source: 'FILE_UPLOAD', video_size: buf.length, chunk_size: buf.length, total_chunk_count: 1 },
    });
    // An unapproved app can only post privately. If TikTok refuses the chosen privacy for that reason, post it as
    // "Only me" instead (the user asked for this). Branded content can't be private, so those posts don't fall back.
    const PRIVATE_ACCT = 'TikTok: TikTok won\'t take posts from this app until it approves it, unless your TikTok account is set to private (TikTok app → Settings → Privacy → Private account)';
    let privacy = o.privacy, init;
    try { init = await initFor(privacy); }
    catch (e) {
      if (!/unaudited/i.test(e.code || '')) throw e;
      if (privacy === 'SELF_ONLY' || o.brandedContent) throw Object.assign(new Error(o.brandedContent && privacy !== 'SELF_ONLY' ? 'TikTok: branded content can\'t be posted until TikTok approves the app' : PRIVATE_ACCT), { code: e.code });
      console.error(`TikTok refused privacy ${privacy} (${e.code}); posting as Only me`);
      privacy = 'SELF_ONLY';
      try { init = await initFor(privacy); }
      catch (e2) { throw /unaudited/i.test(e2.code || '') ? Object.assign(new Error(PRIVATE_ACCT), { code: e2.code }) : e2; }
    }
    const up = await fetch(init.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes 0-${buf.length - 1}/${buf.length}` }, body: buf, signal: AbortSignal.timeout(300000) });
    if (!up.ok) throw new Error(`TikTok upload failed (HTTP ${up.status})`);
    return { publishId: init.publish_id, privacy, fellBack: privacy !== o.privacy };
  }
  // TikTok processes the upload for a while; check back and fill in the post link when it's live
  function ttWatch(jobId, clipId, publishId, tries = 0) {
    setTimeout(async () => {
      try {
        const d = await ttCall('/post/publish/status/fetch/', { publish_id: publishId });
        const done = d.status === 'PUBLISH_COMPLETE', failed = d.status === 'FAILED';
        if (!done && !failed && tries < 40) return ttWatch(jobId, clipId, publishId, tries + 1);
        mutate(c => { const x = findJob(c, jobId)?.clips.find(y => y.id === clipId); if (!x) return;
          x.ttStatus = done ? 'posted' : failed ? `failed: ${d.fail_reason || 'unknown'}` : 'processing';
          const id = (d.publicaly_available_post_id || d.publicly_available_post_id || [])[0];
          if (id) x.postLinks = { ...(x.postLinks || {}), tiktok: `https://m.tiktok.com/v/${id}.html` };
          else if (done) x.postLinks = { ...(x.postLinks || {}), tiktok: x.postLinks?.tiktok || 'https://www.tiktok.com/tiktokstudio/content' }; });
      } catch (e) { if (tries < 40) ttWatch(jobId, clipId, publishId, tries + 1); else console.error('TikTok status check failed:', e.message); }
    }, tries < 6 ? 10000 : 30000);
  }

  // Approve + post: one call sends the clip to every connected platform.
  // body: { youtube: bool, tiktok: { privacy, comment, duet, stitch, brandedContent, yourBrand } | null }
  app.post('/api/clips/jobs/:id/clips/:cid/post', async (req, res) => {
    const b = req.body || {};
    const c0 = clipsOf(getAppData()), job = findJob(c0, req.params.id), cl = job?.clips.find(x => x.id === req.params.cid);
    if (!cl) return res.status(404).json({ error: 'Clip not found' });
    const wantYt = b.youtube !== false && !!ytOf(c0).tok && !cl.postLinks?.youtube;
    const wantTt = !!b.tiktok && !!ttOf(c0).tok && !cl.ttPublishId;
    if (wantTt && !['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].includes(b.tiktok.privacy)) return res.status(400).json({ error: 'Pick who can see it on TikTok' });
    if (!wantYt && !wantTt) return res.json({ ok: true, clip: cl, already: true });
    if (cl.posting && Date.now() - new Date(cl.posting) < 10 * 60 * 1000) return res.status(409).json({ error: 'Already posting this one' });
    mutate(c => { const x = findJob(c, job.id)?.clips.find(y => y.id === cl.id); if (x) { x.posting = new Date().toISOString(); if (x.status === 'review') x.status = 'approved'; } });
    const errors = [];
    const [yt, tt] = await Promise.allSettled([wantYt ? ytUpload(job, cl) : null, wantTt ? ttUpload(job, cl, b.tiktok) : null]);
    if (yt.status === 'rejected') errors.push(`YouTube: ${yt.reason.message}`);
    if (yt.status === 'rejected') console.error(`YouTube post failed for ${cl.id}: ${yt.reason.message}`);
    if (tt.status === 'rejected') { errors.push(tt.reason.message.startsWith('TikTok') ? tt.reason.message : `TikTok: ${tt.reason.message}`); console.error(`TikTok post failed for ${cl.id} (${tt.reason.code || 'no code'}): ${tt.reason.message}`); }
    const clip = mutate(c => {
      const x = findJob(c, job.id).clips.find(y => y.id === cl.id); delete x.posting;
      if (yt.value) { x.postLinks = { ...(x.postLinks || {}), youtube: `https://youtube.com/shorts/${yt.value.id}` }; x.ytId = yt.value.id; x.ytPrivacy = yt.value.privacy; const y = ytOf(c); const d = new Date().toISOString().slice(0, 10); y.uploads = { [d]: ((y.uploads || {})[d] || 0) + 1 }; }
      if (tt.value) { x.ttPublishId = tt.value.publishId; x.ttStatus = 'processing'; x.ttPrivacy = tt.value.privacy; delete x.ttError; }
      if (tt.status === 'rejected') x.ttError = str(errors[errors.length - 1], 300);
      if (yt.value || tt.value) { x.postedAt = x.postedAt || new Date().toISOString(); if ((x.postLinks?.youtube || !ytOf(c).tok) && (x.ttPublishId || !ttOf(c).tok)) x.status = 'posted'; }
      return x;
    });
    if (tt.value) ttWatch(job.id, cl.id, tt.value.publishId);
    if (tt.value?.fellBack) errors.push('TikTok only allows "Only me" until it approves the app, so it was posted as Only me');
    if (errors.length && !yt.value && !tt.value) return res.status(502).json({ error: errors.join(' · ') });
    res.json({ ok: true, clip, errors });
  });

  // ── Stats: spend, clip counts, estimated campaign earnings ──
  app.get('/api/clips/stats', (req, res) => {
    const c = clipsOf(getAppData());
    const all = c.jobs.filter(j => j.type !== 'render').flatMap(j => j.clips.map(cl => ({ ...cl, campaignId: j.campaignId })));
    let estUsd = 0;
    for (const cl of all.filter(x => x.status === 'posted' && x.campaignId)) {
      const camp = c.campaigns.find(x => x.id === cl.campaignId); if (!camp || cl.views < (camp.minViews || 0)) continue;
      let pay = cl.views / 1000 * camp.rate; if (camp.cap) pay = Math.min(pay, camp.cap);
      estUsd += pay * (1 - WHOP_FEE);
    }
    res.json({
      spendUsd: +c.spendUsd.toFixed(4), estUsd: +estUsd.toFixed(2),
      counts: { review: all.filter(x => x.status === 'review' || x.status === 'editing').length, approved: all.filter(x => x.status === 'approved').length, posted: all.filter(x => x.status === 'posted').length },
      views: all.filter(x => x.status === 'posted').reduce((n, x) => n + (x.views || 0), 0),
    });
  });

  setTimeout(() => resendStuck().catch(console.error), 20 * 1000);
  setInterval(() => resendStuck().catch(console.error), 15 * 60 * 1000);
  console.log(`  Clips  : worker ${WORKER_URL ? '✅ ' + WORKER_URL : '❌ not set (WORKER_URL / WORKER_SECRET)'} · Twitch ${TW_ID ? '✅' : '❌ (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)'}`);
};
