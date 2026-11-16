// ── CLIP WORKER ─────────────────────────────────────────────────────────────
// Runs as a Render private service (or any Docker host). Mission Control POSTs a job to /jobs;
// this downloads the source (yt-dlp), transcribes it (Groq's Whisper API, or local faster-whisper),
// asks Mission Control which moments to cut (Claude runs there), renders 9:16 clips with burned
// captions (ffmpeg), stores them (R2, or served from /files here — on Render, Mission Control
// passes /files through at /clipfiles since this has no public address), sends the "clips ready" push itself,
// and reports back, retrying until Mission Control (which may be asleep) accepts the result.
// The queue is saved to disk, so a restart picks up exactly where it left off.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const webpush = require('web-push');
const { buildAss } = require('./captions');

const PORT = +process.env.PORT || 8080;
const SECRET = process.env.WORKER_SECRET || '';
const SERVER = (process.env.SERVER_URL || '').replace(/\/+$/, '');
const PUBLIC = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
// where phones fetch finished clips: this worker's own /files, or (on Render) Mission Control's /clipfiles pass-through
const FILES_BASE = (process.env.FILES_BASE_URL || (PUBLIC ? PUBLIC + '/files' : '')).replace(/\/+$/, '');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const KEEP_DAYS = +process.env.KEEP_DAYS || 14;
const MAX_HEIGHT = +process.env.MAX_HEIGHT || 1080;   // source resolution cap; 720 keeps small servers quick
const FONTS = path.join(__dirname, 'fonts');
const PY = process.env.PYTHON || 'python3';
const R2 = process.env.R2_BUCKET && process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_PUBLIC_BASE;
const PUSH = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

if (!SECRET || !SERVER) { console.error('WORKER_SECRET and SERVER_URL are required'); process.exit(1); }
if (!R2 && !FILES_BASE) { console.error('Set PUBLIC_URL (this worker\'s https address), FILES_BASE_URL, or the R2_* variables so clips have somewhere to live'); process.exit(1); }
if (PUSH) webpush.setVapidDetails(process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const dirs = { work: path.join(DATA, 'work'), src: path.join(DATA, 'src'), out: path.join(DATA, 'out') };
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
const QUEUE_FILE = path.join(DATA, 'queue.json');

// queue entries: { job, state: 'queued' | 'running' | 'reporting', result?, failed?, at }
let queue = [];
try { queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch {}
const saveQueue = () => { fs.writeFileSync(QUEUE_FILE + '.tmp', JSON.stringify(queue)); fs.renameSync(QUEUE_FILE + '.tmp', QUEUE_FILE); };
// "id:attempt" of jobs finished this process lifetime, so a duplicate send isn't redone
// (a user's "Try again" bumps the attempt, so it does run)
const recent = new Set();
const runKey = job => `${job.id}:${job.attempt || 1}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const secretOk = h => typeof h === 'string' && h.length === SECRET.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(SECRET));

// ── talking to Mission Control ──
async function callServer(p, body, { tries = 8, timeout = 90000 } = {}) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${SERVER}${p}`, { method: 'POST', signal: AbortSignal.timeout(timeout), headers: { 'Content-Type': 'application/json', 'x-worker-secret': SECRET }, body: JSON.stringify(body || {}) });
      if (r.status === 404 || r.status === 401) { const t = await r.text(); throw Object.assign(new Error(`server ${r.status}: ${t.slice(0, 120)}`), { fatal: true }); }
      if (!r.ok) throw new Error(`server HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (e.fatal || i + 1 >= tries) throw e;
      // Render's free tier can take ~a minute to wake: back off 5s → 10 min
      await sleep(Math.min(600000, 5000 * 2 ** i));
    }
  }
}
let lastProg = 0;
function progress(job, status, pct, msg, extra) {
  const now = Date.now();
  if (now - lastProg < 15000 && status !== 'picking') return;   // keep it light; each call also keeps Render awake
  lastProg = now;
  callServer(`/api/clips/worker/${job.id}/progress`, { status, progress: Math.round(pct), msg, attempt: job.attempt || 1, ...extra }, { tries: 1, timeout: 60000 }).catch(() => {});
}

// ── shell helpers ──
function run(cmd, args, { cwd, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let tail = '', out = '';
    const feed = buf => { const s = buf.toString(); tail = (tail + s).slice(-3000); if (onLine) s.split(/\r|\n/).forEach(l => l && onLine(l)); };
    p.stdout.on('data', b => { out += b; feed(b); });
    p.stderr.on('data', feed);
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} exited ${code}: ${tail.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 280)}`)));
  });
}
async function duration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return +(+out.trim()).toFixed(2) || 0;
}
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

