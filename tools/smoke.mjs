/**
 * Headless smoke test — loads the app in system Chromium, checks core flows,
 * captures console errors and screenshots.
 * Run: node tools/smoke.mjs   (needs: python3 -m http.server 8123)
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:8123';
const errors = [];
const warnings = [];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.type() === 'warning') warnings.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
};

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

// 1. loading overlay eventually hides
await page.waitForSelector('#loading.hide', { timeout: 8000 }).catch(() => {});
check('loading overlay hidden',
  await page.$eval('#loading', el => el.classList.contains('hide')).catch(() => true));

// 2. day tabs
await page.waitForSelector('.day-tab', { timeout: 10000 });
const tabs = await page.$$eval('.day-tab', els => els.map(e => e.textContent));
check('8 day tabs', tabs.length === 8, tabs.slice(0, 3).join(','));

// 3. guide rows + programmes render with real data
await page.waitForFunction(() => document.querySelectorAll('.prog').length > 30, { timeout: 60000 });
const progCount = await page.$$eval('.prog', els => els.length);
check('programmes rendered', progCount > 30, `${progCount} blocks`);

const rows = await page.$$eval('.grow', els => els.length);
check('virtualised rows', rows > 0 && rows < 40, `${rows} rows in DOM`);

const onNow = await page.$$eval('.prog.on-now', els => els.length);
check('on-now highlighting', onNow > 0, `${onNow} marked`);

const nowLineVisible = await page.$eval('.now-line', el => getComputedStyle(el).display !== 'none');
check('now line visible', nowLineVisible);

const titles = await page.$$eval('.prog .p-title', els => els.slice(0, 5).map(e => e.textContent));
console.log('  sample titles:', titles.join(' | '));

// 4. channel cell content
const chName = await page.$eval('.ch-name', el => el.textContent);
check('channel names', !!chName, chName);

// 5. details modal opens (click a programme that's fully in view)
await page.waitForSelector('.prog.on-now', { timeout: 5000 });
await page.evaluate(() => {
  const els = [...document.querySelectorAll('.prog')];
  const target = els.find(el => {
    const r = el.getBoundingClientRect();
    return r.x > 240 && r.width > 60;
  }) || els[0];
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForSelector('#detailsModal:not([hidden])', { timeout: 5000 });
const detailsTitle = await page.$eval('#detailsTitle', el => el.textContent);
check('details modal opens with title', !!detailsTitle, detailsTitle);
const hasWatchLink = await page.$$eval('#detailsModal .d-actions a', els => els.map(a => a.textContent));
console.log('  action links:', hasWatchLink.join(', '));
await page.keyboard.press('Escape');
check('modal closes', await page.$eval('#detailsModal', el => el.hidden));

// 6. search
await page.click('#searchBox');
await page.type('#searchBox', 'news', { delay: 30 });
await page.waitForSelector('.sr-item', { timeout: 8000 });
const srCount = await page.$$eval('.sr-item', els => els.length);
check('search results', srCount > 0, `${srCount} hits`);
await page.keyboard.press('Escape');

// 7. now & next view
await page.click('#btnNowNextView');
await page.waitForSelector('.nn-card', { timeout: 8000 });
const cards = await page.$$eval('.nn-card', els => els.length);
check('now&next cards', cards > 10, `${cards} cards`);
await page.click('#btnGuideView');

// 8. day tab navigation
await page.click('.day-tab:nth-child(2)');
await new Promise(r => setTimeout(r, 1500));
const activeTab = await page.$eval('.day-tab.on', el => el.textContent);
check('day tab switch', activeTab === 'Tomorrow', activeTab);

// 9. zoom buttons change timeline width
const w1 = await page.$eval('.guide-inner', el => el.style.width);
await page.click('#zoomIn');
const w2 = await page.$eval('.guide-inner', el => el.style.width);
check('zoom works', w1 !== w2, `${w1} -> ${w2}`);

// 10. channels modal
await page.click('#btnChannels');
await page.waitForSelector('#channelsModal:not([hidden])');
const groupCount = await page.$$eval('.cm-group', els => els.length);
check('channel manager groups', groupCount === 11, `${groupCount} groups`);
await page.click('#channelsModal .modal-close');

// 11. sticky layout inside the scroller
const box = await page.evaluate(async () => {
  const sc = document.querySelector('.guide-scroller');
  sc.scrollTo({ left: 400, top: 300, behavior: 'instant' });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const scRect = sc.getBoundingClientRect();
  const cells = [...document.querySelectorAll('.ch-cell')].slice(0, 5).map(e => Math.round(e.getBoundingClientRect().x - scRect.x));
  const hdrTop = Math.round(document.querySelector('.time-header').getBoundingClientRect().top - scRect.top);
  const corner = document.querySelector('.th-corner').getBoundingClientRect();
  return { cells, hdrTop, cornerX: Math.round(corner.x - scRect.x), cornerY: Math.round(corner.y - scRect.y) };
});
check('channel cells stick to left', box.cells.every(x => x === 0), JSON.stringify(box.cells));
check('time header sticks to top', box.hdrTop === 0, String(box.hdrTop));
check('corner pinned at origin', box.cornerX === 0 && box.cornerY === 0, `${box.cornerX},${box.cornerY}`);

// now-line position after jumping to Now
await page.click('#btnNow');
await new Promise(r => setTimeout(r, 900));
const nlBox = await page.evaluate(() => {
  const scRect = document.querySelector('.guide-scroller').getBoundingClientRect();
  const nl = document.querySelector('.now-line').getBoundingClientRect();
  return { x: Math.round(nl.x), left: Math.round(scRect.left), right: Math.round(scRect.right), w: nl.width, display: getComputedStyle(document.querySelector('.now-line')).display };
});
check('now line visible in grid', nlBox.display !== 'none' && nlBox.x > nlBox.left && nlBox.x < nlBox.right && nlBox.w === 2, JSON.stringify(nlBox));

// screenshots
await page.screenshot({ path: '/tmp/tvg-guide.png' });
await page.screenshot({ path: '/tmp/tvg-now-line.png' });
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: '/tmp/tvg-mobile.png' });
const mob = await page.evaluate(() => ({
  chW: Math.round(document.querySelector('.ch-cell').getBoundingClientRect().width),
  progs: document.querySelectorAll('.prog').length,
}));
check('mobile channel column narrows', mob.chW === 118, String(mob.chW));
check('mobile programmes render', mob.progs > 20, String(mob.progs));

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
if (warnings.length) console.log('warnings:', warnings.slice(0, 5).join(' | '));

await browser.close();
console.log(process.exitCode ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
