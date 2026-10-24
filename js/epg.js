/**
 * epg.js — data layer for the UK TV guide.
 *
 * Free, CORS-enabled JSON API: https://epg.pw (no key required).
 *   GET /api/epg.json?channel_id=<id>&date=YYYY-MM-DD
 *   -> { name, provider, epg_list: [{ title, desc, start_date }], ... }
 *
 * Features: in-memory + Cache API persistence, concurrency-limited fetching,
 * progressive update events, Europe/London timezone helpers.
 */

const API = 'https://epg.pw/api/epg.json';
const CACHE_NAME = 'tvg-epg-v1';
const MAX_PARALLEL = 8;
const TODAY_TTL = 30 * 60 * 1000; // refetch "today" at most every 30 min

const memory = new Map();     // `${id}|${date}` -> { progs, fetchedAt }
const inflight = new Map();   // key -> Promise
const listeners = new Set();

const cacheReady = typeof caches !== 'undefined' ? caches.open(CACHE_NAME).catch(() => null) : Promise.resolve(null);

/* ------------------------------------------------------------------ time */

const londonFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** 'YYYY-MM-DD' for a timestamp, in Europe/London time. */
export function londonDateKey(ms = Date.now()) {
  return londonFmt.format(new Date(ms));
}

function londonWallParts(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** UTC milliseconds of London midnight starting dateKey ('YYYY-MM-DD'). */
export function londonDayStart(dateKey) {
  // Offset valid for the day, taken at noon (London never transitions DST at noon)
  const noonGuess = Date.parse(dateKey + 'T12:00:00Z');
  const offset = Date.UTC(...(v => [v.y, v.m - 1, v.d, v.hh, v.mm])(londonWallParts(noonGuess))) - noonGuess;
  let ms = Date.parse(dateKey + 'T00:00:00Z') - offset;
  // Verify: wall clock must read 00:00 of dateKey; nudge if a DST edge shifted it
  for (let i = 0; i < 3; i++) {
    const p = londonWallParts(ms);
    const key = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
    if (key === dateKey && p.hh === 0 && p.mm === 0) return ms;
    ms += key < dateKey ? 3600e3 : -3600e3;
  }
  return ms;
}

/** Format a timestamp as HH:MM London time. */
export function londonTime(ms) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms));
}

/* ----------------------------------------------------------------- cache */

const cKey = (id, date) => `${API}?channel_id=${id}&date=${date}`; // real URL — Cache API requires http(s)

async function readCache(id, date) {
  const c = await cacheReady;
  if (!c) return null;
  try {
    const r = await c.match(cKey(id, date));
    return r ? await r.json() : null;
  } catch { return null; }
}

async function writeCache(id, date, value) {
  const c = await cacheReady;
  if (!c) return;
  try {
    await c.put(cKey(id, date), new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'X-Fetched-At': String(Date.now()) },
    }));
  } catch { /* quota — ignore */ }
}

/* ---------------------------------------------------------------- parse */

const TAG_RE = /\[(?:S|HD|AD|SL|SLD|W|16|8|4|PG|12|15|18|SIG|Repeat|New|New Series|R|Deemed|Signed|Audio Described)[^\]]*\]/gi;

/** Extract [S]/[HD]/[AD]-style badges from a description, returning {desc, tags}. */
export function extractTags(desc) {
  const tags = [];
  const clean = (desc || '').replace(TAG_RE, (m) => { tags.push(m.slice(1, -1)); return ''; })
    .replace(/\s{2,}/g, ' ').trim();
  return { desc: clean, tags: [...new Set(tags)].slice(0, 6) };
}

function parseEpg(json) {
  const list = json?.epg_list || [];
  const progs = [];
  let lastEnd = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const start = Date.parse(p.start_date || '');
    if (!Number.isFinite(start) || start < lastEnd) continue;
    let end = i + 1 < list.length ? Date.parse(list[i + 1].start_date || '') : NaN;
    if (!Number.isFinite(end) || end <= start) end = start + 90 * 60e3;
    const { desc, tags } = extractTags(p.desc);
    progs.push({
      start, end,
      title: (p.title || 'Untitled').trim(),
      desc, tags,
    });
    lastEnd = end;
  }
  return progs;
}

