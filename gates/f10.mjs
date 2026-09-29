// F10 Auto + Guide (M1.2, SPEC §14):
//  - AUTO LAND from the 8 starts × both aircraft × 2 winds (headless, the real world): lands on the planned runway and
//    stops, no crash or strike, score ≥ 80, LANDING CONFIG set in the air, the 777's bank within the pod margin below
//    100 ft, the aircraft inside the ribbon corridor from 1 NM inside the FAF down to 200 ft, and the planned route
//    (before the final approach) clear of terrain and roofs by 1,000 ft (777) / 500 ft (172);
//  - GUIDE ME flown by an obedient pilot that acts only on the instruction bar (gates/lib/f10-flights.mjs): touchdown
//    and stop with score ≥ 70, every planned instruction shown ≥ 3 s before the route needs it, each cleared once
//    done, every turn told toward the side the new heading is on;
//  - takeover: stick input disconnects in the same step (headless, both aircraft) and within one frame in the page,
//    handing back a trimmed aircraft (pitch rate small, configuration and throttle kept);
//  - real Chrome: AUTO LAND / GUIDE ME buttons and the instruction bar hit-tested at 1440×900 and 390×844 in en and zh,
//    no overflow; the ribbon ≤ 1 m from the computed 3° path at 5 points; approach lights and PAPI lit (pixel contrast
//    at the lights' screen positions) in day, golden and night stills; PAPI 2 white / 2 red on the path and 4 red low,
//    in the rule and in the colours on the mesh; a touchdown banked beyond the margin shows BANK ANGLE ≥ 2 s before
//    the pod strike and the result screen says why, with the bank.
// --negative: a route across terrain, a bank beyond the margin near the ground, a missed LANDING CONFIG, an
// instruction shown late, turns told the wrong way, a takeover ignored, a ribbon 20 m off, PAPI colours swapped,
// the approach lights off by day, the bank warning suppressed and a covered instruction bar must each fail.
import { inflateSync } from 'node:zlib';
import { gate } from './lib/common.mjs';
import { readThresholds } from 'harbor-engine/gates/lib/thresholds.mjs';
import { loadWorld, autoLand, guided, starts, START_NAMES, AC, WINDS } from './lib/f10-flights.mjs';
import { planRoute, runwayInUse, profileOf, maxObstacle, RPARAMS, RIBBON, gsAltAt } from '../fdm/route.ts';
import { ilsDeviation } from '../fdm/ils.ts';
import { Flight } from '../fdm/flight.ts';
import { AUTO_EVENT } from '../fdm/autoland.ts';
import { serve, launch, openPage, sleep } from './lib/browser.mjs';

const T = readThresholds(), FT = 0.3048, NM = 1852, D = Math.PI / 180, KT = 0.514444;
const W = loadWorld();
const wrap = (a) => ((a % 360) + 540) % 360 - 180;
const R1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- the planned route above terrain
// min clearance (ft) of the planned profile over the terrain / roof corridor, before the join point
export function routeClearance(id, plan) {
  const P = RPARAMS[id], prof = profileOf(plan, id, 60);
  const dtg = new Array(prof.length).fill(0);
  for (let i = prof.length - 2; i >= 0; i--) dtg[i] = dtg[i + 1] + Math.hypot(prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1]);
  let worst = Infinity;
  for (let i = 0; i < prof.length - 1; i++) {
    if (dtg[i] < (P.dFafNm + P.dJoinNm) * NM) continue;
    const hi = maxObstacle(W.ground, [[prof[i][0], prof[i][1]], [prof[i + 1][0], prof[i + 1][1]]], P.corridorM);
    worst = Math.min(worst, (Math.min(prof[i][2], prof[i + 1][2]) - hi) / FT);
  }
  return worst;
}
const kinOf = (st) => ({ n: st.n, e: st.e, alt: st.alt, trk: st.hdg, gs: (st.cas || 100) * KT, cas: st.cas || 100, t: 0 });
// a start low behind San Bruno Mountain (328 m), heading at it: the route has to climb over (the terrain fixture)
const HILLS = { n: 9600, e: -10500, alt: 800 * FT, hdg: 125, cas: 90, flap: 0, gear: 1, mass: 1080 };
function checkTerrain(patch = {}) {
  const fail = [];
  for (const [id, name, st] of [...['c172', 'b77w'].flatMap((id) => START_NAMES.map((n) => [id, n, starts(W, id)[n]])), ['c172', 'hills', HILLS]]) {
    const k = kinOf(st), I = runwayInUse(W.ils, { dir: 0, kt: 0 }, k.n, k.e), plan = planRoute(id, k, I, W.ground, patch);
    const clr = routeClearance(id, plan), need = T[`F10.terrainClearFt.${id}`];
    if (!(clr >= need - 1)) fail.push(`${id} ${name}: planned route ${Math.round(clr)} ft above terrain (≥ ${need})`);
  }
  if (!fail.length) console.log('route terrain clearance: all 17 plans clear');
  return fail;
}

