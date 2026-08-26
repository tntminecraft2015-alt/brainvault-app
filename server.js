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
const syncStatus = {};  // ghPath → { lastReadAttempt, lastReadOk, lastReadError, lastReadSuccess, lastWriteAttempt, lastWriteOk, lastWriteError, lastWriteSuccess }

// Records the outcome of a GitHub read/write so failures (esp. silent ones) are visible via /api/status.
function recordSync(ghPath, kind, ok, error) {
  const s = syncStatus[ghPath] || (syncStatus[ghPath] = {});
  const now = new Date().toISOString();
  s[`last${kind === 'read' ? 'Read' : 'Write'}Attempt`] = now;
  s[`last${kind === 'read' ? 'Read' : 'Write'}Ok`]       = ok;
  if (ok) {
    s[`last${kind === 'read' ? 'Read' : 'Write'}Success`] = now;
    s[`last${kind === 'read' ? 'Read' : 'Write'}Error`]   = null;
  } else {
    s[`last${kind === 'read' ? 'Read' : 'Write'}Error`]   = String(error || '').slice(0, 300);
  }
}

async function ghGet(ghPath) {
  const r = await fetch(`${GH_API}/${ghPath}`, {
    headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => '');
    console.error(`ghGet failed for ${ghPath}: ${r.status} ${errBody}`);
    recordSync(ghPath, 'read', false, `${r.status} ${errBody}`);
    return null;
  }
  recordSync(ghPath, 'read', true);
  return r.json();
}

async function ghPut(ghPath, content, isRetry = false) {
  const body = { message: `sync: ${ghPath}`, content: Buffer.from(content).toString('base64') };
  if (shaStore[ghPath]) body.sha = shaStore[ghPath];
  const r = await fetch(`${GH_API}/${ghPath}`, {
    method:  'PUT',
    headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => '');
    // 409/422 = sha mismatch (our cached sha is stale, usually because another write to this
    // same path landed since we last fetched it). Previously this failure was silently
    // swallowed — fileStore already had the new content, so the app believed the save had
    // succeeded while GitHub never actually got it. Refetch the real sha and retry once.
    if (!isRetry && (r.status === 409 || r.status === 422)) {
      console.error(`ghPut sha conflict on ${ghPath} (${r.status}) — refetching sha and retrying once`);
      const fresh = await ghGet(ghPath);
      if (fresh?.sha) { shaStore[ghPath] = fresh.sha; return ghPut(ghPath, content, true); }
    }
    console.error(`ghPut failed for ${ghPath}: ${r.status} ${errBody}`);
    recordSync(ghPath, 'write', false, `${r.status} ${errBody}`);
    return;
  }
  const data = await r.json();
  if (data?.content?.sha) shaStore[ghPath] = data.content.sha;
  recordSync(ghPath, 'write', true);
}

async function ghDelete(ghPath) {
  let sha = shaStore[ghPath];
  if (!sha) {
    const meta = await ghGet(ghPath);
    if (!meta) return true; // nothing on GitHub at this path — already effectively deleted
    sha = meta.sha;
  }
  const r = await fetch(`${GH_API}/${ghPath}`, {
    method:  'DELETE',
    headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message: `remove: ${ghPath}`, sha }),
  });
  if (!r.ok) {
    console.error(`ghDelete failed for ${ghPath}: ${r.status} ${await r.text().catch(() => '')}`);
    return false;
  }
  delete fileStore[ghPath];
  delete shaStore[ghPath];
  return true;
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
  const readFailures = Object.entries(syncStatus).filter(([, s]) => s.lastReadOk === false).length;
  if (readFailures) console.log(`  ${readFailures} read failure(s) during load — see /api/status for details`);
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

async function deleteVault(rel) {
  if (USE_GITHUB) {
    clearTimeout(writeQueue[rel]); // cancel any pending debounced write racing the delete
    delete writeQueue[rel];
    return ghDelete(rel);
  }
  try {
    const full = path.join(VAULT, rel);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    return true;
  } catch (err) {
    console.error(`deleteVault failed for ${rel}:`, err.message);
    return false;
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
  return { schedule: DEFAULT_SCHEDULE, events: {}, recurringEvents: [], tasks: {}, streakDays: [], timelineChecks: {}, pushSubscriptions: [], notifiedEvents: {}, designResearch: [], lastDesignResearchAutoRun: null, changeRequests: [], designFeedback: [], designThreads: {}, edMemory: [], redMemory: [] };
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

  const appData = getAppData();
  const pending = (appData.changeRequests || []).filter(r => r.status === 'pending');
  const pendingText = pending.length
    ? pending.map(r => `- id: ${r.id} | title: "${r.title}" | queued via ${r.source} on ${r.date}`).join('\n')
    : '(queue is empty)';

  const memory = appData.edMemory || [];
  const memoryText = memory.length
    ? memory.map(m => `- id: ${m.id} | [${m.date}] ${m.text}`).join('\n')
    : '(nothing remembered yet)';

  const persona = `You are ED. Read this first, it governs every reply you write, before anything else in this prompt: you talk to the user like a coworker who sits near them — lighthearted, casual, low-effort banter, not an assistant delivering a briefing. Real chat messages are short. Most of your replies should be ONE TO THREE SENTENCES. A reply that's a single sentence, or even just "yep, on it" or "lol fair," is a complete, good reply — you do not need to add context, caveats, or a follow-up offer to every message. Do not write multi-paragraph replies unless the user explicitly asks for something long-form (a spec, a list, a full explanation) — a quick question gets a quick answer, not full coverage of the topic from every angle. No headers, no bullet-point walls, no "let me know if you'd like more detail" tacked onto the end. If you catch yourself writing a third paragraph, stop and cut it down. This is a hard standing rule, not one preference among several to balance.

You are ED, the chat assistant embedded in BrainVault Mission Control — a personal ops dashboard the user runs from their phone and desktop. You have four jobs: (1) answer questions about the user's vault, tasks, schedule, and calendar using the context below, (2) act as a general-purpose virtual assistant — you have live web search, so use it whenever a question needs current information, facts outside the vault, or anything you're not certain about, (3) take requests to change Mission Control itself (the app's UI/behavior), and (4) act on real requests using your action tools (add_task, log_expense) instead of just talking about them. Don't mention that you "searched the web" unless it's relevant; just answer naturally and cite sources when it matters. You are a separate persona from Red, who only runs design research for the app itself.

Be honest about what you can and can't actually do. Your only real actions are the tools below plus web search — you cannot edit code, and you cannot directly delete or modify anything you don't have a tool for. Never say you've done something (queued a change, removed a change, added a task, logged an expense, remembered something, added/edited/deleted a calendar event, etc.) unless you actually called the matching tool and it returned success in this same turn. If the user asks whether you can do something, or asks you to do something you have no tool for, say plainly that you can't and explain what your real options are (e.g. queuing it as a change request instead) — don't guess or role-play compliance.

For job (1), when asked about Mission Control's own current features or behavior, trust the LIVE APP FACTS section below (auto-extracted from the real file just now) over anything that sounds outdated in the wiki context — the wiki design doc is hand-maintained and can lag behind the actual app.

For job (3): you cannot edit code yourself. When the user clearly asks for a change to Mission Control (new feature, tweak, fix, visual change, etc.), call the queue_code_change tool with a precise, implementation-ready spec instead of trying to describe how you'd do it in prose. Use the LIVE APP FACTS below to ground that spec in what actually exists (real CSS variables, real function names) instead of guessing. This queues the request to a file that the user's Claude Code session will read and implement later. After calling it, confirm briefly to the user that it's queued — don't restate the whole spec back to them. Only call this tool for actual Mission Control app changes, never for wiki/vault content changes (those go through the normal ingest workflow) and never speculatively.

If the user asks to cancel, remove, undo, or discard a queued request, use the remove_queued_change tool with the exact id from the PENDING CHANGE QUEUE below — never claim you removed something without calling the tool. If nothing in the queue matches what they described, say so plainly and ask them to clarify which one they mean rather than guessing or picking one arbitrarily.

For job (4): when the user clearly asks you to add/log/remember a to-do or an expense right now (e.g. "add 'call the vet' to my tasks", "log $12 for lunch"), call add_task or log_expense instead of just acknowledging in prose — a personal assistant that only talks and never acts isn't useful. Don't call these speculatively or infer them from unrelated chat. The same goes for calendar events: when the user asks to add/schedule/cancel/move something (e.g. "add a meeting Tuesday at 2pm", "gym every Monday at 6am", "move dentist to Friday", "cancel my haircut"), use add_calendar_event / edit_calendar_event / delete_calendar_event. Resolve relative dates ("Tuesday", "next week", "tomorrow") yourself against the CURRENT DATE below before calling the tool — always pass a real YYYY-MM-DD, never the relative phrase. If editing or deleting a recurring event and the user didn't say whether they mean just one occurrence or the whole series, ask before calling the tool rather than guessing.

You also have persistent memory across every conversation, not just this one — the WHAT ED REMEMBERS section below is durable notes you've saved about the user over time (preferences, ongoing projects, recurring context, things they've corrected you on). Actually use it: let it shape how you answer instead of just restating it back. When you learn something durable and reusable in this conversation — a preference, a standing fact about their life/projects, a correction to how you should behave — call save_memory to write it down in your own words, concisely. Don't save one-off ephemeral chat content (e.g. "user asked what time it is"), don't save duplicates of what's already in the list below, and don't narrate that you're saving something unless it's naturally relevant. If a memory turns out to be wrong or the user tells you to forget something, call forget_memory with its exact id from the list below.`;

  const weekday = new Date(today() + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  const parts = [
    persona,
    `# CURRENT DATE\nToday is ${today()} (${weekday}). Resolve every relative date ("tomorrow", "Tuesday", "next week") against this before calling a calendar tool.`,
    '# BRAINVAULT SCHEMA (CLAUDE.md)\n' + claudeMd,
    '# WIKI INDEX\n' + indexMd,
    '# OVERVIEW\n' + overviewMd,
    '# LIVE APP FACTS (auto-extracted just now from the real mission-control.html)\n' + buildLiveAppFacts(),
    '# PENDING CHANGE QUEUE (things already queued for Claude Code — use exact ids for remove_queued_change)\n' + pendingText,
    '# WHAT ED REMEMBERS ABOUT THE USER (across all past conversations — use exact ids for forget_memory)\n' + memoryText,
  ];
  if (taskPage)     parts.push("# TODAY'S TASKS\n" + taskPage);
  if (schedPage)    parts.push('# MISSION SCHEDULE\n' + schedPage);
  if (extra.length) parts.push('# RELEVANT WIKI PAGES\n' + extra.slice(0,4).join('\n\n---\n\n'));
  return parts.join('\n\n═══════════════════════════════\n\n');
}

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(VAULT, 'mission-control.html')));