// ── pipeline steps ──
// A multi-hour VOD is several GB of video, so the source is fetched in two passes: the audio track
// only (~70 MB/hour) to listen and pick moments, then just the picked moments' video sections.
// All moment times are seconds from the start of the job's range (0 when there is no range).
const rangeOf = job => ({ from: job.range?.start ?? 0, to: job.range?.end ?? null });

async function ytdlp(job, base, format, section, extra, pctFrom, pctSpan, label, exactCuts = true) {
  // leftovers from a run that died mid-download must not be mistaken for the result
  for (const f of fs.readdirSync(dirs.src)) if (f.startsWith(`${base}.dl.`)) fs.rmSync(path.join(dirs.src, f), { force: true });
  const args = ['-f', format, '--no-playlist', '--no-part', '--newline', ...extra, '-o', path.join(dirs.src, `${base}.dl.%(ext)s`)];
  // exact cuts make yt-dlp re-encode the section, which takes ~10 min on half a CPU for video
  if (section) args.push('--download-sections', `*${section[0]}-${section[1] ?? 'inf'}`, ...(exactCuts ? ['--force-keyframes-at-cuts'] : []));
  args.push(job.source.url);
  await run('yt-dlp', args, { onLine: l => { const m = l.match(/\[download\]\s+([\d.]+)%/); if (m) progress(job, 'downloading', pctFrom + +m[1] / 100 * pctSpan, `${label}… ${Math.round(+m[1])}%`); } });
  const outs = fs.readdirSync(dirs.src).filter(f => f.startsWith(`${base}.dl.`) && !/\.part$|\.ytdl$/.test(f));
  if (outs.length !== 1) throw new Error(`Download finished but ${outs.length ? 'several' : 'no'} files appeared`);
  return path.join(dirs.src, outs[0]);
}

async function downloadAudio(job) {
  const { from, to } = rangeOf(job);
  const key = hash(job.source.url + JSON.stringify(job.range || {}));
  const done = fs.readdirSync(dirs.src).find(f => f.startsWith(`${key}.audio.`) && !f.endsWith('.json'));
  if (done) { const p = path.join(dirs.src, done); fs.utimesSync(p, new Date(), new Date()); return p; }
  const got = await ytdlp(job, `${key}.tmp`, 'ba/wa/b', from || to != null ? [from, to] : null, [], 0, 15, 'Downloading audio');
  const file = path.join(dirs.src, `${key}.audio${path.extname(got)}`);
  fs.renameSync(got, file);
  return file;
}

// Just one moment's video, copied without re-encoding; returns { file, pad } where pad is how far
// into the file the moment starts. A copy can only start on a keyframe (every ~2s on Twitch), so
// the file usually begins a little before what was asked for: that lead-in is measured and skipped.
async function downloadSection(job, m, pctFrom) {
  const { from } = rangeOf(job);
  const pad = Math.min(2, m.start), tail = 1;
  const h = MAX_HEIGHT;
  const base = `${hash(job.source.url + `${from + m.start}-${from + m.end}`)}.sec`;
  const file = await ytdlp(job, base, `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}][ext=mp4]/bv*[height<=${h}]+ba/b`,
    [from + m.start - pad, from + m.end + tail], ['--merge-output-format', 'mp4'], pctFrom, 3, 'Downloading clip video', false);
  const asked = m.end - m.start + pad + tail, got = await duration(file).catch(() => asked);
  return { file, pad: pad + Math.min(6, Math.max(0, got - asked)) };
}

