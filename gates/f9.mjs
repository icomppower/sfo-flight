// F9 Easy (M1.1): the Missions menu, the guided checklist and TAKEOFF / LANDING CONFIG, in real Chrome on the build.
//  - trims: every trim setting in fdm/configs.ts is what trimFly finds for the condition it names (±0.002);
//  - each mission loads its exact aircraft / start / runway / time and checklist from a fresh page (menu click);
//  - scripted inputs (keys, MCP clicks, a robot pilot on the Gamepad API fixture) complete each checklist in order:
//    the gate records its own evaluation of every step's condition each frame and requires each tick within 1 s of
//    the condition being met, never before; in mission ③ the throttle step must stay open for 6 s with the throttle
//    closed; mission ① autolands with score ≥ 80 after its three clicks, mission ② lands with score ≥ 70;
//  - TAKEOFF / LANDING CONFIG give exactly the SPEC §12 state on both aircraft; LANDING CONFIG outside the ILS
//    window does not arm APP;
//  - the checklist and both config buttons are hit-tested at 1440×900 and 390×844, in zh and en, with no overflow
//    and no overlap with the other controls.
// --negative: a step that ticks at once, a step that ticks on a timer, a config item left unset, APP armed outside
// the window, a mission that loads the wrong runway and a covered config button must each fail.
import { execFileSync } from 'node:child_process';
import { root, gate } from './lib/common.mjs';
import { serve, launch, openPage, sleep } from './lib/browser.mjs';
import { trimFly } from '../fdm/pilot.ts';
import { C172 } from '../fdm/aircraft/c172.ts';
import { B77W } from '../fdm/aircraft/b77w.ts';
import { CONFIGS, B77W_TO_TRIM } from '../fdm/configs.ts';

const TRIM_TOL = 0.002, Q = 1 / 1024;
// SPEC §12 as the gate reads it
const MISSION = { 1: { ac: 'b77w', start: 'final9', rwy: '28R', time: 'golden', steps: 7 }, 2: { ac: 'c172', start: 'final3', rwy: '28R', steps: 5 }, 3: { ac: 'c172', start: 'runway', rwy: '28R', steps: 7 }, 4: { ac: 'c172', start: 'ggb', steps: 4 } };
const HOLDS = { 1: [0, 0, 0, 0, 0, 0, 0], 2: [3, 5, 0, 0, 0], 3: [0, 0, 0, 0, 5, 0, 0], 4: [0, 3, 3, 10] };

function trims() {
  const fail = [], row = (ac, o, want, name) => { const t = trimFly(ac, { alt: 600, seconds: 150, ...o }).sim.trimPos; console.log(`  trim ${name}: table ${want.toFixed(4)}, trimFly ${t.toFixed(4)}`); if (Math.abs(t - want) > TRIM_TOL) fail.push(`${name} trim ${want} vs trimFly ${t.toFixed(4)}`); };
  row(C172, { cas: 70, flap: 1, gamma: 4 }, CONFIGS.c172.takeoff.trim, 'C172 takeoff');
  row(C172, { cas: 65, flap: 3, gamma: -3, alt: 300 }, CONFIGS.c172.landing.trim, 'C172 landing');
  for (const [m, t] of B77W_TO_TRIM) row(B77W, { cas: 178, flap: 3, gamma: 5, mass: m, gear: 1 }, t, `777 takeoff ${m / 1000} t`);
  return fail;
}

