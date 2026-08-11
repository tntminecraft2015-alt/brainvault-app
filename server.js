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
    const full = path.join(VAULT, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
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
  return { schedule: DEFAULT_SCHEDULE, events: {}, tasks: {}, streakDays: [], timelineChecks: {}, pushSubscriptions: [], notifiedEvents: {}, designResearch: [], lastDesignResearchAutoRun: null, changeRequests: [] };
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

  const persona = `You are ED, the chat assistant embedded in BrainVault Mission Control — a personal ops dashboard the user runs from their phone and desktop. You have three jobs: (1) answer questions about the user's vault, tasks, schedule, and calendar using the context below, (2) act as a general-purpose virtual assistant — you have live web search, so use it whenever a question needs current information, facts outside the vault, or anything you're not certain about, and (3) take requests to change Mission Control itself (the app's UI/behavior). Don't mention that you "searched the web" unless it's relevant; just answer naturally and cite sources when it matters. Be concise — this is a chat window, not an essay. You are a separate persona from Red, who only runs design research for the app itself.

For job (3): you cannot edit code yourself. When the user clearly asks for a change to Mission Control (new feature, tweak, fix, visual change, etc.), call the queue_code_change tool with a precise, implementation-ready spec instead of trying to describe how you'd do it in prose. This queues the request to a file that the user's Claude Code session will read and implement later. After calling it, confirm briefly to the user that it's queued — don't restate the whole spec back to them. Only call this tool for actual Mission Control app changes, never for wiki/vault content changes (those go through the normal ingest workflow) and never speculatively.`;

  const parts = [
    persona,
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

const QUEUE_CHANGE_TOOL = {
  name: 'queue_code_change',
  description: 'Queue a requested change to Mission Control (the web app itself) for the user\'s Claude Code session to implement and push later. Use ONLY when the user explicitly asks to change, add, fix, or tweak something about how Mission Control looks or behaves — never for wiki/vault content. Write a clear, implementation-ready spec: assume the engineer reading it has the codebase open but no memory of this conversation.',
  input_schema: {
    type: 'object',
    properties: {
      title:       { type: 'string', description: 'Short title, e.g. "Make accent color blue"' },
      description: { type: 'string', description: 'One paragraph: what the user asked for and why, in plain language, close to their own words.' },
      details:     { type: 'string', description: 'Specific, implementation-ready instructions: what to change, where if known (feature/screen names), and any exact values (colors, text, behavior) the user specified. Markdown ok.' },
    },
    required: ['title', 'description', 'details'],
  },
};

function queueCodeChange({ title, description, details, source = 'ED chat' }) {
  const date  = today();
  const safeTitle = String(title || 'Untitled change').slice(0, 120);
  const id    = `${date}-${slugifyTopic(safeTitle) || 'change'}`;
  writeVault(`change-requests/${id}.md`, `---
status: pending
title: "${safeTitle.replace(/"/g, '\\"')}"
date: "${date}"
requested_via: "${source}"
---

## What the user asked for

${description || ''}

## Implementation notes

${details || ''}
`);
  const data = getAppData();
  data.changeRequests = data.changeRequests || [];
  data.changeRequests.unshift({ id, date, title: safeTitle, status: 'pending', source });
  data.changeRequests = data.changeRequests.slice(0, 50);
  saveAppData(data);
  appendLog('note', `Mission Control change requested via ${source}: ${safeTitle}`, [], []);
  return { id, title: safeTitle };
}

async function runChatTurn(anthropic, system, tools, messages, maxRounds = 4) {
  let finalText = '';
  let usage = null;
  let queuedChange = null;
  for (let round = 0; round < maxRounds; round++) {
    const resp = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system,
      tools,
      messages,
    });
    usage = resp.usage;
    const textBlocks = stripCiteTags(resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n\n'));
    if (textBlocks) finalText = textBlocks;

    const clientToolUses = resp.content.filter(b => b.type === 'tool_use' && b.name === 'queue_code_change');
    if (resp.stop_reason !== 'tool_use' || !clientToolUses.length) break;

    messages.push({ role: 'assistant', content: resp.content });
    const toolResults = clientToolUses.map(tu => {
      const result = queueCodeChange(tu.input || {});
      queuedChange = result;
      return {
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify({ ok: true, id: result.id, message: `Queued as change-requests/${result.id}.md — Claude Code will pick this up next session.` }),
      };
    });
    messages.push({ role: 'user', content: toolResults });
  }
  return { text: finalText || '(no response text)', usage, queuedChange };
}

app.post('/api/chat', async (req, res) => {
  const key = getApiKey();
  if (!key) return res.status(401).json({ error: 'NO_KEY', message: 'No API key found.' });
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'Empty message' });
  const anthropic = makeClient(key);
  try {
    const messages = [...history.map(m => ({ role: m.role, content: m.content })),
                       { role: 'user', content: message }];
    const tools = [
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
      QUEUE_CHANGE_TOOL,
    ];
    const { text: responseText, usage, queuedChange } = await runChatTurn(anthropic, buildSystemPrompt(message), tools, messages);
    saveConversation(message, responseText);
    res.json({ response: responseText, tokens: usage, queuedChange: queuedChange ? { id: queuedChange.id, title: queuedChange.title } : null });
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

// ── DESIGN RESEARCH LAB ───────────────────────────────────────────────────────
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function stripCiteTags(s) { return String(s == null ? '' : s).replace(/<\/?cite[^>]*>/gi, ''); }
function escAttr(s) { return escHtml(s).replace(/"/g,'&quot;'); }
function slugifyTopic(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
}

async function runDesignResearch(topic) {
  const key = getApiKey();
  if (!key) throw Object.assign(new Error('No API key configured'), { code: 'NO_KEY' });
  const anthropic = makeClient(key);
  const mcPage = readWiki('entities/mission-control.md');
  const focus  = (topic || '').trim();

  const system = `You are Red, the design research agent embedded in BrainVault Mission Control — a personal ops dashboard with a dark cyan "Hub C" JRPG battle-menu aesthetic (hard-shadow bento cards, Press Start 2P + VT323 fonts, rank badges, XP pop animations, mobile 5-tab nav). You are a separate persona from ED, the chat assistant elsewhere in the app: ED answers questions about the vault, Red's only job is running design research and reporting back findings. Its current design is documented below.

# CURRENT MISSION CONTROL DESIGN
${mcPage || '(no design doc on file)'}

Use web search to find current, real UI/UX patterns and trends relevant to${focus ? ` "${focus}" in` : ''} personal dashboards, habit trackers, gamified productivity apps, and bento-grid/neumorphic design systems. Prioritize ideas that would make Mission Control more fun, easier to use, and better-looking WITHOUT abandoning its existing JRPG identity. Be economical with searches — a few well-chosen queries beat many broad ones.

Respond with ONLY a fenced \`\`\`json code block (no other prose before or after) matching this exact schema:
{
  "title": "short title for this research run",
  "summary": "2-3 sentence overview of what you found",
  "findings": [
    {
      "title": "short name of the pattern/idea",
      "description": "2-3 sentences: what it is, why it fits Mission Control, how it could be applied",
      "source_title": "name of the site/app it's drawn from",
      "source_url": "https://...",
      "mockup_html": "a small self-contained HTML snippet (inline <style> ok, no external assets, no <script>) illustrating the idea applied to Mission Control's own palette using these hardcoded hex values: bg #0a1929, surface #12253c, darker #1e3a5f, fg #dfeeff, accent #ff8a63, green #7fffb0. Keep it under ~25 lines and visually representative, not just a text description."
    }
  ]
}
Produce exactly 3 findings. Keep everything concise — this is a budget-conscious run.`;

  const resp = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    system,
    tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages:   [{ role: 'user', content: focus ? `Research focus: ${focus}` : 'Research general improvements.' }],
  });

  const textBlocks = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const match = textBlocks.match(/```json\s*([\s\S]*?)```/) || textBlocks.match(/(\{[\s\S]*\})/);
  if (!match) throw new Error('Could not parse research output from ED');
  const parsed = JSON.parse(match[1]);
  if (!Array.isArray(parsed.findings)) throw new Error('Research output missing findings array');
  parsed.title   = stripCiteTags(parsed.title);
  parsed.summary = stripCiteTags(parsed.summary);
  parsed.findings.forEach(f => {
    f.title       = stripCiteTags(f.title);
    f.description = stripCiteTags(f.description);
  });
  return parsed;
}

function buildSlideshowHtml(topic, result) {
  const slides = [
    {
      kicker: 'DESIGN RESEARCH · BY RED',
      title:  result.title || 'Design Research',
      body:   `<p style="font-size:18px;line-height:1.6;">${escHtml(result.summary || '')}</p>
               <p style="opacity:.55;font-size:13px;margin-top:22px;font-family:monospace;">${result.findings.length} findings${topic ? ' · focus: ' + escHtml(topic) : ''}</p>`,
    },
    ...result.findings.map((f, i) => ({
      kicker: `FINDING ${i + 1} / ${result.findings.length}`,
      title:  f.title || `Finding ${i + 1}`,
      body:   `<p style="font-size:15px;line-height:1.6;margin-bottom:14px;">${escHtml(f.description || '')}</p>
               ${f.source_url ? `<p style="font-size:12px;opacity:.6;margin-bottom:16px;">Source: <a href="${escAttr(f.source_url)}" target="_blank" rel="noopener" style="color:#ff8a63;">${escHtml(f.source_title || f.source_url)}</a></p>` : ''}
               <div class="mockup-frame"><iframe class="mockup-iframe" sandbox="allow-same-origin" srcdoc="${escAttr(f.mockup_html || '<p style=\'color:#888;font-family:sans-serif;padding:20px;\'>No mockup generated</p>')}"></iframe></div>
               <button class="queue-design-btn" onclick="queueDesign(${i}, this)">+ QUEUE THIS DESIGN</button>`,
    })),
  ];

  const slidesHtml = slides.map((s, i) => `
    <section class="slide${i === 0 ? ' active' : ''}" data-i="${i}">
      <div class="slide-kicker">${escHtml(s.kicker)}</div>
      <h1>${escHtml(s.title)}</h1>
      <div class="slide-body">${s.body}</div>
    </section>`).join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escHtml(result.title || 'Design Research')}</title>
<style>
  :root{ --bg:#0a1929;--surface:#12253c;--darker:#1e3a5f;--fg:#dfeeff;--accent:#ff8a63; }
  *{box-sizing:border-box;}
  html,body{margin:0;height:100%;}
  body{background:var(--bg);color:var(--fg);font-family:Georgia,serif;display:flex;flex-direction:column;overflow:hidden;}
  .slides{flex:1;position:relative;overflow:hidden;}
  .slide{position:absolute;inset:0;padding:36px 48px;display:flex;flex-direction:column;justify-content:center;opacity:0;transform:translateX(24px);transition:opacity .25s,transform .25s;pointer-events:none;overflow-y:auto;}
  .slide.active{opacity:1;transform:translateX(0);pointer-events:auto;}
  .slide-kicker{font-size:11px;letter-spacing:3px;color:var(--accent);opacity:.85;margin-bottom:10px;font-family:monospace;}
  .slide h1{margin:0 0 18px;font-size:28px;}
  .slide-body{max-width:760px;}
  .mockup-frame{border:1px solid rgba(223,238,255,.15);border-radius:10px;overflow:hidden;background:#fff;height:200px;}
  .mockup-iframe{width:100%;height:100%;border:none;}
  .nav{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid rgba(223,238,255,.1);background:var(--surface);flex-shrink:0;}
  .nav button{background:var(--darker);color:var(--fg);border:1px solid rgba(223,238,255,.15);border-radius:8px;padding:8px 16px;cursor:pointer;font-family:monospace;font-size:12px;}
  .nav button:hover:not(:disabled){border-color:var(--accent);color:var(--accent);}
  .nav button:disabled{opacity:.3;cursor:default;}
  .dots{display:flex;gap:6px;}
  .dot{width:7px;height:7px;border-radius:50%;background:rgba(223,238,255,.2);}
  .dot.active{background:var(--accent);}
  .queue-design-btn{margin-top:14px;background:var(--accent);color:#0a1929;border:none;border-radius:8px;padding:11px 18px;cursor:pointer;font-family:monospace;font-weight:bold;font-size:13px;letter-spacing:.5px;}
  .queue-design-btn:hover:not(:disabled){filter:brightness(1.08);}
  .queue-design-btn:disabled{background:rgba(223,238,255,.15);color:var(--fg);opacity:.7;cursor:default;}
  .queue-design-btn.failed{background:rgba(255,64,64,.25);color:#ffb3b3;}
  @media (max-width:600px){
    .slide{padding:20px 18px 16px;}
    .slide h1{font-size:21px;margin-bottom:12px;}
    .slide-kicker{font-size:10px;letter-spacing:2px;}
    .slide-body{max-width:100%;font-size:15px;}
    .slide-body p{font-size:15px !important;}
    .mockup-frame{height:36vh;min-height:140px;}
    .nav{padding:12px 14px;padding-bottom:calc(12px + env(safe-area-inset-bottom));}
    .nav button{padding:13px 20px;font-size:14px;min-width:84px;}
    .queue-design-btn{width:100%;padding:14px;font-size:14px;}
  }
</style></head>
<body>
  <div class="slides" id="slides">${slidesHtml}</div>
  <div class="nav">
    <button id="prevBtn" onclick="go(-1)">◀ PREV</button>
    <div class="dots" id="dots"></div>
    <button id="nextBtn" onclick="go(1)">NEXT ▶</button>
  </div>
<script>
  const FINDINGS = ${JSON.stringify(result.findings.map(f => ({
    title: f.title || '', description: f.description || '',
    source_title: f.source_title || '', source_url: f.source_url || '',
  })))};
  async function queueDesign(i, btn) {
    const f = FINDINGS[i]; if (!f) return;
    btn.disabled = true;
    btn.classList.remove('failed');
    btn.textContent = 'QUEUING…';
    try {
      const r = await fetch('/api/change-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: f.title, description: f.description,
          source_title: f.source_title, source_url: f.source_url,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.message || d.error || 'failed');
      btn.textContent = '✓ QUEUED FOR CLAUDE CODE';
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'mc-queue-change', title: f.title }, window.location.origin);
      }
    } catch (e) {
      btn.textContent = '⚠ FAILED — TAP TO RETRY';
      btn.classList.add('failed');
      btn.disabled = false;
    }
  }
  const total = ${slides.length};
  let cur = 0;
  const dotsEl = document.getElementById('dots');
  for (let i = 0; i < total; i++) { const d = document.createElement('div'); d.className = 'dot' + (i === 0 ? ' active' : ''); dotsEl.appendChild(d); }
  function render() {
    document.querySelectorAll('.slide').forEach((el, i) => el.classList.toggle('active', i === cur));
    document.querySelectorAll('.dot').forEach((el, i) => el.classList.toggle('active', i === cur));
    document.getElementById('prevBtn').disabled = cur === 0;
    document.getElementById('nextBtn').disabled = cur === total - 1;
  }
  function go(d) { cur = Math.max(0, Math.min(total - 1, cur + d)); render(); }
  document.addEventListener('keydown', e => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); });
  let touchX = null;
  document.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    touchX = null;
  }, { passive: true });
  render();
