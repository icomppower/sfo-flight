// The METAR picker's choices: real KSFO observations (IEM ASOS archive via the pinned sfo-tower package, 2023–2025),
// one per weather type, chosen by rule (the first record of each type in time order), with the METAR text rebuilt
// from the record. Deterministic.  node pipelines/weather/build.mjs → public/flight/metars.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SIM = process.env.SFO_TOWER || join(root, 'node_modules/sfo-tower');
const M = JSON.parse(readFileSync(join(SIM, 'data/derived/ksfo-metar.min.json'), 'utf8'));
// record: [epoch, dir, kt, gust, visSM, ceilingFt, wx, tempC, dewC, altimInHg, cat]
const pad = (n, k = 2) => String(n).padStart(k, '0');
export function metarText(r) {
  const d = new Date(r[0] * 1000);
  const wind = r[2] === 0 ? '00000KT' : `${r[1] == null ? 'VRB' : pad(r[1], 3)}${pad(r[2])}${r[3] ? 'G' + pad(r[3]) : ''}KT`;
  const vis = r[4] >= 10 ? '10SM' : r[4] >= 1 ? `${Math.round(r[4])}SM` : r[4] >= 0.5 ? '1/2SM' : '1/4SM';
  const sky = r[5] == null ? 'CLR' : `${r[10] === 'IFR' || r[10] === 'LIFR' ? 'OVC' : 'BKN'}${pad(Math.round(r[5] / 100), 3)}`;
  const t = (c) => (c < 0 ? 'M' + pad(-c) : pad(c));
  return `KSFO ${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z ${wind} ${vis}${r[6] ? ' ' + r[6] : ''} ${sky} ${t(r[7])}/${t(r[8])} A${Math.round(r[9] * 100)}`;
}
const PICKS = [
  ['calm', 'Calm, clear morning', '清晨無風晴朗', (r) => r[2] <= 3 && r[4] >= 10 && r[5] == null],
  ['westerly', 'Afternoon westerly, gusty', '午後西風陣風', (r) => r[1] >= 270 && r[1] <= 300 && r[2] >= 15 && r[3] >= 22 && r[4] >= 10],
  ['strong', 'Strong west wind', '強勁西風', (r) => r[1] >= 280 && r[1] <= 310 && r[2] >= 25 && r[4] >= 10],
  ['crosswind', 'Northwest crosswind on 28', '28 號跑道西北側風', (r) => r[1] >= 320 && r[1] <= 340 && r[2] >= 16 && r[4] >= 10],
  ['south', 'Southerly, rain', '南風降雨', (r) => r[1] >= 150 && r[1] <= 200 && r[2] >= 14 && /RA/.test(r[6])],
  ['marine', 'Marine layer, low ceiling', '海霧低雲', (r) => r[10] === 'MVFR' && r[5] != null && r[5] <= 1500 && r[2] <= 12],
  ['fog', 'Fog, IFR', '濃霧（儀器飛行）', (r) => r[4] <= 1 && (r[10] === 'IFR' || r[10] === 'LIFR')],
  ['night', 'Clear night, light wind', '晴朗夜間微風', (r) => r[4] >= 10 && r[5] == null && r[2] <= 8 && new Date(r[0] * 1000).getUTCHours() === 6],
];
export function buildMetars() {
  const out = [];
  for (const [id, en, zh, test] of PICKS) {
    const r = M.records.find(test);
    if (!r) throw new Error('metar pick not found: ' + id);
    out.push({ id, en, zh, epoch: r[0], metar: metarText(r), wind: { dir: r[1] ?? 0, kt: r[2], gustKt: r[3] ?? r[2] }, visSM: r[4], ceilingFt: r[5], wx: r[6], tempC: r[7], dewC: r[8], altimInHg: r[9], cat: r[10] });
  }
  return { format: 'sfo-flight-metars/1', source: `${M.source} via sfo-tower data/derived/ksfo-metar.min.json (${M.years.join(', ')})`, picks: out };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(join(root, 'public/flight'), { recursive: true });
  const m = buildMetars();
  writeFileSync(join(root, 'public/flight/metars.json'), JSON.stringify(m, null, 1) + '\n');
  for (const p of m.picks) console.log(p.id.padEnd(10), p.metar);
}
