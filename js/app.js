/**
 * app.js — application shell: state, day tabs, search, details modal,
 * channel manager, Now & Next view, keyboard shortcuts, midnight rollover.
 */
import { CHANNELS, DEFAULT_CHANNEL_IDS, GROUP_ORDER } from './channels.js';
import * as epg from './epg.js';
import { Guide, DAYS } from './guide.js';

const HOUR = 3600e3;

/* ------------------------------------------------------------- storage */

const LS = { favs: 'tvg.favs', chans: 'tvg.channels', zoom: 'tvg.zoom' };
const store = {
  get(k, fb) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const channelMap = new Map(CHANNELS.map(c => [c.id, c]));

let activeIds = (store.get(LS.chans, DEFAULT_CHANNEL_IDS) || []).filter(id => channelMap.has(id));
if (!activeIds.length) activeIds = [...DEFAULT_CHANNEL_IDS];
let favs = new Set(store.get(LS.favs, []).filter(id => channelMap.has(id)));
let favsOnly = false;
let viewMode = 'guide';
let todayKey = epg.londonDateKey();
let currentDayKey = todayKey;
const loadedDays = new Set();          // dateKeys requested for active channels
const timelineCache = new Map();       // channelId -> timeline[] | null
let lastDataAt = 0;

const $ = (sel) => document.querySelector(sel);

/* -------------------------------------------------------- channel sets */

function activeChannels() {
  let list = activeIds.map(id => channelMap.get(id)).filter(Boolean);
  if (favsOnly) {
    const f = list.filter(c => favs.has(c.id));
    if (f.length) list = f;
  }
  return [...list].sort((a, b) => (favs.has(b.id) - favs.has(a.id)) ||
    activeIds.indexOf(a.id) - activeIds.indexOf(b.id));
}

function timelineFor(id) {
  if (!loadedDays.size) return null;
  if (!timelineCache.has(id)) timelineCache.set(id, epg.mergedTimeline(id, [...loadedDays]));
  return timelineCache.get(id);
}

/** True when every requested day has settled (loaded or failed) for this channel. */
function loadedFully(id) {
  for (const dk of loadedDays) {
    const e = epg.getCached(id, dk);
    if (!e) return false;
  }
  return true;
}

/* -------------------------------------------------------------- loading */

let progressShown = 0, progressTotal = 0;
function ensureDays(dateKeys, { channels = activeChannels() } = {}) {
  const fresh = dateKeys.filter(k => !loadedDays.has(k));
  for (const k of fresh) loadedDays.add(k);
  // invalidate cached timelines that don't cover the fresh days
  if (fresh.length) timelineCache.clear();

  const targets = channels.length ? channels : activeChannels();
  const keys = fresh.length ? fresh : [...loadedDays];
  epg.loadSet(targets.map(c => c.id), keys, (done, total) => {
    progressShown = done; progressTotal = total;
    updateLoading();
    setStatus(`${done}/${total} channels loaded`);
  });
}

epg.onUpdate((channelId) => {
  timelineCache.delete(channelId);
  lastDataAt = Date.now();
  if (viewMode === 'guide') guide.invalidate(channelId);
  else renderNowNext();
  updateStatus();
});

/* --------------------------------------------------------------- status */

function updateLoading() {
  const fill = document.getElementById('loadingFill');
  if (!fill || !progressTotal) return;
  const pct = Math.min(100, Math.round(progressShown / progressTotal * 100));
  fill.style.width = `${pct}%`;
  const text = document.getElementById('loadingText');
  if (text) text.textContent = `Loading ${progressShown} of ${progressTotal} channel days…`;
}
let loadingHidden = false;
function hideLoading() {
  if (loadingHidden) return;
  loadingHidden = true;
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('hide');
  setTimeout(() => el.remove(), 450);
}

function updateStatus() {
  const n = activeChannels().length;
  const parts = [`${n} channel${n === 1 ? '' : 's'}`];
  if (lastDataAt) parts.push(`updated ${epg.londonTime(lastDataAt)}`);
  if (typeof caches !== 'undefined') parts.push('cached for offline');
  setStatus(parts.join(' · '));
}
const setStatus = (t) => { $('#statusText').textContent = t; };

/* ------------------------------------------------------------ day tabs */

function dayKeys() {
  const start = epg.londonDayStart(todayKey);
  return Array.from({ length: DAYS }, (_, i) =>
    epg.londonDateKey(start + i * 24 * HOUR));
}

function buildTabs() {
  const tabs = $('#dayTabs');
  tabs.textContent = '';
  const keys = dayKeys();
  keys.forEach((key, i) => {
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
      : new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' })
          .format(new Date(epg.londonDayStart(key)));
    const b = document.createElement('button');
    b.className = 'day-tab' + (key === currentDayKey ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => selectDay(key));
    tabs.appendChild(b);
  });
}

function selectDay(key, { scroll = true } = {}) {
  currentDayKey = key;
  buildTabs();
  setView('guide');
  ensureDays([key, epg.londonDateKey(epg.londonDayStart(key) + 24 * HOUR)]);
  if (scroll) {
    const start = epg.londonDayStart(key) + 6 * HOUR; // guides start at 6am
    const dist = Math.abs(start - guide.tAtLeft);
    guide.scrollToTime(start, { smooth: dist < 6 * HOUR });
  }
}

/* --------------------------------------------------------------- guide */

const guide = new Guide($('#guideView'), {
  getChannels: activeChannels,
  getTimeline: timelineFor,
  loadedFully,
  isFav: (ch) => favs.has(ch.id),
  groupOf: (ch) => ch.group || 'Entertainment',
  noData: (ch) => ch.on === 0,
  onStarClick: (ch) => toggleFav(ch.id),
  onProgrammeClick: openDetails,
});

const savedZoom = store.get(LS.zoom, null);
if (savedZoom) guide.pxPerMin = Math.min(8, Math.max(0.8, savedZoom));
guide.layout();
guide.scrollToTime(Date.now() - 40 * 60e3, { smooth: false }); // now-ish, instantly

/* ------------------------------------------------------------- details */

function playerFor(channelName, title) {
  const n = channelName.toLowerCase();
  const q = encodeURIComponent(title);
  if (/^bbc/.test(n)) return ['BBC iPlayer', `https://www.bbc.co.uk/iplayer/search?q=${q}`];
  if (/^itv/.test(n)) return ['ITVX', `https://www.itv.com/watch/search?q=${q}`];
  if (/^(channel 4|e4|more4|film4|4seven)/.test(n)) return ['Channel 4', `https://www.channel4.com/search?q=${q}`];
  if (/^(channel 5|5star|5usa|5select|5action|5 action)/.test(n)) return ['My5', `https://www.channel5.com/search?q=${q}`];
  return null;
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? (mm ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`;
}

function openDetails(p, ch) {
  const modal = $('#detailsModal');
  const now = Date.now();
  const onNow = p.start <= now && now < p.end;
  const past = p.end <= now;
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(p.start));
  const player = playerFor(ch.name, p.title);

  const statusHtml = onNow
    ? `<span class="pill live">On now · ${Math.round((now - p.start) / (p.end - p.start) * 100)}%</span>`
    : past ? `<span class="pill dim">Ended</span>`
    : `<span class="pill soon">Starts ${relativeStart(p.start, now)}</span>`;

  modal.innerHTML = `
    <div class="modal-card" role="document">
      <button class="modal-close" aria-label="Close">×</button>
      <div class="d-channel">
        <span class="gdot g-${ch.group}"></span>${ch.name}
        <span class="pill group">${ch.group}</span>
      </div>
      <h2 id="detailsTitle">${escapeHtml(p.title)}</h2>
      <div class="d-time">${dateLabel} · ${epg.londonTime(p.start)} – ${epg.londonTime(p.end)} <span class="dim">(${fmtDuration(p.end - p.start)})</span> ${statusHtml}</div>
      ${p.desc ? `<p class="d-desc">${escapeHtml(p.desc)}</p>` : '<p class="d-desc dim">No description available.</p>'}
      ${p.tags?.length ? `<div class="d-tags">${p.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="d-actions">
        ${player ? `<a class="btn accent" target="_blank" rel="noopener" href="${player[1]}">Watch on ${player[0]}</a>` : ''}
        <a class="btn" target="_blank" rel="noopener" href="https://www.justwatch.com/uk/search?q=${encodeURIComponent(p.title)}">Find on JustWatch</a>
      </div>
    </div>`;
  modal.hidden = false;
  modal.querySelector('.modal-close').addEventListener('click', closeDetails);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeDetails(); });
}

function relativeStart(start, now) {
  const m = Math.round((start - now) / 60000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `in ${h}h ${m % 60}m` : `in ${h}h`;
}

function closeDetails() { $('#detailsModal').hidden = true; }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* -------------------------------------------------------------- search */

const searchBox = $('#searchBox');
const searchResults = $('#searchResults');
let searchTimer = 0, searchSel = -1;

function runSearch(q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) { searchResults.hidden = true; searchResults.textContent = ''; return; }
  const now = Date.now();
  const hits = [];
  for (const ch of activeChannels()) {
    const tl = timelineFor(ch.id);
    if (!tl) continue;
    for (const p of tl) {
      const t = p.title.toLowerCase();
      if (t.includes(q)) {
        const prefix = t.startsWith(q) ? 0 : 1;
        const timeScore = Math.abs(p.start - now) / 3e10; // favour near-now
        hits.push({ p, ch, score: prefix * 100 + timeScore });
      }
    }
  }
  hits.sort((a, b) => a.score - b.score);
  renderSearchResults(hits.slice(0, 60));
}

function renderSearchResults(hits) {
  searchSel = -1;
  searchResults.textContent = '';
  if (!hits.length) {
    const d = document.createElement('div');
    d.className = 'sr-empty';
    d.textContent = 'No matches in loaded days. Try another day or more channels.';
    searchResults.appendChild(d);
  } else {
    const now = Date.now();
    hits.forEach(({ p, ch }) => {
      const b = document.createElement('button');
      b.className = 'sr-item' + (p.end <= now ? ' past' : '');
      const dayBit = dayKeys().indexOf(epg.londonDateKey(p.start));
      const dayName = dayBit <= 0 ? '' : dayBit === 1 ? 'Tomorrow' :
        new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(p.start);
      b.innerHTML = `
        <span class="sr-time">${epg.londonTime(p.start)}</span>
        <span class="sr-title">${escapeHtml(p.title)}</span>
        <span class="sr-ch"><span class="gdot g-${ch.group}"></span>${escapeHtml(ch.name)}</span>
        <span class="sr-day">${dayName}</span>`;
      b.addEventListener('click', () => {
        searchResults.hidden = true;
        setView('guide');
        const key = epg.londonDateKey(p.start);
        if (key !== currentDayKey) selectDay(key, { scroll: false });
        guide.revealProgramme(p, ch.id);
        openDetails(p, ch);
      });
      searchResults.appendChild(b);
    });
  }
  searchResults.hidden = false;
}

searchBox.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(searchBox.value), 160);
});
searchBox.addEventListener('focus', () => { if (searchBox.value.trim().length >= 2) runSearch(searchBox.value); });
searchBox.addEventListener('keydown', (e) => {
  const items = [...searchResults.querySelectorAll('.sr-item')];
  if (e.key === 'Escape') { searchResults.hidden = true; searchBox.blur(); return; }
  if (!items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    searchSel = e.key === 'ArrowDown'
      ? (searchSel + 1) % items.length
      : (searchSel - 1 + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('sel', i === searchSel));
    items[searchSel].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && searchSel >= 0) {
    items[searchSel].click();
  } else if (e.key === 'Enter' && items.length) {
    items[0].click();
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) searchResults.hidden = true;
});