</script>
</body></html>`;
}

function saveDesignResearchWiki(id, date, topic, result) {
  const findingsMd = result.findings.map((f, i) =>
    `### ${i + 1}. ${f.title}\n\n${f.description || ''}\n\n${f.source_url ? `Source: [${f.source_title || f.source_url}](${f.source_url})` : ''}\n`
  ).join('\n');
  const title = (result.title || 'Design Research').replace(/"/g, '\\"');
  writeWiki(`analyses/${id}.md`, `---
type: analysis
title: "${title}"
date: "${date}"
tags: [design, ui-ux, mission-control${topic ? ', ' + slugifyTopic(topic) : ''}]
---

## Design Research${topic ? ` — focus: ${topic}` : ''}

${result.summary || ''}

${findingsMd}
_Researched by Red · slideshow: open the Design Lab in ED to view the interactive version._

_Generated: ${new Date().toLocaleString()}_
`);
  appendLog('note', `Design research: ${result.title || topic || 'general'} (${result.findings.length} findings)`, [`[[${id}]]`], []);
  let idx = readWiki('index.md');
  if (idx && !idx.includes(`[[${id}]]`)) {
    const entry = `- [[${id}]] — ${(result.summary || 'Design research run').slice(0, 140)}\n`;
    idx = idx.includes('## Analyses') ? idx.replace('## Analyses\n', '## Analyses\n' + entry) : idx + '\n## Analyses\n' + entry;
    writeWiki('index.md', idx);
  }
}

