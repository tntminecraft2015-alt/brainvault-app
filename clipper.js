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
const LAYOUTS = ['blur', 'center', 'split'];
const CORNERS = ['tl', 'tr', 'bl', 'br'];

const str = (v, n) => String(v ?? '').trim().slice(0, n);
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

async function getTrending(streamers) {
  const items = [];
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
  // Top live streams right now (all of Twitch), for discovering who's hot
  const live = await helix('streams?first=20', 5 * 60 * 1000).catch(() => []);
  for (const s of live) items.push({ id: `tl-${s.id}`, kind: 'live', url: `https://www.twitch.tv/${s.user_login}`, title: s.title, channel: s.user_name, login: s.user_login, views: s.viewer_count, game: s.game_name, date: s.started_at, thumb: twThumb(s.thumbnail_url, 480, 270), saved: streamers.includes(s.user_login.toLowerCase()) });
  // views per hour since posting: what's moving right now
  for (const it of items) { const hrs = Math.max(1, (Date.now() - new Date(it.date)) / 3.6e6); it.velocity = it.kind === 'live' ? it.views : Math.round(it.views / hrs); }
  return items;
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
      'You rate Twitch videos for how well they would clip into viral 30–75s TikTok/YouTube Shorts. Big reactions, funny moments, rage, clutch plays, drama and hot takes score high; quiet grinding, music streams and AFK score low. Reply ONLY with JSON: [{"n":0,"score":1-10,"why":"under 12 words"}].',
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
      const streamers = clipsOf(getAppData()).streamers.map(s => s.login);
      const items = await getTrending(streamers);
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
    const jobs = c.jobs.filter((j, i) => i < 40 || j.clips?.some(x => x.status === 'review' || x.status === 'approved'))
      .map(j => live.has(j.id) && !['done', 'failed'].includes(j.status) ? { ...j, ...live.get(j.id) } : j);
    res.json({ streamers: c.streamers, campaigns: c.campaigns, jobs, spendUsd: c.spendUsd, worker: !!(WORKER_URL && WORKER_SECRET), twitch: !!(TW_ID && TW_SECRET) });
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
    const login = str(b.login, 40).toLowerCase() || (String(b.url).match(/twitch\.tv\/(?!videos\/)([a-z0-9_]+)/i)?.[1] || '').toLowerCase();
    const now = new Date().toISOString();
    const job = {
      id: newId('job'), type: 'full', status: 'queued', createdAt: now, updatedAt: now,
      source: { url: str(b.url, 500), title: str(b.title, 200) || 'Pasted link', channel: str(b.channel, 60), login, thumb: isUrl(b.thumb) ? str(b.thumb, 500) : '', kind: str(b.kind, 10) || 'link' },
      range: start != null || end != null ? { start, end } : null,
      campaignId: str(b.campaignId, 40) || null,
      layout: LAYOUTS.includes(b.layout) ? b.layout : null, corner: CORNERS.includes(b.corner) ? b.corner : null,
      progress: 0, msg: 'Queued', clips: [], costUsd: 0,
    };
    mutate(c => {
      c.jobs.unshift(job);
      // keep the 60 newest, but never drop a job that still has clips waiting for review
      c.jobs = c.jobs.filter((j, i) => i < 60 || j.clips?.some(x => x.status === 'review' || x.status === 'approved'));
    });
    const delivered = await sendToWorker(job.id);
    res.json({ ok: true, job: findJob(clipsOf(getAppData()), job.id), delivered, workerConfigured: !!(WORKER_URL && WORKER_SECRET) });
  });

  app.post('/api/clips/jobs/:id/retry', async (req, res) => {
    // not for jobs the worker already has ('sent' and later): it would still be running the old attempt
    const ok = mutate(c => { const j = findJob(c, req.params.id); if (!j || !['failed', 'queued'].includes(j.status)) return false; Object.assign(j, { status: 'queued', error: null, msg: 'Queued', progress: 0, attempt: (j.attempt || 1) + 1, updatedAt: new Date().toISOString() }); return true; });
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
      if (['review', 'approved', 'rejected', 'posted'].includes(b.status)) cl.status = b.status;
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

  // Re-cut: Haiku turns a plain-English note into new timings, then a render-only job goes to the worker
  app.post('/api/clips/jobs/:id/clips/:cid/recut', async (req, res) => {
    const note = str(req.body?.note, 300);
    if (!note) return res.status(400).json({ error: 'Say what to change' });
    const c0 = clipsOf(getAppData()), job = findJob(c0, req.params.id), cl = job?.clips.find(x => x.id === req.params.cid);
    if (!cl) return res.status(404).json({ error: 'Clip not found' });
    try {
      const { json, cost } = await haiku(
        'You adjust one short-form video clip based on the editor\'s note. Times are seconds in the source video. Keep length 15–90s unless the note says otherwise. Reply ONLY with JSON: {"start":n,"end":n,"title":"…","hook":"…","caption":"…"}. Keep fields unchanged unless the note asks.',
        `CURRENT: ${JSON.stringify({ start: cl.start, end: cl.end, title: cl.title, hook: cl.hook, caption: cl.caption })}\nSOURCE LENGTH: ${job.duration || 'unknown'}s\nTRANSCRIPT NEAR CLIP:\n${cl.context || '(none)'}\nNOTE: ${note}`, 600);
      const max = job.duration || 864000;
      const s = num(json.start, 0, max, cl.start), e = num(json.end, s + 5, max, cl.end);
      const moment = { start: s, end: e, title: str(json.title, 100) || cl.title, hook: str(json.hook, 60) || cl.hook, caption: str(json.caption, 2200) || cl.caption, hashtags: cl.hashtags, score: cl.score, why: cl.why, context: cl.context };
      const now = new Date().toISOString();
      // The worker cuts from the full source, so the moment times stay in source seconds;
      // range-limited parents are re-downloaded with the same range so offsets still line up.
      const rj = {
        id: newId('job'), type: 'render', parentId: job.id, status: 'queued', createdAt: now, updatedAt: now,
        source: job.source, range: job.range, duration: job.duration, campaignId: job.campaignId, layout: job.layout, corner: job.corner,
        moments: [moment], recutOf: cl.id, note, progress: 0, msg: 'Queued re-cut', clips: [], costUsd: cost,
      };
      mutate(c => { c.jobs.unshift(rj); const p = findJob(c, job.id)?.clips.find(x => x.id === cl.id); if (p) p.recutting = rj.id; });
      res.json({ ok: true, job: rj, delivered: await sendToWorker(rj.id) });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // ── Worker callbacks (x-worker-secret) ──
  // a report from an attempt older than the latest "Try again" is ignored
  const staleAttempt = (j, b) => b.attempt != null && b.attempt !== (j.attempt || 1);
  const workerOnly = (req, res, next) => secretOk(req.get('x-worker-secret')) ? next() : res.status(401).json({ error: 'bad worker secret' });

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
      picks.set(key, pickMoments(job, c0, segs, duration));
      setTimeout(() => picks.delete(key), 3600 * 1000);
    }
    try { res.json({ moments: await picks.get(key) }); }
    catch (e) { picks.delete(key); res.status(502).json({ error: e.message }); }
  });

  async function pickMoments(job, c0, segs, duration) {
    const camp = c0.campaigns.find(x => x.id === job.campaignId);
    const short = duration > 0 && duration <= 95;
    // ~120k chars of transcript max: keeps one Haiku call to a few cents even on long VODs
    let tx = ''; for (const s of segs) { const line = `[${Math.round(s.s)}-${Math.round(s.e)}] ${str(s.t, 400)}\n`; if (tx.length + line.length > 120000) break; tx += line; }
    {
      const { json, cost } = await haiku(
        `You are an expert short-form editor who clips Twitch streamers for TikTok and YouTube Shorts. ${short ? 'This source is already a short clip: return exactly ONE moment covering the whole thing (start 0, end = its length), with your best title, hook and caption.' : 'Pick the 3–6 best self-contained moments that do not overlap each other. Each must be 30–75s (make at least one 61–75s for TikTok Creator Rewards), start right before the setup, and end on the payoff, with no dead air at the start. Gaming transcripts are often thin or repetitive: still return your best 3 picks, favoring the most energetic stretches (yelling, ALL CAPS, laughter, "no way", "clip that"). Only return [] if there is no speech at all.'}
For each give: a "title" (≤70 chars, for YouTube), a "hook" (≤6 words, punchy on-screen text, ALL CAPS ok), a "caption" (1–2 lines for TikTok, no hashtags), 3–6 "hashtags" (no #), a "score" 1–10 for viral potential, and "why" (≤12 words).${camp?.rules ? `\nThis clip is for a paid campaign, "${camp.name}". Follow its rules exactly in the caption/hashtags:\n${camp.rules}` : ''}
Timestamps in the transcript are seconds. Reply ONLY with JSON: [{"start":n,"end":n,"title":"","hook":"","caption":"","hashtags":[""],"score":n,"why":""}]`,
        `SOURCE: "${job.source.title}" by ${job.source.channel || 'unknown'} (${Math.round(duration)}s)\nTRANSCRIPT:\n${tx || '(no speech detected)'}`, 2500);
      const max = duration || 864000;
      const moments = (Array.isArray(json) ? json : []).map(m => {
        const s = num(m.start, 0, max, 0), e = num(m.end, 0, max, Math.min(max, s + 45));
        const context = segs.filter(x => x.e >= s - 20 && x.s <= e + 20).map(x => `[${Math.round(x.s)}] ${str(x.t, 300)}`).join('\n').slice(0, 3000);
        return { start: s, end: e, title: str(m.title, 100), hook: str(m.hook, 60), caption: str(m.caption, 600), hashtags: (Array.isArray(m.hashtags) ? m.hashtags : []).map(h => str(h, 40).replace(/^#/, '')).filter(Boolean).slice(0, 8), score: num(m.score, 1, 10, 5), why: str(m.why, 90), context };
      }).filter(m => m.end - m.start >= 5).sort((a, b) => b.score - a.score)
        // drop picks that are mostly the same footage as a better one
        .filter((m, i, all) => !all.slice(0, i).some(k => Math.min(k.end, m.end) - Math.max(k.start, m.start) > 0.5 * Math.min(k.end - k.start, m.end - m.start)))
        .slice(0, 6);
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
        title: str(x.title, 100), hook: str(x.hook, 60), caption: str(x.caption, 2200), hashtags: (Array.isArray(x.hashtags) ? x.hashtags : []).map(h => str(h, 40)).slice(0, 8),
        score: num(x.score, 1, 10, 5), why: str(x.why, 90), context: str(x.context, 3000), status: 'review', views: 0, postLinks: {},
      }));
      j.status = j.clips.length ? 'done' : 'failed'; j.error = j.clips.length ? null : 'No clips came back';
      j.progress = 100; j.msg = j.clips.length ? `${j.clips.length} clip${j.clips.length > 1 ? 's' : ''} ready` : 'Failed';
      j.finishedAt = j.updatedAt = new Date().toISOString();
      if (j.recutOf) {        // a re-cut replaces the old clip inside its original job
        const parent = findJob(c, j.parentId), old = parent?.clips.find(x => x.id === j.recutOf);
        if (old) delete old.recutting;
        if (parent && j.clips[0]) { if (old) old.status = 'rejected'; parent.clips.push({ ...j.clips[0], recutNote: j.note }); }
        j.clips = [];         // the clip now lives in the parent; an empty re-cut job can be pruned like any other
      }
      live.delete(j.id);
      return j;
    });
    if (!job) return res.status(404).json({ error: 'unknown job' });
    // Backup push: only when the worker isn't sending its own (it does so right after this call succeeds)
    if (fresh && !b.workerPushes && pushEnabled && job.status === 'done') {
      const n = (b.clips || []).length;
      const payload = JSON.stringify({ title: '🎬 Clips ready', body: `${n} clip${n > 1 ? 's' : ''} from "${job.source.title}". Tap to review.`, tag: `clips-${job.id}`, url: '/?open=clips' });
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
      counts: { review: all.filter(x => x.status === 'review').length, approved: all.filter(x => x.status === 'approved').length, posted: all.filter(x => x.status === 'posted').length },
      views: all.filter(x => x.status === 'posted').reduce((n, x) => n + (x.views || 0), 0),
    });
  });

  setTimeout(() => resendStuck().catch(console.error), 20 * 1000);
  setInterval(() => resendStuck().catch(console.error), 15 * 60 * 1000);
  console.log(`  Clips  : worker ${WORKER_URL ? '✅ ' + WORKER_URL : '❌ not set (WORKER_URL / WORKER_SECRET)'} · Twitch ${TW_ID ? '✅' : '❌ (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)'}`);
};