/* ---------------------------------------------------------- now & next */

function renderNowNext() {
  const view = $('#nowView');
  const now = Date.now();
  view.textContent = '';
  const channels = activeChannels();
  if (!channels.length) return;
  const frag = document.createDocumentFragment();
  for (const ch of channels) {
    const tl = timelineFor(ch.id);
    const { prog } = tl ? epg.programmeAt(tl, now) : { prog: null };
    let next = null;
    if (tl) { const n = epg.programmeAt(tl, now, { next: true }); next = n.prog; }

    const card = document.createElement('button');
    card.className = 'nn-card';
    if (prog) {
      card.innerHTML = `
        <div class="nn-head"><span class="gdot g-${ch.group}"></span><span class="nn-ch">${escapeHtml(ch.name)}</span></div>
        <div class="nn-main">
          <div class="nn-now">
            <div class="nn-title">${escapeHtml(prog.title)}</div>
            <div class="nn-time">${epg.londonTime(prog.start)} – ${epg.londonTime(prog.end)}</div>
            <div class="nn-bar"><span style="width:${Math.min(100, Math.round((now - prog.start) / (prog.end - prog.start) * 100))}%"></span></div>
          </div>
          ${next ? `<div class="nn-next"><span class="nn-next-label">Next</span> ${escapeHtml(next.title)} <span class="dim">${epg.londonTime(next.start)}</span></div>` : ''}
        </div>`;
      card.addEventListener('click', () => openDetails(prog, ch));
    } else {
      card.innerHTML = `
        <div class="nn-head"><span class="gdot g-${ch.group}"></span><span class="nn-ch">${escapeHtml(ch.name)}</span></div>
        <div class="nn-main"><div class="nn-now dim">${ch.on === 0 ? 'No listings' : 'Loading…'}</div></div>`;
      card.disabled = ch.on === 0;
    }
    frag.appendChild(card);
  }
  view.appendChild(frag);
}

