const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const Anthropic = require('@anthropic-ai/sdk');
const webpush   = require('web-push');

const app       = express();
const PORT      = process.env.PORT || 3000;
const VAULT     = __dirname;
const WIKI      = path.join(VAULT, 'wiki');
const DATA_FILE = path.join(VAULT, 'app-data.json');

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(VAULT));

// ── CLOUD MODE (GitHub file store) ────────────────────────────────────────────
// When GITHUB_TOKEN + GITHUB_OWNER + GITHUB_VAULT_REPO env vars are set,
// all vault file reads/writes go to GitHub instead of the local disk.
const USE_GITHUB = !!(
  process.env.GITHUB_TOKEN &&
  process.env.GITHUB_OWNER &&
  process.env.GITHUB_VAULT_REPO
);

const GH_TOKEN = process.env.GITHUB_TOKEN      || '';
const GH_OWNER = process.env.GITHUB_OWNER      || '';
const GH_REPO  = process.env.GITHUB_VAULT_REPO || '';
const GH_API   = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents`;

const fileStore  = {};  // ghPath → string content (in-memory cache)
const shaStore   = {};  // ghPath → blob SHA (required for GitHub PUT updates)
const writeQueue = {};  // ghPath → debounce timer

async function ghGet(ghPath) {
  const r = await fetch(`${GH_API}/${ghPath}`, {
    headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
  });
  return r.ok ? r.json() : null;
}

async function ghPut(ghPath, content) {
  const body = { message: `sync: ${ghPath}`, content: Buffer.from(content).toString('base64') };
  if (shaStore[ghPath]) body.sha = shaStore[ghPath];
  const r = await fetch(`${GH_API}/${ghPath}`, {
    method:  'PUT',
    headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = r.ok ? await r.json() : null;
  if (data?.content?.sha) shaStore[ghPath] = data.content.sha;
}

async function loadDir(dir) {
  const items = await ghGet(dir || '');
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item.type === 'dir') {
      await loadDir(item.path);
    } else if (item.type === 'file' && item.size < 300_000) {
      const f = await ghGet(item.path);
      if (f?.content) {
        fileStore[item.path] = Buffer.from(f.content, 'base64').toString('utf8');
        shaStore[item.path]  = f.sha;
      }
    }
  }
}

async function initStore() {
  if (!USE_GITHUB) return;
  console.log('  Loading vault from GitHub…');
  await loadDir('');
  console.log(`  Loaded ${Object.keys(fileStore).length} files from ${GH_OWNER}/${GH_REPO}`);
}

// Debounced write: updates memory immediately, persists to GitHub after 600ms idle
function ghWrite(ghPath, content) {
  fileStore[ghPath] = content;
  clearTimeout(writeQueue[ghPath]);
  writeQueue[ghPath] = setTimeout(() => ghPut(ghPath, content).catch(console.error), 600);
}

// ── DUAL-MODE FILE HELPERS ────────────────────────────────────────────────────
function readWiki(rel) {
  if (USE_GITHUB) return fileStore[`wiki/${rel}`] || '';
  try { return fs.readFileSync(path.join(WIKI, rel), 'utf8'); } catch { return ''; }
}

function writeWiki(rel, content) {
  if (USE_GITHUB) {
    ghWrite(`wiki/${rel}`, content);
  } else {
    const full = path.join(WIKI, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
}

function readVault(rel) {
  if (USE_GITHUB) return fileStore[rel] || '';
  try { return fs.readFileSync(path.join(VAULT, rel), 'utf8'); } catch { return ''; }
}

function writeVault(rel, content) {
  if (USE_GITHUB) {
    ghWrite(rel, content);
  } else {
    fs.writeFileSync(path.join(VAULT, rel), content, 'utf8');
  }
}

// ── API KEY ───────────────────────────────────────────────────────────────────
function getApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const cfgRaw = readVault('config.json');
  if (cfgRaw) { try { return JSON.parse(cfgRaw).api_key || null; } catch {} }
  if (!USE_GITHUB) {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    if (fs.existsSync(credPath)) {
      try {
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        return creds?.claudeAiOauth?.accessToken || null;
      } catch {}
    }
  }
  return null;
}

function makeClient(key) {
  if (key?.startsWith('sk-ant-oat')) return new Anthropic({ authToken: key });
  return new Anthropic({ apiKey: key });
}

// ── PUSH NOTIFICATIONS (VAPID / Web Push) ─────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_CONTACT = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com';
const PUSH_ENABLED  = !!(VAPID_PUBLIC && VAPID_PRIVATE);
const REMINDER_LEAD_MIN = 30;

if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  console.log('  Push   : ⚠️  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push notifications disabled');
}

// ── SHARED APP DATA ───────────────────────────────────────────────────────────
const DEFAULT_SCHEDULE = [
  { time:'06:00', title:'Morning Routine',  kind:'routine'  },
  { time:'07:30', title:'Workout',           kind:'training' },
  { time:'09:00', title:'Deep Work Block',   kind:'focus'    },
  { time:'12:00', title:'Lunch Break',       kind:'errand'   },
  { time:'13:00', title:'Study / Read',      kind:'focus'    },
  { time:'16:00', title:'Review + Planning', kind:'focus'    },
  { time:'18:00', title:'Dinner',            kind:'routine'  },
  { time:'20:00', title:'Wind Down',         kind:'routine'  },
];

function getAppData() {
  const raw = USE_GITHUB
    ? fileStore['app-data.json']
    : (() => { try { return fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf8') : null; } catch { return null; } })();
  if (raw) { try { return JSON.parse(raw); } catch {} }
  return { schedule: DEFAULT_SCHEDULE, events: {}, tasks: {}, streakDays: [], timelineChecks: {}, pushSubscriptions: [], notifiedEvents: {} };
}

function saveAppData(data) {
  const content = JSON.stringify(data, null, 2);
  if (USE_GITHUB) {
    ghWrite('app-data.json', content);
  } else {
    fs.writeFileSync(DATA_FILE, content, 'utf8');
  }
}

function recalcStreak(data, clientDate) {
  const checks   = data.timelineChecks || {};
  const schedLen = (data.schedule || []).length;
  const days     = new Set();
  for (const [date, checks_] of Object.entries(checks)) {
    const checked = Object.values(checks_).filter(Boolean).length;
    if (schedLen > 0 && checked / schedLen >= 0.75) days.add(date);
  }
  data.streakDays = [...days].sort();
  let streak = 0, cur = clientDate || today();
  while (days.has(cur)) {
    streak++;
    const dt = new Date(cur + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - 1);
    cur = dt.toISOString().split('T')[0];
  }
  data.currentStreak = streak;
  return streak;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function today()   { return new Date().toISOString().split('T')[0]; }
function nowStamp() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
}

// ── CLAUDE CONTEXT BUILDER ────────────────────────────────────────────────────
function buildSystemPrompt(userMessage) {
  const claudeMd   = readVault('CLAUDE.md');
  const indexMd    = readWiki('index.md');
  const overviewMd = readWiki('overview.md');
  const taskPage   = readWiki(`analyses/daily-tasks-${today()}.md`);
  const schedPage  = readWiki('analyses/mission-schedule.md');

  const words = (userMessage || '').toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const extra = [];
  for (const line of indexMd.split('\n')) {
    const m = line.match(/\[\[([^\]]+)\]\]/);
    if (!m) continue;
    const slug = m[1];
    if (words.some(w => slug.toLowerCase().includes(w) || line.toLowerCase().includes(w))) {
      for (const sub of ['concepts', 'entities', 'sources', 'analyses']) {
        const content = readWiki(`${sub}/${slug}.md`);
        if (content) { extra.push(content); break; }
      }
    }
  }

  const parts = [
    '# BRAINVAULT SCHEMA (CLAUDE.md)\n' + claudeMd,
    '# WIKI INDEX\n' + indexMd,
    '# OVERVIEW\n' + overviewMd,
  ];
  if (taskPage)     parts.push("# TODAY'S TASKS\n" + taskPage);
  if (schedPage)    parts.push('# MISSION SCHEDULE\n' + schedPage);
  if (extra.length) parts.push('# RELEVANT WIKI PAGES\n' + extra.slice(0,4).join('\n\n---\n\n'));
  return parts.join('\n\n═══════════════════════════════\n\n');
}

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(VAULT, 'mission-control.html')));

app.get('/api/status', (req, res) => {
  res.json({ ok: true, hasKey: !!getApiKey(), mode: USE_GITHUB ? 'cloud' : 'local', date: today() });
});

app.post('/api/set-key', (req, res) => {
  if (USE_GITHUB)
    return res.status(400).json({ error: 'In cloud mode set ANTHROPIC_API_KEY as a Render environment variable.' });
  const { key } = req.body;
  if (!key || !key.startsWith('sk-ant-'))
    return res.status(400).json({ error: 'Invalid API key format' });
  writeVault('config.json', JSON.stringify({ api_key: key }, null, 2));
  res.json({ ok: true });
});

app.get('/api/data', (req, res) => {
  const data = getAppData();
  recalcStreak(data);
  res.json(data);
});

app.post('/api/data', (req, res) => {
  try {
    const data  = getAppData();
    const patch = req.body;
    if (patch.schedule       !== undefined) data.schedule       = patch.schedule;
    if (patch.events         !== undefined) data.events         = patch.events;
    if (patch.tasks          !== undefined) data.tasks          = patch.tasks;
    if (patch.timelineChecks !== undefined) data.timelineChecks = patch.timelineChecks;
    if (patch.theme          !== undefined) data.theme          = patch.theme;
    if (patch.taskStats      !== undefined) data.taskStats      = patch.taskStats;
    if (patch.budget         !== undefined) data.budget         = patch.budget;
    if (patch.questXp        !== undefined) data.questXp        = patch.questXp;
    if (patch.caughtPoke     !== undefined) data.caughtPoke     = patch.caughtPoke;
    if (patch.savings        !== undefined) data.savings        = patch.savings;
    const date = req.body._date || today();
    recalcStreak(data, date);
    saveAppData(data);
    if (patch.tasks && Array.isArray(patch.tasks)) syncTasks(patch.tasks, date);
    if (patch.events   !== undefined) syncEvents(data.events);
    if (patch.schedule !== undefined) syncSchedule(data.schedule);
    res.json({ ok: true, currentStreak: data.currentStreak, streakDays: data.streakDays });
  } catch (err) {
    console.error('Data patch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const key = getApiKey();
  if (!key) return res.status(401).json({ error: 'NO_KEY', message: 'No API key found.' });
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'Empty message' });
  const anthropic = makeClient(key);
  try {
    const resp = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     buildSystemPrompt(message),
      messages:   [...history.map(m => ({ role: m.role, content: m.content })),
                   { role: 'user', content: message }],
    });
    const responseText = resp.content[0].text;
    saveConversation(message, responseText);
    res.json({ response: responseText, tokens: resp.usage });
  } catch (err) {
    console.error('Claude API error:', err.status, err.message);
    const msg = String(err.message || '');
    const isRateLimit  = err.status === 429 || msg.includes('rate_limit');
    const isAuth       = err.status === 401 || msg.includes('authentication');
    const isTooLong     = err.status === 400 && (msg.includes('too long') || msg.includes('maximum context') || msg.includes('token'));
    const isOverloaded = err.status === 529 || err.status === 503 || msg.includes('overloaded');
    const isNetwork    = !err.status;

    if (isRateLimit) {
      return res.status(429).json({
        error: 'RATE_LIMIT',
        message: 'Rate limit reached on the shared OAuth token. Go to ⚙ Settings → API Key and paste a key from console.anthropic.com for unlimited access.',
      });
    }
    if (isAuth) {
      return res.status(401).json({
        error: 'AUTH_ERROR',
        message: 'Authentication failed. Your API key may be expired. Set a new one in ⚙ Settings.',
      });
    }
    if (isTooLong) {
      return res.status(400).json({
        error: 'TOO_LONG',
        message: 'Your question plus the wiki context ED pulled in was too large for one request. Try a shorter question, or ask about one specific page instead of a broad topic.',
      });
    }
    if (isOverloaded) {
      return res.status(503).json({
        error: 'OVERLOADED',
        message: "Claude's servers are overloaded right now — wait a minute and try again.",
      });
    }
    if (isNetwork) {
      return res.status(502).json({
        error: 'NETWORK',
        message: 'Could not reach the Claude API — check the server has internet access and try again.',
      });
    }
    res.status(500).json({
      error: 'UNKNOWN',
      message: `Something went wrong (${err.status || 'no status'}): ${msg || 'unknown error'}`,
    });
  }
});

app.post('/api/sync', (req, res) => {
  try {
    const { type, data, date } = req.body;
    if      (type === 'tasks')    syncTasks(data, date || today());
    else if (type === 'events')   syncEvents(data);
    else if (type === 'schedule') syncSchedule(data);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUSH ROUTES ───────────────────────────────────────────────────────────────
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC, enabled: PUSH_ENABLED });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const data = getAppData();
  data.pushSubscriptions = data.pushSubscriptions || [];
  if (!data.pushSubscriptions.some(s => s.endpoint === sub.endpoint)) {
    data.pushSubscriptions.push(sub);
    saveAppData(data);
  }
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  const data = getAppData();
  data.pushSubscriptions = (data.pushSubscriptions || []).filter(s => s.endpoint !== endpoint);
  saveAppData(data);
  res.json({ ok: true });
});

// ── WIKI BROWSE ROUTES ─────────────────────────────────────────────────────────
function parseWikiIndex() {
  const idx = readWiki('index.md');
  const categoryDirs = {
    'Overview & Navigation': 'root', 'Sources': 'sources', 'Concepts': 'concepts', 'Entities': 'entities',
    'Projects & Tools': 'entities', 'Properties': 'entities', 'Analyses': 'analyses',
  };
  const pages = [];
  let currentCategory = null;
  for (const line of idx.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) { currentCategory = h[1].trim(); continue; }
    const m = line.match(/^-\s*\[\[([^\]]+)\]\]\s*—\s*(.*)$/);
    if (m && currentCategory) {
      pages.push({
        slug: m[1],
        summary: m[2].trim(),
        category: currentCategory,
        dir: categoryDirs[currentCategory] || 'analyses',
      });
    }
  }
  return pages;
}

app.get('/api/wiki/list', (req, res) => {
  try { res.json({ pages: parseWikiIndex() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/wiki/page/:dir/:slug', (req, res) => {
  const { dir, slug } = req.params;
  if (!/^[a-z]+$/.test(dir) || !/^[a-z0-9-]+$/i.test(slug))
    return res.status(400).json({ error: 'Invalid path' });
  const content = readWiki(dir === 'root' ? `${slug}.md` : `${dir}/${slug}.md`);
  if (!content) return res.status(404).json({ error: 'Page not found' });
  res.json({ content });
});

// ── WIKI WRITERS ──────────────────────────────────────────────────────────────
function syncTasks(tasks, date) {
  if (!Array.isArray(tasks)) return;
  const done = tasks.filter(t => t.done).length;
  const rows = tasks.map(t =>
    `| ${t.rank||'B'} | ${t.text} | ${t.done ? '✅ Done' : '⬜ Pending'} | ${t.rank==='S'?'Permanent':'Daily'} |`
  ).join('\n');
  writeWiki(`analyses/daily-tasks-${date}.md`, `---
