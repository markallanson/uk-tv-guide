/** Fresh-profile first-run verification. Run: node tools/firstrun.mjs */
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  userDataDir: mkdtempSync(tmpdir() + '/tvg-profile-'), // pristine: no cache, no localStorage
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const t0 = Date.now();
await page.goto('http://localhost:8123', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.prog').length > 100, { timeout: 90000 });
console.log('first paint with 100+ programmes:', Date.now() - t0, 'ms');

console.log('tabs:', await page.$$eval('.day-tab', els => els.map(e => e.textContent).join(',')));
console.log('status:', await page.evaluate(() => document.querySelector('#statusText').textContent));

// favourite a channel then verify pinned order
await page.evaluate(() => document.querySelectorAll('.ch-cell .star')[5].click());
console.log('after starring 6th channel, top row:', await page.evaluate(() => document.querySelector('.grow .ch-name').textContent));

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