// Transcribe [from, to) of the source (whole file when omitted); returns segments in source seconds.
// With GROQ_API_KEY set it uses Groq's free Whisper API (small servers); otherwise local faster-whisper.
async function transcribe(job, src, dur, from = 0, to = null) {
  const cache = `${src}.${from}-${to ?? 'end'}.json`;
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const span = (to ?? dur) - from;
  const segs = GROQ ? await transcribeGroq(job, src, from, span) : await transcribeLocal(job, src, from, span);
  fs.writeFileSync(cache, JSON.stringify(segs));
  return segs;
}
const cutArgs = (from, span) => ['-y', '-v', 'error', ...(from ? ['-ss', String(from)] : []), '-t', String(span)];

async function transcribeLocal(job, src, from, span) {
  const wav = path.join(dirs.work, `${job.id}.wav`), json = path.join(dirs.work, `${job.id}.tx.json`);
  await run('ffmpeg', [...cutArgs(from, span), '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  await run(PY, [path.join(__dirname, 'transcribe.py'), wav, json], { onLine: l => { const m = l.match(/^PROGRESS ([\d.]+)/); if (m) { const pct = +m[1]; progress(job, 'transcribing', 25 + pct * 40, `Listening… ${Math.round(pct * span / 60)} of ${Math.max(1, Math.round(span / 60))} min`); } } });
  const tx = JSON.parse(fs.readFileSync(json, 'utf8'));
  fs.rmSync(wav, { force: true }); fs.rmSync(json, { force: true });
  return (tx.segments || []).map(s => ({ s: s.s + from, e: s.e + from, t: s.t, w: (s.w || []).map(([ws, we, w]) => [ws + from, we + from, w]) }));
}

// Groq: 10-minute mono MP3 chunks (~2.4 MB each, well under the 25 MB upload cap), waiting out rate limits
const GROQ = process.env.GROQ_API_KEY || '';
const CHUNK = 600;
async function transcribeGroq(job, src, from, span) {
  const dir = path.join(dirs.work, `${job.id}-audio`); fs.mkdirSync(dir, { recursive: true });
  await run('ffmpeg', [...cutArgs(from, span), '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', '-f', 'segment', '-segment_time', String(CHUNK), path.join(dir, 'a%03d.mp3')]);
  const parts = fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).sort();
  const segs = [];
  for (let i = 0; i < parts.length; i++) {
    progress(job, 'transcribing', 25 + 40 * i / parts.length, `Listening… ${Math.min(Math.round(span / 60), i * CHUNK / 60)} of ${Math.max(1, Math.round(span / 60))} min`);
    const off = from + i * CHUNK;
    const tx = await groqChunk(job, path.join(dir, parts[i]));
    const words = (tx.words || []).map(w => [w.start + off, w.end + off, String(w.word || '').trim()]);
    for (const s of tx.segments || []) {
      const s0 = s.start + off, e0 = s.end + off;
      segs.push({ s: s0, e: e0, t: String(s.text || '').trim(), w: words.filter(([ws]) => ws >= s0 - 0.05 && ws < e0) });
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return segs;
}
async function groqChunk(job, file) {
  for (let i = 0; ; i++) {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file));
    form.append('model', process.env.GROQ_MODEL || 'whisper-large-v3-turbo');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    const r = await fetch(process.env.GROQ_URL || 'https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${GROQ}` }, body: form, signal: AbortSignal.timeout(180000) }).catch(e => ({ ok: false, status: 0, e }));
    if (r.ok) return r.json();
    // free tier: an hour of audio per hour or so; long VODs wait for the window to reset
    if ((r.status === 429 || r.status >= 500 || r.status === 0) && i < 12) {
      const wait = Math.min(15 * 60, +(r.headers?.get?.('retry-after')) || 30 * 2 ** Math.min(i, 4));
      if (r.status === 429) progress(job, 'transcribing', 30, `Free transcription limit hit, waiting ${Math.ceil(wait / 60)} min…`);
      await sleep(wait * 1000); continue;
    }
    throw new Error(`Transcription failed (Groq HTTP ${r.status}${r.status === 401 ? ': check GROQ_API_KEY' : ''})`);
  }
}

const CROP_XY = { tl: ['0', '0'], tr: ['iw-ow', '0'], bl: ['0', 'ih-oh'], br: ['iw-ow', 'ih-oh'] };
// Output size: 1080×1920 by default; OUT_WIDTH=720 renders 720×1280 (fine for Shorts/TikTok, ~2.3× less work).
// Captions are laid out on a 1080×1920 canvas and libass scales them to whatever size this is.
const W = Math.round((+process.env.OUT_WIDTH || 1080) / 2) * 2, H = Math.round(W * 16 / 9 / 2) * 2;
const PRESET = process.env.X264_PRESET || 'veryfast';
function filterFor(layout, corner) {
  const ass = `ass=sub.ass:fontsdir=${FONTS}`;
  if (layout === 'center') return `[0:v]scale=-2:${H},crop=${W}:${H},setsar=1,${ass}[v]`;
  if (layout === 'split') {
    const [x, y] = CROP_XY[corner] || CROP_XY.br;
    const camH = Math.round(H * 0.4 / 2) * 2, gameH = H - camH;
    // facecam corner (30% of the width) on top, center of the gameplay below
    return `[0:v]split=2[a][b];[a]crop=iw*0.3:iw*0.3*${camH}/${W}:${x}:${y},scale=${W}:${camH},setsar=1[cam];[b]crop=ih*${W}/${gameH}:ih,scale=${W}:${gameH},setsar=1[game];[cam][game]vstack,${ass}[v]`;
  }
  // blur: the full frame centered on a blurred, zoomed copy of itself. The blur runs at 1/4 size
  // and is scaled back up, which looks the same and is far cheaper than blurring full-size frames.
  const bw = Math.round(W / 8) * 2, bh = Math.round(H / 8) * 2;
  return `[0:v]split=2[a][b];[a]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=6:1,scale=${W}:${H},eq=brightness=-0.08[bg];[b]scale=${W}:-2,setsar=1[fg];[bg][fg]overlay=0:(H-h)/2,setsar=1,${ass}[v]`;
}

async function render(job, m, i, segs, pctFrom) {
  const dir = path.join(dirs.work, job.id); fs.mkdirSync(dir, { recursive: true });
  const len = +(m.end - m.start).toFixed(2);
  const words = segs.flatMap(s => s.w).filter(([ws, we]) => we > m.start && ws < m.end).map(([ws, we, w]) => [Math.max(0, ws - m.start), Math.min(len, we - m.start), w]);
  fs.writeFileSync(path.join(dir, 'sub.ass'), buildAss({ words, hook: m.hook, layout: job.layout, duration: len }));
  const t0 = Date.now();
  const { file: src, pad } = await downloadSection(job, m, pctFrom);
  const t1 = Date.now();
  const out = `clip${i}.mp4`;
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(pad), '-t', String(len), '-i', src,
    '-filter_complex', filterFor(job.layout, job.corner), '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', PRESET, '-crf', '21', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-movflags', '+faststart', out], { cwd: dir });
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.min(1, len / 2)), '-i', out, '-frames:v', '1', '-vf', 'scale=360:-2', `thumb${i}.jpg`], { cwd: dir });
  fs.rmSync(src, { force: true });
  console.log(`job ${job.id}: clip ${i + 1} (${len}s) downloaded in ${Math.round((t1 - t0) / 1000)}s, rendered in ${Math.round((Date.now() - t1) / 1000)}s (lead-in ${pad.toFixed(1)}s)`);
  return { video: path.join(dir, out), thumb: path.join(dir, `thumb${i}.jpg`) };
}