type: analysis
title: "Daily Tasks — ${date}"
date: "${date}"
tags: [tasks, daily-log]
---

## Quest Log — ${date}

| Rank | Task | Status |
|------|------|--------|
${rows || '| — | No tasks | — |'}

**Completion:** ${done}/${tasks.length}${tasks.length ? ` (${Math.round(done/tasks.length*100)}%)` : ''}

_Last synced: ${new Date().toLocaleString()}_
`);
  appendLog('sync', `Tasks synced for ${date}: ${done}/${tasks.length} complete`,
    [`[[daily-tasks-${date}]]`], []);
  updateIndex();
}

function syncEvents(events) {
  if (typeof events !== 'object') return;
  const entries = Object.entries(events).sort(([a],[b]) => a.localeCompare(b))
    .flatMap(([date, evs]) =>
      evs.map(e => `| ${date} | ${e.time||'—'} | ${e.title} | ${e.kind||'focus'} | ${e.location||''} |`)
    ).join('\n');
  writeWiki('analyses/calendar-events.md', `---
type: analysis
title: "Calendar Events"
last_updated: "${today()}"
tags: [calendar, events]
---

## All Scheduled Events

| Date | Time | Title | Kind | Location |
|------|------|-------|------|----------|
${entries || '| — | — | No events | — | — |'}