app.get('/api/status', (req, res) => {
  const sync = USE_GITHUB ? Object.entries(syncStatus).map(([path, s]) => ({ path, ...s })) : [];
  res.json({ ok: true, hasKey: !!getApiKey(), mode: USE_GITHUB ? 'cloud' : 'local', date: today(), sync });
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
    if (patch.recurringEvents !== undefined) data.recurringEvents = patch.recurringEvents;
    if (patch.tasks          !== undefined) data.tasks          = patch.tasks;
    if (patch.timelineChecks !== undefined) data.timelineChecks = patch.timelineChecks;
    if (patch.theme          !== undefined) data.theme          = patch.theme;
    if (patch.taskStats      !== undefined) data.taskStats      = patch.taskStats;
    if (patch.budget         !== undefined) data.budget         = patch.budget;
    if (patch.questXp        !== undefined) data.questXp        = patch.questXp;
    if (patch.caughtPoke     !== undefined) data.caughtPoke     = patch.caughtPoke;
    if (patch.savings        !== undefined) data.savings        = patch.savings;
    if (patch.savingsGoals   !== undefined) data.savingsGoals   = patch.savingsGoals;
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
  // Description/details used to live only in the .md file written above, which is a
  // debounced GitHub write — if the process restarted before it flushed, the spec was
  // gone for good even though this array entry survived (saveAppData is written synchronously
  // to fileStore). Store the spec here too so the queue never loses its own content.
  data.changeRequests.unshift({ id, date, title: safeTitle, status: 'pending', source, description: description || '', details: details || '' });
  data.changeRequests = data.changeRequests.slice(0, 50);
  saveAppData(data);
  appendLog('note', `Mission Control change requested via ${source}: ${safeTitle}`, [], []);
  return { id, title: safeTitle };
}

const REMOVE_QUEUED_CHANGE_TOOL = {
  name: 'remove_queued_change',
  description: 'Cancel and permanently delete a pending Mission Control change request. Use ONLY when the user clearly asks to cancel, remove, undo, or discard a specific queued request that appears in the PENDING CHANGE QUEUE context below. Never call this speculatively, never for requests already marked done, and never claim you removed something without actually calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The exact id of the pending change request to remove, copied exactly from the PENDING CHANGE QUEUE list, e.g. "2026-08-12-add-ded-design-agent-to-brainvault".' },
    },
    required: ['id'],
  },
};

async function removeQueuedChange({ id }) {
  if (!id || !/^[a-z0-9-]+$/.test(id)) return { ok: false, error: 'Invalid id' };
  const data = getAppData();
  data.changeRequests = data.changeRequests || [];
  const idx = data.changeRequests.findIndex(r => r.id === id && r.status === 'pending');
  if (idx === -1) return { ok: false, error: 'No pending change request with that id (it may already be done, or the id is wrong)' };
  const [removed] = data.changeRequests.splice(idx, 1);
  saveAppData(data);
  await deleteVault(`change-requests/${id}.md`);
  appendLog('note', `Mission Control change request removed via ${removed.source || 'ED chat'}: ${removed.title}`, [], []);
  return { ok: true, id, title: removed.title };
}

const SAVE_MEMORY_TOOL = {
  name: 'save_memory',
  description: 'Save a durable, reusable note about the user to your persistent memory — carries over into every future conversation, not just this one. Use for real preferences, ongoing projects, standing facts about their life/work, or corrections to how you should behave. Never use for one-off ephemeral chat content, and never save something that already appears in the WHAT ED REMEMBERS list.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The fact/preference/note itself, written concisely in your own words, e.g. "Prefers metric units" or "Working on a woodworking project in the garage, calls it \'the bench build\'."' },
    },
    required: ['text'],
  },
};

function saveEdMemory({ text }) {
  const clean = String(text || '').trim().slice(0, 400);
  if (!clean) return { ok: false, error: 'Empty memory text' };
  const data = getAppData();
  data.edMemory = data.edMemory || [];
  const id = `mem-${Date.now()}`;
  data.edMemory.unshift({ id, date: today(), text: clean });
  data.edMemory = data.edMemory.slice(0, 150);
  saveAppData(data);
  return { ok: true, id, text: clean };
}

const FORGET_MEMORY_TOOL = {
  name: 'forget_memory',
  description: 'Permanently delete one saved memory. Use ONLY when the user asks you to forget something, or a remembered note turns out to be wrong/outdated. Never call this speculatively, and never claim you forgot something without calling it.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The exact id of the memory to delete, copied from the WHAT ED REMEMBERS list, e.g. "mem-1786517286745".' },
    },
    required: ['id'],
  },
};

function forgetEdMemory({ id }) {
  if (!id || !/^mem-\d+$/.test(id)) return { ok: false, error: 'Invalid id' };
  const data = getAppData();
  data.edMemory = data.edMemory || [];
  const idx = data.edMemory.findIndex(m => m.id === id);
  if (idx === -1) return { ok: false, error: 'No memory with that id' };
  const [removed] = data.edMemory.splice(idx, 1);
  saveAppData(data);
  return { ok: true, id, text: removed.text };
}

// ── RED'S MEMORY (separate namespace from ED's — own id prefix so ids can never cross) ────────
const SAVE_RED_MEMORY_TOOL = {
  name: 'save_red_memory',
  description: 'Save a durable, reusable note about ongoing research context, goals, or standing preferences for how the user likes research done — carries over into every future research briefing, not just this one. This is separate from ED\'s memory: never use it for tasks, expenses, code changes, or anything outside research context. Never save something that already appears in the WHAT RED REMEMBERS list.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The research context/goal/preference itself, written concisely in your own words, e.g. "User is redesigning their home office, cares about minimalism" or "Prefers sources with real screenshots over pure text descriptions."' },
    },
    required: ['text'],
  },
};

function saveRedMemory({ text }) {
  const clean = String(text || '').trim().slice(0, 400);
  if (!clean) return { ok: false, error: 'Empty memory text' };
  const data = getAppData();
  data.redMemory = data.redMemory || [];
  const id = `rmem-${Date.now()}`;
  data.redMemory.unshift({ id, date: today(), text: clean });
  data.redMemory = data.redMemory.slice(0, 150);
  saveAppData(data);
  return { ok: true, id, text: clean };
}

const FORGET_RED_MEMORY_TOOL = {
  name: 'forget_red_memory',
  description: 'Permanently delete one saved research memory. Use ONLY when the user asks you to forget something, or a remembered note turns out to be wrong/outdated. Never call this speculatively.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The exact id of the memory to delete, copied from the WHAT RED REMEMBERS list, e.g. "rmem-1786517286745".' },
    },
    required: ['id'],
  },
};

function forgetRedMemory({ id }) {
  if (!id || !/^rmem-\d+$/.test(id)) return { ok: false, error: 'Invalid id' };
  const data = getAppData();
  data.redMemory = data.redMemory || [];
  const idx = data.redMemory.findIndex(m => m.id === id);
  if (idx === -1) return { ok: false, error: 'No memory with that id' };
  const [removed] = data.redMemory.splice(idx, 1);
  saveAppData(data);
  return { ok: true, id, text: removed.text };
}

const START_RED_RESEARCH_TOOL = {
  name: 'start_red_research',
  description: 'Kick off a real research run on a briefed topic. Use once the user has given you a clear topic/goal to research — design-focused, but on any subject, not just Mission Control. The run happens in the background and results show up in Design Lab as a slideshow, plus a filed wiki page — it takes up to a minute, so don\'t wait for it or claim you have findings yet; just confirm it started.',
  input_schema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'The research topic/brief, as specific as what the user gave you, e.g. "Ergonomic desk setups for small apartments" or "Modern onboarding flows for habit-tracking apps".' },
    },
    required: ['topic'],
  },
};

function startRedResearch({ topic }) {
  const clean = String(topic || '').trim().slice(0, 200);
  if (!clean) return { ok: false, error: 'No topic given' };
  runAndSaveDesignResearch(clean, null, { openTopic: true }).catch(console.error);
  return { ok: true, topic: clean };
}

const ADD_TASK_TOOL = {
  name: 'add_task',
  description: 'Add a real to-do item to the user\'s task list for today. Use ONLY when the user clearly asks you to add, create, or remember a task/to-do right now — not for hypothetical or future-conditional requests.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The task text, e.g. "Call the vet about Max\'s checkup".' },
      rank: { type: 'string', enum: ['S', 'B'], description: 'S = important/planned (shows as a bigger quest), B = ordinary to-do. Default B if unsure.' },
    },
    required: ['text'],
  },
};

function addEdTask({ text, rank }) {
  const clean = String(text || '').trim().slice(0, 200);
  if (!clean) return { ok: false, error: 'Empty task text' };
  const data = getAppData();
  if (!Array.isArray(data.tasks)) data.tasks = [];
  const date = today();
  data.tasks.push({ text: clean, done: false, rank: rank === 'S' ? 'S' : 'B', date, time: null });
  recalcStreak(data, date);
  saveAppData(data);
  syncTasks(data.tasks, date);
  return { ok: true, text: clean };
}

// ── CALENDAR EVENTS (via ED chat) ──────────────────────────────────────────────
// Mirrors KIND_COLORS keys in mission-control.html — keep in sync if that list changes.
const EVENT_KIND_KEYS = ['training', 'meeting', 'focus', 'social', 'errand', 'routine'];