/* ------------------------------------------------------------ view mode */

function setView(mode) {
  viewMode = mode;
  $('#guideView').hidden = mode !== 'guide';
  $('#nowView').hidden = mode !== 'now';
  $('#btnGuideView').classList.toggle('on', mode === 'guide');
  $('#btnNowNextView').classList.toggle('on', mode === 'now');
  $('#btnGuideView').setAttribute('aria-selected', mode === 'guide');
  $('#btnNowNextView').setAttribute('aria-selected', mode === 'now');
  if (mode === 'now') renderNowNext();
}

$('#btnGuideView').addEventListener('click', () => setView('guide'));
$('#btnNowNextView').addEventListener('click', () => setView('now'));
setInterval(() => { if (viewMode === 'now') renderNowNext(); }, 60e3);

/* ---------------------------------------------------------- favourites */

function toggleFav(id) {
  if (favs.has(id)) favs.delete(id); else favs.add(id);
  store.set(LS.favs, [...favs]);
  if (viewMode === 'guide') { guide.layout(); guide.render(true); }
  else renderNowNext();
  updateFavBtn();
}

function updateFavBtn() {
  const b = $('#btnFavs');
  b.classList.toggle('on', favsOnly);
  b.setAttribute('aria-pressed', String(favsOnly));
  b.style.color = favsOnly ? 'var(--accent)' : '';
  b.style.opacity = favs.length ? 1 : 0.45;
}
$('#btnFavs').addEventListener('click', () => {
  if (!favs.length) { $('#btnFavs').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], 250); return; }
  favsOnly = !favsOnly;
  updateFavBtn();
  if (viewMode === 'guide') { guide.layout(); guide.render(true); }
  else renderNowNext();
});

