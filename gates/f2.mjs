// F2 Performance (headless scripted flights, ISA sea level, calm): stall speeds clean and landing flap, best-rate
// climb, take-off ground roll (and the 777's field length), landing roll — each within its frozen tolerance of the
// sourced value in SPEC-THRESHOLDS.md.
// --negative: CLmax cut 15 %, climb power cut, brakes weakened, parasite drag ×4 must each fail.
import { gate } from './lib/common.mjs';
import { readThresholds } from 'harbor-engine/gates/lib/thresholds.mjs';
import { stallSpeed, climbRate, takeoff, landing } from '../fdm/tests/perf.ts';
import { C172 } from '../fdm/aircraft/c172.ts';
import { B77W } from '../fdm/aircraft/b77w.ts';

const T = readThresholds();
const near = (v, t, tol) => Math.abs(v - t) <= tol;
export function measure(c172 = C172, b77w = B77W) {
  return {
    c172: {
      stallClean: stallSpeed(c172, 0, 1156.7, 50).kcas, stallLand: stallSpeed(c172, 3, 1156.7, 45).kcas,
      climb: climbRate(c172, { cas: 74, flapIdx: 0, gear: 1, mass: 1156.7, thr: 1, from: 200, to: 1200 }).fpm,
      takeoff: takeoff(c172, { flapIdx: 1, mass: 1156.7, vr: 50, pitchDeg: 10, screenFt: 50, rotRate: 5 }),
      landing: landing(c172, { flapIdx: 3, mass: 1156.7, vapp: 61, flareFt: 15, spoilers: false, brake: 1 }),
    },
    b77w: {
      stallLand: stallSpeed(b77w, 6, 251290, 121).kcas, stallClean: stallSpeed(b77w, 0, 251290, 158).kcas,
      climb: climbRate(b77w, { cas: 200, flapIdx: 2, gear: 0, mass: 300000, thr: 0.9177, from: 2000, to: 5000 }).fpm,
      takeoff: takeoff(b77w, { flapIdx: 3, mass: 351533, vr: 150, pitchDeg: 10, screenFt: 35, rotRate: 2, rotGain: 10, groundPitchMax: 8.5 }),
      landing: landing(b77w, { flapIdx: 6, mass: 251290, vapp: 149, flareFt: 30, spoilers: true, brake: 1 }),
    },
  };
}
export function check(m = measure()) {
  const fail = [], req = (ok, s) => { if (!ok) fail.push(s); };
  const c = m.c172, b = m.b77w;
  const line = (k, v, t, tol, u) => { console.log(`${k.padEnd(28)} ${v.toFixed(1).padStart(8)} ${u}  (target ${t} ± ${tol})`); req(near(v, t, tol), `${k}: ${v.toFixed(1)} ${u}, target ${t} ± ${tol}`); };
  line('c172 stall clean', c.stallClean, T['F2.c172.stallCleanKcas'], T['F2.c172.stallTolKt'], 'KCAS');
  line('c172 stall flaps 30', c.stallLand, T['F2.c172.stallLandKcas'], T['F2.c172.stallTolKt'], 'KCAS');
  line('c172 climb S.L.', c.climb, T['F2.c172.climbFpm'], T['F2.c172.climbFpm'] * T['F2.c172.climbTolFrac'], 'fpm');
  line('c172 take-off roll', c.takeoff.rollFt, T['F2.c172.takeoffRollFt'], T['F2.c172.takeoffRollFt'] * T['F2.c172.takeoffTolFrac'], 'ft');
  line('c172 landing roll', c.landing.rollFt, T['F2.c172.landingRollFt'], T['F2.c172.landingRollFt'] * T['F2.c172.landingTolFrac'], 'ft');
  line('b77w stall flaps 30', b.stallLand, T['F2.b77w.stallLandKcas'], T['F2.b77w.stallLandTolKt'], 'KCAS');
  line('b77w stall clean', b.stallClean, T['F2.b77w.stallCleanKcas'], T['F2.b77w.stallCleanTolKt'], 'KCAS');
  line('b77w climb 2,000–5,000 ft', b.climb, T['F2.b77w.climbFpm'], T['F2.b77w.climbFpm'] * T['F2.b77w.climbTolFrac'], 'fpm');
  const fl = 1.15 * b.takeoff.screenDistFt, lo = T['F2.b77w.takeoffFieldLoFrac'] * T['F2.b77w.takeoffFieldFt'], hi = T['F2.b77w.takeoffFieldHiFrac'] * T['F2.b77w.takeoffFieldFt'];
  console.log(`${'b77w 1.15 × TOD35'.padEnd(28)} ${fl.toFixed(0).padStart(8)} ft  (within ${lo.toFixed(0)}–${hi.toFixed(0)}); roll / TOD35 ${(b.takeoff.rollFt / b.takeoff.screenDistFt).toFixed(3)} (≤ ${T['F2.b77w.takeoffRollFrac']})`);
  req(fl >= lo && fl <= hi, `b77w take-off: 1.15 × distance to 35 ft ${fl.toFixed(0)} ft outside ${lo.toFixed(0)}–${hi.toFixed(0)}`);
  req(b.takeoff.rollFt / b.takeoff.screenDistFt <= T['F2.b77w.takeoffRollFrac'], `b77w take-off: ground roll ${(b.takeoff.rollFt / b.takeoff.screenDistFt).toFixed(3)} of the distance to 35 ft`);
  line('b77w landing (d50 / 0.6)', b.landing.from50Ft / 0.6, T['F2.b77w.landingFieldFt'], T['F2.b77w.landingFieldFt'] * T['F2.b77w.landingTolFrac'], 'ft');
  for (const [k, r] of [['c172 take-off', c.takeoff], ['c172 landing', c.landing], ['b77w take-off', b.takeoff], ['b77w landing', b.landing]]) req(!r.crashed && !r.tailstrike, `${k}: crashed ${r.crashed} tail strike ${r.tailstrike}`);
  return fail;
}
const clone = (a) => JSON.parse(JSON.stringify(a));
if (process.argv[1]?.endsWith('f2.mjs')) await gate('F2', () => check(), [
  ['CLmax cut 15 %', () => { const a = clone(C172); for (const r of a.aero.CL.rows) for (let k = 1; k <= 4; k++) r[k] = r[k] * 0.85; return check(measure(a, B77W)); }],
  ['climb power cut', () => { const b = clone(B77W); b.engine.thrustN.v *= 0.6; return check(measure(C172, b)); }],
  ['brakes weakened', () => { const a = clone(C172); a.brakes.mu.v = 0.1; return check(measure(a, B77W)); }],
  ['parasite drag ×4', () => { const b = clone(B77W); b.aero.CD0.v *= 4; b.aero.CDflap.rows.forEach((r) => { r[1] *= 4; }); return check(measure(C172, b)); }],
]);