// Recurring events are stored as templates (data.recurringEvents) and expanded into
// virtual occurrences at read time — never materialized into data.events. Mirrors the
// client-side occursOn/occurrenceForDate in mission-control.html — keep both in sync.
function daysBetweenDates(aStr, bStr) {
  return Math.round((new Date(bStr + 'T00:00:00') - new Date(aStr + 'T00:00:00')) / 86400000);
}
function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate();
}
function occursOn(rec, dateStr) {
  if (dateStr < rec.startDate) return false;
  if (rec.endDate && dateStr > rec.endDate) return false;
  const exc = (rec.exceptions || {})[dateStr];
  if (exc && exc.skip) return false;
  const interval = rec.interval || 1;
  if (rec.freq === 'daily') return daysBetweenDates(rec.startDate, dateStr) % interval === 0;
  if (rec.freq === 'weekly') {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    if (!(rec.daysOfWeek || []).includes(dow)) return false;
    const mondayOf = d => { const nd = new Date(d + 'T00:00:00'); nd.setDate(nd.getDate() - ((nd.getDay() + 6) % 7)); return nd; };
    const weeksDiff = Math.round((mondayOf(dateStr) - mondayOf(rec.startDate)) / (7 * 86400000));
    return weeksDiff >= 0 && weeksDiff % interval === 0;
  }
  if (rec.freq === 'monthly') {
    const d = new Date(dateStr + 'T00:00:00'), s = new Date(rec.startDate + 'T00:00:00');
    // Months too short for dayOfMonth fall back to that month's last day, so a "31st"
    // series still fires in Feb/Apr/Jun/Sep/Nov instead of silently skipping them.
    const targetDay = Math.min(rec.dayOfMonth, daysInMonth(d.getFullYear(), d.getMonth()));
    if (d.getDate() !== targetDay) return false;
    const monthsDiff = (d.getFullYear() - s.getFullYear()) * 12 + (d.getMonth() - s.getMonth());
    return monthsDiff >= 0 && monthsDiff % interval === 0;
  }
  return false;
}
function occurrenceForDate(rec, dateStr) {
  const exc = (rec.exceptions || {})[dateStr] || {};
  return {
    id: `rec-${rec.id}-${dateStr}`,
    title: exc.title || rec.title,
    time: exc.time !== undefined ? exc.time : rec.time,
    location: exc.location !== undefined ? exc.location : rec.location,
    kind: exc.kind || rec.kind || 'focus',
    notify: exc.notify !== undefined ? exc.notify : rec.notify,
    notifyLeadMin: exc.notifyLeadMin !== undefined ? exc.notifyLeadMin : rec.notifyLeadMin,
    recurring: true,
    recurringId: rec.id,
  };
}

// Finds events (one-off and recurring occurrences) matching a title substring, optionally
// narrowed to one date. Shared by edit/delete so both give the same "which one?" behavior.
function findCalendarMatches(data, titleSearch, dateFilter) {
  const q = String(titleSearch || '').toLowerCase().trim();
  const matches = [];
  for (const [date, evs] of Object.entries(data.events || {})) {
    if (dateFilter && date !== dateFilter) continue;
    evs.forEach((ev, idx) => {
      if (ev.title.toLowerCase().includes(q)) matches.push({ kind: 'oneoff', date, idx, ev });
    });
  }
  for (const rec of (data.recurringEvents || [])) {
    if (!rec.title.toLowerCase().includes(q)) continue;
    if (dateFilter) {
      if (occursOn(rec, dateFilter)) matches.push({ kind: 'recurring', date: dateFilter, rec });
    } else {
      matches.push({ kind: 'recurring', date: null, rec });
    }
  }
  return matches;
}

function describeMatch(m) {
  if (m.kind === 'oneoff') return `"${m.ev.title}" on ${m.date}${m.ev.time ? ' at ' + m.ev.time : ''}`;
  return `"${m.rec.title}" (recurring, ${m.rec.freq}${m.date ? ', occurrence on ' + m.date : ''})`;
}

const ADD_CALENDAR_EVENT_TOOL = {
  name: 'add_calendar_event',
  description: 'Create a calendar event — a one-time event on a specific date, or a recurring one (e.g. "gym every Monday at 6am", "rent due the 1st of every month"). Use ONLY when the user clearly asks to add/create/schedule something right now.',
  input_schema: {
    type: 'object',
    properties: {
      title:    { type: 'string', description: 'Event title, e.g. "Gym" or "Dentist appointment".' },
      date:     { type: 'string', description: 'YYYY-MM-DD. For a one-time event, the day it happens. For a recurring event, the day the recurrence starts from (default: today).' },
      time:     { type: 'string', description: '24h HH:MM, e.g. "18:00". Omit if no specific time.' },
      location: { type: 'string', description: 'Optional location.' },
      kind:     { type: 'string', enum: EVENT_KIND_KEYS, description: 'Category for calendar color-coding. Default "focus" if unclear.' },
      recurrence: {
        type: 'object',
        description: 'Omit entirely for a one-time event.',
        properties: {
          freq:        { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
          daysOfWeek:  { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Weekly only. 0=Sunday...6=Saturday.' },
          dayOfMonth:  { type: 'integer', minimum: 1, maximum: 31, description: 'Monthly only.' },
          interval:    { type: 'integer', minimum: 1, description: 'Every N days/weeks/months. Default 1.' },
          endDate:     { type: 'string', description: 'YYYY-MM-DD, optional. Omit for "forever".' },
        },
        required: ['freq'],
      },
    },
    required: ['title'],
  },
};

function addEdCalendarEvent({ title, date, time, location, kind, recurrence }) {
  const cleanTitle = String(title || '').trim().slice(0, 120);
  if (!cleanTitle) return { ok: false, error: 'Empty title' };
  const evKind = EVENT_KIND_KEYS.includes(kind) ? kind : 'focus';
  const data = getAppData();

  if (recurrence && recurrence.freq) {
    if (!['daily', 'weekly', 'monthly'].includes(recurrence.freq)) return { ok: false, error: 'Invalid recurrence.freq' };
    const rec = {
      id: `rec-${Date.now()}`,
      title: cleanTitle,
      time: time || null,
      location: String(location || '').trim().slice(0, 120),
      kind: evKind,
      notify: false, notifyLeadMin: null,
      freq: recurrence.freq,
      daysOfWeek: recurrence.freq === 'weekly' ? (Array.isArray(recurrence.daysOfWeek) && recurrence.daysOfWeek.length ? recurrence.daysOfWeek : [new Date((date || today()) + 'T00:00:00').getDay()]) : null,
      dayOfMonth: recurrence.freq === 'monthly' ? (recurrence.dayOfMonth || new Date((date || today()) + 'T00:00:00').getDate()) : null,
      interval: recurrence.interval || 1,
      startDate: date || today(),
      endDate: recurrence.endDate || null,
      exceptions: {},
    };
    if (!Array.isArray(data.recurringEvents)) data.recurringEvents = [];
    data.recurringEvents.push(rec);
    saveAppData(data);
    return { ok: true, recurring: true, rec };
  }

  const d = date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: 'Invalid date, expected YYYY-MM-DD' };
  if (!data.events) data.events = {};
  if (!data.events[d]) data.events[d] = [];
  const ev = { id: `ev-${Date.now()}`, title: cleanTitle, time: time || null, location: String(location || '').trim().slice(0, 120), kind: evKind, notify: false, notifyLeadMin: null };
  data.events[d].push(ev);
  saveAppData(data);
  syncEvents(data.events);
  return { ok: true, recurring: false, date: d, ev };
}

const EDIT_CALENDAR_EVENT_TOOL = {
  name: 'edit_calendar_event',
  description: 'Change the title/time/location/kind (or, for a one-off event, the date) of an existing calendar event that is still happening. Do NOT use this to cancel/skip/delete an event — use delete_calendar_event for that, even for one occurrence of a series; pushing the time to some "out of the way" value is not a cancellation and leaves a real, wrong event on the calendar. Find the event by title_search (matched against existing titles) and optionally a date to narrow it down. If it turns out to be part of a recurring series and the user didn\'t specify a date/occasion, ask them in your reply whether they mean just one occurrence or the whole series, then call this again with scope and date set — don\'t guess.',
  input_schema: {
    type: 'object',
    properties: {
      title_search: { type: 'string', description: 'Text to match against the event\'s current title.' },
      date:         { type: 'string', description: 'YYYY-MM-DD. Narrows to one event/occurrence; required when scope is "occurrence" on a recurring series.' },
      scope:        { type: 'string', enum: ['occurrence', 'series'], description: 'For recurring events only: change just the one occurrence on `date`, or the whole series. Default "series".' },
      new_title:    { type: 'string' },
      new_date:     { type: 'string', description: 'YYYY-MM-DD. Only valid for a one-off event (moves it to a new day) — a recurring series\' schedule cannot be moved this way, only its time/title/location/kind.' },
      new_time:     { type: 'string', description: '24h HH:MM.' },
      new_location: { type: 'string' },
      new_kind:     { type: 'string', enum: EVENT_KIND_KEYS },
    },
    required: ['title_search'],
  },
};

function editEdCalendarEvent({ title_search, date, scope, new_title, new_date, new_time, new_location, new_kind }) {
  const data = getAppData();
  const matches = findCalendarMatches(data, title_search, date);
  if (!matches.length) return { ok: false, error: 'No matching event found' };
  if (matches.length > 1) return { ok: false, error: `Multiple events match: ${matches.map(describeMatch).join('; ')}. Ask the user which one, or narrow with a date.` };

  const m = matches[0];
  const fields = {};
  if (new_title !== undefined)    fields.title = String(new_title).trim().slice(0, 120);
  if (new_time !== undefined)     fields.time = new_time;
  if (new_location !== undefined) fields.location = String(new_location).trim().slice(0, 120);
  if (new_kind !== undefined && EVENT_KIND_KEYS.includes(new_kind)) fields.kind = new_kind;

  if (m.kind === 'oneoff') {
    Object.assign(m.ev, fields);
    if (new_date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(new_date) && new_date !== m.date) {
      data.events[m.date] = data.events[m.date].filter(e => e !== m.ev);
      if (!data.events[m.date].length) delete data.events[m.date];
      if (!data.events[new_date]) data.events[new_date] = [];
      data.events[new_date].push(m.ev);
    }
    saveAppData(data);
    syncEvents(data.events);
    return { ok: true, message: `Updated "${m.ev.title}".` };
  }

  // recurring
  if (scope === 'occurrence') {
    if (!m.date) return { ok: false, error: 'A date is required to edit a single occurrence of a recurring event.' };
    m.rec.exceptions = m.rec.exceptions || {};
    m.rec.exceptions[m.date] = { ...m.rec.exceptions[m.date], ...fields };
    saveAppData(data);
    return { ok: true, message: `Updated the ${m.date} occurrence of "${m.rec.title}".` };
  }
  Object.assign(m.rec, fields);
  saveAppData(data);
  return { ok: true, message: `Updated the whole "${m.rec.title}" series.` };
}

const DELETE_CALENDAR_EVENT_TOOL = {
  name: 'delete_calendar_event',
  description: 'Delete/cancel/skip/remove an existing calendar event so it no longer happens. Use this — not edit_calendar_event — for ANY phrasing that means "make this not happen": "delete", "cancel", "skip", "remove", "I\'m not doing X anymore", "take X off my calendar". Never simulate a cancellation by editing the time/title instead — that leaves a real (wrong) event on the calendar and misleads the user about what happened. Find it by title_search and optionally a date. If it\'s part of a recurring series and the user didn\'t specify which, ask in your reply whether to delete just one occurrence or the whole series, then call again with scope and date set.',
  input_schema: {
    type: 'object',
    properties: {
      title_search: { type: 'string', description: 'Text to match against the event\'s title.' },
      date:         { type: 'string', description: 'YYYY-MM-DD. Narrows to one event/occurrence; required when scope is "occurrence".' },
      scope:        { type: 'string', enum: ['occurrence', 'series'], description: 'For recurring events only. Default "series".' },
    },
    required: ['title_search'],
  },
};

function deleteEdCalendarEvent({ title_search, date, scope }) {
  const data = getAppData();
  const matches = findCalendarMatches(data, title_search, date);
  if (!matches.length) return { ok: false, error: 'No matching event found' };
  if (matches.length > 1) return { ok: false, error: `Multiple events match: ${matches.map(describeMatch).join('; ')}. Ask the user which one, or narrow with a date.` };

  const m = matches[0];
  if (m.kind === 'oneoff') {
    data.events[m.date] = data.events[m.date].filter(e => e !== m.ev);
    if (!data.events[m.date].length) delete data.events[m.date];
    saveAppData(data);
    syncEvents(data.events);
    return { ok: true, message: `Deleted "${m.ev.title}" on ${m.date}.` };
  }

  if (scope === 'occurrence') {
    if (!m.date) return { ok: false, error: 'A date is required to delete a single occurrence of a recurring event.' };
    m.rec.exceptions = m.rec.exceptions || {};
    m.rec.exceptions[m.date] = { skip: true };
    saveAppData(data);
    return { ok: true, message: `Deleted the ${m.date} occurrence of "${m.rec.title}".` };
  }
  data.recurringEvents = (data.recurringEvents || []).filter(r => r.id !== m.rec.id);
  saveAppData(data);
  return { ok: true, message: `Deleted the whole "${m.rec.title}" series.` };
}

// Mirrors BUDGET_CATS keys in mission-control.html — keep in sync if that list changes.
const BUDGET_CATEGORY_KEYS = ['food', 'rent', 'transport', 'fun', 'health', 'income', 'savings', 'other'];

const LOG_EXPENSE_TOOL = {
  name: 'log_expense',
  description: 'Log a real transaction (expense or income) to the user\'s GIL WALLET budget tracker. Use ONLY when the user clearly asks you to log/record/add a specific expense or income amount right now.',
  input_schema: {
    type: 'object',
    properties: {
      amount:   { type: 'number', description: 'Positive dollar amount, e.g. 12.50.' },
      category: { type: 'string', enum: BUDGET_CATEGORY_KEYS, description: 'Budget category. Use "other" if unclear.' },
      note:     { type: 'string', description: 'Short label for the transaction, e.g. "Lunch with Sam".' },
      type:     { type: 'string', enum: ['expense', 'income'], description: 'Default expense unless the user is logging money received.' },
    },
    required: ['amount', 'category'],
  },
};

function logEdExpense({ amount, category, note, type }) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: 'Invalid amount' };
  const cat = BUDGET_CATEGORY_KEYS.includes(category) ? category : 'other';
  const data = getAppData();
  if (!data.budget) data.budget = { monthlyLimit: 2000, transactions: [], mode: 'monthly' };
  if (!Array.isArray(data.budget.transactions)) data.budget.transactions = [];
  const txnType = type === 'income' ? 'income' : 'expense';
  const accts = Array.isArray(data.budget.accounts) ? data.budget.accounts : [];
  const acctId = accts.some(a => a.id === data.budget.lastAccountId)
    ? data.budget.lastAccountId
    : (accts[0]?.id || 'general');
  const txn = { id: Date.now(), date: today(), amount: amt, category: cat, note: String(note || '').trim().slice(0, 120) || cat, type: txnType, accountId: acctId };
  data.budget.transactions.unshift(txn);
  data.budget.lastAccountId = acctId;
  saveAppData(data);
  return { ok: true, txn };
}