async function runAndSaveDesignResearch(topic, idSuffix) {
  const result = await runDesignResearch(topic);
  const date   = today();
  const id     = `${date}-design-research-${idSuffix || slugifyTopic(topic || result.title) || 'general'}`;
  const html   = buildSlideshowHtml(topic, result);
  writeVault(`design-research/${id}.html`, html);
  saveDesignResearchWiki(id, date, topic, result);
  const data = getAppData();
  data.designResearch = data.designResearch || [];
  data.designResearch.unshift({ id, date, topic: topic || '', title: result.title || 'Design Research', findingsCount: result.findings.length, auto: !!idSuffix });
  data.designResearch = data.designResearch.slice(0, 30);
  saveAppData(data);
  return { id, result };
}

async function maybeAutoRunDesignResearch() {
  if (!getApiKey()) return;
  if (new Date().getDay() !== 1) return; // Mondays only
  const data = getAppData();
  if (data.lastDesignResearchAutoRun === today()) return;
  try {
    const { id, result } = await runAndSaveDesignResearch('', 'weekly');
    const fresh = getAppData();
    fresh.lastDesignResearchAutoRun = today();
    saveAppData(fresh);
    if (PUSH_ENABLED) {
      const subs    = fresh.pushSubscriptions || [];
      const payload = JSON.stringify({
        title: "🎨 Red's weekly design research is ready",
        body:  `${result.title || 'New ideas for Mission Control'} — open ED to view.`,
      });
      for (const sub of subs) webpush.sendNotification(sub, payload).catch(() => {});
    }
    console.log('  Design Lab: weekly auto-research complete —', id);
  } catch (err) {
    console.error('Weekly design research failed:', err.message);
  }
}