_Last synced: ${new Date().toLocaleString()}_
`);
  appendLog('sync', 'Calendar events synced', ['[[calendar-events]]'], []);
  updateIndex();
}

function syncSchedule(items) {
  if (!Array.isArray(items)) return;
  const rows = items.slice().sort((a,b) => a.time.localeCompare(b.time))
    .map(s => `| ${s.time} | ${s.title} | ${s.kind||'focus'} |`).join('\n');
  writeWiki('analyses/mission-schedule.md', `---
type: analysis
title: "Mission Schedule"
last_updated: "${today()}"
tags: [schedule, routine]
---

## Daily Mission Schedule

| Time | Mission | Kind |
|------|---------|------|
${rows || '| — | No missions | — |'}

_Last synced: ${new Date().toLocaleString()}_
`);
  appendLog('sync', `Schedule synced (${items.length} missions)`, ['[[mission-schedule]]'], []);
  updateIndex();
}

function saveConversation(userMsg, claudeMsg) {
  const date    = today();
  const time    = nowStamp();
  const relPath = `analyses/chat-${date}.md`;
  let existing  = readWiki(relPath).trimEnd() ||
    `---\ntype: analysis\ntitle: "Chat Log — ${date}"\ndate: "${date}"\ntags: [chat, conversation]\n---`;
  writeWiki(relPath, existing + `\n\n## [${time}] You\n${userMsg}\n\n## [${time}] Claude\n${claudeMsg}\n`);
  appendLog('query', `Chat session on ${date}`, [`[[chat-${date}]]`], []);
  updateIndex();
}

