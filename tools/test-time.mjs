import { londonDayStart } from '../js/epg.js';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

let pass = 0, fail = 0;
for (const key of ['2026-01-01', '2026-03-29', '2026-03-30', '2026-06-21',
                   '2026-10-24', '2026-10-25', '2026-10-26', '2026-12-25']) {
  const ms = londonDayStart(key);
  const wall = fmt.format(new Date(ms)).replace(', ', 'T');
  const ok = wall === `${key}T00:00`;
  ok ? pass++ : fail++;
  console.log(ok ? 'PASS' : 'FAIL', key, '->', wall);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