app.post('/api/design-research', async (req, res) => {
  try {
    const topic = String(req.body?.topic || '').slice(0, 200);
    const { id, result } = await runAndSaveDesignResearch(topic, null);
    res.json({ ok: true, id, title: result.title, findingsCount: result.findings.length });
  } catch (err) {
    console.error('Design research error:', err.message);
    res.status(err.code === 'NO_KEY' ? 401 : 500).json({ error: err.code || 'RESEARCH_FAILED', message: err.message });
  }
});

app.get('/api/design-research', (req, res) => {
  const data = getAppData();
  res.json({ runs: data.designResearch || [] });
});

app.get('/api/change-requests', (req, res) => {
  const data = getAppData();
  res.json({ requests: data.changeRequests || [] });
});

// Queues a Design Lab finding directly — no LLM call, the finding text IS the spec.
app.post('/api/change-requests', (req, res) => {
  try {
    const { title, description, source_title, source_url } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Missing title' });
    const details = source_url
      ? `${description || ''}\n\nSource: [${source_title || source_url}](${source_url})`
      : (description || '');
    const result = queueCodeChange({
      title,
      description: 'Liked this Design Lab finding from Red and queued it for implementation.',
      details,
      source: 'Design Lab',
    });
    res.json({ ok: true, id: result.id, title: result.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/design-research/:id', (req, res) => {
  const { id } = req.params;
  if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).send('Invalid id');
  const html = readVault(`design-research/${id}.html`);
  if (!html) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

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
      if (!ev.time || !ev.notify || !ev.notifyLeadMin) continue;
      const evDt = new Date(`${date}T${ev.time}:00`);
      const diffMin = (evDt - now) / 60000;
      const key = `${date}|${ev.time}|${ev.title}`;
      if (diffMin <= 0 || diffMin > ev.notifyLeadMin || data.notifiedEvents[key]) continue;
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

  maybeAutoRunDesignResearch().catch(console.error);
  setInterval(() => maybeAutoRunDesignResearch().catch(console.error), 6 * 60 * 60 * 1000);
}

main().catch(console.error);
