/**
 * guide.js — virtualised channel × time grid renderer.
 *
 * Timeline spans 8 London days starting today. Rows are virtualised vertically;
 * programme blocks are clipped to the visible time window horizontally.
 * The time header and channel column are sticky inside one scroll container.
 */
import { londonDayStart, londonDateKey, londonTime } from './epg.js';

export const DAYS = 8;
export const ROW_H = 64;
export const HEADER_H = 52;

const HOUR = 3600e3, HALF = 1800e3;

export class Guide {
  /**
   * @param root  element containing .guide-scroller etc (built by index.html)
   * @param opts  { getChannels(), getTimeline(id), onProgrammeClick, onStarClick,
   *                isFav(id), groupOf(id), noData(id) }
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.scroller = root.querySelector('.guide-scroller');
    this.inner = root.querySelector('.guide-inner');
    this.timeHeader = root.querySelector('.time-header');
    this.rowsLayer = root.querySelector('.rows-layer');
    this.nowLine = root.querySelector('.now-line');

    this.pxPerMin = 2.2;
    this.t0 = londonDayStart(londonDateKey());           // timeline start (ms)
    this.t1 = this.t0 + DAYS * 24 * HOUR;                // timeline end (ms)
    this.chColW = 208;

    this.rowEls = new Map();      // index -> element
    this.dirtyRows = new Set();
    this.flashProg = null;

    this._onScroll = () => this._scheduleRender();
    this.scroller.addEventListener('scroll', this._onScroll, { passive: true });
    addEventListener('resize', () => this.layout());

    this._nowTimer = setInterval(() => this._tickNow(), 30e3);
  }

  destroy() {
    clearInterval(this._nowTimer);
    this.scroller.removeEventListener('scroll', this._onScroll);
  }

  /* ------------------------------------------------------------ layout */

  /** Channel-column width comes from the CSS var --ch-w (mobile.css tunes it). */
  readChannelColWidth() {
    const v = parseFloat(getComputedStyle(this.root).getPropertyValue('--ch-w'));
    return Number.isFinite(v) && v >= 80 ? v : 208;
  }

  layout() {
    this.chColW = this.readChannelColWidth();
    this.timelineW = (this.t1 - this.t0) / 60000 * this.pxPerMin;
    this.n = this.opts.getChannels().length;
    this.inner.style.width = `${this.timelineW + this.chColW}px`;
    this.inner.style.height = `${HEADER_H + this.n * ROW_H}px`;
    this._buildHeader();
    this.render(true);
    this._tickNow();
  }

  setZoom(pxPerMin, anchorClientX) {
    const rect = this.scroller.getBoundingClientRect();
    const ax = anchorClientX ?? rect.width / 2;
    const anchorMin = (this.scroller.scrollLeft + ax - this.chColW) / this.pxPerMin;
    this.pxPerMin = Math.min(8, Math.max(0.8, pxPerMin));
    this.layout();
    this.scroller.scrollLeft = Math.max(0, anchorMin * this.pxPerMin + this.chColW - ax);
  }

  zoomBy(factor, x) { this.setZoom(this.pxPerMin * factor, x); }

  /** Scroll so that time `t` (ms) sits at the left edge of the timeline area. */
  scrollToTime(t, { smooth = true } = {}) {
    const x = (t - this.t0) / 60000 * this.pxPerMin + this.chColW;
    this.scroller.scrollTo({ left: Math.max(0, x), behavior: smooth ? 'smooth' : 'auto' });
  }

  centreOnTime(t) {
    const x = (t - this.t0) / 60000 * this.pxPerMin + this.chColW;
    this.scroller.scrollTo({ left: Math.max(0, x - (this.scroller.clientWidth - this.chColW) / 2) });
  }

  get tAtLeft() {
    return this.t0 + Math.max(0, this.scroller.scrollLeft - this.chColW) / this.pxPerMin * 60000;
  }

  /* ------------------------------------------------------------ header */