// ED's tool dispatch. Each handler performs the action, pushes onto toolActions on success
// (matching each tool's original push-only-on-ok behavior), and returns the tool_result payload.
const ED_TOOL_HANDLERS = {
  queue_code_change: (input, toolActions) => {
    const result = queueCodeChange(input);
    toolActions.push({ type: 'queued', id: result.id, title: result.title });
    return { ok: true, id: result.id, message: `Queued as change-requests/${result.id}.md — Claude Code will pick this up next session.` };
  },
  remove_queued_change: async (input, toolActions) => {
    const result = await removeQueuedChange(input);
    if (result.ok) toolActions.push({ type: 'removed', id: result.id, title: result.title });
    return result.ok
      ? { ok: true, message: `Removed change-requests/${result.id}.md and its queue entry.` }
      : { ok: false, message: result.error };
  },
  save_memory: (input, toolActions) => {
    const result = saveEdMemory(input);
    if (result.ok) toolActions.push({ type: 'memory_saved', text: result.text });
    return result.ok ? { ok: true, id: result.id, message: 'Saved to persistent memory.' } : { ok: false, message: result.error };
  },
  forget_memory: (input, toolActions) => {
    const result = forgetEdMemory(input);
    if (result.ok) toolActions.push({ type: 'memory_forgotten', text: result.text });
    return result.ok ? { ok: true, message: 'Forgotten.' } : { ok: false, message: result.error };
  },
  add_task: (input, toolActions) => {
    const result = addEdTask(input);
    if (result.ok) toolActions.push({ type: 'task_added', text: result.text });
    return result.ok ? { ok: true, message: `Added "${result.text}" to today's tasks.` } : { ok: false, message: result.error };
  },
  log_expense: (input, toolActions) => {
    const result = logEdExpense(input);
    if (result.ok) toolActions.push({ type: 'expense_logged', txn: result.txn });
    return result.ok ? { ok: true, message: `Logged $${result.txn.amount.toFixed(2)} (${result.txn.category}).` } : { ok: false, message: result.error };
  },
  add_calendar_event: (input, toolActions) => {
    const result = addEdCalendarEvent(input);
    if (result.ok) toolActions.push({ type: 'calendar_event_added', title: (result.ev || result.rec).title });
    return result.ok
      ? { ok: true, message: result.recurring ? `Created recurring event "${result.rec.title}" (${result.rec.freq}).` : `Added "${result.ev.title}" on ${result.date}.` }
      : { ok: false, message: result.error };
  },
  edit_calendar_event: (input, toolActions) => {
    const result = editEdCalendarEvent(input);
    if (result.ok) toolActions.push({ type: 'calendar_event_edited' });
    return result.ok ? { ok: true, message: result.message } : { ok: false, message: result.error };
  },
  delete_calendar_event: (input, toolActions) => {
    const result = deleteEdCalendarEvent(input);
    if (result.ok) toolActions.push({ type: 'calendar_event_deleted' });
    return result.ok ? { ok: true, message: result.message } : { ok: false, message: result.error };
  },
};

// Red's tool dispatch — deliberately separate from ED_TOOL_HANDLERS, never merged. This is the
// concrete code-level boundary: Red physically cannot reach queue/task/expense/ED-memory actions
// because runChatTurn only ever dispatches whatever handler map is passed in for that call.
const RED_TOOL_HANDLERS = {
  save_red_memory: (input, toolActions) => {
    const result = saveRedMemory(input);
    if (result.ok) toolActions.push({ type: 'red_memory_saved', text: result.text });
    return result.ok ? { ok: true, id: result.id, message: 'Saved to research memory.' } : { ok: false, message: result.error };
  },
  forget_red_memory: (input, toolActions) => {
    const result = forgetRedMemory(input);
    if (result.ok) toolActions.push({ type: 'red_memory_forgotten', text: result.text });
    return result.ok ? { ok: true, message: 'Forgotten.' } : { ok: false, message: result.error };
  },
  start_red_research: (input, toolActions) => {
    const result = startRedResearch(input);
    if (result.ok) toolActions.push({ type: 'research_started', topic: result.topic });
    return result.ok
      ? { ok: true, message: `Started researching "${result.topic}" — it'll show up in Design Lab shortly.` }
      : { ok: false, message: result.error };
  },
};

async function runChatTurn(anthropic, system, tools, messages, toolHandlers, maxRounds = 4) {
  let finalText = '';
  let usage = null;
  const toolActions = [];
  // web_search is dispatched by the API itself, not by us — every *_TOOL definition has an
  // input_schema key, so this set is exactly "the tools we're responsible for handling".
  const clientToolNames = new Set(tools.filter(t => t.input_schema).map(t => t.name));
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

    const clientToolUses = resp.content.filter(b => b.type === 'tool_use' && clientToolNames.has(b.name));
    if (resp.stop_reason !== 'tool_use' || !clientToolUses.length) break;

    messages.push({ role: 'assistant', content: resp.content });
    const toolResults = [];
    for (const tu of clientToolUses) {
      const handler = toolHandlers[tu.name];
      const payload = handler ? await handler(tu.input || {}, toolActions) : { ok: false, message: 'Unknown tool' };
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(payload) });
    }
    messages.push({ role: 'user', content: toolResults });
  }
  return { text: finalText || '(no response text)', usage, toolActions };
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
      REMOVE_QUEUED_CHANGE_TOOL,
      SAVE_MEMORY_TOOL,
      FORGET_MEMORY_TOOL,
      ADD_TASK_TOOL,
      LOG_EXPENSE_TOOL,
      ADD_CALENDAR_EVENT_TOOL,
      EDIT_CALENDAR_EVENT_TOOL,
      DELETE_CALENDAR_EVENT_TOOL,
    ];
    const { text: responseText, usage, toolActions } = await runChatTurn(anthropic, buildSystemPrompt(message), tools, messages, ED_TOOL_HANDLERS);
    saveConversation(message, responseText);
    res.json({ response: responseText, tokens: usage, toolActions });
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

