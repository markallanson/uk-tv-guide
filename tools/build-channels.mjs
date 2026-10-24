#!/usr/bin/env node
/**
 * Builds js/channels.js from epg.pw's published UK channel list.
 *
 * 1. Scrapes https://epg.pw/areas/gb/epg.html for channel ids/names.
 * 2. Dedupes, cleans names, classifies into groups.
 * 3. Verifies every channel in the default set returns EPG data for today.
 * 4. Emits js/channels.js (ES module) consumed by the app.
 *
 * Run:  node tools/build-channels.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const AREA_PAGE = 'https://epg.pw/areas/gb/epg.html';
const API = (id, date) => `https://epg.pw/api/epg.json?channel_id=${id}&date=${date}`;

const todayLondon = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());

// --- name cleanup for cryptic EPG names -------------------------------------
const RENAMES = {
  'bbc one lon hd': 'BBC One London', 'bbc one ci hd': 'BBC One Channel Islands',
  'bbc one e mid hd': 'BBC One East Midlands', 'bbc one easthd': 'BBC One East',
  'bbc one n west hd': 'BBC One North West', 'bbc one ne and c hd': 'BBC One NE & Cumbria',
  'bbc one ne&c hd': 'BBC One NE & Cumbria', 'bbc one ni hd': 'BBC One Northern Ireland',
  'bbc one s east hd': 'BBC One South East', 'bbc one s west hd': 'BBC One South West',
  'bbc one scothd': 'BBC One Scotland', 'bbc one sth hd': 'BBC One South',
  'bbc one wm hd': 'BBC One West Midlands', 'bbc one wal hd': 'BBC One Wales',
  'bbc one west hd': 'BBC One West', 'bbc one y and l hd': 'BBC One Yorks & Lincs',
  'bbc one y&l hd': 'BBC One Yorks & Lincs', 'bbc one yorks hd': 'BBC One Yorkshire',
  'bbcscotlandhd': 'BBC Scotland', 'bbc two ni hd': 'BBC Two NI', 'bbc two wal hd': 'BBC Two Wales',
  'bbc four hd': 'BBC Four', 'bbc three hd': 'BBC Three', 'bbc alba hd': 'BBC Alba',
  'bbc news hd': 'BBC News', 'bbc parliament hd': 'BBC Parliament', 'bbc asian': 'BBC Asian Network',
  'cbbc hd': 'CBBC', 'cbeebies hd': 'CBeebies',
  'itv1 hd': 'ITV1', 'itv be hd': 'ITVBe', 'itv quiz': 'ITV Quiz',
  'channel 4 hd': 'Channel 4', 'e4 hd': 'E4', 'film4 hd': 'Film4', 'more4 hd': 'More4',
  'channel 5 hd': 'Channel 5', '5 usa': '5USA', '5 usa+1': '5USA+1',
  'skyspmainevhd': 'Sky Sports Main Event', 'skysp pl hd': 'Sky Sports Premier League',
  "skysp f'ball hd": 'Sky Sports Football', 'skysp fball hd': 'Sky Sports Football',
  'skysp f1 hd': 'Sky Sports F1', 'skysp cricket': 'Sky Sports Cricket',
  'skysp cricket hd': 'Sky Sports Cricket', 'skysp golf hd': 'Sky Sports Golf',
  'skysp arenahd': 'Sky Sports Arena', 'skysp action': 'Sky Sports Action',
  'skysp actionhd': 'Sky Sports Action HD', 'skysp racing hd': 'Sky Sports Racing',
  'skysp news': 'Sky Sports News', 'skysp news hd': 'Sky Sports News',
  'skysp mix': 'Sky Sports Mix', 'skysp mix hd': 'Sky Sports Mix',
  'skysp tennis hd': 'Sky Sports Tennis', 'skysp+': 'Sky Sports+', 'skysp+hd': 'Sky Sports+',
  'skyspboxoffhd': 'Sky Sports Box Office', 'skyspf1': 'Sky Sports F1',
  'skyscfi/horhd': 'Sky Sci-Fi/Horror', 'sky sci-fi': 'Sky Sci-Fi', 'sky sci-fi hd': 'Sky Sci-Fi',
  'skydocmntrs': 'Sky Documentaries', 'skydocmntrshd': 'Sky Documentaries',
  'skydocumentaries hd': 'Sky Documentaries', 'skyhistory2': 'Sky History 2',
  'skyhistory2hd': 'Sky History 2', 'sky historyhd': 'Sky History',
  'sky one hd': 'Sky One', 'sky mix hd': 'Sky Mix', 'bbc two hd': 'BBC Two',
  'itv2 hd': 'ITV2', 'itv3 hd': 'ITV3', 'itv4 hd': 'ITV4',
  'skysp f1': 'Sky Sports F1', 'skysp golf': 'Sky Sports Golf',
  'skysp golf hd': 'Sky Sports Golf', 'skyspcricket hd': 'Sky Sports Cricket',
  'sky hits hd': 'Sky Cinema Hits', 'quest hd': 'Quest', 'skysp fball': 'Sky Sports Football',
  'sky action': 'Sky Cinema Action', 'sky premiere hd': 'Sky Cinema Premiere', 'skypremierehd': 'Sky Cinema Premiere',
  'sky premiere': 'Sky Cinema Premiere', 'sky action hd': 'Sky Cinema Action',
  'sky adventure': 'Sky Cinema Adventure', 'skyadventurehd': 'Sky Cinema Adventure',
  'sky family hd': 'Sky Cinema Family', 'sky drama hd': 'Sky Cinema Drama',
  'sky thriller hd': 'Sky Cinema Thriller', 'sky greats': 'Sky Cinema Greats',
  'sky greats hd': 'Sky Cinema Greats', 'sky hits hd': 'Sky Cinema Hits',
  'skymegahitshd': 'Sky Cinema Mega Hits', 'sky cinema comedy': 'Sky Cinema Comedy',
  'sky cinema hits hd': 'Sky Cinema Hits', 'sky cinema select': 'Sky Cinema Select',
  'sky valentine': 'Sky Cinema Valentine', 'skyvalentinehd': 'Sky Cinema Valentine HD',
  'comedycent+1': 'Comedy Central+1', 'comedycenthd': 'Comedy Central',
  'crime+inv': 'Crime+Investigation', 'crime+inv hd': 'Crime+Investigation',
  'disc.history': 'Discovery History', 'disc.science': 'Discovery Science',
  'disc.turbo': 'Discovery Turbo', 'animal plnt+1': 'Animal Planet+1',
  'natgeo wild': 'Nat Geo Wild', 'natgeowild hd': 'Nat Geo Wild', 'nat geo hd': 'Nat Geo',
  'yesterday': 'Yesterday', 'yesterday+1': 'Yesterday+1',
  'u and yesterday': 'U&Yesterday', 'u and yesterday+1': 'U&Yesterday+1',
  'u and dave hd': 'U&Dave', 'u and gold hd': 'U&GOLD', 'u and eden': 'U&Eden',
  'u and drama': 'U&Drama', 'u and w hd': 'U&W', 'u and laughs': 'U&Laughs',
  'gold': 'GOLD', 'gold hd': 'GOLD', 'dave ja vu': 'Dave ja vu', 'alibi': 'alibi',
  'quest red': 'QUEST RED', 'quest red+1': 'QUEST RED+1', 'quest hd': 'Quest',
  'id': 'Investigation Discovery', 'talkingpictures': 'Talking Pictures TV',
  'tnt sports 1 hd': 'TNT Sports 1', 'tnt sports 2 hd': 'TNT Sports 2',
  'tnt sports 3 hd': 'TNT Sports 3', 'tnt sports 4 hd': 'TNT Sports 4',
  'tnt sports 5 hd': 'TNT Sports 5', 'tnt sports 6 hd': 'TNT Sports 6',
  'tnt sports 7 hd': 'TNT Sports 7', 'tnt sports 8 hd': 'TNT Sports 8',
  'tnt sports 9 hd': 'TNT Sports 9', 'tnt sports 10 hd': 'TNT Sports 10',
  'tntsboxoffhd': 'TNT Sports Box Office', 'tntsboxoff2hd': 'TNT Sports Box Office 2',
  'tnt sports boxoffice hd': 'TNT Sports Box Office', 'tnt sports box office': 'TNT Sports Box Office',
  'tnt sports box office 2': 'TNT Sports Box Office 2', 'tnt sports ultimate hd': 'TNT Sports Ultimate',
  'viaplay 1 hd': 'Viaplay 1', 'viaplay 2 hd': 'Viaplay 2', 'lfctv hd': 'LFCTV',
  'mutv hd': 'MUTV', 'racing tv hd': 'Racing TV', 'premier sports 1 hd': 'Premier Sports 1',
  'premier sports 2 hd': 'Premier Sports 2', 'gb news hd': 'GB News', 'cnn hd': 'CNN',
  'al jazeera hd': 'Al Jazeera', 'nhk world hd': 'NHK World', 'bloomberg hd': 'Bloomberg',
  'cnbc hd': 'CNBC', 'france 24 hd': 'France 24', 'cartoon net hd': 'Cartoon Network',
  'cartoon netwrk': 'Cartoon Network', 'nick jr.': 'Nick Jr.', 'nick jr': 'Nick Jr.',
  'nick juniors': 'Nick Jr.', 'disney jr hd': 'Disney Jr.', 'disney+cinehd': 'Disney+ Cinema',
  'nickspongebob': 'Nickelodeon SpongeBob', 'chstv': 'Chart Show TV', 'clubland tv': 'Clubland TV',
  'now 90s00s': 'NOW 90s & 00s', 'now 90s & 00s': 'NOW 90s & 00s',
  'great! tv': 'GREAT! tv', 'great! action': 'GREAT! action', 'great! movies': 'GREAT! movies',
  'great! romance': 'GREAT! romance', 'horrorxtra': 'HorrorXtra', 'g! romance+1': 'GREAT! romance+1',
  'movies24': 'Movies24', 'movies24+': 'Movies24+', 'realityxtra': 'RealityXtra',
  'tjc hd': 'TJC', 'qvc hd': 'QVC', 'qvc style hd': 'QVC Style', 'ideal world hd': 'Ideal World',
  'cruise1st.tv': 'Cruise1st.tv', 'bbcr1': 'BBC Radio 1', 'bbcr1x': 'BBC Radio 1Xtra',
  'bbc r1': 'BBC Radio 1', 'bbc r1x': 'BBC Radio 1Xtra', 'bbc r2': 'BBC Radio 2',
  'bbc r3': 'BBC Radio 3', 'bbc r4 fm': 'BBC Radio 4 FM', 'bbc r4 ex': 'BBC Radio 4 Extra',
  'bbc r4 lw': 'BBC Radio 4 LW', 'bbc r5l': 'BBC Radio 5 Live', 'bbc r5sx': 'BBC Radio 5 Sports Extra',
  'bbc r cymru': 'BBC Radio Cymru', 'bbc r cymru 2': 'BBC Radio Cymru 2',
  'bbc r scot.': 'BBC Radio Scotland', 'bbc r ulster': 'BBC Radio Ulster',
  'bbc r wales': 'BBC Radio Wales', 'bbc r foyle': 'BBC Radio Foyle',
  'bbc r n gael': 'BBC Radio nan Gàidheal', 'bbc rlondon': 'BBC Radio London',
  'bbc 6 music': 'BBC Radio 6 Music', 'bbc ws': 'BBC World Service',
  'bbc rb 1 hd': 'BBC Radio 1', 'talkradio (talktv)': 'TalkTV', 'stv central': 'STV',
  'stv central +1': 'STV+1', 'stv north': 'STV North', 'stv north +1': 'STV North+1',
  'stv hd': 'STV HD', 'utv': 'UTV', 's4c hd': 'S4C', 'virgin media one hd': 'Virgin Media One',
  'virgin media two hd': 'Virgin Media Two', 'virgin media three': 'Virgin Media Three',
  'virgin media four hd': 'Virgin Media Four', 'virgin media one +1': 'Virgin Media One+1',
  'colors cineplex': 'Colors Cineplex', 'colorsgujarati': 'Colors Gujarati',
  'colorsrishtey': 'Colors Rishtey', 'sony max 2': 'Sony MAX 2', 'kanshi tv': 'Kanshi TV',
  'sonlife': 'SonLife', 'revelation': 'Revelation TV', 'ion tv': 'iON TV',
  'bbci': 'BBCi', 'wtv': 'W', 'wtv+1': 'W+1',
};

// --- channel ids excluded entirely (junk / test / placeholder channels) ------
const EXCLUDE = new Set([
  '50327', '348744', 'Live 360', 'XXXpublicpikups', 'Spider-Man HD', 'EasterEpicsHD',
  'Chl Line-up', 'DM News English', '486773', '5553',
]);

// --- group classification rules (first match wins) ---------------------------
const GROUP_RULES = [
  ['Radio', [/^bbc (radio|rb|world service|6 music)/i, /^(capital|heart|lbc|classic fm|smooth|radio x|talksport|greatest hits|virgin radio|times radio|bfbf|wrn)/i, /^bbc r\d/i, /^bbc r /i, /^rté (2fm|lyric|r na g|radio)/i, /radio/i, /gael$/i]],
  ['Sport', [/sky ?sp/i, /^tnt sports/i, /^premier sports/i, /^(racing tv|lfctv|mutv|viaplay)/i, /box office/i]],
  ['News', [/news/i, /^(cnn|cnbc|bloomberg|al jazeera|france 24|nhk world|trt world|euronews|ndtv|gb news|bbc parliament)/i, /^cgtn/i]],
  ['Kids', [/^(cbeebies|cbbc|cartoon|nick|disney|boomerang|babytv|pop)/i, /cartoonito/i]],
  ['Movies', [/^sky cinema/i, /^(film4|movies24|horrorxtra|sony max|zee cinema|b4u movies)/i, /great! movies/i, /movie/i]],
  ['Music', [/^(mtv|now |clubland|chart show|viva|kiss|magic|the box|smash hits|4music)/i, /(music|mtv)/i]],
  ['Documentaries', [/^(discovery|animal planet|nat geo|national geographic|history|sky history|sky nature|sky documentaries|eden|pbs america|investigation discovery|crime\+inv|id|sky crime|quest|dmax|tlc|really|food network|travel|wildearth|together|hgtv)/i, /history/i, /documentar/i, /investigation/i]],
  ['Shopping', [/^(qvc|ideal world|gems tv|jewellerymaker|tjc|cruise1st|high street tv|best direct)/i, /shopping/i]],
  ['Faith', [/(ewtn|god channel|islam|iqra|aastha|ahlebait|akaal|sangat|sanskhar|sikh|madani|noor tv|sonlife|daystar|loveworld|revelation|faith world|deen tv|eman|kanshi|takbeer|matv|mta|pbk|pbc|tbn|ntd|good news|new vision|vision tv|krt|zion|wisdom)/i]],
  ['International', [/(zee tv|sony|colors|ary|geo|aaj tak|b4u|utsav|atn|ktv|apna|punjab|pcne|arirang|china|cctv|tv5|ndtv|huma|ma tv|takbeer|chstv|venus|matro|sadhna|sanskar|9xm|big magic|star utsav|rishtey|cineplex|eurostar|gaunchi|pitaara|ion tv|channels 24|hindu|dhoom|hum|masala|madhuban|sarah|uk 36|vissa|bihar|hansa|abp|aajtak|news18|india|mh1|ptc|jus|chardi|brit asia|sanskar)/i]],
];

function groupFor(name) {
  for (const [group, rules] of GROUP_RULES) {
    if (rules.some(r => r.test(name))) return group;
  }
  return 'Entertainment';
}

// --- curated default (popular) channels, in display order ---------------------
const DEFAULT_ORDER = [
  'BBC One London', 'BBC Two', 'ITV1', 'Channel 4', 'Channel 5',
  'BBC Three', 'BBC Four', 'BBC Scotland', 'ITV2', 'ITV3', 'ITV4', 'ITVBe',
  'E4', 'E4 Extra', 'More4', '4seven', 'Film4',
  '5STAR', '5USA', '5SELECT', '5ACTION', '5USA+1',
  'Sky Atlantic', 'Sky Max', 'Sky Mix', 'Sky Arts', 'Sky Witness', 'Sky Comedy', 'Sky Sci-Fi',
  'alibi', 'U&Dave', 'Dave', 'Dave ja vu', 'Drama', 'W', 'Yesterday', 'GOLD', 'Comedy Central',
  'Quest', 'Discovery', 'Sky Nature', 'Sky Documentaries', 'Sky History', 'Nat Geo',
  'Animal Planet', 'TLC', 'DMAX', 'Eden', 'Really',
  'BBC News', 'Sky News', 'GB News', 'CNN', 'Al Jazeera',
  'Sky Sports Main Event', 'Sky Sports Premier League', 'Sky Sports Football', 'Sky Sports F1',
  'Sky Sports Cricket', 'Sky Sports Golf', 'Sky Sports Arena', 'Sky Sports Action',
  'Sky Sports Racing', 'Sky Sports News', 'Sky Sports Mix', 'Sky Sports+',
  'TNT Sports 1', 'TNT Sports 2', 'TNT Sports 3', 'TNT Sports 4',
  'Premier Sports 1', 'Racing TV',
  'Sky Cinema Premiere', 'Sky Cinema Hits', 'Sky Cinema Greats', 'Sky Cinema Family',
  'Sky Cinema Action', 'Sky Cinema Comedy', 'Sky Cinema Drama', 'Sky Cinema Thriller',
  'Sky Cinema Select', 'GREAT! movies', 'Movies24', 'HorrorXtra',
  'CBeebies', 'CBBC', 'Cartoon Network', 'Cartoonito', 'Nickelodeon', 'Nick Jr.', 'Nicktoons', 'Boomerang',
  'MTV',
];

async function fetchWithRetries(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'tvg-guide-builder/1.0' } });
      if (res.ok) return res;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`Failed: ${url}`);
}

async function main() {
  console.log('Fetching UK area page...');
  const res = await fetchWithRetries(AREA_PAGE);
  const html = await res.text();

  // cleaned name -> all candidate ids (deduped)
  const re = /href="\/last\/(\d+)\.html[^"]*"[^>]*title="View channel ([^"]+?)'s weekly program guide"/g;
  const byName = new Map();
  let m;
  while ((m = re.exec(html))) {
    const [, id, rawName] = m;
    const name = rawName.trim();
    if (EXCLUDE.has(name) || EXCLUDE.has(id)) continue;
    const key = name.replace(/\s+/g, ' ').toLowerCase();
    const clean = RENAMES[key] ?? name;
    const entry = byName.get(clean.toLowerCase()) ?? { name: clean, ids: [] };
    if (!entry.ids.includes(+id)) entry.ids.push(+id);
    byName.set(clean.toLowerCase(), entry);
  }
  console.log(`Scraped ${byName.size} unique channels. Probing candidate ids for ${todayLondon}...`);

  // Probe every candidate id; keep the one with the most programmes.
  const countCache = new Map();
  const probeQueue = [...byName.values()].flatMap(e => e.ids.map(id => ({ name: e.name, id })));
  const probe = async (id) => {
    if (countCache.has(id)) return countCache.get(id);
    let n = -1;
    try {
      const r = await fetchWithRetries(API(id, todayLondon));
      n = ((await r.json()).epg_list || []).length;
      if (n === 0) { // some sources lag a day — check tomorrow before declaring dead
        const r2 = await fetchWithRetries(API(id, tomorrowLondon()));
        n = -((await r2.json()).epg_list || []).length; // negative = only tomorrow
      }
    } catch { /* keep -1 */ }
    countCache.set(id, n);
    return n;
  };
  const workers = Array.from({ length: 10 }, async () => {
    while (probeQueue.length) { const j = probeQueue.shift(); await probe(j.id); }
  });
  await Promise.all(workers);

  const channels = [];
  for (const entry of byName.values()) {
    const ranked = entry.ids
      .map(id => ({ id, n: countCache.get(id) ?? -1 }))
      .sort((a, b) => Math.max(0, b.n) - Math.max(0, a.n) || b.n - a.n || a.id - b.id);
    const best = ranked[0];
    const alive = best.n > 0;
    channels.push({ id: best.id, name: entry.name, group: groupFor(entry.name), on: alive ? 1 : 0 });
  }
  channels.sort((a, b) => a.name.localeCompare(b.name));
  const dead = channels.filter(c => !c.on).map(c => c.name);
  console.log(`Alive: ${channels.length - dead.length}, no current data: ${dead.length}`);
  if (dead.length) console.log('  no-data channels:', dead.join(', '));

  // Default set = curated order, only channels that exist AND have data
  const byCleanName = new Map(channels.map(c => [c.name, c]));
  const missing = DEFAULT_ORDER.filter(n => !byCleanName.has(n));
  if (missing.length) console.warn('MISSING from scrape:', missing.join(', '));
  const defaultIds = DEFAULT_ORDER.map(n => byCleanName.get(n)).filter(c => c && c.on).map(c => c.id);
  const dropped = DEFAULT_ORDER.filter(n => { const c = byCleanName.get(n); return c && !c.on; });
  if (dropped.length) console.warn('Dropped from defaults (no data):', dropped.join(', '));
  console.log(`Defaults: ${defaultIds.length} channels`);

  const out = `// AUTO-GENERATED by tools/build-channels.mjs — do not edit by hand.
// Source: epg.pw UK channel list, verified ${new Date().toISOString().slice(0, 10)}
export const CHANNELS = ${JSON.stringify(channels)};
export const DEFAULT_CHANNEL_IDS = ${JSON.stringify(defaultIds)};
export const GROUP_ORDER = ${JSON.stringify(['Entertainment', 'Movies', 'Sport', 'News', 'Documentaries', 'Kids', 'Music', 'International', 'Faith', 'Shopping', 'Radio'])};
`;
  mkdirSync('js', { recursive: true });
  writeFileSync('js/channels.js', out);
  console.log(`Wrote js/channels.js (${channels.length} channels, ${defaultIds.length} defaults)`);
}

function tomorrowLondon() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);
}

main().catch(e => { console.error(e); process.exit(1); });