function appendLog(operation, narrative, created=[], updated=[]) {
  let log = readWiki('log.md');
  const recent = log.split('## [').slice(-5).join('## [');
  if (recent.includes(narrative.slice(0,40))) return;
  log += `\n## [${today()}] ${operation} | Mission Control Sync\n\n**Operation:** ${operation}\n${created.length?`**Pages created:** ${created.join(', ')}\n`:''}${updated.length?`**Pages updated:** ${updated.join(', ')}\n`:''}\n${narrative}\n`;
  writeWiki('log.md', log);
}

function updateIndex() {
  let idx = readWiki('index.md');
  if (!idx) return;
  const analyses = [
    { slug:`daily-tasks-${today()}`, summary:`Quest log for ${today()}` },
    { slug:'calendar-events',        summary:'All synced calendar events from Mission Control' },
    { slug:'mission-schedule',       summary:'Daily mission timeline from Mission Control' },
    { slug:`chat-${today()}`,        summary:`Claude conversation log for ${today()}` },
  ];
  let changed = false;
  for (const { slug, summary } of analyses) {
    const exists = USE_GITHUB
      ? !!fileStore[`wiki/analyses/${slug}.md`]
      : fs.existsSync(path.join(WIKI, 'analyses', `${slug}.md`));
    if (!exists || idx.includes(`[[${slug}]]`)) continue;
    const entry = `- [[${slug}]] — ${summary}\n`;
    idx = idx.includes('## Analyses')
      ? idx.replace('## Analyses\n', '## Analyses\n' + entry)
      : idx + '\n## Analyses\n' + entry;
    changed = true;
  }
  if (changed) writeWiki('index.md', idx);
}

