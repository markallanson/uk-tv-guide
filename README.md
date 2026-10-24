# 📺 UK TV Guide

**Live:** <https://uk-tv-guide.allanson.org> — deploy status: [![Deploy](https://github.com/markallanson/uk-tv-guide/actions/workflows/deploy.yml/badge.svg)](https://github.com/markallanson/uk-tv-guide/actions/workflows/deploy.yml)

A fast, free UK TV guide that **runs entirely in your browser**. No backend, no build
step, no API keys — just static files and a free, CORS-enabled EPG API.

![Guide](https://img.shields.io/badge/data-source-epg.pw-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Sky-style channel × time grid** — 87 popular channels on by default, 430+ available
- **8 days of listings** with day tabs (Today, Tomorrow, …)
- **Now line** with live "on now" highlighting and progress bars
- **Now & Next view** — quick cards for "what's on right now"
- **Instant search** across every loaded programme, with keyboard navigation
- **Favourites** — star channels, pin them to the top, filter to favourites only
- **Channel manager** — add/remove channels by group (Sport, Movies, Kids, News, …)
- **Deep-link watch buttons** — jumps straight to iPlayer / ITVX / Channel 4 / My5
  searches for the programme, plus JustWatch
- **Zoom** the timeline in/out; sticky time header and channel column
- **Works offline** after first visit (service worker + Cache API)
- **Keyboard shortcuts** — see below
- Dark, dense, mobile-friendly design with zero external dependencies (no CDN,
  no fonts, no trackers)

## Run it

Any static file server works. For example:

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

Or drop the folder onto any static host (GitHub Pages, Netlify, Cloudflare Pages…).
Opening `index.html` directly via `file://` won't work — browsers block `fetch()` and
modules on `file://` — so use a local server or a host.

> Offline caching (service worker + Cache API) needs `http://localhost` or HTTPS.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | focus search |
| `←` / `→` | scroll time (±1h, hold `Shift` for ±6h) |
| `N` | jump to now |
| `T` | jump to today |
| `F` | toggle favourites-only |
| `+` / `−` | zoom in / out |
| `Esc` | close dialogs |

## Data source

Listings come from [epg.pw](https://epg.pw)'s free JSON API
(`https://epg.pw/api/epg.json?channel_id=…&date=YYYY-MM-DD`), which is CORS-enabled
(`Access-Control-Allow-Origin: *`) so it can be called straight from the browser.
Times are always shown in UK time (`Europe/London`) with correct DST handling.

The channel list is baked in at build time. To regenerate it (re-scrapes epg.pw's
published UK channel list, verifies which IDs currently have live data, and rewrites
`js/channels.js`):

```sh
node tools/build-channels.mjs
```

## Development

```sh
npm install                # pulls puppeteer-core for the smoke test (optional)
python3 -m http.server 8123 &
node tools/smoke.mjs       # headless end-to-end test against system Chromium
node tools/test-time.mjs   # DST/timezone unit tests
```

## Project layout

```
index.html          app shell
css/style.css       base styling (dark theme, desktop)
css/mobile.css      phones/small tablets (touch targets, bottom sheets, safe areas)
js/channels.js      generated channel list (id, name, group)
js/epg.js           data layer: epg.pw client, caching, London-time helpers
js/guide.js         virtualised guide grid renderer (reads --ch-w from CSS)
js/app.js           app logic: tabs, search, modals, Now & Next, shortcuts
sw.js               service worker (offline app shell)
tools/              channel builder + tests
```

## Mobile

Mobile styles live in `css/mobile.css`: 40px+ touch targets, full-width swipeable
day tabs, single-column Now & Next, modals that slide up as bottom sheets with
notch-safe padding, no sticky hover states, and an iOS-safe 16px search input.
The guide grid's channel-column width is driven by the `--ch-w` CSS variable at
breakpoints 760px (118px) and 380px (104px). Verify with `node tools/mobile-test.mjs`.

## Notes

- Listings data belongs to its respective providers (Sky/epg.pw) — personal use.
- "Today" data is refreshed from the network at most every 30 minutes; past and
  future days are served from cache.