let s3 = null;
async function store(file, type) {
  const name = `${crypto.randomBytes(12).toString('hex')}${path.extname(file)}`;
  if (R2) {
    if (!s3) { const { S3Client } = require('@aws-sdk/client-s3'); s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } }); }
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: `clips/${name}`, Body: fs.readFileSync(file), ContentType: type }));
    return `${process.env.R2_PUBLIC_BASE.replace(/\/+$/, '')}/clips/${name}`;
  }
  fs.copyFileSync(file, path.join(dirs.out, name));
  return `${FILES_BASE}/${name}`;
}

async function sendPush(job, n) {
  if (!PUSH || !job.pushSubscriptions?.length) return false;
  const payload = JSON.stringify({ title: '🎬 Clips ready', body: `${n} clip${n > 1 ? 's' : ''} from "${job.source.title}". Tap to review.`, tag: `clips-${job.id}`, url: '/?open=clips' });
  const results = await Promise.allSettled(job.pushSubscriptions.map(s => webpush.sendNotification(s, payload, { TTL: 86400 })));
  return results.some(r => r.status === 'fulfilled');
}

async function processJob(job) {
  progress(job, 'downloading', 1, 'Downloading audio…'); lastProg = 0;
  const src = await downloadAudio(job);
  const dur = await duration(src);
  if (!dur) throw new Error('Could not read the downloaded audio');
  let moments, segs;
  if (job.type === 'render' && job.moments?.length) {
    // re-cut: only listen to the part being cut (cached if this source was done before)
    moments = job.moments;
    const from = Math.max(0, Math.floor(Math.min(...moments.map(m => m.start)))), to = Math.min(dur, Math.ceil(Math.max(...moments.map(m => m.end))));
    segs = fs.existsSync(`${src}.0-end.json`) ? JSON.parse(fs.readFileSync(`${src}.0-end.json`, 'utf8')) : await transcribe(job, src, dur, from, to);
  } else {
    const tt = Date.now();
    segs = await transcribe(job, src, dur);
    console.log(`job ${job.id}: ${Math.round(dur / 60)} min of audio transcribed in ${Math.round((Date.now() - tt) / 1000)}s`);
    lastProg = 0; progress(job, 'picking', 66, 'Picking the best moments…', { duration: dur });
    // generous timeout: Render may be waking up AND Haiku reading a long transcript (a retry reuses the server's same call)
    const r = await callServer(`/api/clips/worker/${job.id}/pick`, { duration: dur, segments: segs.map(({ s, e, t }) => ({ s, e, t })) }, { tries: 6, timeout: 240000 });
    moments = r.moments || [];
    if (!moments.length) throw new Error('No good moments found in this video');
  }
  const clips = [];
  for (let i = 0; i < moments.length; i++) {
    const m = { ...moments[i], start: Math.max(0, +moments[i].start), end: Math.min(dur, +moments[i].end) };
    if (m.end - m.start < 3) continue;
    lastProg = 0; progress(job, 'rendering', 68 + 30 * i / moments.length, `Editing clip ${i + 1} of ${moments.length}…`);
    const { video, thumb } = await render(job, m, i, segs, 68 + 30 * i / moments.length);
    const [url, thumbUrl] = [await store(video, 'video/mp4'), await store(thumb, 'image/jpeg')];
    clips.push({ ...moments[i], start: m.start, end: m.end, url, thumb: thumbUrl });
  }
  fs.rmSync(path.join(dirs.work, job.id), { recursive: true, force: true });
  if (!clips.length) throw new Error('Every picked moment was too short to cut');
  return clips;
}