// ── REMINDER PUSH CHECK ────────────────────────────────────────────────────────
async function checkReminders() {
  if (!PUSH_ENABLED) return;
  const data = getAppData();
  const subs = data.pushSubscriptions || [];
  if (!subs.length) return;
  data.notifiedEvents = data.notifiedEvents || {};

  const now = new Date();
  let changed = false;
  for (const [date, evs] of Object.entries(data.events || {})) {
    for (const ev of evs) {
      if (!ev.time) continue;
      const evDt = new Date(`${date}T${ev.time}:00`);
      const diffMin = (evDt - now) / 60000;
      const key = `${date}|${ev.time}|${ev.title}`;
      if (diffMin <= 0 || diffMin > REMINDER_LEAD_MIN || data.notifiedEvents[key]) continue;
      data.notifiedEvents[key] = true;
      changed = true;
      const payload = JSON.stringify({
        title: `📅 ${ev.title}`,
        body:  `${ev.time}${ev.location ? ' · ' + ev.location : ''} — starting in ${Math.max(1, Math.round(diffMin))} min`,
      });
      for (const sub of subs) {
        webpush.sendNotification(sub, payload).catch(err => {
          if (err.statusCode === 404 || err.statusCode === 410) {
            data.pushSubscriptions = data.pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
            saveAppData(data);
          } else {
            console.error('Push send error:', err.message);
          }
        });
      }
    }
  }

  // Prune notified-event records older than 2 days so the map doesn't grow forever
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 2);
  for (const key of Object.keys(data.notifiedEvents)) {
    const dateStr = key.split('|')[0];
    if (new Date(dateStr + 'T00:00:00') < cutoff) { delete data.notifiedEvents[key]; changed = true; }
  }

  if (changed) saveAppData(data);
}

// ── START ─────────────────────────────────────────────────────────────────────
async function main() {
  await initStore();

  app.listen(PORT, '0.0.0.0', () => {
    const key  = getApiKey();
    const nets = os.networkInterfaces();
    const lan  = Object.values(nets).flat().find(n => n.family==='IPv4' && !n.internal);
    console.log('\n  ████████████████████████████████████');
    console.log('  █  BRAINVAULT MISSION CONTROL v3.1  █');
    console.log('  ████████████████████████████████████\n');
    console.log(`  Mode   : ${USE_GITHUB ? '☁️  Cloud (GitHub)' : '💻 Local'}`);
    console.log(`  URL    : http://localhost:${PORT}`);
    if (lan) console.log(`  Phone  : http://${lan.address}:${PORT}  (same WiFi)`);
    console.log(`  API key: ${key ? '✅ loaded' : '❌ missing'}`);
    console.log(`  Push   : ${PUSH_ENABLED ? '✅ enabled' : '❌ disabled (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)'}\n`);
  });

  if (PUSH_ENABLED) {
    checkReminders().catch(console.error);
    setInterval(() => checkReminders().catch(console.error), 5 * 60 * 1000);
  }
}

main().catch(console.error);
