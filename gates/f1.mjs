// F1 FDM physics (headless, plus one browser check):
//  - trimmed level flight, hands off for 120 s, holds altitude and speed (four configurations);
//  - energy h + V²/2g is conserved with drag and thrust removed (no ground, calm) over 60 s;
//  - parked on the real SFO ramp (brakes set, engine idling) the aircraft neither drifts nor bounces;
//  - the same start + weather + seed + input log gives the same hash in Node, in the recording run, and in real Chrome
//    on the built page (window.__sfo.hashOf).
// --negative: an unstable airframe (Cmα > 0), drag left on in the energy fixture, brakes without friction, and a log
// with one input changed must each fail.
import { execFileSync } from 'node:child_process';
import { root, gate } from './lib/common.mjs';
import { readThresholds } from 'harbor-engine/gates/lib/thresholds.mjs';
import { loadWorld } from './lib/world.mjs';
import { serve, launch, openPage, sleep } from './lib/browser.mjs';
import { Sim, flatGround, CALM, DT } from '../fdm/sim.ts';
import { trimFly } from '../fdm/pilot.ts';
import { Flight } from '../fdm/flight.ts';
import { Rng } from '../fdm/rng.ts';
import { AP_EVENT } from '../fdm/autopilot.ts';
import { C172 } from '../fdm/aircraft/c172.ts';
import { B77W } from '../fdm/aircraft/b77w.ts';
import { makeStart } from '../src/game/starts.js';

const T = readThresholds(), FT = 0.3048, KT = 0.514444, G = 9.80665;
const AC = { c172: C172, b77w: B77W };
const clone = (ac) => { const a = JSON.parse(JSON.stringify(ac)); return a; };

export function trimHold(ac, o) {
  const { sim, c } = trimFly(ac, { ...o, seconds: 240 });
  const h0 = sim.altMsl, v0 = sim.cas; let dh = 0, dv = 0;
  for (let i = 0; i < 120 * 120; i++) { sim.step(c); dh = Math.max(dh, Math.abs(sim.altMsl - h0)); dv = Math.max(dv, Math.abs(sim.cas - v0)); if (sim.crashed) return { dhFt: Infinity, dv: Infinity }; }
  return { dhFt: dh / FT, dv };
}
export function energy(ac, o, fixture = { noDrag: true, noThrust: true }) {
  const { sim, c } = trimFly(ac, { ...o, seconds: 120 });
  sim.ground = flatGround(-5000); sim.fx = fixture;
  const E = () => sim.altMsl + (sim.vel[0] ** 2 + sim.vel[1] ** 2 + sim.vel[2] ** 2) / (2 * G);
  const e0 = E(); let worst = 0;
  for (let i = 0; i < 120 * 60; i++) { sim.step(c); worst = Math.max(worst, Math.abs(E() - e0) / e0); }
  return worst;
}
export function rest(ac, W) {
  const start = makeStart('ramp', ac.id, '28R', W);
  const f = new Flight(ac, start, CALM, 'f1-rest', { ground: W.ground, ils: W.ils, runways: W.runways });
  const c = { ...f.initial, thr: f.initial.thr.slice() };
  let p5 = null, zmin = Infinity, zmax = -Infinity, drift = 0;
  for (let i = 0; i < 120 * 65; i++) {
    f.step(c);
    if (i === 120 * 5) p5 = f.sim.pos.slice();
    if (p5) { drift = Math.max(drift, Math.hypot(f.sim.pos[0] - p5[0], f.sim.pos[1] - p5[1])); zmin = Math.min(zmin, f.sim.pos[2]); zmax = Math.max(zmax, f.sim.pos[2]); }
  }
  return { drift, bounce: zmax - zmin, crashed: f.sim.crashed, onGround: f.sim.onGround };
}
// a scripted flight recorded through Flight (the page's loop): random but smooth inputs from a seed
export function recordLog(acId, W, startKind, seconds, seed) {
  const ac = AC[acId], start = makeStart(startKind, acId, '28R', W);
  const f = new Flight(ac, start, { wind: { dir: 280, kt: 14, gustKt: 22 }, visM: 16000, qnhHpa: 1013, tempC: 15 }, 'f1-' + seed, { ground: W.ground, ils: W.ils, runways: W.runways });
  const c = { ...f.initial, thr: f.initial.thr.slice() }, r = new Rng(seed);
  c.park = 0; c.mcpSpd = 160; c.mcpAlt = 3000; c.mcpHdg = start.hdg;
  for (let i = 0; i < seconds * 120; i++) {
    if (i % 30 === 0) { c.elev = (r.next() - 0.5) * 0.3; c.ail = (r.next() - 0.5) * 0.4; c.rud = (r.next() - 0.5) * 0.3; c.thr = c.thr.map(() => Math.min(1, 0.4 + r.next() * 0.6)); }
    c.ap = acId === 'b77w' && i === 240 ? AP_EVENT.AP : acId === 'b77w' && i === 250 ? AP_EVENT.APP : 0;
    f.step(c);
  }
  return { log: JSON.parse(JSON.stringify(f.log)), live: f.finalHash() };
}