// ── queue loop ──
let busy = false;
const REPORT_GIVE_UP = 2 * 864e5;    // stop re-reporting a result after 2 days
const PUSH_ANYWAY = 10 * 60 * 1000;  // if Mission Control still hasn't taken the result after 10 min, notify anyway

// Report a finished job. Returns true once it's settled (accepted, rejected for good, or given up on).
async function report(e) {
  e.finishedAt = e.finishedAt || new Date().toISOString();
  const attempt = e.job.attempt || 1;
  const willPush = PUSH && !e.failed && e.job.pushSubscriptions?.length > 0;
  try {
    if (e.failed) await callServer(`/api/clips/worker/${e.job.id}/fail`, { error: e.failed, attempt }, { tries: 3 });
    else await callServer(`/api/clips/worker/${e.job.id}/done`, { ...e.result, attempt, workerPushes: willPush }, { tries: 3 });
  } catch (err) {
    if (!err.fatal && Date.now() - new Date(e.finishedAt) < REPORT_GIVE_UP) {
      // Mission Control is unreachable: still tell the phone once, so the user isn't left waiting
      if (willPush && !e.pushed && Date.now() - new Date(e.finishedAt) > PUSH_ANYWAY) { e.pushed = await sendPush(e.job, e.result.clips.length).catch(() => false); saveQueue(); }
      console.error(`could not report job ${e.job.id} yet:`, err.message);
      return false;
    }
    console.error(`giving up reporting job ${e.job.id}:`, err.message);
    return true;
  }
  if (willPush && !e.pushed) await sendPush(e.job, e.result.clips.length).catch(() => false);   // only now the clips are actually there
  return true;
}