// ── RED CHAT (briefing conversation before a research run) ────────────────────
function buildRedChatSystemPrompt() {
  const appData = getAppData();
  const memory = appData.redMemory || [];
  const memoryText = memory.length
    ? memory.map(m => `- id: ${m.id} | [${m.date}] ${m.text}`).join('\n')
    : '(nothing remembered yet)';

  const persona = `You are Red, the design research agent embedded in BrainVault Mission Control. Read this first, it governs every reply you write: you talk like a focused research collaborator briefing the user before you go dig into something — casual but purposeful, not a formal report. Most replies should be ONE TO THREE SENTENCES unless the user is asking you to actually lay out research findings.

You are a separate persona from ED, the general-purpose chat assistant elsewhere in this app. ED can act on nearly anything in the app on the user's behalf — tasks, queued code changes, memory — except looking at the budget. Your job is strictly research and reporting: you dig into topics (design-focused, but not limited to Mission Control) and report back findings as a Design Lab slideshow. You do NOT take actions that fall under ED's scope — you have no tools for tasks, expenses, code changes, or ED's own memory, and you should say so plainly and point the user to ED if they ask you to do one of those things here. Don't pretend you can or did.

Before starting a research run, make sure you actually understand what the user wants — ask a clarifying question if the topic or angle is vague, rather than guessing. Once you have a clear brief, call start_red_research with the topic. Findings always keep a design-quality lens, and where relevant, note how an idea could apply back to Mission Control's own design — but that's a secondary consideration, not the main point, unless the user is specifically briefing you on Mission Control itself.

You also have persistent memory across every research conversation, not just this one — the WHAT RED REMEMBERS section below is durable notes you've saved about the user's research goals/preferences over time. Use it to shape how you approach new briefings. When you learn something durable and reusable — a standing research interest, a preference for how findings should be presented, a correction — call save_red_memory to write it down concisely. Don't save one-off ephemeral chat content, and don't save duplicates of what's already below. If a memory turns out wrong or the user asks you to forget it, call forget_red_memory with its exact id.`;

  return persona + `\n\n═══════════════════════════════\n\n# WHAT RED REMEMBERS ABOUT THE USER'S RESEARCH GOALS (across all past briefings — use exact ids for forget_red_memory)\n${memoryText}`;
}