async function check({ acMut = null, fixture = undefined, restMut = null, logMut = null } = {}) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(m); return ok; };
  const W = loadWorld();
  // trim holds
  const cases = [[C172, { alt: 900, cas: 100, flap: 0, gear: 1, mass: 1156.7 }], [C172, { alt: 900, cas: 65, flap: 3, gear: 1, mass: 1156.7 }], [B77W, { alt: 1500, cas: 250, flap: 0, gear: 0, mass: 300000 }], [B77W, { alt: 900, cas: 150, flap: 6, gear: 1, mass: 251290 }]];
  for (const [ac0, o] of cases) {
    const ac = acMut && acMut.id === ac0.id ? acMut : ac0;
    const r = trimHold(ac, o);
    console.log(`trim ${ac.id} ${o.cas} kt flap ${o.flap}: ±${r.dhFt.toFixed(1)} ft, ±${r.dv.toFixed(2)} kt`);
    req(r.dhFt <= T['F1.trimAltFt'], `${ac.id} ${o.cas} kt: altitude wandered ${r.dhFt.toFixed(1)} ft hands-off (≤ ${T['F1.trimAltFt']})`);
    req(r.dv <= T['F1.trimSpeedKt'], `${ac.id} ${o.cas} kt: speed wandered ${r.dv.toFixed(2)} kt (≤ ${T['F1.trimSpeedKt']})`);
  }
  // energy
  for (const [ac, o] of [[C172, { alt: 1500, cas: 90, flap: 0, gear: 1, mass: 1156.7 }], [B77W, { alt: 2000, cas: 230, flap: 0, gear: 0, mass: 280000 }]]) {
    const d = energy(ac, o, fixture);
    console.log(`energy ${ac.id}: drift ${(d * 100).toFixed(4)} %`);
    req(d <= T['F1.energyDriftFrac'], `${ac.id}: energy drift ${(d * 100).toFixed(3)} % in the no-drag, no-thrust fixture (≤ ${T['F1.energyDriftFrac'] * 100} %)`);
  }
  // at rest on the ramp
  for (const ac0 of [C172, B77W]) {
    const ac = restMut && restMut.id === ac0.id ? restMut : ac0;
    const r = rest(ac, W);
    console.log(`rest ${ac.id}: drift ${r.drift.toFixed(4)} m, bounce ${r.bounce.toFixed(4)} m`);
    req(!r.crashed && r.onGround, `${ac.id} at rest: crashed ${r.crashed} / on ground ${r.onGround}`);
    req(r.drift <= T['F1.restDriftM'], `${ac.id} parked: drifted ${r.drift.toFixed(3)} m in 60 s (≤ ${T['F1.restDriftM']})`);
    req(r.bounce <= T['F1.restBounceM'], `${ac.id} parked: bounced ${r.bounce.toFixed(4)} m (≤ ${T['F1.restBounceM']})`);
  }
  // determinism: live recording = Node replay = Chrome replay
  const logs = [recordLog('c172', W, 'runway', 60, 'a'), recordLog('b77w', W, 'final9', 60, 'b')];
  const node = logs.map((L) => Flight.replay(L.log, AC[L.log.aircraft], { ground: W.ground, ils: W.ils, runways: W.runways }).finalHash());
  logs.forEach((L, i) => req(node[i] === L.live, `${L.log.aircraft}: Node replay hash ${node[i]} ≠ the recording run's ${L.live}`));
  execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore' });
  const srv = await serve(), br = await launch();
  try {
    const { page, errors } = await openPage(br, srv.url, { query: '&ac=c172&start=ramp' });
    await sleep(500);
    for (const [i, L] of logs.entries()) {
      const log = logMut ? logMut(L.log) : L.log;
      const b = await page.evaluate((lg) => window.__sfo.hashOf(lg).hash, log);
      console.log(`hash ${L.log.aircraft}: node ${node[i]} chrome ${b}`);
      req(b === node[i], `${L.log.aircraft}: Chrome replay hash ${b} ≠ Node ${node[i]}`);
    }
    req(!errors.some((e) => !/favicon/.test(e)), `page errors: ${errors.slice(0, 3).join(' | ')}`);
  } finally { await br.close(); srv.close(); }
  return fail;
}

if (process.argv[1]?.endsWith('f1.mjs')) await gate('F1', () => check(), [
  ['unstable airframe (Cmα > 0)', () => { const a = clone(C172); a.aero.Cma.v = 0.3; return check({ acMut: a }); }],
  ['drag left on in the energy fixture', () => check({ fixture: { noThrust: true } })],
  ['brakes without friction', () => { const a = clone(B77W); a.brakes.mu.v = 0; a.tyre.roll.v = 0; return check({ restMut: a }); }],
  ['one input changed in the log', () => check({ logMut: (lg) => { const l = JSON.parse(JSON.stringify(lg)); const k = l.changes.findIndex((c) => c[1] === 'ail'); l.changes[k][2] += 1; return l; } })],
]);
void DT; void KT; void Sim;