  _buildHeader() {
    const frag = document.createDocumentFragment();
    const step = this.pxPerMin >= 1.6 ? HALF : HOUR; // tick density by zoom
    for (let t = this.t0; t < this.t1; t += step) {
      const d = new Date(t);
      const wall = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
      if (wall === '00:00') continue; // day marker instead
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.textContent = wall;
      tick.style.left = `${(t - this.t0) / 60000 * this.pxPerMin + this.chColW}px`;
      frag.appendChild(tick);
    }
    for (let t = this.t0; t < this.t1; t += 24 * HOUR) {
      const d = new Date(t);
      const label = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
      }).format(d);
      const day = document.createElement('div');
      day.className = 'day-mark';
      day.textContent = label;
      day.style.left = `${(t - this.t0) / 60000 * this.pxPerMin + this.chColW}px`;
      frag.appendChild(day);
    }
    this.timeHeader.querySelectorAll('.tick, .day-mark').forEach(el => el.remove());
    this.timeHeader.appendChild(frag);
  }

  /* ------------------------------------------------------------- render */

  _scheduleRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }

  render(full = false) {
    const st = this.scroller.scrollTop, sl = this.scroller.scrollLeft;
    const vh = this.scroller.clientHeight;

    const first = Math.max(0, Math.floor((st - HEADER_H) / ROW_H) - 3);
    const last = Math.min(this.n - 1, Math.ceil((st + vh - HEADER_H) / ROW_H) + 6);

    const winT0 = this.t0 + Math.max(0, sl - this.chColW) / this.pxPerMin * 60000 - HOUR;
    const winT1 = this.t0 + (sl + this.scroller.clientWidth) / this.pxPerMin * 60000 + HOUR;

    // drop out-of-range rows
    for (const [i, el] of this.rowEls) {
      if (i < first || i > last || full) { el.remove(); this.rowEls.delete(i); }
    }

    const channels = this.opts.getChannels();
    const now = Date.now();
    for (let i = first; i <= last; i++) {
      const ch = channels[i];
      if (!ch) continue;
      let el = full ? null : this.rowEls.get(i);
      if (!el) {
        el = this._buildRow(i, ch);
        this.rowsLayer.appendChild(el);
        this.rowEls.set(i, el);
      }
      this._fillRow(el, ch, winT0, winT1, now);
    }
  }

  _buildRow(i, ch) {
    const el = document.createElement('div');
    el.className = 'grow';
    el.style.top = `${HEADER_H + i * ROW_H}px`;
    el.style.height = `${ROW_H}px`;

    const cell = document.createElement('div');
    cell.className = 'ch-cell';
    cell.dataset.id = ch.id;
    const dot = document.createElement('span');
    dot.className = `gdot g-${this.opts.groupOf(ch)}`;
    const name = document.createElement('span');
    name.className = 'ch-name';
    name.textContent = ch.name;
    name.title = ch.name;
    const star = document.createElement('button');
    star.className = 'star';
    star.setAttribute('aria-label', 'Favourite channel');
    star.innerHTML = SVG_STAR;
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      this.opts.onStarClick(ch);
    });
    cell.append(dot, name, star);
    el.appendChild(cell);

    const progs = document.createElement('div');
    progs.className = 'progs';
    el.appendChild(progs);
    return el;
  }

  _fillRow(el, ch, winT0, winT1, now) {
    const progsEl = el.querySelector('.progs');
    const timeline = this.opts.getTimeline(ch.id);
    const star = el.querySelector('.star');
    star.classList.toggle('on', !!this.opts.isFav(ch.id));

    progsEl.textContent = '';
    if (!timeline) {                       // not loaded yet
      const s = document.createElement('div');
      s.className = 'skeleton-prog';
      s.style.left = '0';
      s.style.width = '100%';
      progsEl.appendChild(s);
      return;
    }
    if (timeline.length === 0 || this.opts.noData(ch)) {
      const e = document.createElement('div');
      e.className = 'nodata-prog';
      e.textContent = this.opts.noData(ch) || (timeline.length === 0 && this.opts.loadedFully?.(ch.id))
        ? 'No listings' : 'Loading…';
      e.style.left = '0';
      e.style.width = '100%';
      progsEl.appendChild(e);
      return;
    }

    const toX = (t) => (t - this.t0) / 60000 * this.pxPerMin;
    for (const p of timeline) {
      if (p.end < winT0) continue;
      if (p.start > winT1) break;
      const left = toX(p.start);
      const w = Math.max(14, toX(p.end) - toX(p.start) - 2);
      const b = document.createElement('button');
      b.className = 'prog';
      b.dataset.group = this.opts.groupOf(ch);
      const onNow = p.start <= now && now < p.end;
      const past = p.end <= now;
      if (onNow) b.classList.add('on-now');
      else if (past) b.classList.add('past');
      b.style.left = `${left}px`;
      b.style.width = `${w}px`;
      const timeEl = document.createElement('span');
      timeEl.className = 'p-time';
      timeEl.textContent = londonTime(p.start);
      const titleEl = document.createElement('span');
      titleEl.className = 'p-title';
      titleEl.textContent = p.title;
      b.append(timeEl, titleEl);
      if (onNow) {
        const bar = document.createElement('span');
        bar.className = 'p-progress';
        bar.style.width = `${Math.round((now - p.start) / (p.end - p.start) * 100)}%`;
        b.appendChild(bar);
      }
      if (this.flashProg === p) {
        b.classList.add('flash');
        this.flashProg = null;
      }
      b.title = `${p.title} — ${londonTime(p.start)}–${londonTime(p.end)}`;
      b.addEventListener('click', () => this.opts.onProgrammeClick(p, ch));
      progsEl.appendChild(b);
    }
  }

  /** Mark a channel's row for refresh (called after data loads). */
  invalidate(channelId) {
    const channels = this.opts.getChannels();
    const i = channels.findIndex(c => c.id === channelId);
    if (i >= 0) {
      const el = this.rowEls.get(i);
      const ch = channels[i];
      if (el) this._fillRow(el, ch, this.tAtLeft - HOUR, this.tAtLeft + this.scroller.clientWidth / this.pxPerMin * 60000 + HOUR, Date.now());
    }
  }

  /** Scroll to a programme (channel row + time) and flash it. */
  revealProgramme(p, channelId) {
    const channels = this.opts.getChannels();
    const i = channels.findIndex(c => c.id === channelId);
    if (i >= 0) {
      this.scroller.scrollTop = Math.max(0, HEADER_H + i * ROW_H - (this.scroller.clientHeight - HEADER_H) / 2 + ROW_H / 2);
    }
    this.centreOnTime((p.start + p.end) / 2);
    this.flashProg = p;
    this.render(true);
    // re-apply after smooth scroll settles
    setTimeout(() => { this.flashProg = p; this.render(true); }, 450);
  }

  /* ----------------------------------------------------------- now line */

  _tickNow() {
    const now = Date.now();
    const visible = now >= this.t0 && now < this.t1;
    this.nowLine.style.display = visible ? '' : 'none';
    if (visible) {
      this.nowLine.style.left = `${(now - this.t0) / 60000 * this.pxPerMin + this.chColW}px`;
    }
    this._scheduleRender(); // refresh on-now styling
  }
}

const SVG_STAR = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 17.3l-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z"/></svg>';
