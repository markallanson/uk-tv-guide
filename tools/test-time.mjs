import { londonDayStart, addDays } from '../js/epg.js';

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

// addDays: calendar arithmetic across both DST edges
const t = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(ok ? 'PASS' : 'FAIL', name, extra);
};
t('addDays over 25h autumn day', addDays('2026-10-25', 1) === '2026-10-26', addDays('2026-10-25', 1));
t('addDays over 23h spring day', addDays('2027-03-28', 1) === '2027-03-29', addDays('2027-03-28', 1));
t('autumn day is 25h long', londonDayStart('2026-10-26') - londonDayStart('2026-10-25') === 25 * 3600e3);
t('spring day is 23h long', londonDayStart('2027-03-29') - londonDayStart('2027-03-28') === 23 * 3600e3);
for (const edge of ['2026-10-25', '2027-03-28']) {
  const keys = Array.from({ length: 8 }, (_, i) => addDays(edge, i));
  const dups = keys.filter((k, i) => keys.indexOf(k) !== i);
  t(`8 days from ${edge} have no duplicates`, dups.length === 0, dups.join(',') || 'ok');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