// ---------------------------------------------------------------- AUTO LAND
function checkAuto({ patch = {}, cases = null } = {}) {
  const fail = [], req = (ok, s) => { if (!ok) fail.push(s); };
  const list = cases || ['c172', 'b77w'].flatMap((id) => START_NAMES.flatMap((n) => ['calm', 'west'].map((wx) => [id, n, wx])));
  for (const [id, name, wx] of list) {
    const Rb = RIBBON[id], P = RPARAMS[id];
    let outX = 0, outH = 0;
    const r = autoLand(W, id, name, wx, { patch, each: (f) => {
      const s = f.sim, I = f.auto.rwy; if (!I || s.onGround || !f.auto.g?.onFinal) return;
      const d = ilsDeviation(I, s.pos[0], s.pos[1], s.altMsl), ra = s.altMsl - Math.max(s.groundH, 0) - s.ac.model.gearGround;
      if (d.distNm > 0 && d.distNm <= P.dFafNm - 1 && ra >= T['F10.ribbonInsideFt'] * FT) { outX = Math.max(outX, Math.abs(d.xte)); outH = Math.max(outH, Math.abs(d.gsErrM)); }
    } });
    const L = r.landing, tag = `${id} ${name} ${wx}`;
    console.log(`  AUTO LAND ${tag.padEnd(18)} ${r.crashed ? 'CRASH ' + r.crashed : L?.complete ? `landed ${L.runway} (planned ${r.planned}) score ${L.score}` : 'not landed'} · LANDING CONFIG ${r.ldgAt ? `at ${R1(r.ldgAt.dtgNm)} NM` : 'never'} · bank < 100 ft ${R1(r.maxBankLow)}° (margin ${R1(r.margin)}) · corridor ${R1(outX)}/${Rb.halfW} m, ${R1(outH)}/${Rb.halfH} m`);
    req(!r.crashed, `${tag}: crashed (${r.crashed})`);
    req(!!L?.complete, `${tag}: did not land and stop`);
    req(L?.runway === r.planned, `${tag}: landed on ${L?.runway} (planned ${r.planned})`);
    req((L?.score ?? 0) >= T['F10.autoScoreMin'], `${tag}: score ${L?.score} (≥ ${T['F10.autoScoreMin']})`);
    req(!!r.ldgAt && r.ldgAt.raFt > 300, `${tag}: LANDING CONFIG ${r.ldgAt ? `only at ${Math.round(r.ldgAt.raFt)} ft` : 'never set'}`);
    if (id === 'b77w') req(r.maxBankLow <= r.margin, `${tag}: bank ${R1(r.maxBankLow)}° below 100 ft (pod margin ${R1(r.margin)}°)`);
    req(outX <= Rb.halfW && outH <= Rb.halfH, `${tag}: outside the ribbon above ${T['F10.ribbonInsideFt']} ft (${R1(outX)} m across, ${R1(outH)} m vertical)`);
    for (const k of ['turn', 'loc', 'gs', 'ldg', 'flare', 'touchdown']) if (k !== 'turn' || name !== 'fast') req(r.captions.some((c) => c.id === k) || (k === 'turn' && ['high', 'fast'].includes(name)), `${tag}: no "${k}" caption`);
  }
  return fail;
}