// One job renders at a time. Unreported results are retried between jobs (and every minute when idle),
// so a long Mission Control outage never stops new jobs from being worked on.
async function pump() {
  if (busy) return; busy = true;
  try {
    for (;;) {
      for (const e of queue.filter(x => x.state === 'reporting')) {
        if (await report(e)) { recent.add(runKey(e.job)); queue = queue.filter(x => x !== e); saveQueue(); }
      }
      const e = queue.find(x => x.state === 'running') || queue.find(x => x.state === 'queued');
      if (!e) break;
      e.state = 'running'; saveQueue();
      try { e.result = { clips: await processJob(e.job) }; }
      catch (err) { console.error(`job ${e.job.id} failed:`, err.message); e.failed = String(err.message || err).slice(0, 300); }
      e.state = 'reporting'; e.finishedAt = new Date().toISOString(); saveQueue();
    }
  } finally { busy = false; }
  if (queue.some(x => x.state === 'reporting')) setTimeout(pump, 60000);
  else scheduleTick(5 * 60 * 1000);   // queue drained: see if autopilot wants another one soon
}

// ── autopilot: every 2 hours (and soon after each job), ask Mission Control whether to make more clips.
// This worker is the always-on part, so it drives the schedule; it also lists the YouTube channels
// with yt-dlp (Mission Control can't), and Mission Control picks the source and sends the job back.
const TICK = 2 * 3600 * 1000;
let ticking = false, tickTimer = null;
function scheduleTick(ms) { clearTimeout(tickTimer); tickTimer = setTimeout(autopilotTick, ms); }
async function listYoutube(url) {
  for (const tab of ['/streams', '/videos']) {
    try {
      const d = JSON.parse(await run('yt-dlp', ['--flat-playlist', '-J', '--playlist-end', '8', '--extractor-args', 'youtubetab:approximate_date', url + tab]));
      const items = (d.entries || []).filter(e => e?.id).map(e => ({ id: e.id, title: e.title, channel: d.channel || d.uploader || d.title, views: e.view_count || 0, duration: e.duration || 0, date: e.timestamp ? new Date(e.timestamp * 1000).toISOString() : null }));
      if (items.length) return items;
    } catch (e) { console.error(`autopilot: couldn't list ${url}${tab}:`, e.message.slice(0, 200)); }
  }
  return [];
}
async function autopilotTick() {
  scheduleTick(TICK);
  if (ticking || busy || queue.length) return;
  ticking = true;
  try {
    const r = await fetch(`${SERVER}/api/clips/worker/autopilot`, { headers: { 'x-worker-secret': SECRET }, signal: AbortSignal.timeout(90000) }).then(x => x.json());
    if (!r.need) { if (r.why && r.why !== 'off') console.log(`autopilot: resting (${r.why})`); return; }
    const youtube = [];
    for (const url of r.youtube || []) youtube.push(...await listYoutube(url));
    const out = await callServer('/api/clips/worker/autopilot', { youtube }, { tries: 3 });
    console.log(out.queued ? `autopilot: queued "${out.title}"` : `autopilot: nothing queued (${out.why})`);
  } catch (e) { console.error('autopilot tick failed:', e.message); }
  finally { ticking = false; }
}

