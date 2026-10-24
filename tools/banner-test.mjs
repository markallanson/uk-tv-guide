/**
 * Install-banner behaviour test — headless Chromium, phone emulation.
 * Covers: desktop never sees it; phone sees it; iOS gets Share instructions
 * even when a placeholder beforeinstallprompt fires (iOS never implements
 * prompt()); prompt() failure falls back to manual steps; accept/dismiss
 * flows; 6-month opt-out window; standalone mode suppresses it.
 *
 * Each case runs in its own browser context so localStorage is isolated.
 * Run: node tools/banner-test.mjs   (needs: python3 -m http.server 8123)
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:8123';
const SIX_MONTHS_MS = 6 * 30 * 86400e3;
const results = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  results.push(ok);
};

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const freshPage = async (opts = {}) => {
  const context = await browser.createBrowserContext(); // isolated storage per test
  const page = await context.newPage();
  if (opts.phone) {
    await page.emulate({
      viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
      userAgent: opts.ios
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    });
  } else {
    await page.setViewport({ width: 1440, height: 900 });
  }
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return { page, errors, done: () => context.close() };
};

const bannerState = (page) => page.evaluate(() => {
  const b = document.querySelector('#installBanner');
  return {
    hidden: b.hidden,
    inFlow: b.offsetParent !== null || getComputedStyle(b).display !== 'none',
    hint: document.querySelector('#installHint').textContent,
    installBtnShown: !document.querySelector('#btnInstall').hidden,
    optOutAt: JSON.parse(localStorage.getItem('tvg.installBanner.optOutAt') || 'null'),
  };
});
const settle = (ms = 1800) => new Promise(r => setTimeout(r, ms)); // show timer is 1200ms

// 1. desktop — banner must never appear
{
  const { page, errors, done } = await freshPage();
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await settle();
  const s = await bannerState(page);
  check('desktop: banner stays hidden', s.hidden, `hidden=${s.hidden}`);
  check('desktop: no page errors', errors.length === 0, errors.join('; '));
  await done();
}

// 2. phone (android UA) — banner shows. Headless Chromium with a manifest+SW
//    actually fires beforeinstallprompt, so assert whichever path is live:
//    native (Install button) or fallback (browser-menu hint).
{
  const { page, errors, done } = await freshPage({ phone: true });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await settle();
  const s = await bannerState(page);
  check('android phone: banner shown', !s.hidden && s.inFlow, `hidden=${s.hidden}`);
  check('android phone: correct hint for path taken',
    s.installBtnShown ? /One tap to install/.test(s.hint) : /browser menu/.test(s.hint),
    s.installBtnShown ? `native: "${s.hint}"` : `fallback: "${s.hint}"`);
  check('android phone: banner is at top of page', await page.evaluate(() => {
    const b = document.querySelector('#installBanner').getBoundingClientRect();
    const h = document.querySelector('.topbar').getBoundingClientRect();
    return b.top <= h.top && b.bottom <= h.bottom;
  }));
  check('android phone: no page errors', errors.length === 0, errors.join('; '));
  await done();
}

// 3. iOS UA, beforeinstallprompt left to fire (as iOS 17.4+ Safari does, as a
//    placeholder) — must still get the Share hint, never a dead Install button
{
  const { page, done } = await freshPage({ phone: true, ios: true });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await settle();
  const s = await bannerState(page);
  check('iphone (event fires): banner shown', !s.hidden, `hidden=${s.hidden}`);
  check('iphone (event fires): no Install button', !s.installBtnShown,
    `installBtnShown=${s.installBtnShown}`);
  check('iphone (event fires): Share/Add-to-Home-Screen hint',
    /Share/.test(s.hint) && /Home Screen/.test(s.hint), s.hint);
  await done();
}

// 3b. iOS UA, event blocked (older Safari) — same Share hint via the other path
{
  const { page, done } = await freshPage({ phone: true, ios: true });
  await page.evaluateOnNewDocument(() => {
    window.addEventListener('beforeinstallprompt', (e) => e.stopImmediatePropagation(), true);
  });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await settle();
  const s = await bannerState(page);
  check('iphone (no event): banner shown', !s.hidden, `hidden=${s.hidden}`);
  check('iphone (no event): Share/Add-to-Home-Screen hint', /Share/.test(s.hint) && /Home Screen/.test(s.hint), s.hint);
  await done();
}

// 3c. android, synthetic event whose prompt() rejects (stale/placeholder) —
//     clicking Install must swap in manual instructions, not fail silently
{
  const { page, done } = await freshPage({ phone: true });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await settle();
  await page.evaluate(() => {
    const fake = new Event('beforeinstallprompt');
    fake.prompt = () => Promise.reject(new Error('not supported'));
    fake.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(fake);
  });
  const offered = await bannerState(page);
  check('synthetic reject: Install button offered', offered.installBtnShown);
  await page.click('#btnInstall');
  await new Promise(r => setTimeout(r, 300));
  const s = await bannerState(page);
  check('synthetic reject: banner stays with manual hint', !s.hidden && !s.installBtnShown && /browser menu/.test(s.hint),
    `hidden=${s.hidden} btn=${s.installBtnShown} hint="${s.hint}"`);
  await done();
}

// 3d. android, synthetic event accepted — banner hides, installed flag stored
{
  const { page, done } = await freshPage({ phone: true });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await settle();
  await page.evaluate(() => {
    const fake = new Event('beforeinstallprompt');
    fake.prompt = () => Promise.resolve();
    fake.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(fake);
  });
  await page.click('#btnInstall');
  await new Promise(r => setTimeout(r, 300));
  const s = await bannerState(page);
  const installed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tvg.installBanner.installed') || 'null'));
  check('synthetic accepted: banner hidden', s.hidden, `hidden=${s.hidden}`);
  check('synthetic accepted: installed flag stored', installed === true, `installed=${installed}`);
  await done();
}

// 4. dismiss → opt-out persisted → stays hidden on reload
{
  const { page, done } = await freshPage({ phone: true });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await settle();
  await page.click('#btnInstallNo');
  const dismissed = await bannerState(page);
  check('dismiss: banner hides immediately', dismissed.hidden);
  const ts = dismissed.optOutAt;
  check('dismiss: opt-out timestamp stored', typeof ts === 'number' && Date.now() - ts < 5000, `ts=${ts}`);
  await page.reload({ waitUntil: 'networkidle2' });
  await settle();
  const reloaded = await bannerState(page);
  check('dismiss: still hidden after reload', reloaded.hidden, `hidden=${reloaded.hidden}`);
  // 5. simulate the opt-out ageing past 6 months → banner returns
  await page.evaluate((ago) => {
    localStorage.setItem('tvg.installBanner.optOutAt', JSON.stringify(Date.now() - ago));
  }, SIX_MONTHS_MS + 86400e3);
  await page.reload({ waitUntil: 'networkidle2' });
  await settle();
  const aged = await bannerState(page);
  check('opt-out >6 months old: banner returns', !aged.hidden, `hidden=${aged.hidden}`);
  await done();
}

// 6. already installed (display-mode: standalone) → never shows
{
  const { page, done } = await freshPage({ phone: true });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true }); // iOS-style installed
  });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await settle();
  const s = await bannerState(page);
  check('standalone mode: banner never shows', s.hidden, `hidden=${s.hidden}`);
  await done();
}

await browser.close();
const failed = results.filter(r => !r).length;
console.log(failed ? `BANNER TEST FAILED (${failed})` : 'BANNER TEST PASSED');
process.exit(failed ? 1 : 0);