// ---------------------------------------------------------------- GUIDE ME
function checkGuide({ guideOpts = {}, cases = null } = {}) {
  const fail = [], req = (ok, s) => { if (!ok) fail.push(s); };
  const list = cases || ['c172', 'b77w'].flatMap((id) => START_NAMES.flatMap((n) => ['calm', 'west'].map((wx) => [id, n, wx])));
  let planned = 0, reactive = 0;
  for (const [id, name, wx] of list) {
    const r = guided(W, id, name, wx, { guideOpts }), L = r.landing, tag = `${id} ${name} ${wx}`;
    const items = r.log, late = [], wrongDir = [], open = [];
    for (const it of items) {
      if (it.reactive) { reactive++; } else {
        planned++;
        const need = it.trueT ?? Math.max(it.dueT, it.doneT ?? it.dueT);
        if (need - it.showT < T['F10.leadMinS'] - 1e-6) late.push(`${it.kind}@${Math.round(it.showT)}s ${R1(need - it.showT)}s`);
      }
      if (it.kind === 'turn') { const sh = r.shown.find((x) => x.kind === 'turn' && Math.abs(x.t - it.showT) < 0.2); if (sh && Math.abs(wrap(it.hdg - sh.hdgNow)) > 10 && Math.sign(wrap(it.hdg - sh.hdgNow)) !== it.dir) wrongDir.push(`→${it.hdg} from ${Math.round(sh.hdgNow)} told ${it.dir > 0 ? 'R' : 'L'}`); }
      if (it.doneT == null && it.kind !== 'brake') open.push(it.kind);
    }
    console.log(`  GUIDE ME  ${tag.padEnd(18)} ${r.crashed ? 'CRASH ' + r.crashed : L?.complete ? `landed ${L.runway} score ${L.score}` : 'not landed'} · ${items.length} instructions (${items.filter((x) => x.reactive).length} reactive) · min lead ${R1(Math.min(...items.filter((x) => !x.reactive).map((x) => (x.trueT ?? Math.max(x.dueT, x.doneT ?? x.dueT)) - x.showT)))} s`);
    req(!r.crashed && !!L?.complete, `${tag}: ${r.crashed ? 'crashed (' + r.crashed + ')' : 'did not land and stop'}`);
    req((L?.score ?? 0) >= T['F10.guideScoreMin'], `${tag}: score ${L?.score} (≥ ${T['F10.guideScoreMin']})`);
    req(!late.length, `${tag}: shown late: ${late.join(', ')}`);
    req(!wrongDir.length, `${tag}: turn told the wrong way: ${wrongDir.join(', ')}`);
    req(!open.length, `${tag}: instructions never cleared: ${open.join(', ')}`);
  }
  console.log(`  GUIDE ME: ${planned} planned instructions measured for lead, ${reactive} reactive (engage, drift, re-plan)`);
  return fail;
}

// ---------------------------------------------------------------- takeover (headless)
function checkTakeover(patch = {}) {
  const fail = [];
  for (const id of ['c172', 'b77w']) {
    const f = new Flight(AC[id], starts(W, id).ggb, WINDS.calm, 'f10', { ground: W.ground, ils: W.ils, runways: W.runways });
    Object.assign(f.auto.patch, patch);
    const c = { ...f.initial, thr: f.initial.thr.slice() };
    c.auto = AUTO_EVENT.TOGGLE; f.step(c); c.auto = 0;
    for (let i = 0; i < 120 * 40; i++) f.step(c);
    const onBefore = f.auto.on, flapBefore = f.applied.flap;
    c.elev = 0.2; f.step(c); const offAt = f.auto.on; c.elev = 0;
    let qMax = 0; const th0 = f.sim.euler.theta;
    for (let i = 0; i < 120 * 3; i++) { f.step(c); qMax = Math.max(qMax, Math.abs(f.sim.w[1]) / D); }
    const dth = Math.abs(f.sim.euler.theta - th0) / D;
    console.log(`  takeover ${id}: AUTO LAND ${onBefore ? 'on' : 'off'} → after one step of stick ${offAt ? 'still on' : 'off'}; next 3 s |q| ≤ ${R1(qMax)}°/s, pitch moved ${R1(dth)}°, flaps ${f.applied.flap} (was ${flapBefore}), throttle ${c.thr[0].toFixed(2)}`);
    if (!onBefore) fail.push(`${id}: AUTO LAND was not on before the takeover`);
    if (offAt) fail.push(`${id}: stick input did not disconnect AUTO LAND in the same step`);
    if (qMax > 3 || dth > 5) fail.push(`${id}: not handed back trimmed (|q| ${R1(qMax)}°/s, pitch moved ${R1(dth)}°)`);
    if (f.applied.flap !== flapBefore) fail.push(`${id}: configuration not kept (flaps ${flapBefore} → ${f.applied.flap})`);
  }
  return fail;
}