/* ------------------------------------------------------ channel manager */

function openChannelsModal() {
  const modal = $('#channelsModal');
  modal.innerHTML = `
    <div class="modal-card wide" role="document">
      <button class="modal-close" aria-label="Close">×</button>
      <h2 id="channelsModalTitle">Channels</h2>
      <div class="cm-tools">
        <input id="cmFilter" type="search" placeholder="Filter channels…" autocomplete="off">
        <span class="dim" id="cmCount"></span>
      </div>
      <div class="cm-groups" id="cmGroups"></div>
      <div class="cm-footer">
        <button class="btn" id="cmReset">Reset to defaults</button>
        <button class="btn accent" id="cmApply">Done</button>
      </div>
    </div>`;
  modal.hidden = false;

  const selected = new Set(activeIds);
  const groups = $('#cmGroups');
  const filterBox = $('#cmFilter');
  let filter = '';

  const render = () => {
    groups.textContent = '';
    for (const g of GROUP_ORDER) {
      const all = CHANNELS.filter(c => c.group === g).sort((a, b) => a.name.localeCompare(b.name));
      const shown = all.filter(c => c.name.toLowerCase().includes(filter));
      if (!shown.length) continue;
      const box = document.createElement('div');
      box.className = 'cm-group';
      const onCount = shown.filter(c => selected.has(c.id)).length;
      box.innerHTML = `
        <div class="cm-group-head">
          <button class="cm-toggle all">${g}<span class="cm-count">${onCount}/${shown.length}</span></button>
          <button class="cm-mini" data-act="all">All</button>
          <button class="cm-mini" data-act="none">None</button>
        </div>`;
      const list = document.createElement('div');
      list.className = 'cm-list';
      for (const c of shown) {
        const item = document.createElement('label');
        item.className = 'cm-item' + (c.on === 0 ? ' dead' : '');
        item.innerHTML = `
          <input type="checkbox" ${selected.has(c.id) ? 'checked' : ''}>
          <span class="cm-name">${escapeHtml(c.name)}</span>
          ${c.on === 0 ? '<span class="tag dim-tag">no data</span>' : ''}`;
        item.querySelector('input').addEventListener('change', (e) => {
          e.target.checked ? selected.add(c.id) : selected.delete(c.id);
          render();
        });
        list.appendChild(item);
      }
      box.appendChild(list);
      box.querySelector('[data-act="all"]').addEventListener('click', () => {
        shown.forEach(c => selected.add(c.id)); render();
      });
      box.querySelector('[data-act="none"]').addEventListener('click', () => {
        shown.forEach(c => selected.delete(c.id)); render();
      });
      groups.appendChild(box);
    }
    $('#cmCount').textContent = `${selected.size} selected`;
  };
  render();

  filterBox.addEventListener('input', () => { filter = filterBox.value.trim().toLowerCase(); render(); });
  modal.querySelector('.modal-close').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  $('#cmReset').addEventListener('click', () => {
    selected.clear();
    DEFAULT_CHANNEL_IDS.forEach(id => selected.add(id));
    render();
  });
  $('#cmApply').addEventListener('click', () => {
    const ids = [...selected];
    activeIds = ids.length ? ids : [...DEFAULT_CHANNEL_IDS];
    store.set(LS.chans, activeIds);
    timelineCache.clear();
    modal.hidden = true;
    guide.layout();
    guide.render(true);
    ensureDays([...loadedDays]);
    updateStatus();
  });
}
$('#btnChannels').addEventListener('click', openChannelsModal);

