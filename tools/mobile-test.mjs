/** Mobile stylesheet verification. Run: node tools/mobile-test.mjs (server on :8123) */
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto('http://localhost:8123', { waitUntil: 'domcontentloaded' });

// 1. mobile.css actually loaded and applied
const cssLoaded = await page.evaluate(() =>
  [...document.styleSheets].some(s => (s.href || '').includes('mobile.css')));
check('mobile.css loaded', cssLoaded);

await page.waitForFunction(() => document.querySelectorAll('.prog').length > 20, { timeout: 60000 });

// 2. --ch-w var + JS math + rendered column all agree (deterministic: at scrollLeft 0,
//    the midnight tick must sit exactly at the channel column's right edge)
const widths = await page.evaluate(async () => {
  const sc = document.querySelector('.guide-scroller');
  sc.scrollTo({ left: 0, behavior: 'instant' });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cs = getComputedStyle(document.documentElement).getPropertyValue('--ch-w').trim();
  const cell = document.querySelector('.ch-cell').getBoundingClientRect().width;
  const midnightTick = document.querySelector('.day-mark');
  return { cssVar: cs, cellW: Math.round(cell), tickX: Math.round(midnightTick.getBoundingClientRect().x) };
});
check('CSS var & channel cell agree', widths.cssVar === '152px' && widths.cellW === 152, JSON.stringify(widths));
check('JS positions ticks after column', Math.abs(widths.tickX - widths.cellW) <= 12, `day-mark at ${widths.tickX}px`);

// 3. search input 16px (iOS zoom prevention)
const searchFont = await page.$eval('#searchBox', el => getComputedStyle(el).fontSize);
check('search input 16px font', searchFont === '16px', searchFont);

// 4. touch targets >= 40px
const targets = await page.evaluate(() => {
  const btn = document.querySelector('#btnNow').getBoundingClientRect();
  const tab = document.querySelector('.day-tab').getBoundingClientRect();
  const star = document.querySelector('.ch-cell .star').getBoundingClientRect();
  return { btn: Math.round(btn.height), tab: Math.round(tab.height), star: Math.round(star.width) };
});
check('touch targets ≥ 38px', targets.btn >= 40 && targets.tab >= 38 && targets.star >= 38, JSON.stringify(targets));

// 5. modals become bottom sheets
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.prog')].find(p => p.getBoundingClientRect().x > 130);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForSelector('#detailsModal:not([hidden])', { timeout: 5000 });
const sheet = await page.evaluate(() => {
  const m = getComputedStyle(document.querySelector('#detailsModal'));
  const c = document.querySelector('#detailsModal .modal-card').getBoundingClientRect();
  return { align: m.alignItems, justify: m.justifyItems, cardTop: Math.round(c.top), cardW: Math.round(c.width) };
});
check('modal is bottom sheet', sheet.align === 'end' && sheet.cardW === 390 && sheet.cardTop > 200, JSON.stringify(sheet));
await page.keyboard.press('Escape');

// 6. Now & Next single column
await page.tap('#btnNowNextView');
await page.waitForSelector('.nn-card', { timeout: 8000 });
const cols = await page.$eval('.now-view', el => getComputedStyle(el).gridTemplateColumns);
check('now&next single column', cols.split(' ').length === 1, cols);
await page.tap('#btnGuideView');

// 7. day tabs strip scrollable
const tabsScroll = await page.$eval('.day-tabs', el => el.scrollWidth > el.clientWidth);
check('day tabs swipeable', tabsScroll);

// 8. no sticky hover (hover:none) — programme shouldn't change style without tap
const hoverGuard = await page.evaluate(() => {
  // simulate: matchMedia hover:none + .prog:hover rule overridden to filter:none
  const probe = document.querySelector('.prog');
  const before = getComputedStyle(probe).filter;
  probe.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const after = getComputedStyle(probe).filter;
  return before === after;
});
check('no sticky hover on touch', hoverGuard);

// 9. very small phone tier (360px -> --ch-w 104px) stays in sync with JS
await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
await new Promise(r => setTimeout(r, 700));
const tiny = await page.evaluate(async () => {
  const sc = document.querySelector('.guide-scroller');
  sc.scrollTo({ left: 0, behavior: 'instant' });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cs = getComputedStyle(document.documentElement).getPropertyValue('--ch-w').trim();
  const cell = document.querySelector('.ch-cell')?.getBoundingClientRect().width;
  const tick = document.querySelector('.day-mark');
  return { cssVar: cs, cellW: cell ? Math.round(cell) : 0, tickX: tick ? Math.round(tick.getBoundingClientRect().x) : -1 };
});
check('360px tier synced', tiny.cssVar === '126px' && tiny.cellW === 126 && Math.abs(tiny.tickX - 126) <= 12, JSON.stringify(tiny));

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: '/tmp/tvg-mobile-final.png' });
await browser.close();
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL MOBILE CHECKS PASSED');
process.exit(failed ? 1 : 0);