// ---------------------------------------------------------------- real Chrome
function decodePng(buf) {
  buf = Buffer.from(buf);
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break; p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h * bpp), stride = w * bpp;
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[o + x - bpp] : 0, b = y ? out[o - stride + x] : 0, c = x >= bpp && y ? out[o - stride + x - bpp] : 0; let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[o + x] = v & 255; } }
  return { w, h, bpp, px: out, lum: (x, y) => { x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y))); const i = (y * w + x) * bpp; return 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]; } };
}
// approach lights lit: at each ALS light's screen position the peak luminance stands out from its surroundings
function lightsLit(img, pts) {
  let lit = 0, n = 0; const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  for (const [x, y] of pts) {
    if (x < 10 || y < 10 || x > img.w - 10 || y > img.h - 10) continue;
    n++; let peak = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) peak = Math.max(peak, img.lum(x + dx, y + dy));
    const ring = []; for (let a = 0; a < 16; a++) ring.push(img.lum(x + Math.cos(a / 16 * 2 * Math.PI) * 9, y + Math.sin(a / 16 * 2 * Math.PI) * 9));
    if (peak >= 245 && peak - med(ring) >= 50) lit++; // boosted lights saturate (253–255); unboosted by day peak ≤ 232
  }
  return { lit, n, frac: n ? lit / n : 0 };
}
const PAD = () => { const pad = { id: 'SFO fixture joystick', index: 0, connected: true, mapping: '', timestamp: 0, axes: [0, 0, 1, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [pad]; window.__pad = pad; };

// hit-test the AUTO LAND / GUIDE ME buttons and the instruction bar, with GUIDE ME switched on by its button
async function hitTest(br, url, { viewport, touch, lang, cover = false }) {
  const fail = [], tag = `${viewport.width}×${viewport.height} ${lang}`;
  const { page, errors } = await openPage(br, url, { viewport, touch, query: `${touch ? '&touch' : ''}&ac=c172&start=ggb&time=day&lang=${lang}` });
  await page.waitForFunction(() => window.__sfo?.state === 'flying', { timeout: 120000 });
  await sleep(800);
  const sel = touch ? { auto: '.sf-btns .t-auto', guide: '.sf-btns .t-guide' } : { auto: '.sf-autobar [data-auto="land"]', guide: '.sf-autobar [data-auto="guide"]' };
  const hit = (s) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return { ok: false, why: 'missing' }; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return { ok: false, why: 'not shown' }; const x = r.left + r.width / 2, y = r.top + r.height / 2, at = document.elementFromPoint(x, y); const inView = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; return { ok: !!at && (at === e || e.contains(at)) && inView, why: at ? at.className || at.tagName : 'nothing', x, y, text: e.textContent, over: e.scrollWidth > e.clientWidth + 1 }; }, s);
  for (const k of ['auto', 'guide']) { const h = await hit(sel[k]); if (!h.ok) fail.push(`${tag}: ${k} button not hit (${h.why})`); if (h.over) fail.push(`${tag}: ${k} button text overflows`); }
  const g = await hit(sel.guide);
  if (g.ok) { if (touch) await page.touchscreen.tap(g.x, g.y); else await page.mouse.click(g.x, g.y); }
  await page.waitForFunction(() => { const d = document.querySelector('.sf-guide'); return d && !d.hidden && d.textContent.trim(); }, { timeout: 15000 }).catch(() => fail.push(`${tag}: the GUIDE ME button did not bring up the instruction bar`));
  if (cover) await page.evaluate(() => { const c = document.createElement('div'); c.style.cssText = 'position:fixed;inset:0;z-index:99'; document.body.append(c); });
  const b = await hit('.sf-guide');
  if (!b.ok) fail.push(`${tag}: instruction bar not hit (${b.why})`);
  if (b.over) fail.push(`${tag}: instruction bar text overflows`);
  const clip = await page.evaluate(() => { const e = document.querySelector('.sf-guide .gd-main b'); return e.scrollWidth > e.clientWidth + 1 ? e.textContent : ''; });
  if (clip) fail.push(`${tag}: instruction clipped: "${clip}"`);
  const zh = /[一-鿿]/.test(b.text || '');
  if ((lang === 'zh') !== zh) fail.push(`${tag}: instruction bar not in ${lang} ("${(b.text || '').slice(0, 30)}")`);
  const ov = await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1);
  if (ov) fail.push(`${tag}: horizontal overflow`);
  // the AUTO LAND button engages it
  const a = await hit(sel.auto);
  if (a.ok && !cover) { if (touch) await page.touchscreen.tap(a.x, a.y); else await page.mouse.click(a.x, a.y); await page.waitForFunction(() => window.__sfo.flight.auto.on, { timeout: 10000 }).catch(() => fail.push(`${tag}: the AUTO LAND button did not engage it`)); }
  if (errors.length) fail.push(`${tag}: page errors: ${errors.slice(0, 2).join(' | ')}`);
  console.log(`  page ${tag}: buttons + bar ${fail.length ? 'FAIL' : 'hit, in view, ' + lang + ', no overflow'}${b.text ? ` · bar "${b.text.slice(0, 48)}"` : ''}`);
  await page.close();
  return fail;
}