export const PAD = () => { const pad = { id: 'SFO fixture joystick', index: 0, connected: true, mapping: '', timestamp: 0, axes: [0, 0, 1, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [pad]; window.__pad = pad; };

// the gate's own step conditions (SPEC §11/§12 wording), evaluated on every frame the game runs
const INSTALL = (id) => {
  const g = window.__sfo, D = Math.PI / 180, FT = 0.3048, KT = 0.514444;
  const R = g.W.runways.find((r) => r.id === '28R'), I = g.W.ils.find((i) => i.id === '28R'), u = [Math.cos(R.crs * D), Math.sin(R.crs * D)];
  const geo = (s) => { const dn = s.pos[0] - R.thrN, de = s.pos[1] - R.thrE; return { along: dn * u[0] + de * u[1], lat: -dn * u[1] + de * u[0] }; };
  const gsDots = (s) => { const x = -geo(s).along + Math.hypot(I.gsN - I.thrN, I.gsE - I.thrE); return (Math.atan2(s.altMsl - I.gsH, Math.max(1, x)) / D - I.gsDeg) / (0.12 * I.gsDeg); };
  const td = (s) => s.onGround && s.touchdowns.length > 0, agl = (s) => s.agl / FT, thr = () => Math.max(...g.flight.applied.thr), ap = () => g.flight.ap;
  const stopped = (s) => !!g.flight.scorer.landing?.complete || (td(s) && s.gs < KT);
  const P = {
    1: [() => g.mcpOn, () => ap().at, () => ap().on, () => ap().gsArm || ap().vert === 'GS', () => ap().vert === 'GS', td, stopped],
    2: [(s) => Math.abs(geo(s).lat) < 40 && Math.abs(((s.euler.psi / D - R.crs + 540) % 360) - 180) < 10, (s) => s.cas >= 58 && s.cas <= 78 && Math.abs(gsDots(s)) < 1.5, (s) => agl(s) < 100 && thr() <= 0.1, td, stopped],
    3: [(s) => g.c.park < 0.5 && s.ac.flaps.detents[g.c.flap] === 10 && g.c.mixture > 0.5 && Math.abs(s.trimPos - 0.0205) < 0.002, () => thr() >= 0.95, (s) => s.cas >= 55, (s) => !s.onGround && agl(s) > 20, (s) => !s.onGround && s.cas >= 68 && s.cas <= 82, (s) => !s.onGround && agl(s) >= 300 && s.ac.flaps.detents[g.c.flap] === 0, (s) => !s.onGround && agl(s) >= 1000],
    4: [() => g.cams.mode !== 'cockpit', (s) => !s.onGround && Math.abs(s.euler.phi / D) >= 10 && Math.abs(s.euler.phi / D) <= 35, (s) => !s.onGround && Math.abs(s.euler.phi / D) < 5, (s) => !s.onGround && s.altMsl / FT >= 1200 && s.altMsl / FT <= 1800],
  }[id];
  window.__rec = { frames: [], t0: performance.now() };
  g.onFrame = () => { const s = g.flight.sim; window.__rec.frames.push([performance.now(), s.t, g.checklist.i, ...P.map((p) => (p(s) ? 1 : 0))]); };
};

// each tick within 1 s after the gate's condition (with its hold, counted from the step becoming current), never before
export function timing(frames, ticks, holds, t0) {
  const fail = []; let start = t0;
  for (let k = 0; k < holds.length; k++) {
    const T = ticks[k];
    if (!T) { fail.push(`step ${k + 1} never ticked`); break; }
    if (T.skipped) fail.push(`step ${k + 1} was skipped`);
    let since = null, met = null;
    for (const f of frames) {
      if (f[0] < start) continue; if (f[0] > T.at + 1500) break;
      if (f[3 + k]) { if (since == null) since = f[1]; if (f[1] - since >= holds[k] - 1e-9) { met = f[0]; break; } } else since = null;
    }
    if (met == null) fail.push(`step ${k + 1} (${T.id}) ticked but its condition was never met`);
    else if (T.at < met - 250) fail.push(`step ${k + 1} (${T.id}) ticked ${Math.round(met - T.at)} ms before its condition`);
    else if (T.at - met > 1000) fail.push(`step ${k + 1} (${T.id}) ticked ${Math.round(T.at - met)} ms after its condition`);
    start = T.at;
  }
  return fail;
}

// the robot pilot on the joystick fixture (F7's control laws): 'land' from a final, 'takeoff', 'sight'
export const ROBOT = (mode) => {
  const g = window.__sfo, pad = window.__pad, TP = g.tools.TestPilot, D = Math.PI / 180, FT = 0.3048;
  const R = g.W.runways.find((r) => r.id === '28R'), u = [Math.cos(R.crs * D), Math.sin(R.crs * D)], rt = [-u[1], u[0]], thrH = g.W.ils.find((i) => i.id === '28R').thrH;
  const st = window.__robot = { phase: { land: 'final', takeoff: 'roll', sight: 'bank' }[mode], brakes: false, log: [], done: false };
  let P = null, c = { elev: 0, ail: 0, rud: 0, thr: [1], trim: 0 }, flareSink = 0, flareTh = 0, tPh = 0, hdg0 = 0;
  const put = (i, v) => { pad.axes[i] = v === 0 ? 0 : Math.sign(v) * (Math.min(1, Math.abs(v)) * 0.92 + 0.08); };
  const tick = () => {
    const s = g.flight?.sim; if (!s || g.state === 'ended' || st.done) { st.done = true; return; }
    if (!P || P.sim !== s) { P = new TP(s, 0.6); hdg0 = s.euler.psi / D; }
    const e = s.euler, dn = s.pos[0] - R.thrN, de = s.pos[1] - R.thrE, along = dn * u[0] + de * u[1], lat = dn * rt[0] + de * rt[1], agl = s.altMsl - thrH - 1.0;
    const set = (p) => { if (st.phase !== p) { st.phase = p; st.log.push([p, Math.round(s.t)]); P.thetaCmd = null; P.gamSpd = null; tPh = s.t; } };
    if (!tPh) tPh = s.t;
    let T;
    switch (st.phase) {
      case 'roll': T = { pitch: e.theta, thr: 1, bank: 0 }; if (s.cas > 56) set('rotate'); break;
      case 'rotate': T = { pitch: 9 * D, thr: 1, bank: 0 }; if (agl > 60 * FT) set('climb'); break;
      case 'climb': T = { cas: 75, speedOnPitch: true, thr: 1, hdg: R.crs }; break;
      case 'final': { const gp = Math.max(0, 300 - along) * Math.tan(3 * D); T = { gamma: -3 * D + Math.max(-0.05, Math.min(0.05, (gp - agl) * 0.01)), cas: 65, track: { n: R.thrN, e: R.thrE, crs: R.crs } }; if (agl < 15 * FT) { set('flare'); flareSink = Math.abs(s.vel[2]); flareTh = e.theta; } break; }
      case 'flare': { const vs = -Math.max(agl / (15 * FT) * flareSink, 0.35); T = { pitch: flareTh + Math.max(-0.02, Math.min(0.12, (vs + s.vel[2]) * 0.05)), thr: 0, track: { n: R.thrN, e: R.thrE, crs: R.crs } }; if (s.onGround && s.touchdowns.length) set('rollout'); break; }
      case 'rollout': T = { pitch: e.theta, thr: 0, bank: 0 }; st.brakes = s.cas < 50; if (g.flight.scorer.landing?.complete) st.done = true; break;
      case 'bank': T = { alt: 1500 * FT, cas: 100, bank: 20 * D }; if (s.t - tPh > 5) set('level'); break;
      case 'level': T = { alt: 1500 * FT, cas: 100, bank: 0 }; break;
    }
    P.fly(c, T);
    if (s.onGround) { const he = ((R.crs - e.psi / D + 540) % 360) - 180; c.rud = Math.max(-1, Math.min(1, he * D * 5 - lat * 0.01)); if (st.phase === 'roll' || st.phase === 'rollout') c.ail = 0; }
    put(0, c.ail); put(1, -c.elev); pad.axes[2] = 1 - 2 * Math.max(0, Math.min(1, c.thr[0])); put(5, c.rud);
    pad.buttons[4] = { pressed: c.trim < -0.3, value: c.trim < -0.3 ? 1 : 0 }; pad.buttons[5] = { pressed: c.trim > 0.3, value: c.trim > 0.3 ? 1 : 0 };
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const snap = (page) => page.evaluate(() => { const g = window.__sfo, K = g.checklist; return { state: g.state, i: K?.i, done: K?.done, crashed: g.flight?.sim.crashed, landing: g.flight?.scorer.landing, robot: window.__robot?.phase, brakes: window.__robot?.brakes, aglFt: g.flight ? g.flight.sim.agl / 0.3048 : 0 }; });

async function mission(br, url, id, fx = {}) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(`mission ${id}: ${m}`); return ok; };
  const { page, errors } = await openPage(br, url, { query: `&lang=${id % 2 ? 'en' : 'zh'}`, init: PAD });
  try {
    await page.waitForSelector('.sf-menu [data-mission]', { timeout: 20000 });
    if (fx.wrongRwy) await page.evaluate(() => { window.__sfo.tools.MISSIONS[1].rwy = '28L'; });
    if (fx.patch) await page.evaluate(fx.patch);
    await page.click(`.sf-menu [data-mission="${id}"]`);
    await page.waitForFunction(() => window.__sfo.state === 'flying' && window.__sfo.checklist, { timeout: 30000 });
    await page.evaluate(INSTALL, id);
    await page.waitForFunction(() => !window.__sfo.ui.dom.check.hidden, { timeout: 2000 }).catch(() => {});
    // ---- the load: exact start, aircraft, runway, time, checklist on its first step, overlay shown
    const L = await page.evaluate(() => { const g = window.__sfo, TIMES = { dawn: 6.6, day: 12.0, golden: 17.4, night: 20.6 }, d = g.ui.dom.check; return { ac: g.ac.id, start: g.opts.start, rwy: g.opts.rwy, time: g.opts.time, tod: g.app.settings.timeOfDay, todWant: TIMES[g.opts.time], m: g.checklist.m.id, i: g.checklist.i, n: g.checklist.m.steps.length, shown: !d.hidden && d.getBoundingClientRect().height > 20, list: [...d.querySelectorAll('.ck-list li')].map((li) => li.className).join(','), text: d.querySelector('.ck-text').textContent, want: g.ui.L.steps[g.checklist.m.id][g.checklist.m.steps[0].id], startName: g.startName }; });
    const M = MISSION[id];
    req(L.ac === M.ac && L.start === M.start && (!M.rwy || L.rwy === M.rwy) && (!M.time || L.time === M.time) && Math.abs(L.tod - L.todWant) < 0.01, `loaded ${JSON.stringify(L)}`);
    req(L.m === id && L.i === 0 && L.n === M.steps && L.shown && L.text === L.want && L.list === ['cur', ...Array(M.steps - 1).fill('')].join(','), `checklist not on its first step: ${JSON.stringify(L)}`);
    if (fx.loadOnly) return fail;
    // ---- scripted inputs
    const keyShift = async (k) => { await page.keyboard.down('ShiftLeft'); await page.keyboard.press(k); await page.keyboard.up('ShiftLeft'); };
    if (id === 1) {
      await keyShift('KeyA');
      await page.waitForSelector('.sf-mcp:not([hidden]) button[data-e="AT"]', { timeout: 5000 });
      for (const e of ['AT', 'AP', 'APP']) { await sleep(1200); await page.click(`.sf-mcp button[data-e="${e}"]`); }
    } else if (id === 2) await page.evaluate(ROBOT, 'land');
    else if (id === 3) {
      await sleep(800); await page.keyboard.press('KeyT');
      await sleep(6000);
      const open = await snap(page);
      req(open.i === 1, `throttle closed for 6 s, but the checklist is on step ${open.i + 1} (the throttle step must stay open)`);
      const lv = await page.$eval('.sf-check', (d) => ({ live: d.querySelector('.ck-live').textContent, marks: [...d.querySelectorAll('.ck-list li i')].map((i) => i.textContent).join('') }));
      req(/0 %/.test(lv.live) && lv.marks.startsWith('✓▶○'), `step list / live value on the throttle step: ${JSON.stringify(lv)}`);
      if (fx.stopEarly) return fail.concat(await finishTiming(page, id, true));
      await page.evaluate(ROBOT, 'takeoff');
    } else if (id === 4) { await sleep(800); await page.keyboard.press('KeyC'); await sleep(1000); await page.evaluate(ROBOT, 'sight'); }
    if (fx.stopEarly) { await sleep(4000); return fail.concat(await finishTiming(page, id, true)); }
    let braking = false, flapsUp = false, last = '', t0 = Date.now();
    while (Date.now() - t0 < 480000) {
      const r = await snap(page);
      const line = `step ${r.i} ${r.robot || ''}`; if (line !== last) { last = line; console.log(`  mission ${id}: ${line}`); }
      if (r.brakes && !braking) { await page.keyboard.down('KeyB'); braking = true; }
      if (id === 3 && !flapsUp && r.robot === 'climb' && r.aglFt > 350) { await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyF'); await page.keyboard.up('ShiftLeft'); flapsUp = true; }
      if (r.crashed || r.state === 'ended' || (id > 2 && r.done)) break;
      await sleep(400);
    }
    if (braking) await page.keyboard.up('KeyB');
    if (id <= 2) await page.waitForFunction(() => window.__sfo.state === 'ended', { timeout: 30000 }).catch(() => {});
    fail.push(...await finishTiming(page, id, false));
    const marks = await page.$$eval('.sf-check .ck-list li.done', (l) => l.length).catch(() => -1);
    if (id > 2) req(marks === MISSION[id].steps, `${marks} of ${MISSION[id].steps} steps checked ✓ in the list at the end`);
    if (id <= 2) {
      const r = await snap(page), min = id === 1 ? 80 : 70;
      console.log(`  mission ${id}: ${r.crashed ? 'crashed ' + r.crashed : r.landing ? `landed ${r.landing.runway} score ${r.landing.score} (${r.landing.grade}), sink ${Math.round(r.landing.sinkFpm)} fpm` : 'no landing'}`);
      req(!r.crashed && r.landing?.complete && r.landing.score >= min, `landing score ${r.landing?.score} (≥ ${min}), crashed ${r.crashed}`);
    }
    const errs = errors.filter((e) => !/favicon/.test(e));
    req(!errs.length, `page errors: ${errs.slice(0, 3).join(' | ')}`);
  } catch (e) { fail.push(`mission ${id} stopped: ${e.message.split('\n')[0]}`); } finally { await page.close(); }
  return fail;
}
async function finishTiming(page, id, partial) {
  const R = await page.evaluate(() => ({ frames: window.__rec.frames, t0: window.__rec.t0, ticks: window.__sfo.checklist.ticks, ids: window.__sfo.checklist.m.steps.map((s) => s.id), done: window.__sfo.checklist.done }));
  const holds = partial ? HOLDS[id].slice(0, R.ticks.length) : HOLDS[id];
  const f = timing(R.frames, R.ticks, holds, R.t0).map((m) => `mission ${id}: ${m}`);
  if (!partial && !R.done) f.push(`mission ${id}: checklist not complete (${R.ticks.length}/${R.ids.length})`);
  if (R.ticks.some((t, k) => t.id !== R.ids[k])) f.push(`mission ${id}: steps out of order`);
  console.log(`  mission ${id} ticks: ${R.ticks.map((t, k) => `${t.id} +${((t.at - (k ? R.ticks[k - 1].at : R.t0)) / 1000).toFixed(1)}s`).join(', ')} (${R.frames.length} frames)`);
  return f;
}

// TAKEOFF / LANDING CONFIG on both aircraft, item by item against SPEC §12
async function configs(br, url, fx = {}) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(m); return ok; };
  const { page, errors } = await openPage(br, url, { query: '&lang=en&ac=c172&start=runway&rwy=28R&wx=calm' });
  try {
    await page.waitForFunction(() => window.__sfo.state === 'flying', { timeout: 30000 });
    if (fx.skipItem) await page.evaluate(() => { const T = window.__sfo.tools.TAKEOFF_ITEMS.b77w; T.splice(T.findIndex((x) => x[0] === 'autobrake'), 1); });
    if (fx.appAlways) await page.evaluate(() => { const L = window.__sfo.tools.LANDING_ITEMS.b77w, g = window.__sfo; L[L.findIndex((x) => x[0] === 'app')][1] = () => { g.pending = g.tools.AP_EVENT.APP; }; });
    const fly = async (ac, start, over = null) => { await page.evaluate((ac, start, over) => { const g = window.__sfo; g.opts = { ...g.opts, ac, start, rwy: '28R', wx: 'calm', startOver: over }; return g.startFlight(); }, ac, start, over); await page.waitForFunction(() => window.__sfo.state === 'flying', { timeout: 30000 }); await sleep(600); };
    const state = () => page.evaluate(() => { const g = window.__sfo, s = g.flight.sim, a = g.W.airport; return { flapDeg: s.ac.flaps.detents[g.c.flap], park: g.c.park, mixture: g.c.mixture, engMix: g.eng.mixture, trimPos: s.trimPos, gear: g.c.gear, spoiler: g.c.spoiler, autobrake: g.autobrake, mcp: { ...g.mcp }, atArm: g.atArm, bug: g.bug, mass: s.mass, gsArm: !!g.flight.ap?.gsArm, locArm: !!(g.flight.ap && (g.flight.ap.locArm || g.flight.ap.lat === 'LOC')), rwyMag: ((g.W.runways.find((r) => r.id === '28R').crs - a.trueNorthGridDeg - a.magVar) % 360 + 360) % 360, onGround: s.onGround, thr: g.flight.applied.thr.slice(), elev: g.c.elev }; });
    const eq = (name, got, want, tol = 0) => req(typeof want === 'number' ? Math.abs(got - want) <= tol : got === want, `${name}: ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
    // ---- C172 takeoff
    await fly('c172', 'runway'); await page.keyboard.press('KeyT'); await sleep(600);
    let s = await state(); console.log(`  C172 TAKEOFF CONFIG: flaps ${s.flapDeg}°, park ${s.park}, trim ${s.trimPos.toFixed(4)}, mixture ${s.mixture}`);
    eq('C172 T flaps', s.flapDeg, 10); eq('C172 T parking brake', s.park, 0); eq('C172 T trim', s.trimPos, 0.0205, Q); eq('C172 T mixture', s.mixture, 1); eq('C172 T mixture switch', s.engMix, true);
    // ---- C172 landing (airborne)
    await fly('c172', 'final9'); await page.keyboard.press('KeyL'); await sleep(2500);
    s = await state(); console.log(`  C172 LANDING CONFIG: flaps ${s.flapDeg}°, trim ${s.trimPos.toFixed(4)}, bug ${s.bug}`);
    eq('C172 L flaps', s.flapDeg, 30); eq('C172 L trim', s.trimPos, 0.0065, Q); eq('C172 L bug', s.bug, 65);
    // ---- 777 takeoff
    await fly('b77w', 'runway'); await page.keyboard.press('KeyT'); await sleep(600);
    s = await state();
    const toTrim = trimFly(B77W, { alt: 600, seconds: 150, cas: 178, flap: 3, gamma: 5, mass: s.mass, gear: 1 }).sim.trimPos;
    console.log(`  777 TAKEOFF CONFIG: flaps ${s.flapDeg}°, trim ${s.trimPos.toFixed(4)} (trimFly ${toTrim.toFixed(4)} at ${Math.round(s.mass / 1000)} t), spoilers ${s.spoiler}, autobrake ${s.autobrake}, MCP ${JSON.stringify(s.mcp)}, A/T arm ${s.atArm}`);
    eq('777 T flaps', s.flapDeg, 15); eq('777 T parking brake', s.park, 0); eq('777 T trim for weight', s.trimPos, toTrim, TRIM_TOL); eq('777 T spoilers disarmed', s.spoiler, 0); eq('777 T autobrake RTO', s.autobrake, 6);
    eq('777 T SPD = V2', s.mcp.spd, 168); eq('777 T HDG = runway', s.mcp.hdg, Math.round(s.rwyMag) % 360, 1); eq('777 T ALT', s.mcp.alt, 3000); eq('777 T A/T armed', s.atArm, true);
    req(s.thr.every((x) => x === 0) && s.elev === 0, `TAKEOFF CONFIG moved a flight control: thr ${s.thr}, elev ${s.elev}`);
    // TO/GA: the A/T engages and the levers go up
    await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyT'); await page.keyboard.up('ShiftLeft'); await sleep(1500);
    const tg = await page.evaluate(() => ({ at: window.__sfo.flight.ap.at, thr: Math.min(...window.__sfo.flight.applied.thr) }));
    req(tg.at && tg.thr > 0.95, `TO/GA: A/T ${tg.at}, levers ${tg.thr}`);
    // ---- 777 landing inside the ILS window (9 NM final 28R) and outside it (over the Golden Gate)
    await fly('b77w', 'final9'); await page.keyboard.press('KeyL'); await sleep(600);
    s = await state();
    const vref = 149 * Math.sqrt(s.mass / 251290) + 5;
    console.log(`  777 LANDING CONFIG on final: gear ${s.gear}, flaps ${s.flapDeg}°, spoilers ${s.spoiler}, autobrake ${s.autobrake}, SPD ${s.mcp.spd} (Vref+5 ${vref.toFixed(1)}), LOC ${s.locArm} APP ${s.gsArm}`);
    eq('777 L gear', s.gear, 1); eq('777 L flaps', s.flapDeg, 30); eq('777 L spoilers armed', s.spoiler, -1); eq('777 L autobrake', s.autobrake, 3); eq('777 L SPD = Vref+5', s.mcp.spd, vref, 0.5);
    req(s.locArm && s.gsArm, `777 LANDING CONFIG within 12 NM of 28R did not arm LOC + APP`);
    // over the Golden Gate heading 325° grid: every SFO localizer is behind or more than 45° off (checked here too)
    await fly('b77w', 'ggb', { hdg: 325 }); await page.keyboard.press('KeyL'); await sleep(600);
    const inWin = await page.evaluate(() => { const g = window.__sfo, s = g.flight.sim, D = Math.PI / 180; return g.W.ils.filter((I) => { const dn = I.thrN - s.pos[0], de = I.thrE - s.pos[1], u = [Math.cos(I.crs * D), Math.sin(I.crs * D)], ahead = dn * u[0] + de * u[1], off = Math.abs(((s.euler.psi / D - I.crs + 540) % 360) - 180); return ahead > 0 && ahead < 12 * 1852 && off <= 45; }).map((I) => I.id); });
    req(!inWin.length, `the outside-window fixture is inside the window of ${inWin.join(', ')}`);
    s = await state(); console.log(`  777 LANDING CONFIG over the Golden Gate heading north: gear ${s.gear}, flaps ${s.flapDeg}°, LOC ${s.locArm} APP ${s.gsArm}`);
    eq('777 L gear (ggb)', s.gear, 1); eq('777 L flaps (ggb)', s.flapDeg, 30);
    req(!s.gsArm && !s.locArm, 'LANDING CONFIG outside the ILS window armed APP');
    const errs = errors.filter((e) => !/favicon/.test(e));
    req(!errs.length, `page errors: ${errs.slice(0, 3).join(' | ')}`);
  } catch (e) { fail.push(`configs stopped: ${e.message.split('\n')[0]}`); } finally { await page.close(); }
  return fail;
}

// the checklist, its buttons and both config buttons: reachable, in view, not overlapping, text not clipped
async function layout(br, url, vp, lang, fx = {}) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(`${vp.width}×${vp.height} ${lang}: ${m}`); return ok; };
  const touch = vp.width < 600;
  const { page, errors } = await openPage(br, url, { viewport: vp, touch, query: `${touch ? '&touch' : ''}&lang=${lang}&mission=1` });
  try {
    await page.waitForFunction(() => window.__sfo.state === 'flying' && window.__sfo.checklist, { timeout: 30000 });
    await page.evaluate(() => window.__sfo.pilot.press('apPanel'));
    await sleep(800);
    if (fx.cover) await page.evaluate(() => { const b = document.querySelector('.sf-cfg [data-cfg="landing"]').getBoundingClientRect(); const d = document.createElement('div'); d.style.cssText = `position:fixed;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;z-index:99;pointer-events:auto`; document.body.append(d); });
    const R = await page.evaluate((touch) => {
      const mine = ['.sf-check .ck-text', '.sf-check [data-ck="next"]', '.sf-check [data-ck="hide"]', '.sf-cfg [data-cfg="takeoff"]', '.sf-cfg [data-cfg="landing"]'].map((q) => document.querySelector(q));
      const others = [...document.querySelectorAll(`.sf-mcp:not([hidden]) button${touch ? ', .sf-stick, .sf-thr input, .sf-btns button' : ''}`)];
      const box = (e) => e.getBoundingClientRect();
      const hit = (e) => { const r = box(e), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === e || e.contains(h)); };
      const inView = (r) => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.width > 0;
      const ov = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const card = document.querySelector('.sf-check'), cfg = document.querySelector('.sf-cfg');
      return {
        mine: mine.map((e) => ({ id: e.dataset.cfg || e.dataset.ck || e.className, hit: hit(e), inView: inView(box(e)), clipped: e.scrollWidth > e.clientWidth + 1, text: e.textContent })),
        overlaps: others.filter((o) => ov(box(o), box(card)) || ov(box(o), box(cfg))).map((o) => o.dataset.e || o.dataset.k || o.dataset.a || o.className),
        sw: document.documentElement.scrollWidth, lang: document.documentElement.lang,
      };
    }, touch);
    console.log(`  layout ${vp.width}×${vp.height} ${lang}: ${R.mine.map((m) => `${m.id}${m.hit && m.inView && !m.clipped ? ' ok' : ' BAD'} "${m.text.slice(0, 18)}"`).join(' · ')}; overlaps ${R.overlaps.length}, scrollWidth ${R.sw}`);
    for (const m of R.mine) req(m.hit && m.inView && !m.clipped, `${m.id} hit ${m.hit}, in view ${m.inView}, clipped ${m.clipped}`);
    req(!R.overlaps.length, `overlaps other controls: ${R.overlaps.join(', ')}`);
    req(R.sw <= vp.width, `horizontal overflow ${R.sw}`);
    req(lang === 'zh' ? R.lang === 'zh-Hant' && R.mine.every((m) => m.id === 'hide' || /[一-鿿]/.test(m.text)) : R.lang === 'en', `language: ${R.lang}`);
    if (!fx.cover) {
      // the missions menu and How to fly: every mission button reachable, the reversed-pitch note shown
      await page.keyboard.press('Escape'); await page.waitForSelector('.sf-menu [data-mission]');
      const mb = await page.$$eval('.sf-menu [data-mission], .sf-menu [data-go="checklist"], .sf-menu [data-go="howto"]', (bs) => bs.map((b) => { b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { id: b.dataset.mission || b.dataset.go, ok: !!h && b.contains(h) && r.right <= innerWidth }; }));
      req(mb.length === 6 && mb.every((m) => m.ok), `menu buttons: ${JSON.stringify(mb)}`);
      await page.click('.sf-menu [data-go="howto"]');
      const how = await page.$eval('.sf-howto', (d) => ({ rev: d.querySelector('.sf-rev')?.textContent || '', rows: d.querySelectorAll('tr').length }));
      req(/↓/.test(how.rev) && how.rows >= 5, `How to fly: ${JSON.stringify(how)}`);
      await page.click('.sf-howto [data-go="back"]'); await page.click('.sf-menu [data-go="checklist"]');
      const back = await page.evaluate(() => ({ state: window.__sfo.state, shown: !window.__sfo.checklist.hidden }));
      req(back.state === 'flying' && back.shown, `Esc menu → Checklist did not resume with the checklist: ${JSON.stringify(back)}`);
    }
    const errs = errors.filter((e) => !/favicon/.test(e));
    req(!errs.length, `page errors: ${errs.slice(0, 3).join(' | ')}`);
  } catch (e) { fail.push(`layout ${vp.width} ${lang} stopped: ${e.message.split('\n')[0]}`); } finally { await page.close(); }
  return fail;
}

const DESK = { width: 1440, height: 900 }, PHONE = { width: 390, height: 844 };
async function check(fx = {}) {
  const fail = [];
  if (!fx.only) fail.push(...trims());
  execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore' });
  const srv = await serve(), br = await launch();
  try {
    const only = fx.only || process.env.F9_ONLY?.split(',') || ['layout', 'configs', 'm3', 'm4', 'm2', 'm1'];
    if (only.includes('layout')) for (const vp of fx.vps || [DESK, PHONE]) for (const lang of fx.langs || ['en', 'zh']) fail.push(...await layout(br, srv.url, vp, lang, fx));
    if (only.includes('configs')) fail.push(...await configs(br, srv.url, fx));
    for (const id of [3, 4, 2, 1]) if (only.includes('m' + id)) fail.push(...await mission(br, srv.url, id, fx));
  } finally { await br.close(); srv.close(); }
  return fail;
}
if (process.argv[1]?.endsWith('f9.mjs')) await gate('F9', () => check(), [
  ['a step that ticks at once', () => check({ only: ['m3'], stopEarly: true, patch: () => { window.__sfo.tools.MISSIONS[2].steps[1].cond = () => true; } })],
  ['a step that ticks on a timer', () => check({ only: ['m3'], stopEarly: true, patch: () => { window.__sfo.tools.MISSIONS[2].steps[1].cond = (x, K, now) => now - K.stepAt > 3000; } })],
  ['a TAKEOFF CONFIG item left unset', () => check({ only: ['configs'], skipItem: true })],
  ['APP armed outside the ILS window', () => check({ only: ['configs'], appAlways: true })],
  ['a mission that loads the wrong runway', () => check({ only: ['m2'], loadOnly: true, wrongRwy: true })],
  ['a covered config button', () => check({ only: ['layout'], vps: [PHONE], langs: ['zh'], cover: true })],
]);