/* --------------------------------------------------------------- misc ui */

$('#btnNow').addEventListener('click', () => {
  currentDayKey = todayKey;
  buildTabs();
  setView('guide');
  ensureDays([todayKey, epg.londonDateKey(epg.londonDayStart(todayKey) + 24 * HOUR)]);
  guide.scrollToTime(Date.now() - 20 * 60e3);
});

$('#zoomIn').addEventListener('click', () => { guide.zoomBy(1.3); store.set(LS.zoom, guide.pxPerMin); });
$('#zoomOut').addEventListener('click', () => { guide.zoomBy(1 / 1.3); store.set(LS.zoom, guide.pxPerMin); });

document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, select');
  if (e.key === 'Escape') {
    closeDetails(); $('#channelsModal').hidden = true; searchResults.hidden = true;
    return;
  }
  if (typing) return;
  switch (e.key) {
    case '/': e.preventDefault(); searchBox.focus(); searchBox.select(); break;
    case 'n': $('#btnNow').click(); break;
    case 't': selectDay(todayKey); break;
    case 'f': $('#btnFavs').click(); break;
    case '+': case '=': guide.zoomBy(1.3); store.set(LS.zoom, guide.pxPerMin); break;
    case '-': case '_': guide.zoomBy(1 / 1.3); store.set(LS.zoom, guide.pxPerMin); break;
    case 'ArrowLeft': case 'ArrowRight': {
      if (viewMode !== 'guide') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const step = (e.shiftKey ? 6 : 1) * HOUR / guide.pxPerMin;
      guide.scroller.scrollBy({ left: dir * step, behavior: 'smooth' });
      break;
    }
  }
});