// AUTO LAND in the page (777, 2.5 NM final, day): ribbon on the path, PAPI, lights in day / golden / night, takeover
async function approachPage(br, url, mut = {}) {
  const fail = [], req = (ok, s) => { if (!ok) fail.push(s); };
  const { page, errors } = await openPage(br, url, { query: '&ac=b77w&start=final9&rwy=28R&time=day' });
  await page.waitForFunction(() => window.__sfo?.state === 'flying', { timeout: 120000 });
  await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyL'); await page.keyboard.up('ShiftLeft');
  await page.waitForFunction(() => window.__sfo.flight.auto.on && window.__sfo.viz.ribbon, { timeout: 15000 }).catch(() => req(false, 'Shift+L did not engage AUTO LAND with its ribbon'));
  if (mut.ribbonOffset) await page.evaluate((o) => { const g = window.__sfo; g.viz.offsetM = o; g.planKey = ''; g.viz.key = ''; g.syncViz(); }, mut.ribbonOffset);
  // ---- ribbon: the midpoints of its vertex rows against the 3° path the gate computes itself
  const rib = await page.evaluate(() => { const R = window.__sfo.viz.ribbon; const m = R.children[0], P = m.geometry.attributes.position.array, C = R.userData.centre; return { rows: C.map((c, i) => [c[3], (P[i * 6] + P[i * 6 + 3]) / 2, (P[i * 6 + 1] + P[i * 6 + 4]) / 2, (P[i * 6 + 2] + P[i * 6 + 5]) / 2]), rwy: R.userData.rwy }; });
  const I = W.ils.find((i) => i.id === rib.rwy), cn = Math.cos(I.crs * D), ce = Math.sin(I.crs * D);
  let worstRib = 0; const at = [];
  for (const sNm of [1, 2.5, 5, 7.5, 9.5]) {
    const row = rib.rows.reduce((b, r) => (Math.abs(r[0] - sNm * NM) < Math.abs(b[0] - sNm * NM) ? r : b));
    const s = row[0], x = I.thrE - ce * s, z = -(I.thrN - cn * s), y = I.gsH + (s + Math.hypot(I.gsN - I.thrN, I.gsE - I.thrE)) * Math.tan(I.gsDeg * D);
    const d = Math.hypot(row[1] - x, row[2] - y, row[3] - z); worstRib = Math.max(worstRib, d); at.push(R1(d));
  }
  console.log(`  ribbon ${rib.rwy}: centre from the 3° path at 1 / 2.5 / 5 / 7.5 / 9.5 NM: ${at.join(' / ')} m`);
  req(worstRib <= T['F10.ribbonM'], `ribbon ${R1(worstRib)} m from the ILS path (≤ ${T['F10.ribbonM']})`);
  void gsAltAt;
  // ---- PAPI: the rule at eye points on the path and 1° low (the gate's own rule), the page's rule, and the colours
  // the page put on the mesh for its own eye
  const papi = await page.evaluate(() => window.__sfo.airfield.userData.approach.papis.map((u) => ({ id: u.id, gsDeg: u.gsDeg, boxes: u.boxes })));
  const rule = (eye, u) => u.boxes.map((b, k) => (Math.atan2(eye[1] - b[1], Math.hypot(eye[0] - b[0], eye[2] - b[2])) / D > u.gsDeg + [0.5, 1 / 6, -1 / 6, -0.5][k] ? 'W' : 'R')).join('');
  const U = papi.find((u) => u.id === rib.rwy);
  for (const [sNm, low] of [[1, 0], [2, 0], [3, 0], [2, 1]]) {
    const s = sNm * NM, x = I.thrE - ce * s, z = -(I.thrN - cn * s), dist = Math.hypot(x - U.boxes[1][0], z - U.boxes[1][2]);
    const y = U.boxes[1][1] + dist * Math.tan((U.gsDeg - low) * D);
    const mine = rule([x, y, z], U), theirs = await page.evaluate((e, id) => { const g = window.__sfo, u = g.airfield.userData.approach.papis.find((q) => q.id === id); return g.tools.papiRead(e, u).join(''); }, [x, y, z], U.id);
    const want = low ? 'RRRR' : 'RRWW';
    req(mine === want, `PAPI rule at ${sNm} NM${low ? ' 1° low' : ''}: ${mine} (want ${want})`);
    req(theirs === mine, `page PAPI rule at ${sNm} NM${low ? ' 1° low' : ''}: ${theirs} (gate ${mine})`);
  }
  // ---- approach lights lit: stills at day, golden hour and night from the cockpit, contrast at the lights' pixels
  await page.evaluate(() => { const g = window.__sfo; g.autoCam = false; g.cams.mode = 'cockpit'; });
  await page.waitForFunction(() => { const d = window.__sfo.flight.auto.g; return d && d.dtgNm < 4.5; }, { timeout: 240000, polling: 500 });
  await page.evaluate(() => { window.__sfo.state = 'paused'; });
  if (mut.papiSwap) await page.evaluate(() => { const a = window.__sfo.airfield.userData.approach, up = a.update.bind(a); a.update = (eye) => { up(eye); const c = a.papis.length && window.__sfo.airfield.children.find((m) => m.name === 'papi').instanceColor; for (let i = 0; i < c.array.length; i += 3) c.array[i + 1] = c.array[i + 1] > 0.5 ? 0.12 : 0.96; c.needsUpdate = true; }; });
  await sleep(600);
  const mesh = await page.evaluate((id) => { const g = window.__sfo, a = g.airfield.userData.approach, m = g.airfield.children.find((q) => q.name === 'papi'), c = m.instanceColor.array, k = a.papis.findIndex((u) => u.id === id), cam = g.app.camera.position; return { cols: [0, 1, 2, 3].map((j) => (c[(k * 4 + j) * 3 + 1] > 0.5 ? 'W' : 'R')).join(''), eye: [cam.x, cam.y, cam.z] }; }, U.id);
  const expect = rule(mesh.eye, U);
  console.log(`  PAPI ${U.id}: rule on the path RRWW, 1° low RRRR; the mesh shows ${mesh.cols} for the camera, the rule says ${expect}`);
  req(mesh.cols === expect, `PAPI mesh colours ${mesh.cols} for the camera (rule ${expect})`);
  if (mut.lightsOff) await page.evaluate(() => { const a = window.__sfo.airfield.userData.approach; a.setBoost(0); a.setBoost = () => {}; });
  for (const [name, hour] of [['day', 12.0], ['golden', 17.4], ['night', 20.6]]) {
    await page.evaluate((h) => { window.__sfo.app.settings.timeOfDay = h; }, hour);
    await sleep(1800);
    const pts = await page.evaluate(() => { const g = window.__sfo, cam = g.app.camera, V = cam.position.constructor, out = []; for (const m of g.airfield.children) if (/^als-(white|red)$/.test(m.name)) { const a = m.instanceMatrix.array; for (let i = 0; i < m.count; i += 7) { const p = new V(a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14]).project(cam); if (p.z < 1 && p.z > -1) out.push([(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight]); } } return out; });
    const img = decodePng(await page.screenshot({ type: 'png' }));
    const L = lightsLit(img, pts);
    console.log(`  approach lights ${name}: ${L.lit}/${L.n} lights lit (peak ≥ 245, +50 over the surroundings)`);
    req(L.n >= 10 && L.frac >= 0.6, `approach lights not lit at ${name}: ${L.lit}/${L.n}`);
  }
  await page.evaluate(() => { const g = window.__sfo; g.app.settings.timeOfDay = 12; g.state = 'flying'; });
  // ---- takeover in the page: the frame the stick passes the takeover threshold is the frame AUTO LAND lets go
  await page.evaluate(() => { const g = window.__sfo, rec = window.__rec = []; let f = 0; const tick = () => { rec.push({ f: f++, elev: g.c.elev, on: g.flight.auto.on, q: g.flight.sim.w[1], th: g.flight.sim.euler.theta, flap: g.c.flap, thr: g.pilot.thr, thrA: g.flight.applied.thr[0] }); if (rec.length < 600) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await sleep(500);
  if (mut.ignoreTakeover) await page.evaluate(() => { window.__sfo.flight.auto.patch.takeover = 2; });
  await page.keyboard.down('ArrowDown'); await sleep(160); await page.keyboard.up('ArrowDown');
  await sleep(3500);
  const rec = await page.evaluate(() => window.__rec);
  const fi = rec.findIndex((r) => Math.abs(r.elev) > 0.1), fo = rec.findIndex((r) => !r.on);
  const after = rec.filter((r, i) => i > fi + 30 && Math.abs(r.elev) < 1e-3), qMax = Math.max(0, ...after.map((r) => Math.abs(r.q) / D));
  console.log(`  takeover in the page: stick past 0.1 at frame ${fi}, AUTO LAND off at frame ${fo}; afterwards |q| ≤ ${R1(qMax)}°/s, flaps ${rec[rec.length - 1].flap}, throttle lever ${rec[rec.length - 1].thr.toFixed(2)}`);
  req(fi >= 0 && fo >= 0 && fo - fi <= T['F10.takeoverFrames'], `takeover: stick at frame ${fi}, disconnect at frame ${fo} (≤ ${T['F10.takeoverFrames']} frame)`);
  req(qMax < 3, `takeover: not handed back trimmed (|q| ${R1(qMax)}°/s)`);
  if (errors.length) req(false, `page errors: ${errors.slice(0, 2).join(' | ')}`);
  await page.close();
  return fail;
}

// a touchdown banked beyond the pod margin (777, robot on the joystick fixture): BANK ANGLE first, then the strike,
// then the result screen's plain words with the bank
async function podStrike(br, url, { suppress = false } = {}) {
  const fail = [];
  const { page, errors } = await openPage(br, url, { query: '&ac=b77w&start=final3&rwy=28R&time=day&timescale=2', init: PAD });
  await page.waitForFunction(() => window.__sfo?.state === 'flying', { timeout: 120000 });
  if (suppress) await page.evaluate(() => { window.__sfo.flight.auto.margin = { deg: 90, part: 'nacelle' }; });
  await page.evaluate(() => {
    const g = window.__sfo, pad = window.__pad, TP = g.tools.TestPilot, D = Math.PI / 180, FT = 0.3048;
    const R = g.W.runways.find((r) => r.id === '28R'), I = g.W.ils.find((i) => i.id === '28R');
    const st = window.__pod = { warnT: null, crashT: null, log: [] };
    let P = null; const c = { elev: 0, ail: 0, rud: 0, thr: [0.4, 0.4], trim: 0 };
    const put = (i, v) => { pad.axes[i] = v === 0 ? 0 : Math.sign(v) * (Math.min(1, Math.abs(v)) * 0.92 + 0.08); };
    const tick = () => {
      const s = g.flight?.sim; if (!s) return requestAnimationFrame(tick);
      if (!P || P.sim !== s) P = new TP(s, 0.45);
      const ra = s.altMsl - Math.max(s.groundH, 0) - s.ac.model.gearGround;
      const d = g.tools.ilsDeviation(I, s.pos[0], s.pos[1], s.altMsl);
      const T = { gamma: -3 * D + Math.max(-0.03, Math.min(0.03, -d.gsErrM * 0.004)), cas: 150 };
      if (ra > 130 * FT) T.track = { n: R.thrN, e: R.thrE, crs: R.crs }; else T.bank = 13 * D;
      if (!s.crashed) P.fly(c, T);
      put(0, c.ail); put(1, -c.elev); pad.axes[2] = 1 - 2 * Math.max(0, Math.min(1, c.thr[0]));
      const msg = document.querySelector('.sf-msg')?.textContent;
      if (st.warnT == null && msg === g.ui.L.bankWarn) st.warnT = s.t;
      if (s.crashed && st.crashT == null) { st.crashT = s.crashT; st.crash = s.crashed; st.info = s.crashInfo; }
      if (g.state !== 'ended') requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForFunction(() => window.__sfo.state === 'ended' || window.__sfo.flight.scorer.landing?.complete, { timeout: 240000, polling: 500 });
  await sleep(2500);
  const r = await page.evaluate(() => ({ ...window.__pod, why: document.querySelector('.sf-result .sf-why')?.textContent || '', crashText: document.querySelector('.sf-result .sf-crash')?.textContent || '', score: window.__sfo.flight.scorer.landing?.score }));
  const lead = r.warnT != null && r.crashT != null ? r.crashT - r.warnT : null;
  console.log(`  pod strike: ${r.crash || 'no crash'} (bank ${r.info ? R1(r.info.bank) : '-'}°), BANK ANGLE ${r.warnT == null ? 'never shown' : `shown ${R1(lead)} s before`}; result: "${r.why}"`);
  if (r.crash !== 'nacelle') fail.push(`the banked touchdown was not a pod strike (${r.crash || 'landed, score ' + r.score})`);
  if (lead == null || lead < T['F10.bankWarnLeadS']) fail.push(`BANK ANGLE ${r.warnT == null ? 'never shown' : `only ${R1(lead)} s`} before the strike (≥ ${T['F10.bankWarnLeadS']} s)`);
  const num = r.info ? String(Math.round(Math.abs(r.info.bank))) : 'x';
  if (!/pod/i.test(r.why) || !r.why.includes(num + '°')) fail.push(`result screen does not say why with the bank: "${r.why}" (bank ${num}°)`);
  if (errors.length) fail.push(`page errors: ${errors.slice(0, 2).join(' | ')}`);
  await page.close();
  return fail;
}

async function checkPage({ mut = {}, only = null } = {}) {
  const srv = await serve(), br = await launch();
  const fail = [];
  try {
    if (!only || only === 'hit') for (const [viewport, touch] of [[{ width: 1440, height: 900 }, false], [{ width: 390, height: 844 }, true]]) for (const lang of ['en', 'zh']) { fail.push(...await hitTest(br, srv.url, { viewport, touch, lang, cover: !!mut.cover })); if (mut.cover) break; }
    if (!only || only === 'approach') fail.push(...await approachPage(br, srv.url, mut));
    if (!only || only === 'pod') fail.push(...await podStrike(br, srv.url, { suppress: !!mut.suppress }));
  } finally { await br.close(); srv.close(); }
  return fail;
}

async function check() {
  const fail = [];
  fail.push(...checkTerrain());
  fail.push(...checkAuto());
  fail.push(...checkGuide());
  fail.push(...checkTakeover());
  fail.push(...await checkPage());
  return fail;
}

if (process.argv[1]?.endsWith('f10.mjs')) await gate('F10', check, [
  ['route across terrain (planner without its terrain step)', () => checkTerrain({ noTerrain: true })],
  ['bank beyond the pod margin near the ground', () => checkAuto({ patch: { bankLow: 20, lowBankBias: 16 }, cases: [['b77w', 'ggb', 'calm']] })],
  ['LANDING CONFIG missed', () => checkAuto({ patch: { noLandingCfg: true }, cases: [['b77w', 'downwind', 'calm'], ['c172', 'downwind', 'calm']] })],
  ['instruction shown late', () => checkGuide({ guideOpts: { lead: 0 }, cases: [['c172', 'ggb', 'calm']] })],
  ['turns told the wrong way', () => checkGuide({ guideOpts: { flipTurns: true }, cases: [['c172', 'downwind', 'calm']] })],
  ['takeover ignored', () => checkTakeover({ takeover: 2 })],
  ['ribbon 20 m off the path', () => checkPage({ mut: { ribbonOffset: 20 }, only: 'approach' })],
  ['PAPI colours swapped', () => checkPage({ mut: { papiSwap: true }, only: 'approach' })],
  ['approach lights off by day', () => checkPage({ mut: { lightsOff: true }, only: 'approach' })],
  ['BANK ANGLE warning suppressed', () => checkPage({ mut: { suppress: true }, only: 'pod' })],
  ['instruction bar covered', () => checkPage({ mut: { cover: true }, only: 'hit' })],
]);
export { checkAuto, checkGuide, checkTakeover, checkTerrain, checkPage };