// ── housekeeping: old clips, cached sources, leftovers ──
function sweep() {
  const now = Date.now();
  const clean = (dir, maxAgeMs) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); try { if (now - fs.statSync(p).mtimeMs > maxAgeMs) fs.rmSync(p, { recursive: true, force: true }); } catch {} } };
  clean(dirs.out, KEEP_DAYS * 864e5);
  clean(dirs.src, 2 * 864e5);
  if (!busy) clean(dirs.work, 864e5);
}

// ── HTTP ──
const app = express();
app.use(express.json({ limit: '2mb' }));
app.get('/health', (req, res) => res.json({ ok: true, busy, queued: queue.length }));
app.use('/files', (req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); }, express.static(dirs.out, { maxAge: '7d', index: false }));
app.post('/jobs', (req, res) => {
  if (!secretOk(req.get('x-worker-secret'))) return res.status(401).json({ error: 'bad secret' });
  const job = req.body || {};
  if (!/^job-[a-z0-9]+$/.test(job.id || '') || !/^https?:\/\//.test(job.source?.url || '')) return res.status(400).json({ error: 'bad job' });
  const ex = queue.find(x => x.job.id === job.id);
  if (ex) { if (ex.state === 'queued') { ex.job = job; saveQueue(); } return res.status(202).json({ ok: true, dup: true }); }
  if (recent.has(runKey(job))) return res.status(202).json({ ok: true, dup: true });
  queue.push({ job, state: 'queued', at: new Date().toISOString() }); saveQueue();
  res.status(202).json({ ok: true, position: queue.length });
  pump();
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Clip worker on :${PORT} → reporting to ${SERVER} · storage ${R2 ? 'R2' : FILES_BASE} · transcribe ${GROQ ? 'Groq' : 'local whisper'} · push ${PUSH ? 'on' : 'off'} · ${queue.length} job(s) resumed`);
  // half-finished downloads (and whole-video sources from older versions) only waste the disk
  for (const f of fs.readdirSync(dirs.src)) if (f.includes('.dl.') || /^[a-f0-9]{16}\.mp4$/.test(f)) fs.rmSync(path.join(dirs.src, f), { force: true });
  sweep(); setInterval(sweep, 3600 * 1000);
  // keep yt-dlp current; sites change their players often (non-fatal)
  const updateYtDlp = () => run(PY, ['-m', 'pip', 'install', '-q', '-U', 'yt-dlp']).catch(e => console.error('yt-dlp update skipped:', e.message));
  updateYtDlp(); setInterval(updateYtDlp, 864e5);
  pump();
  scheduleTick(+process.env.AUTOPILOT_FIRST_MS || 3 * 60 * 1000);
  // catch up on anything sent while this worker was down
  callServer('/api/clips/worker/hello', { have: queue.map(x => x.job.id) }, { tries: 10 }).then(r => r.resending && console.log(`Mission Control is re-sending ${r.resending} job(s)`)).catch(e => console.error('hello failed:', e.message));
});