app.post('/api/red-chat', async (req, res) => {
  const key = getApiKey();
  if (!key) return res.status(401).json({ error: 'NO_KEY', message: 'No API key found.' });
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'Empty message' });
  const anthropic = makeClient(key);
  try {
    const messages = [...history.map(m => ({ role: m.role, content: m.content })),
                       { role: 'user', content: message }];
    const tools = [SAVE_RED_MEMORY_TOOL, FORGET_RED_MEMORY_TOOL, START_RED_RESEARCH_TOOL];
    const { text: responseText, usage, toolActions } = await runChatTurn(anthropic, buildRedChatSystemPrompt(), tools, messages, RED_TOOL_HANDLERS);
    res.json({ response: responseText, tokens: usage, toolActions });
  } catch (err) {
    console.error('Red chat API error:', err.status, err.message);
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
        message: 'That briefing got too large for one request — try a shorter message.',
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
// JSON.stringify'd content embedded inline inside a <script> block. Red's mockup_html
// routinely contains a literal "</script>" (its own demo markup) — the HTML parser closes
// the *real* surrounding <script> tag the instant it sees that substring, dumping everything
// after it onto the page as visible text. Escaping every "<" as < prevents that.
function jsonForScript(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c'); }
function slugifyTopic(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
}

const RATING_LABELS = ['Not even close', 'Kind of', 'Almost there', 'Just one more tweak', 'Got it'];

function buildFeedbackDigest() {
  const feedback = (getAppData().designFeedback || []).slice(0, 20);
  if (!feedback.length) return '(no feedback yet — this is early days, use your best judgment)';
  return feedback.map(f => `- "${f.findingTitle}" → ${f.ratingLabel}${f.comment ? ` (user's note: ${f.comment})` : ''}`).join('\n');
}

// Ground-truth extraction from the real mission-control.html — cheap regex passes,
// no LLM call, so this stays accurate automatically as the app changes (unlike the
// hand-maintained wiki doc, which drifts).
function buildLiveAppFacts() {
  const html = readVault('mission-control.html');
  if (!html) return '(could not read mission-control.html)';

  const rootMatch = html.match(/:root\s*\{([\s\S]*?)\}/);
  const cssVars = rootMatch
    ? rootMatch[1].split(';').map(l => l.trim()).filter(l => l.startsWith('--')).join('\n')
    : '(no :root block found)';

  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const classNames = new Set();
  for (const m of styleBlocks.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)(?=[\s,.:{\[])/g)) classNames.add(m[1]);
  const groups = {};
  for (const cls of classNames) {
    const prefix = cls.split('-')[0];
    groups[prefix] = (groups[prefix] || 0) + 1;
  }
  const classInventory = Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .map(([prefix, count]) => `${prefix}(${count})`)
    .join(', ');

  const scriptBlocks = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  const funcNames = new Set();
  for (const m of scriptBlocks.matchAll(/function\s+([a-zA-Z0-9_]+)\s*\(/g)) funcNames.add(m[1]);
  const funcList = [...funcNames].sort().join(', ');

  // Literal UI copy pulled straight from the real markup, so Red reuses the app's actual
  // words (e.g. "GIL WALLET", "REMAINING") instead of inventing new names for the same thing.
  const vocab = new Set();
  const copyPatterns = [
    /<button[^>]*>\s*([^<{][^<]{1,39})\s*<\/button>/g,
    /class="[^"]*(?:label|title|kicker|tab-txt|m-label)[^"]*"[^>]*>\s*([A-Za-z][^<{]{1,39})\s*</g,
  ];
  for (const re of copyPatterns) {
    for (const m of html.matchAll(re)) {
      const t = m[1].replace(/\s+/g, ' ').trim();
      if (t && /[a-zA-Z]{2,}/.test(t)) vocab.add(t);
    }
  }
  const vocabList = [...vocab].slice(0, 80).join(' · ');

  return `Current CSS custom properties (use these exact values, not whatever the design doc above says):
${cssVars}

CSS class-name groups present in the real file (prefix(count) — tells you what modules/features already exist, e.g. "budget" = an existing budget tracker, "notify" = an existing notification toggle):
${classInventory}

Client-side function names already defined (self-documenting — don't propose something that duplicates one of these):
${funcList}

Real UI copy/terminology already used in the live app (reuse these exact words/labels for existing concepts instead of inventing new ones — e.g. if the app already says "GIL WALLET" or "REMAINING", say that, don't rename it):
${vocabList || '(none extracted)'}`;
}

// Pulls the live :root hex values as a flat "--var: #hex" list, for embedding real current
// colors into mockup instructions instead of a fixed palette that can drift from reality.
function extractLiveHexPalette() {
  const html = readVault('mission-control.html');
  const rootMatch = html && html.match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootMatch) return 'bg: #0a1929, surface: #12253c, darker: #1e3a5f, fg: #dfeeff, accent: #ff8a63';
  const pairs = [...rootMatch[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)].map(m => `${m[1]}: ${m[2]}`);
  return pairs.length ? pairs.join(', ') : 'bg: #0a1929, surface: #12253c, darker: #1e3a5f, fg: #dfeeff, accent: #ff8a63';
}

// What's already been asked for, queued, implemented, or researched before — so Red
// doesn't propose duplicates of existing or already-rejected ideas.
function buildKnownWorkDigest() {
  const data = getAppData();

  const changeRequests = (data.changeRequests || []).slice(0, 20);
  const crText = changeRequests.length
    ? changeRequests.map(c => `- "${c.title}" (${c.status}, requested ${c.date})`).join('\n')
    : '(none queued yet)';

  const threads = Object.values(data.designThreads || {})
    .sort((a, b) => (b.updatedDate || '').localeCompare(a.updatedDate || ''))
    .slice(0, 25);
  const threadsText = threads.length
    ? threads.map(t => `- "${t.title}" (${t.status})`).join('\n')
    : '(none yet)';

  const runs = (data.designResearch || []).slice(0, 15);
  const runsText = runs.length
    ? runs.map(r => `- ${r.date}: "${r.title}"${r.topic ? ` (focus: ${r.topic})` : ''}`).join('\n')
    : '(none yet)';

  const archive = (data.designArchive || []).slice(0, 20);
  const archiveText = archive.length
    ? archive.map(a => `- "${a.title}"${a.lastRatingLabel ? ` (${a.lastRatingLabel})` : ''}`).join('\n')
    : '(none)';

  return `Mission Control change requests (queued for or already implemented by Claude Code):
${crText}

Individual ideas proposed so far, with their current status:
${threadsText}

Past research run topics:
${runsText}

Archived ideas from before a cleanup wipe (still real history — don't repeat these either):
${archiveText}`;
}

async function runDesignResearch(topic, openTopic = false) {
  const key = getApiKey();
  if (!key) throw Object.assign(new Error('No API key configured'), { code: 'NO_KEY' });
  const anthropic = makeClient(key);
  const mcPage = readWiki('entities/mission-control.md');
  const focus  = (topic || '').trim();

  const researchDirective = openTopic
    ? `The user has briefed you on a specific topic — research "${focus}" thoroughly and on its own terms, with a general design-quality lens, using web search for current real-world examples. As a secondary consideration, note anywhere a finding could meaningfully apply back to Mission Control (a personal ops dashboard with a dark cyan "Hub C" JRPG battle-menu aesthetic) — don't force-fit ideas that don't genuinely transfer; it's fine for a finding to have no Mission Control tie-in. Be economical with searches — a few well-chosen queries beat many broad ones.`
    : `Use web search to find current, real UI/UX patterns and trends relevant to${focus ? ` "${focus}" in` : ''} personal dashboards, habit trackers, gamified productivity apps, and bento-grid/neumorphic design systems. Prioritize ideas that would make Mission Control more fun, easier to use, and better-looking WITHOUT abandoning its existing JRPG identity. Be economical with searches — a few well-chosen queries beat many broad ones.`;

  const system = `You are Red, the design research agent embedded in BrainVault Mission Control — a personal ops dashboard with a dark cyan "Hub C" JRPG battle-menu aesthetic (hard-shadow bento cards, Press Start 2P + VT323 fonts, rank badges, XP pop animations, mobile 5-tab nav). You are a separate persona from ED, the chat assistant elsewhere in the app: ED is a general-purpose assistant who can act on nearly anything in the app (tasks, queued changes, memory) except the budget; Red's job is strictly research and reporting — you never take actions that fall under ED's scope, and you say so plainly if asked. Treat presentation as part of the design work, not an afterthought — a finding only counts as done when its mockup is understandable at a glance, not just conceptually sound. Mission Control's current design is documented below${openTopic ? ' as background context' : ''}.

# CURRENT MISSION CONTROL DESIGN
${mcPage || '(no design doc on file)'}

# LIVE APP FACTS (auto-extracted just now from the real mission-control.html — trust this over the design doc above if they conflict)
${buildLiveAppFacts()}

# ALREADY QUEUED OR PROPOSED (avoid duplicating these)
${buildKnownWorkDigest()}

# FEEDBACK ON YOUR PAST FINDINGS (most recent first)
${buildFeedbackDigest()}
Use this to calibrate: lean into directions similar to what scored "Got it" or "Just one more tweak", and steer away from patterns similar to what scored "Not even close" or "Kind of". If a note explains what needed tweaking, treat that as a specific critique to address in related future ideas — don't just repeat the same idea unchanged.

${researchDirective}

Respond with ONLY a fenced \`\`\`json code block (no other prose before or after) matching this exact schema:
{
  "title": "short title for this research run",
  "summary": "2-3 sentence overview of what you found",
  "findings": [
    ${buildFindingSchema(openTopic)}
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

function buildFindingSchema(openTopic = false) {
  const palette = extractLiveHexPalette();
  const mockupInstruction = openTopic
    ? `a small self-contained HTML snippet (inline <style> ok, no external assets, no <script>) illustrating the idea on its own terms — it does not need to reuse Mission Control's palette or class names unless the idea genuinely is a Mission Control application. Keep it under ~25 lines. This must be understandable in about 5 seconds without reading the description text: use clear visual hierarchy (size, spacing, contrast) to guide the eye, purposeful (not arbitrary) color and typography, obvious grouping/whitespace, and a layout that's scannable at a glance. Visually representative and self-explanatory, not just a text description squeezed into a box.`
    : `a small self-contained HTML snippet (inline <style> ok, no external assets, no <script>) illustrating the idea applied to Mission Control's own look. This mockup renders in an isolated sandboxed iframe with no access to the real site's stylesheet, so hardcode these CURRENT real hex values pulled live from the app right now (do not invent or approximate different ones): ${palette}. Reuse the app's real class-naming conventions and its exact terminology/wording from the LIVE APP FACTS section above (its UI copy list and CSS class-name groups) instead of inventing new labels or class names for things that already exist. Keep it under ~25 lines. This must be understandable in about 5 seconds without reading the description text: use clear visual hierarchy (size, spacing, contrast) to guide the eye, purposeful (not arbitrary) color and typography, obvious grouping/whitespace, and a layout that's scannable at a glance. Visually representative and self-explanatory, not just a text description squeezed into a box.`;
  const mcRelevanceField = openTopic
    ? `,\n  "mc_relevance": "1-2 sentences on how this could apply back to Mission Control specifically, or an empty string if it genuinely doesn't transfer"`
    : '';
  const descriptionField = openTopic
    ? '2-3 sentences: what it is and why it matters for the briefed topic'
    : '2-3 sentences: what it is, why it fits Mission Control, how it could be applied';
  return `{
  "title": "short name of the pattern/idea",
  "description": "${descriptionField}",
  "source_title": "name of the site/app it's drawn from",
  "source_url": "https://...",
  "mockup_html": "${mockupInstruction}"${mcRelevanceField}
}`;
}

// Produces one revised finding for an open thread, per the tier rules: rating 1 switches
// direction entirely (fresh search), rating 2 refines the same direction (fresh search),
// ratings 3-4 just polish/apply the user's tweak with no search at all.
async function runSingleFindingRevision(thread) {
  const key = getApiKey();
  if (!key) throw Object.assign(new Error('No API key configured'), { code: 'NO_KEY' });
  const anthropic = makeClient(key);
  const mcPage = readWiki('entities/mission-control.md');
  const rating = thread.lastRating;

  let instruction;
  let useSearch = false;
  if (rating === 1) {
    instruction = `The user rated your previous idea "${thread.title}" as "Not even close" — it's the wrong direction entirely. Propose a genuinely different idea for the same general problem area, NOT a variation of the previous one. Use web search to find a different real-world pattern.`;
    useSearch = true;
  } else if (rating === 2) {
    instruction = `The user rated your previous idea "${thread.title}" as "Kind of" — on the right track but weak. Keep the same core direction, but use web search to find a stronger real-world example or a better-executed version of it.`;
    useSearch = true;
  } else if (rating === 3) {
    instruction = `The user rated your previous idea "${thread.title}" as "Almost there" — close, just needs polish. Refine the description and mockup to make it sharper and more concrete. Do NOT change the core idea, and do NOT use web search — work from what you already proposed.`;
  } else {
    instruction = `The user rated your previous idea "${thread.title}" as "Just one more tweak" and left this note: "${thread.lastComment || '(no note given)'}". Make exactly that tweak and nothing else. Do NOT change the core idea, and do NOT use web search.`;
  }

  // Only the search-backed tiers (1-2) are effectively mini fresh-discovery calls with
  // real duplicate risk — ratings 3-4 are anchored to one known idea, keep them lean/cheap.
  const knownWork = useSearch ? `\n\n# ALREADY QUEUED OR PROPOSED (avoid duplicating these)\n${buildKnownWorkDigest()}` : '';
  const openTopic = !!thread.openTopic;

  const system = `You are Red, the design research agent embedded in BrainVault Mission Control — a personal ops dashboard with a dark cyan "Hub C" JRPG battle-menu aesthetic (hard-shadow bento cards, Press Start 2P + VT323 fonts, rank badges, XP pop animations, mobile 5-tab nav). This is a revision request, not a fresh research run — you're iterating on one specific idea based on direct user feedback. Treat presentation as part of the design work, not an afterthought — the mockup should be understandable at a glance, not just conceptually sound.${openTopic ? ' The original idea came from an open-topic briefed research run, not a Mission Control-framed one — keep that framing: revise the idea on its own terms, Mission Control is only a secondary consideration.' : ''}

# CURRENT MISSION CONTROL DESIGN
${mcPage || '(no design doc on file)'}

# LIVE APP FACTS (auto-extracted just now from the real mission-control.html — trust this over the design doc above if they conflict)
${buildLiveAppFacts()}${knownWork}

# THE IDEA YOU'RE REVISING
Title: ${thread.title}
Description: ${thread.description}
${thread.source_url ? `Source: ${thread.source_title || thread.source_url} (${thread.source_url})` : ''}

# YOUR TASK
${instruction}

Respond with ONLY a fenced \`\`\`json code block (no other prose before or after) matching this exact schema — produce exactly ONE revised finding:
${buildFindingSchema(openTopic)}
Keep it concise — this is a budget-conscious run.`;

  const resp = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system,
    tools:      useSearch ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }] : undefined,
    messages:   [{ role: 'user', content: 'Produce the revised finding now.' }],
  });

  const textBlocks = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const match = textBlocks.match(/```json\s*([\s\S]*?)```/) || textBlocks.match(/(\{[\s\S]*\})/);
  if (!match) throw new Error('Could not parse revision output from Red');
  const finding = JSON.parse(match[1]);
  finding.title       = stripCiteTags(finding.title);
  finding.description = stripCiteTags(finding.description);
  return finding;
}

function buildSlideshowHtml(id, topic, result) {
  const slides = [
    {
      kicker: 'DESIGN RESEARCH · BY RED',
      title:  result.title || 'Design Research',
      body:   `<p style="font-size:18px;line-height:1.6;">${escHtml(result.summary || '')}</p>
               <p style="opacity:.55;font-size:13px;margin-top:22px;font-family:monospace;">${result.findings.length} findings${topic ? ' · focus: ' + escHtml(topic) : ''}</p>`,
    },
    ...result.findings.map((f, i) => ({
      kicker: f.revisionInfo ? `REVISION ${f.revisionInfo.revisionCount} · FINDING ${i + 1} / ${result.findings.length}` : `FINDING ${i + 1} / ${result.findings.length}`,
      title:  f.title || `Finding ${i + 1}`,
      body:   `${f.revisionInfo ? `<p style="font-size:13px;opacity:.65;margin-bottom:10px;font-family:monospace;">↻ Revising based on your rating: "${escHtml(f.revisionInfo.previousRatingLabel)}"${f.revisionInfo.previousComment ? ` — "${escHtml(f.revisionInfo.previousComment)}"` : ''}</p>` : ''}
               <p style="font-size:15px;line-height:1.6;margin-bottom:14px;">${escHtml(f.description || '')}</p>
               ${f.source_url ? `<p style="font-size:12px;opacity:.6;margin-bottom:16px;">Source: <a href="${escAttr(f.source_url)}" target="_blank" rel="noopener" style="color:#ff8a63;">${escHtml(f.source_title || f.source_url)}</a></p>` : ''}
               <div class="mockup-frame"><iframe class="mockup-iframe" sandbox="allow-same-origin" srcdoc="${escAttr(f.mockup_html || '<p style=\'color:#888;font-family:sans-serif;padding:20px;\'>No mockup generated</p>')}"></iframe></div>
               <div class="rate-row" id="rateRow${i}">
                 <div class="rate-label">RATE THIS IDEA</div>
                 <div class="rate-btns">
                   <button class="rate-btn" onclick="rateFinding(${i},1,this)">Not even close</button>
                   <button class="rate-btn" onclick="rateFinding(${i},2,this)">Kind of</button>
                   <button class="rate-btn" onclick="rateFinding(${i},3,this)">Almost there</button>
                   <button class="rate-btn" onclick="rateFinding(${i},4,this)">Just one more tweak</button>
                   <button class="rate-btn got-it" onclick="rateFinding(${i},5,this)">Got it ✓</button>
                 </div>
                 <div class="rate-tweak-box" id="tweakBox${i}">
                   <textarea id="tweakText${i}" placeholder="What needs tweaking?"></textarea>
                   <button class="send-tweak-btn" onclick="submitTweak(${i})">Send to Red</button>
                 </div>
                 <div class="rate-status" id="rateStatus${i}"></div>
               </div>`,
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
  .rate-row{margin-top:16px;}
  .rate-label{font-size:11px;letter-spacing:2px;opacity:.5;font-family:monospace;margin-bottom:8px;}
  .rate-btns{display:flex;flex-wrap:wrap;gap:6px;}
  .rate-btn{background:var(--darker);color:var(--fg);border:1px solid rgba(223,238,255,.15);border-radius:8px;padding:8px 12px;cursor:pointer;font-family:monospace;font-size:12px;transition:border-color .12s,color .12s,background .12s,opacity .12s;}
  .rate-btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent);}
  .rate-btn.sel{border-color:var(--accent);color:var(--accent);background:rgba(255,138,99,.14);}
  .rate-btn.got-it{background:var(--accent);color:#0a1929;border-color:var(--accent);font-weight:bold;}
  .rate-btn.got-it:hover:not(:disabled){filter:brightness(1.08);}
  .rate-btn:disabled{opacity:.35;cursor:default;}
  .rate-btn.failed{background:rgba(255,64,64,.25);color:#ffb3b3;border-color:rgba(255,64,64,.4);}
  .rate-tweak-box{display:none;flex-direction:column;gap:8px;margin-top:10px;}
  .rate-tweak-box.show{display:flex;}
  .rate-tweak-box textarea{background:var(--surface);color:var(--fg);border:1px solid rgba(223,238,255,.15);border-radius:8px;padding:8px 10px;font-family:inherit;font-size:13px;resize:vertical;min-height:50px;}
  .send-tweak-btn{align-self:flex-start;background:var(--accent);color:#0a1929;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-family:monospace;font-weight:bold;font-size:12px;}
  .send-tweak-btn:disabled{opacity:.5;cursor:default;}
  .rate-status{margin-top:8px;font-size:12px;font-family:monospace;color:var(--accent);opacity:0;transition:opacity .15s;}
  .rate-status.show{opacity:1;}
  @media (max-width:600px){
    .slide{padding:20px 18px 16px;}
    .slide h1{font-size:21px;margin-bottom:12px;}
    .slide-kicker{font-size:10px;letter-spacing:2px;}
    .slide-body{max-width:100%;font-size:15px;}
    .slide-body p{font-size:15px !important;}
    .mockup-frame{height:36vh;min-height:140px;}
    .nav{padding:12px 14px;padding-bottom:calc(12px + env(safe-area-inset-bottom));}
    .nav button{padding:13px 20px;font-size:14px;min-width:84px;}
    .rate-btn{padding:11px 13px;font-size:13px;flex:1 1 calc(50% - 6px);text-align:center;}
  }
</style></head>
<body>
  <div class="slides" id="slides">${slidesHtml}</div>
  <div class="nav">
    <button id="prevBtn" onclick="go(-1)">◀ PREV</button>
    <div class="dots" id="dots"></div>
    <button id="nextBtn" onclick="next()">NEXT ▶</button>
  </div>
<script>
  const RESEARCH_ID = ${jsonForScript(id)};
  const RATING_LABELS = ${jsonForScript(RATING_LABELS)};
  const FINDINGS = ${jsonForScript(result.findings.map(f => ({
    title: f.title || '', description: f.description || '',
    source_title: f.source_title || '', source_url: f.source_url || '',
    mockup_html: f.mockup_html || '',
    threadId: f.threadId || null,
  })))};

  function lockRateRow(i, statusText) {
    const row = document.getElementById('rateRow'+i);
    row.querySelectorAll('.rate-btn').forEach(b => { b.disabled = true; });
    document.getElementById('tweakBox'+i).classList.remove('show');
    const status = document.getElementById('rateStatus'+i);
    status.textContent = statusText;
    status.classList.add('show');
  }

  async function sendRating(i, rating, comment, btn) {
    const f = FINDINGS[i]; if (!f) return;
    try {
      const r = await fetch('/api/design-research/' + encodeURIComponent(RESEARCH_ID) + '/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          findingIndex: i, findingTitle: f.title, findingDescription: f.description, threadId: f.threadId, rating, comment,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.message || d.error || 'failed');
      if (rating === 5) {
        const qr = await fetch('/api/change-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: f.title, description: f.description, source_title: f.source_title, source_url: f.source_url, mockup_html: f.mockup_html }),
        });
        const qd = await qr.json();
        if (!qr.ok || !qd.ok) throw new Error(qd.message || qd.error || 'queue failed');
        lockRateRow(i, '✓ Got it! Queued for Claude Code');
        if (window.parent !== window) window.parent.postMessage({ type: 'mc-queue-change', title: f.title }, window.location.origin);
      } else if (rating === 1) {
        lockRateRow(i, '✓ Scrapped — Red won\\'t rework this one');
      } else if (f.threadId) {
        lockRateRow(i, '✓ Thanks — Red is working on a revision (you\\'ll see it once a couple more are ready)');
      } else {
        lockRateRow(i, '✓ Thanks — feedback sent to Red');
      }
    } catch (e) {
      const row = document.getElementById('rateRow'+i);
      if (btn) btn.classList.add('failed');
      const status = document.getElementById('rateStatus'+i);
      status.textContent = rating === 4 ? '⚠ Failed to save — edit and tap Send to Red again' : '⚠ Failed to save — tap a rating to retry';
      status.classList.add('show');
      row.querySelectorAll('.rate-btn').forEach(b => { b.disabled = false; });
      const sendBtn = document.getElementById('tweakBox'+i).querySelector('.send-tweak-btn');
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function rateFinding(i, rating, btn) {
    const row = document.getElementById('rateRow'+i);
    row.querySelectorAll('.rate-btn').forEach(b => b.classList.remove('sel', 'failed'));
    btn.classList.add('sel');
    if (rating === 4) {
      document.getElementById('tweakBox'+i).classList.add('show');
      document.getElementById('tweakText'+i).focus();
      return;
    }
    row.querySelectorAll('.rate-btn').forEach(b => { b.disabled = true; });
    sendRating(i, rating, '', btn);
  }

  function submitTweak(i) {
    const btn = document.getElementById('rateRow'+i).querySelector('.rate-btn.sel');
    const sendBtn = document.getElementById('tweakBox'+i).querySelector('.send-tweak-btn');
    const text = document.getElementById('tweakText'+i).value.trim();
    sendBtn.disabled = true;
    document.getElementById('rateRow'+i).querySelectorAll('.rate-btn').forEach(b => { b.disabled = true; });
    sendRating(i, 4, text, btn);
  }
  const total = ${slides.length};
  let cur = 0;
  const dotsEl = document.getElementById('dots');
  for (let i = 0; i < total; i++) { const d = document.createElement('div'); d.className = 'dot' + (i === 0 ? ' active' : ''); dotsEl.appendChild(d); }
  function render() {
    document.querySelectorAll('.slide').forEach((el, i) => el.classList.toggle('active', i === cur));
    document.querySelectorAll('.dot').forEach((el, i) => el.classList.toggle('active', i === cur));
    document.getElementById('prevBtn').disabled = cur === 0;
    const nextBtn = document.getElementById('nextBtn');
    nextBtn.disabled = false;
    nextBtn.textContent = cur === total - 1 ? 'DONE ✓' : 'NEXT ▶';
  }
  function go(d) { cur = Math.max(0, Math.min(total - 1, cur + d)); render(); }
  function next() {
    if (cur === total - 1) {
      if (window.parent !== window) window.parent.postMessage({ type: 'mc-slideshow-done' }, window.location.origin);
      return;
    }
    go(1);
  }
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

function saveDesignResearchWiki(id, date, topic, result, openTopic = false) {
  const findingsMd = result.findings.map((f, i) =>
    `### ${i + 1}. ${f.title}\n\n${f.description || ''}\n\n${f.mc_relevance ? `_Mission Control tie-in: ${f.mc_relevance}_\n\n` : ''}${f.source_url ? `Source: [${f.source_title || f.source_url}](${f.source_url})` : ''}\n`
  ).join('\n');
  const title = (result.title || 'Design Research').replace(/"/g, '\\"');
  const baseTags = openTopic ? ['design'] : ['design', 'ui-ux', 'mission-control'];
  const tags = topic ? [...baseTags, slugifyTopic(topic)] : baseTags;
  writeWiki(`analyses/${id}.md`, `---
type: analysis
title: "${title}"
date: "${date}"
tags: [${tags.join(', ')}]
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

// Same-day same-topic runs used to collide on id, silently overwriting the earlier
// run's actual file content. Disambiguate with a numeric suffix on collision.
function uniqueDesignResearchId(data, baseId) {
  let id = baseId, n = 1;
  while ((data.designResearch || []).some(r => r.id === id) || readVault(`design-research/${id}.html`)) {
    n += 1;
    id = `${baseId}-${n}`;
  }
  return id;
}

async function runAndSaveDesignResearch(topic, idSuffix, opts = {}) {
  const openTopic = !!opts.openTopic;
  const result = await runDesignResearch(topic, openTopic);
  const date   = today();
  const data   = getAppData();
  const id     = uniqueDesignResearchId(data, `${date}-design-research-${idSuffix || slugifyTopic(topic || result.title) || 'general'}`);

  data.designThreads = data.designThreads || {};
  result.findings.forEach((f, i) => {
    const threadId = `thread-${Date.now()}-${i}-${slugifyTopic(f.title) || 'idea'}`;
    f.threadId = threadId;
    data.designThreads[threadId] = {
      id: threadId,
      title: f.title || '', description: f.description || '',
      source_title: f.source_title || '', source_url: f.source_url || '', mockup_html: f.mockup_html || '',
      status: 'awaiting_rating',
      revisionCount: 0,
      lastRating: null, lastRatingLabel: null, lastComment: '',
      createdDate: date, updatedDate: date,
      originResearchId: id,
      openTopic,
    };
  });

  const html = buildSlideshowHtml(id, topic, result);
  writeVault(`design-research/${id}.html`, html);
  saveDesignResearchWiki(id, date, topic, result, openTopic);
  data.designResearch = data.designResearch || [];
  data.designResearch.unshift({ id, date, topic: topic || '', title: result.title || 'Design Research', findingsCount: result.findings.length, auto: !!idSuffix, viewed: false, openTopic });
  data.designResearch = data.designResearch.slice(0, 30);
  saveAppData(data);
  return { id, result };
}

// Generates a revision for one open thread, right after the user rates it 1-4.
// Stores the new content on the thread (status: 'ready_to_ship') and checks whether
// enough threads are now ready to bundle into a viewable slideshow.
async function generateThreadRevision(threadId) {
  const data = getAppData();
  const thread = (data.designThreads || {})[threadId];
  if (!thread || thread.status !== 'generating') return;
  try {
    const revised = await runSingleFindingRevision(thread);
    const fresh = getAppData();
    const t = (fresh.designThreads || {})[threadId];
    if (!t) return;
    t.title         = revised.title || t.title;
    t.description   = revised.description || t.description;
    t.source_title  = revised.source_title || '';
    t.source_url    = revised.source_url || '';
    t.mockup_html   = revised.mockup_html || '';
    t.mc_relevance  = revised.mc_relevance || '';
    t.revisionCount = (t.revisionCount || 0) + 1;
    t.status        = 'ready_to_ship';
    t.updatedDate   = today();
    saveAppData(fresh);
    await maybeShipRevisionBundle();
  } catch (err) {
    console.error('Thread revision failed for', threadId, ':', err.message);
    const fresh = getAppData();
    const t = (fresh.designThreads || {})[threadId];
    if (t) { t.status = 'revision_failed'; saveAppData(fresh); }
  }
}

// Ships accumulated revised threads as a bundled slideshow: groups of 3 preferred,
// groups of 2 if that's all that's available, a lone ready thread waits for a partner.
async function maybeShipRevisionBundle() {
  const data = getAppData();
  const threads = data.designThreads || {};
  const ready = Object.keys(threads).filter(tid => threads[tid].status === 'ready_to_ship');
  if (ready.length < 2) return;

  const pool = [...ready];
  const groups = [];
  while (pool.length >= 3) groups.push(pool.splice(0, 3));
  if (pool.length === 2) groups.push(pool.splice(0, 2));
  // a single leftover thread (pool.length === 1) stays 'ready_to_ship' and waits for a partner

  for (const group of groups) {
    const date = today();
    const id   = uniqueDesignResearchId(data, `${date}-design-research-revisions-${Date.now()}`);
    const groupOpenTopic = group.every(tid => threads[tid].openTopic);
    const findings = group.map(tid => {
      const t = threads[tid];
      return {
        title: t.title, description: t.description, source_title: t.source_title, source_url: t.source_url, mockup_html: t.mockup_html, mc_relevance: t.mc_relevance || '',
        threadId: tid,
        revisionInfo: { revisionCount: t.revisionCount, previousRatingLabel: t.lastRatingLabel, previousComment: t.lastComment },
      };
    });
    // Every bundle used to share the exact same generic title, making them
    // indistinguishable in the Design Lab history list — name it after what's inside.
    const titleJoined = findings.map(f => `"${f.title}"`).join(', ');
    const bundleTitle = titleJoined.length <= 80 ? `Revisions: ${titleJoined}` : `Revisions: ${titleJoined.slice(0, 79)}…`;
    const result = {
      title:   bundleTitle,
      summary: `${findings.length} idea${findings.length > 1 ? 's' : ''} Red reworked based on your feedback.`,
      findings,
    };
    const html = buildSlideshowHtml(id, '', result);
    writeVault(`design-research/${id}.html`, html);
    saveDesignResearchWiki(id, date, '', result, groupOpenTopic);
    data.designResearch = data.designResearch || [];
    data.designResearch.unshift({ id, date, topic: '', title: result.title, findingsCount: findings.length, auto: true, isRevision: true, viewed: false });
    data.designResearch = data.designResearch.slice(0, 30);
    for (const tid of group) threads[tid].status = 'awaiting_rating';

    if (PUSH_ENABLED) {
      const subs    = data.pushSubscriptions || [];
      const payload = JSON.stringify({
        title: '🔁 Red has revisions ready for another look',
        body:  `${findings.length} reworked idea${findings.length > 1 ? 's' : ''} — open ED to view.`,
      });
      for (const sub of subs) webpush.sendNotification(sub, payload).catch(() => {});
    }
  }
  saveAppData(data);
}

async function maybeAutoRunDesignResearch() {
  if (!getApiKey()) return;
  const data = getAppData();
  if (data.lastDesignResearchAutoRun === today()) return;
  try {
    const { id, result } = await runAndSaveDesignResearch('', 'daily');
    const fresh = getAppData();
    fresh.lastDesignResearchAutoRun = today();
    saveAppData(fresh);
    if (PUSH_ENABLED) {
      const subs    = fresh.pushSubscriptions || [];
      const payload = JSON.stringify({
        title: "🎨 Red's design research is ready",
        body:  `${result.title || 'New ideas for Mission Control'} — open ED to view.`,
      });
      for (const sub of subs) webpush.sendNotification(sub, payload).catch(() => {});
    }
    console.log('  Design Lab: daily auto-research complete —', id);
  } catch (err) {
    console.error('Daily design research failed:', err.message);
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

// Surfaces what Red actually sees/has learned — the same feedback digest and known-work
// history injected into its own prompts — so the user can check it's really progressing,
// not just talking about it.
app.get('/api/design-research/learnings', (req, res) => {
  const data = getAppData();
  const feedback = data.designFeedback || [];
  const ratingCounts = [0, 0, 0, 0, 0];
  feedback.forEach(f => { if (Number.isInteger(f.rating) && f.rating >= 1 && f.rating <= 5) ratingCounts[f.rating - 1]++; });

  const threads = Object.values(data.designThreads || {});
  const statusCounts = {};
  threads.forEach(t => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });

  const runs = (data.designResearch || []);
  const recentRuns = runs.slice(0, 12).map(r => ({ id: r.id, date: r.date, title: r.title, topic: r.topic || null, isRevision: !!r.isRevision }));

  res.json({
    ok: true,
    totalRuns: runs.length,
    totalFeedback: feedback.length,
    ratingLabels: RATING_LABELS,
    ratingCounts,
    statusCounts,
    threadCount: threads.length,
    recentFeedback: feedback.slice(0, 15).map(f => ({ title: f.findingTitle, ratingLabel: f.ratingLabel, comment: f.comment || null, date: f.date })),
    recentRuns,
    calibrationDigest: buildFeedbackDigest(),
    knownWorkDigest: buildKnownWorkDigest(),
  });
});

app.get('/api/change-requests', (req, res) => {
  const data = getAppData();
  res.json({ requests: data.changeRequests || [] });
});

// Queues a Design Lab finding directly — no LLM call, the finding text IS the spec.
app.post('/api/change-requests', (req, res) => {
  try {
    const { title, description, source_title, source_url, mockup_html } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Missing title' });
    const sourceLine = source_url ? `\n\nSource: [${source_title || source_url}](${source_url})` : '';
    const mockupBlock = mockup_html
      ? `\n\nRed's mockup for this finding — treat this as the concrete visual reference, not just the prose above:\n\`\`\`html\n${mockup_html}\n\`\`\``
      : '';
    const details = `${description || ''}${sourceLine}${mockupBlock}`;
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

app.delete('/api/change-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
    const result = await removeQueuedChange({ id });
    if (!result.ok) return res.status(404).json({ error: result.error });
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

  // Mark viewed as a side effect of actually opening the slideshow — don't block the response on it.
  const data = getAppData();
  const entry = (data.designResearch || []).find(r => r.id === id);
  if (entry && !entry.viewed) { entry.viewed = true; saveAppData(data); }
});

// Rates one finding from a Design Lab slideshow — feeds back into Red's future prompts.
app.post('/api/design-research/:id/rate', (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
    const { findingIndex, findingTitle, findingDescription, threadId, rating, comment } = req.body || {};
    const ratingNum = Number(rating);
    if (!Number.isInteger(findingIndex) || findingIndex < 0) return res.status(400).json({ error: 'Invalid findingIndex' });
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: 'Invalid rating' });
    const data = getAppData();
    data.designFeedback = data.designFeedback || [];
    data.designFeedback.unshift({
      id,
      findingIndex,
      threadId:           threadId || null,
      findingTitle:       String(findingTitle || '').slice(0, 200),
      findingDescription: String(findingDescription || '').slice(0, 500),
      rating:      ratingNum,
      ratingLabel: RATING_LABELS[ratingNum - 1] || '',
      comment:     String(comment || '').slice(0, 500),
      date: today(),
    });
    data.designFeedback = data.designFeedback.slice(0, 200);

    // Old slideshows generated before threads existed won't carry a threadId — record
    // the feedback (above) but skip the revision loop entirely for those.
    data.designThreads = data.designThreads || {};
    const thread = threadId ? data.designThreads[threadId] : null;
    if (thread) {
      thread.lastRating      = ratingNum;
      thread.lastRatingLabel = RATING_LABELS[ratingNum - 1] || '';
      thread.lastComment     = String(comment || '').slice(0, 500);
      thread.updatedDate     = today();
      // Rating 1 ("Not even close") means the idea is wrong entirely — discard it
      // for good instead of feeding it back into a revision loop.
      thread.status          = ratingNum === 5 ? 'resolved' : (ratingNum === 1 ? 'discarded' : 'generating');
      saveAppData(data);
      if (ratingNum !== 5 && ratingNum !== 1) generateThreadRevision(threadId).catch(err => console.error('generateThreadRevision error:', err.message));
    } else {
      saveAppData(data);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

  // Recurring events are never in data.events — expand today's (and, for late-night events
  // with a long lead time, tomorrow's) occurrences so they get reminders like one-off events do.
  const eventsByDate = { ...(data.events || {}) };
  for (const offset of [0, 1]) {
    const d = new Date(now); d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().split('T')[0];
    const occs = (data.recurringEvents || []).filter(rec => occursOn(rec, dateStr)).map(rec => occurrenceForDate(rec, dateStr));
    if (occs.length) eventsByDate[dateStr] = [...(eventsByDate[dateStr] || []), ...occs];
  }

  for (const [date, evs] of Object.entries(eventsByDate)) {
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

async function pruneOldEvents() {
  const data = getAppData();
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  let changed = false;
  for (const dateStr of Object.keys(data.events || {})) {
    if (new Date(dateStr + 'T00:00:00') < cutoff) {
      delete data.events[dateStr];
      changed = true;
    }
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

  pruneOldEvents().catch(console.error);
  setInterval(() => pruneOldEvents().catch(console.error), 24 * 60 * 60 * 1000);
}

main().catch(console.error);
