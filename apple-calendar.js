// ── APPLE CALENDAR READ/EDIT (iCloud → Mission Control, for ED) ────────────────
// The push sync in server.js only goes one way: Mission Control → iCloud. This module
// covers the other direction: it reads events that were created directly in Apple
// Calendar (on the phone, from invites, etc.) so ED can see them, and lets ED edit or
// delete them in place on iCloud. Events Mission Control itself pushed (UID ending
// "@brainvault.local") are skipped here — those are edited through the normal
// Mission Control calendar tools, and the push sync carries the change over.
//
// Everything below the DAV helpers is pure string/date work with no dependencies, so
// it can be unit-tested without network access.

const OWN_UID_SUFFIX = '@brainvault.local';

// ── ICS parsing ──────────────────────────────────────────────────────────────
function unfoldLines(ics) {
  return String(ics || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parsePropLine(line) {
  // NAME;PARAM=a;PARAM2="b:c":value — the first ':' outside quotes ends the params.
  let inQ = false, i = 0;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...paramParts] = head.split(';');
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

function icsUnescape(s) {
  return String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}
function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Returns each VEVENT as { props: [{name, params, value}], start, end } (line indexes).
function findVevents(lines) {
  const out = [];
  let cur = null, depth = 0;
  lines.forEach((l, idx) => {
    if (/^BEGIN:VEVENT$/i.test(l)) { cur = { start: idx, props: [] }; depth = 0; return; }
    if (!cur) return;
    if (/^BEGIN:/i.test(l)) { depth++; return; }           // nested VALARM etc.
    if (/^END:VEVENT$/i.test(l) && depth === 0) { cur.end = idx; out.push(cur); cur = null; return; }
    if (/^END:/i.test(l)) { depth--; return; }
    if (depth === 0) { const p = parsePropLine(l); if (p) cur.props.push({ ...p, line: idx }); }
  });
  return out;
}

// ── Alerts (VALARM) ──────────────────────────────────────────────────────────
// Relative trigger → minutes before start ("-PT15M" → 15, "-P1D" → 1440, "PT0S" → 0).
// Absolute (date-time) triggers return null; they're kept on read but not editable here.
function parseTriggerMin(prop) {
  if (!prop || (prop.params.VALUE || '').toUpperCase() === 'DATE-TIME') return null;
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(prop.value.trim());
  if (!m) return null;
  const min = (+m[2] || 0) * 10080 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0) + Math.round((+m[6] || 0) / 60);
  return m[1] === '+' ? -min : min;
}
// The VALARM blocks nested directly inside one VEVENT: [{ start, end, minutes }].
function alarmBlocks(lines, vevent) {
  const out = []; let cur = null;
  for (let i = vevent.start + 1; i < vevent.end; i++) {
    const l = lines[i];
    if (/^BEGIN:VALARM$/i.test(l)) { cur = { start: i, minutes: null }; continue; }
    if (!cur) continue;
    if (/^END:VALARM$/i.test(l)) { cur.end = i; out.push(cur); cur = null; continue; }
    const p = parsePropLine(l);
    if (p && p.name === 'TRIGGER') cur.minutes = parseTriggerMin(p);
  }
  return out;
}
function triggerFor(min) {
  if (min <= 0) return 'TRIGGER:-PT0S';
  if (min % 1440 === 0) return `TRIGGER:-P${min / 1440}D`;
  const h = Math.floor(min / 60), m = min % 60;
  return `TRIGGER:-PT${h ? h + 'H' : ''}${m ? m + 'M' : ''}`;
}
function alarmLines(min, title) {
  return ['BEGIN:VALARM', `UID:${require('crypto').randomUUID().toUpperCase()}`, triggerFor(min), 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title || 'Reminder')}`, 'END:VALARM'];
}
function alertLabel(min) {
  if (min == null) return 'custom time';
  if (min === 0) return 'at start';
  if (min % 1440 === 0) return `${min / 1440} day${min > 1440 ? 's' : ''} before`;
  if (min >= 60 && min % 60 === 0) return `${min / 60} hr before`;
  return `${min} min before`;
}

// ── Time zones ───────────────────────────────────────────────────────────────
function tzOffsetMinutes(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asIfUtc - date.getTime()) / 60000;
}
function validTz(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
// Wall-clock time in tz → real instant. Second pass fixes the DST-boundary case.
function wallToUtc(y, mo, d, hh, mm, tz) {
  const guess = new Date(Date.UTC(y, mo - 1, d, hh, mm));
  let t = new Date(guess.getTime() - tzOffsetMinutes(guess, tz) * 60000);
  t = new Date(guess.getTime() - tzOffsetMinutes(t, tz) * 60000);
  return t;
}
function utcToLocal(date, tz) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return { dateKey: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Parses a DTSTART/DTEND-style property. appTz is used for floating times and unknown TZIDs.
function parseIcsDate(prop, appTz) {
  if (!prop) return null;
  const v = prop.value.trim();
  if (prop.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const dateKey = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return { allDay: true, dateKey, time: null, instant: new Date(dateKey + 'T00:00:00Z'), tzid: null };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, , z] = m;
  const tzid = prop.params.TZID && validTz(prop.params.TZID) ? prop.params.TZID : null;
  const instant = z ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm))
                    : wallToUtc(+y, +mo, +d, +hh, +mm, tzid || appTz);
  const local = utcToLocal(instant, appTz);
  return { allDay: false, dateKey: local.dateKey, time: local.time, instant, tzid, utc: !!z };
}

function parseDurationMin(v) {
  const m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w, d, h, mi] = m;
  const total = (+(w || 0)) * 10080 + (+(d || 0)) * 1440 + (+(h || 0)) * 60 + (+(mi || 0));
  return sign === '-' ? -total : total;
}

function addDaysKey(dateKey, n) {
  const d = new Date(dateKey + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Recurrence (common RRULE shapes; enough for a personal calendar) ─────────
function parseRrule(v) {
  const r = {};
  String(v || '').split(';').forEach(kv => { const [k, val] = kv.split('='); if (k) r[k.toUpperCase()] = val; });
  return r;
}
const BYDAY_IDX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Occurrence start dates (local date keys) of a recurring event within [fromKey, toKey].
function expandRecurrence(ev, fromKey, toKey) {
  const r = ev.rrule;
  const freq = r.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return [];
  const interval = Math.max(1, parseInt(r.INTERVAL || '1', 10) || 1);
  const count = r.COUNT ? parseInt(r.COUNT, 10) : null;
  let untilKey = null;
  if (r.UNTIL) untilKey = `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}`;
  const byday = r.BYDAY ? r.BYDAY.split(',').map(s => s.replace(/^[+-]?\d+/, '')).filter(s => s in BYDAY_IDX).map(s => BYDAY_IDX[s]) : null;
  const startKey = ev.dateKey;
  const startDow = new Date(startKey + 'T00:00:00Z').getUTCDay();
  const startDom = +startKey.slice(8, 10), startMon = +startKey.slice(5, 7);
  const out = [];
  let n = 0;
  // Walk day by day from the series start; cap the walk so a bad rule can't spin forever.
  const hardStop = untilKey && untilKey < toKey ? untilKey : toKey;
  for (let key = startKey, guard = 0; key <= hardStop && guard < 4000; key = addDaysKey(key, 1), guard++) {
    const days = Math.round((Date.parse(key + 'T00:00:00Z') - Date.parse(startKey + 'T00:00:00Z')) / 86400000);
    const dow = new Date(key + 'T00:00:00Z').getUTCDay();
    let hit = false;
    if (freq === 'DAILY') hit = days % interval === 0;
    else if (freq === 'WEEKLY') {
      const weekIdx = Math.floor((days + startDow) / 7);
      hit = weekIdx % interval === 0 && (byday ? byday.includes(dow) : dow === startDow);
    } else if (freq === 'MONTHLY') {
      const months = (+key.slice(0, 4) - +startKey.slice(0, 4)) * 12 + (+key.slice(5, 7) - startMon);
      hit = months % interval === 0 && +key.slice(8, 10) === startDom;
    } else if (freq === 'YEARLY') {
      hit = (+key.slice(0, 4) - +startKey.slice(0, 4)) % interval === 0 && +key.slice(5, 7) === startMon && +key.slice(8, 10) === startDom;
    }
    if (!hit) continue;
    n++;
    if (count && n > count) break;
    if (ev.exdates.has(key)) continue;
    if (key >= fromKey) out.push(key);
  }
  return out;
}

// Raw ICS object → master event summary (null when it's one of ours or unreadable).
function parseAppleObject(obj, appTz) {
  const lines = unfoldLines(obj.data);
  const vevents = findVevents(lines);
  const master = vevents.find(v => !v.props.some(p => p.name === 'RECURRENCE-ID')) || vevents[0];
  if (!master) return null;
  const get = n => master.props.find(p => p.name === n);
  const uid = (get('UID') || {}).value || '';
  if (uid.endsWith(OWN_UID_SUFFIX)) return null;
  const start = parseIcsDate(get('DTSTART'), appTz);
  if (!start) return null;
  const endProp = get('DTEND');
  const end = parseIcsDate(endProp, appTz);
  let durationMin;
  if (end) durationMin = Math.round((end.instant - start.instant) / 60000);
  else if (get('DURATION')) durationMin = parseDurationMin(get('DURATION').value);
  else durationMin = start.allDay ? 1440 : 60;
  const exdates = new Set();
  master.props.filter(p => p.name === 'EXDATE').forEach(p => p.value.split(',').forEach(v => {
    const d = parseIcsDate({ name: 'EXDATE', params: p.params, value: v }, appTz);
    if (d) exdates.add(d.dateKey);
  }));
  // Individually-moved occurrences show up as extra VEVENTs with RECURRENCE-ID; treat the
  // original slot as removed and list the moved copy as its own (read-only) occurrence.
  const overrides = vevents.filter(v => v !== master && v.props.some(p => p.name === 'RECURRENCE-ID')).map(v => {
    const g = n => v.props.find(p => p.name === n);
    const rid = parseIcsDate(g('RECURRENCE-ID'), appTz);
    const s = parseIcsDate(g('DTSTART'), appTz);
    const e = parseIcsDate(g('DTEND'), appTz);
    if (rid) exdates.add(rid.dateKey);
    return s ? { dateKey: s.dateKey, time: s.time, endTime: e && !e.allDay ? e.time : null,
                 title: icsUnescape((g('SUMMARY') || {}).value || ''), location: icsUnescape((g('LOCATION') || {}).value || '') } : null;
  }).filter(Boolean);
  const alerts = alarmBlocks(lines, master).map(a => a.minutes);
  const rr = get('RRULE');
  const endTime = !start.allDay ? utcToLocal(new Date(start.instant.getTime() + durationMin * 60000), appTz).time : null;
  return {
    uid, url: obj.url, etag: obj.etag,
    title: icsUnescape((get('SUMMARY') || {}).value || '(no title)'),
    location: icsUnescape((get('LOCATION') || {}).value || ''),
    dateKey: start.dateKey, time: start.time, endTime, allDay: start.allDay, durationMin,
    rrule: rr ? parseRrule(rr.value) : null, rruleText: rr ? rr.value : null,
    exdates, overrides, alerts,
    // How the series is anchored, so each occurrence's local time can be worked out
    // correctly across DST (a UTC-anchored 6 PM series becomes 5 PM after November).
    anchor: start.allDay ? null : (() => {
      const raw = get('DTSTART').value.trim();
      const zone = start.utc ? 'UTC' : (start.tzid || appTz);
      const rawKey = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      const shift = Math.round((Date.parse(rawKey + 'T00:00:00Z') - Date.parse(start.dateKey + 'T00:00:00Z')) / 86400000);
      return { zone, shift, hh: +raw.slice(9, 11), mm: +raw.slice(11, 13) };
    })(),
  };
}

// Flattens parsed Apple events into per-day occurrences within [fromKey, toKey].
function appleOccurrences(events, fromKey, toKey, appTz) {
  const out = [];
  for (const ev of events) {
    const base = { uid: ev.uid, title: ev.title, location: ev.location, time: ev.time, endTime: ev.endTime, allDay: ev.allDay, recurring: !!ev.rrule, alerts: ev.alerts || [] };
    if (ev.rrule) {
      expandRecurrence(ev, fromKey, toKey).forEach(dateKey => {
        let time = ev.time, endTime = ev.endTime;
        if (ev.anchor && appTz) {
          const [y, mo, d] = addDaysKey(dateKey, ev.anchor.shift).split('-').map(Number);
          const inst = wallToUtc(y, mo, d, ev.anchor.hh, ev.anchor.mm, ev.anchor.zone);
          time = utcToLocal(inst, appTz).time;
          endTime = utcToLocal(new Date(inst.getTime() + ev.durationMin * 60000), appTz).time;
        }
        out.push({ ...base, date: dateKey, time, endTime });
      });
      ev.overrides.forEach(o => { if (o.dateKey >= fromKey && o.dateKey <= toKey) out.push({ ...base, ...o, date: o.dateKey, title: o.title || ev.title, moved: true }); });
    } else if (ev.allDay && ev.durationMin > 1440) {
      // Multi-day all-day event: list it on each day it covers.
      const days = Math.ceil(ev.durationMin / 1440);
      for (let i = 0; i < days; i++) { const k = addDaysKey(ev.dateKey, i); if (k >= fromKey && k <= toKey) out.push({ ...base, date: k }); }
    } else if (ev.dateKey >= fromKey && ev.dateKey <= toKey) {
      out.push({ ...base, date: ev.dateKey });
    }
  }
  return out.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}

// ── ICS editing ──────────────────────────────────────────────────────────────
function fmtLocal(dateKey, time) { return dateKey.replace(/-/g, '') + 'T' + time.replace(':', '') + '00'; }
function fmtUtc(date) { return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'; }
function toMin(hm) { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0); }

// Applies { title, date, time, end_time, location, all_day } to the master VEVENT of a
// raw ICS object. Keeps every other property (alarms, attendees, notes, VTIMEZONE) as-is.
function editAppleIcs(raw, changes, appTz) {
  const lines = unfoldLines(raw);
  const vevents = findVevents(lines);
  const master = vevents.find(v => !v.props.some(p => p.name === 'RECURRENCE-ID')) || vevents[0];
  if (!master) throw new Error('No VEVENT in calendar object');
  const get = n => master.props.find(p => p.name === n);
  const ev = parseAppleObject({ data: raw }, appTz) || (() => { throw new Error('Unreadable event'); })();
  const startProp = get('DTSTART');
  const tzid = startProp.params.TZID && validTz(startProp.params.TZID) ? startProp.params.TZID : null;

  const allDay = changes.all_day !== undefined ? !!changes.all_day : (changes.time ? false : ev.allDay);
  const dateKey = changes.date || ev.dateKey;
  if (ev.rrule && changes.date && changes.date !== ev.dateKey) {
    throw new Error('Moving a repeating Apple Calendar series to a different start date is not supported here — change it on the phone, or edit just the time.');
  }
  let newStart, newEnd;
  if (allDay) {
    const days = Math.max(1, ev.allDay ? Math.round(ev.durationMin / 1440) : 1);
    newStart = `DTSTART;VALUE=DATE:${dateKey.replace(/-/g, '')}`;
    newEnd = `DTEND;VALUE=DATE:${addDaysKey(dateKey, days).replace(/-/g, '')}`;
  } else {
    const time = changes.time || ev.time || '09:00';
    let dur = ev.allDay ? 60 : ev.durationMin;
    if (changes.end_time) { dur = toMin(changes.end_time) - toMin(time); if (dur <= 0) dur += 1440; }
    // Keep the event's own zone when it has one, so a repeating event stays at the same
    // wall-clock time across DST; otherwise write the app's zone as UTC.
    const zone = tzid || appTz;
    const [y, mo, d] = dateKey.split('-').map(Number), [hh, mm] = time.split(':').map(Number);
    const startUtc = wallToUtc(y, mo, d, hh, mm, zone);
    const endUtc = new Date(startUtc.getTime() + dur * 60000);
    if (tzid) {
      const endLocal = utcToLocal(endUtc, tzid);
      newStart = `DTSTART;TZID=${tzid}:${fmtLocal(dateKey, time)}`;
      newEnd = `DTEND;TZID=${tzid}:${fmtLocal(endLocal.dateKey, endLocal.time)}`;
    } else {
      newStart = `DTSTART:${fmtUtc(startUtc)}`;
      newEnd = `DTEND:${fmtUtc(endUtc)}`;
    }
  }
  const timingChanged = changes.date || changes.time || changes.end_time || changes.all_day !== undefined;

  const replace = new Map();  // line idx → new line ('' removes it)
  const insertAfterStart = [];
  if (timingChanged) {
    replace.set(startProp.line, newStart);
    const endP = get('DTEND'), durP = get('DURATION');
    if (endP) replace.set(endP.line, newEnd); else insertAfterStart.push(newEnd);
    if (durP) replace.set(durP.line, '');
  }
  if (changes.title !== undefined) {
    const s = get('SUMMARY');
    const line = `SUMMARY:${icsEscape(changes.title)}`;
    if (s) replace.set(s.line, line); else insertAfterStart.push(line);
  }
  if (changes.location !== undefined) {
    const l = get('LOCATION');
    const line = changes.location ? `LOCATION:${icsEscape(changes.location)}` : '';
    if (l) replace.set(l.line, line); else if (line) insertAfterStart.push(line);
  }
  // Alerts: `changes.alerts` is the complete new list (minutes before start; [] clears them).
  const dropLines = new Set(), alarmInsert = [];
  if (Array.isArray(changes.alerts)) {
    alarmBlocks(lines, master).forEach(b => { for (let i = b.start; i <= b.end; i++) dropLines.add(i); });
    const title = changes.title !== undefined ? changes.title : ev.title;
    [...new Set(changes.alerts.map(n => Math.max(0, Math.round(Number(n) || 0))))].slice(0, 5).sort((a, b) => a - b)
      .forEach(min => alarmInsert.push(...alarmLines(min, title)));
  }
  // Bump SEQUENCE + DTSTAMP so iOS treats it as a newer revision.
  const seq = get('SEQUENCE');
  const nextSeq = `SEQUENCE:${(parseInt(seq ? seq.value : '0', 10) || 0) + 1}`;
  if (seq) replace.set(seq.line, nextSeq); else insertAfterStart.push(nextSeq);
  const stamp = get('DTSTAMP');
  if (stamp) replace.set(stamp.line, `DTSTAMP:${fmtUtc(new Date())}`);

  const out = [];
  lines.forEach((l, idx) => {
    if (l === '' && idx === lines.length - 1) return;
    if (idx === master.end) out.push(...alarmInsert);
    if (dropLines.has(idx)) return;
    if (replace.has(idx)) { const r = replace.get(idx); if (r) out.push(r); }
    else out.push(l);
    if (idx === startProp.line) out.push(...insertAfterStart);
  });
  return out.map(foldLine).join('\r\n') + '\r\n';
}

// Removes one occurrence of a repeating event by adding an EXDATE for it.
function addExdateIcs(raw, dateKey, appTz) {
  const lines = unfoldLines(raw);
  const vevents = findVevents(lines);
  const master = vevents.find(v => !v.props.some(p => p.name === 'RECURRENCE-ID')) || vevents[0];
  const startProp = master.props.find(p => p.name === 'DTSTART');
  const ev = parseAppleObject({ data: raw }, appTz);
  let exLine;
  if (ev.allDay) exLine = `EXDATE;VALUE=DATE:${dateKey.replace(/-/g, '')}`;
  else {
    const tzid = startProp.params.TZID && validTz(startProp.params.TZID) ? startProp.params.TZID : null;
    if (tzid) {
      // The occurrence's wall-clock start in the series' own zone.
      const [y, mo, d] = dateKey.split('-').map(Number), [hh, mm] = ev.time.split(':').map(Number);
      const local = utcToLocal(wallToUtc(y, mo, d, hh, mm, appTz), tzid);
      exLine = `EXDATE;TZID=${tzid}:${fmtLocal(local.dateKey, local.time)}`;
    } else {
      // UTC-anchored or floating series: every occurrence keeps the master's own time of
      // day in the master's own format (e.g. "T220000Z"), so reuse that suffix.
      // The master's raw date can differ from its local date (e.g. 11 PM Eastern is the
      // next day in UTC); apply the same shift to the occurrence.
      const raw = startProp.value.trim();
      const rawKey = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      const shift = Math.round((Date.parse(rawKey + 'T00:00:00Z') - Date.parse(ev.dateKey + 'T00:00:00Z')) / 86400000);
      exLine = `EXDATE:${addDaysKey(dateKey, shift).replace(/-/g, '')}${raw.slice(8)}`;
    }
  }
  const out = [];
  lines.forEach((l, idx) => { if (l === '' && idx === lines.length - 1) return; out.push(l); if (idx === startProp.line) out.push(exLine); });
  return out.map(foldLine).join('\r\n') + '\r\n';
}

function foldLine(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const parts = []; let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

// ── DAV layer ────────────────────────────────────────────────────────────────
// getClient: async () => tsdav client; calendarUrl: the iCloud calendar collection.
async function fetchAppleEvents(client, calendarUrl, fromKey, toKey, appTz) {
  const objects = await client.fetchCalendarObjects({
    calendar: { url: calendarUrl },
    timeRange: { start: new Date(addDaysKey(fromKey, -1) + 'T00:00:00Z').toISOString(), end: new Date(addDaysKey(toKey, 2) + 'T00:00:00Z').toISOString() },
  });
  const events = [];
  for (const obj of objects) {
    if (!obj || !obj.data) continue;
    try { const ev = parseAppleObject(obj, appTz); if (ev) events.push(ev); }
    catch (e) { console.error('Apple event parse failed:', obj.url, e.message); }
  }
  return events;
}

async function fetchOne(client, calendarUrl, url) {
  const [obj] = await client.fetchCalendarObjects({ calendar: { url: calendarUrl }, objectUrls: [url] });
  if (!obj || !obj.data) throw new Error('That Apple Calendar event no longer exists (it may have been deleted on the phone).');
  return obj;
}

async function updateAppleEvent(client, calendarUrl, url, changes, appTz) {
  const obj = await fetchOne(client, calendarUrl, url);
  const data = editAppleIcs(obj.data, changes, appTz);
  const resp = await client.updateCalendarObject({ calendarObject: { url: obj.url || url, data, etag: obj.etag } });
  if (resp && resp.ok === false) throw new Error(`iCloud rejected the edit (${resp.status})`);
  return parseAppleObject({ ...obj, data }, appTz);
}

async function deleteAppleEvent(client, calendarUrl, url, { occurrenceDate, appTz } = {}) {
  const obj = await fetchOne(client, calendarUrl, url);
  if (occurrenceDate) {
    const data = addExdateIcs(obj.data, occurrenceDate, appTz);
    const resp = await client.updateCalendarObject({ calendarObject: { url: obj.url || url, data, etag: obj.etag } });
    if (resp && resp.ok === false) throw new Error(`iCloud rejected the change (${resp.status})`);
    return { occurrence: true };
  }
  const resp = await client.deleteCalendarObject({ calendarObject: { url: obj.url || url, etag: obj.etag } });
  if (resp && resp.ok === false) throw new Error(`iCloud rejected the delete (${resp.status})`);
  return { occurrence: false };
}

module.exports = {
  OWN_UID_SUFFIX, alertLabel, parseTriggerMin,
  parseAppleObject, appleOccurrences, expandRecurrence, editAppleIcs, addExdateIcs,
  fetchAppleEvents, updateAppleEvent, deleteAppleEvent, addDaysKey,
};