/* ----------------------------------------------------------------- fetch */

async function fetchJson(url, tries = 2) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      err = new Error(`HTTP ${r.status}`);
    } catch (e) { err = e; }
    if (i < tries - 1) await new Promise(res => setTimeout(res, 700 * (i + 1)));
  }
  throw err;
}

/** Simple concurrency-limited task queue. */
function createQueue(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < limit && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      fn().then(resolve, reject).finally(() => { active--; next(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const queue = createQueue(MAX_PARALLEL);

/**
 * Load one channel-day. Today: network-first (with TTL); other days: cache-first.
 * Resolves to { progs: Programme[], stale?: boolean } — never rejects (empty on failure).
 */
export function loadDay(channelId, dateKey, { force = false } = {}) {
  const key = `${channelId}|${dateKey}`;
  const mem = memory.get(key);
  const today = londonDateKey();
  const isToday = dateKey === today;

  if (!force && mem) {
    if (!isToday || Date.now() - mem.fetchedAt < TODAY_TTL) return Promise.resolve(mem);
  }
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    let entry = null;
    if (isToday && !force) {
      // network first for today; fall back to cache when offline
      try {
        const raw = await queue(() => fetchJson(`${API}?channel_id=${channelId}&date=${dateKey}`));
        entry = { progs: parseEpg(raw), fetchedAt: Date.now() };
        writeCache(channelId, dateKey, entry);
      } catch {
        const cached = await readCache(channelId, dateKey);
        if (cached) entry = { ...cached, stale: true };
      }
    } else {
      const cached = await readCache(channelId, dateKey);
      if (cached && !force) {
        entry = { ...cached };
      } else {
        try {
          const raw = await queue(() => fetchJson(`${API}?channel_id=${channelId}&date=${dateKey}`));
          entry = { progs: parseEpg(raw), fetchedAt: Date.now() };
          writeCache(channelId, dateKey, entry);
        } catch {
          if (cached) entry = { ...cached, stale: true };
        }
      }
    }
    if (!entry) entry = { progs: [], fetchedAt: Date.now(), failed: true };
    memory.set(key, entry);
    inflight.delete(key);
    for (const cb of listeners) cb(channelId, dateKey, entry);
    return entry;
  })();

  inflight.set(key, task);
  return task;
}

export function getCached(channelId, dateKey) {
  return memory.get(`${channelId}|${dateKey}`);
}

/** Subscribe to progressive loads. Returns unsubscribe fn. */
export function onUpdate(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Ensure channels × days are loaded, reporting progress. Resolves when all settle. */
export async function loadSet(channelIds, dateKeys, onProgress) {
  let done = 0;
  const total = channelIds.length * dateKeys.length;
  await Promise.all(channelIds.flatMap(id =>
    dateKeys.map(dk => loadDay(id, dk).then(r => { done++; onProgress?.(done, total); return r; }))
  ));
}

/* --------------------------------------------------------- merge helpers */

/** Merge loaded days for a channel into one sorted, de-duplicated timeline. */
export function mergedTimeline(channelId, dateKeys) {
  const all = new Map(); // start -> prog
  for (const dk of dateKeys) {
    const entry = memory.get(`${channelId}|${dk}`);
    if (!entry) continue;
    for (const p of entry.progs) {
      const prev = all.get(p.start);
      if (!prev || (p.desc && !prev.desc)) all.set(p.start, p);
    }
  }
  return [...all.values()].sort((a, b) => a.start - b.start);
}

/** Programme that is on air at `at` (or next upcoming when strictNext). */
export function programmeAt(timeline, at, { next = false } = {}) {
  for (let i = 0; i < timeline.length; i++) {
    const p = timeline[i];
    if (!next && p.start <= at && at < p.end) return { prog: p, index: i };
    if (next && p.start > at) return { prog: p, index: i };
  }
  return { prog: null, index: -1 };
}