/* --------------------------------------------------------------- boot */

// offline-capable app shell (harmless no-op when unsupported / file://)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

buildTabs();
updateFavBtn();
updateStatus();
selectDay(todayKey, { scroll: false });
guide.scrollToTime(Date.now() - 40 * 60e3, { smooth: false });

// hide the loading overlay once a useful slice of data is in (or after 2.5s)
const hideTimer = setTimeout(hideLoading, 2500);
epg.onUpdate(() => { if (progressShown >= Math.min(12, progressTotal)) { clearTimeout(hideTimer); hideLoading(); } });

// midnight rollover — shift tabs and refresh "today" data
setInterval(() => {
  const key = epg.londonDateKey();
  if (key !== todayKey) {
    todayKey = key;
    timelineCache.clear();
    loadedDays.delete(key);
    currentDayKey = key;
    buildTabs();
    ensureDays([key, epg.londonDateKey(epg.londonDayStart(key) + 24 * HOUR)]);
    if (viewMode === 'guide') guide.layout();
    else renderNowNext();
  }
}, 60e3);

/* ----------------------------------------------------- install banner */
// Suggest adding the guide to the phone home screen. Dismissing hides it for
// 6 months (localStorage); installing hides it for good. Desktop never sees it.

const SIX_MONTHS_MS = 6 * 30 * 86400e3;
const LS_BANNER = {
  installed: 'tvg.installBanner.installed',
  optOut: 'tvg.installBanner.optOutAt',
};
const banner = $('#installBanner');
const btnInstall = $('#btnInstall');
const installHint = $('#installHint');
let installPrompt = null;

const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isPhone = () =>
  matchMedia('(hover: none) and (pointer: coarse)').matches && innerWidth <= 760;
const isIOS = () =>
  /iphone|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS

function showInstallBanner() {
  if (!banner.hidden) return;
  if (!isPhone() || isStandalone()) return;
  if (store.get(LS_BANNER.installed, false)) return;
  if (Date.now() - (store.get(LS_BANNER.optOut, 0) || 0) < SIX_MONTHS_MS) return;

  // iOS Safari fires beforeinstallprompt as a placeholder but never implements
  // prompt() — always send iPhones down the manual-instructions path.
  if (installPrompt && !isIOS()) {
    installHint.textContent = 'One tap to install — full screen, works offline.';
    btnInstall.hidden = false;
  } else if (isIOS()) {
    installHint.textContent = 'In Safari: Share ⇧ → “Add to Home Screen”.';
  } else {
    installHint.textContent = 'From your browser menu, choose “Add to Home screen”.';
  }
  banner.hidden = false;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (!banner.hidden && !isIOS()) {
    // banner already showing via the fallback path — upgrade it to the native flow
    installHint.textContent = 'One tap to install — full screen, works offline.';
    btnInstall.hidden = false;
  } else {
    showInstallBanner();
  }
});
window.addEventListener('appinstalled', () => {
  store.set(LS_BANNER.installed, true);
  banner.hidden = true;
});

$('#btnInstallNo').addEventListener('click', () => {
  store.set(LS_BANNER.optOut, Date.now());
  banner.hidden = true;
});
btnInstall.addEventListener('click', async () => {
  if (!installPrompt) return;
  const ev = installPrompt;
  installPrompt = null;
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'accepted') store.set(LS_BANNER.installed, true);
    banner.hidden = true;
  } catch {
    // prompt() rejected — stale or placeholder event (e.g. iOS): swap the dead
    // button for the manual steps rather than failing silently.
    btnInstall.hidden = true;
    installHint.textContent = isIOS()
      ? 'In Safari: Share ⇧ → “Add to Home Screen”.'
      : 'From your browser menu, choose “Add to Home screen”.';
  }
});

// let the guide paint first, then nudge
setTimeout(showInstallBanner, 1200);
