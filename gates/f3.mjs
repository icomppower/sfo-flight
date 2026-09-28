// F3 Handling: the Sim's own modes, linearized about trim (fdm/tests/handling.ts), against MIL-F-8785C: short period
// ζ 0.30–2.0, phugoid ζ ≥ 0.04, dutch roll ζ ≥ 0.08 and ζωn ≥ 0.15, spiral time to double ≥ 20 s when divergent;
// roll performance (C172 60° ≤ 2.5 s, 777 30° ≤ 3.2 s); ten minutes of random inputs per aircraft with no NaN and
// body rates under 3 rad/s. Six flight conditions (approach, climb, cruise per aircraft).
// --negative: pitch damping reversed, the 777's yaw damper off, a quarter of the roll control, and a massless roll
// axis must each fail.
import { gate } from './lib/common.mjs';
import { readThresholds } from 'harbor-engine/gates/lib/thresholds.mjs';
import { modes, trimmed, rollTime, fuzz } from '../fdm/tests/handling.ts';
import { C172 } from '../fdm/aircraft/c172.ts';
import { B77W } from '../fdm/aircraft/b77w.ts';

const T = readThresholds();
const CASES = [['c172', { alt: 1000, cas: 65, flap: 3, gear: 1, mass: 1156.7 }], ['c172', { alt: 1000, cas: 90, flap: 0, gear: 1, mass: 1156.7 }], ['c172', { alt: 1000, cas: 115, flap: 0, gear: 1, mass: 1156.7 }],
  ['b77w', { alt: 1000, cas: 150, flap: 6, gear: 1, mass: 251290 }], ['b77w', { alt: 1500, cas: 200, flap: 2, gear: 0, mass: 300000 }], ['b77w', { alt: 2000, cas: 250, flap: 0, gear: 0, mass: 300000 }]];
export function check({ c172 = C172, b77w = B77W, fuzzMin = T['F3.fuzzMinutes'] } = {}) {
  const AC = { c172, b77w }, fail = [], req = (ok, s) => { if (!ok) fail.push(s); };
  for (const [id, o] of CASES) {
    const { sim, c } = trimmed(AC[id], o), m = modes(sim, c), [sp, ph] = m.long, dr = m.lat.find((x) => x.name === 'dutch roll'), sr = m.lat.find((x) => x.name === 'spiral');
    const tag = `${id} ${o.cas} kt flap ${o.flap}`;
    console.log(`${tag.padEnd(20)} SP ζ ${sp.zeta.toFixed(3)} ωn ${sp.wn.toFixed(2)} | PH ζ ${ph.zeta.toFixed(3)} | DR ζ ${dr ? dr.zeta.toFixed(3) : '—'} ζωn ${dr ? (dr.zeta * dr.wn).toFixed(3) : '—'} | spiral T2 ${sr && sr.tDouble !== Infinity ? sr.tDouble.toFixed(0) + ' s' : 'stable'}`);
    req(sp.zeta >= T['F3.shortPeriodZetaMin'] && sp.zeta <= T['F3.shortPeriodZetaMax'], `${tag}: short period ζ ${sp.zeta.toFixed(3)}`);
    req(ph.zeta >= T['F3.phugoidZetaMin'], `${tag}: phugoid ζ ${ph.zeta.toFixed(3)}`);
    req(dr && dr.zeta >= T['F3.dutchRollZetaMin'] && dr.zeta * dr.wn >= T['F3.dutchRollZetaWnMin'], `${tag}: dutch roll ζ ${dr?.zeta.toFixed(3)} ζωn ${dr ? (dr.zeta * dr.wn).toFixed(3) : '—'}`);
    req(!sr || sr.tDouble >= T['F3.spiralDoubleMinS'], `${tag}: spiral doubles in ${sr?.tDouble.toFixed(1)} s`);
  }
  const r1 = rollTime(c172, { alt: 1000, cas: 53 * 1.3, mass: 1156.7, deg: 60 }), r2 = rollTime(b77w, { alt: 1000, cas: 158 * 1.3, mass: 251290, deg: 30 });
  console.log(`roll: c172 60° in ${r1.toFixed(2)} s (≤ ${T['F3.c172.roll60S']}), b77w 30° in ${r2.toFixed(2)} s (≤ ${T['F3.b77w.roll30S']})`);
  req(r1 <= T['F3.c172.roll60S'], `c172 roll 60° in ${r1.toFixed(2)} s`); req(r2 <= T['F3.b77w.roll30S'], `b77w roll 30° in ${r2.toFixed(2)} s`);
  for (const ac of [c172, b77w]) { const z = fuzz(ac, fuzzMin, 'f3'); console.log(`fuzz ${ac.id}: ${fuzzMin} min, ${z.restarts} restarts, max |ω| ${z.maxRate.toFixed(2)} rad/s ${z.ok ? 'ok' : z.why}`); req(z.ok, `${ac.id} fuzz: ${z.why} after ${z.steps} steps`); }
  return fail;
}
const clone = (a) => JSON.parse(JSON.stringify(a));
if (process.argv[1]?.endsWith('f3.mjs')) await gate('F3', () => check(), [
  ['pitch damping reversed', () => { const a = clone(C172); a.aero.Cmq.v = 6; a.aero.Cmadot.v = 0; return check({ c172: a, fuzzMin: 0.5 }); }],
  ['yaw damper off', () => { const b = clone(B77W); b.fcs.yawDamper = 0; return check({ b77w: b, fuzzMin: 0.5 }); }],
  ['a quarter of the roll control', () => { const b = clone(B77W); b.aero.Clda.v *= 0.25; return check({ b77w: b, fuzzMin: 0.5 }); }],
  ['massless roll axis', () => { const a = clone(C172); a.inertia.Ix.v = 1e-6; a.inertia.Iz.v = 1e-6; return check({ c172: a, fuzzMin: 2 }); }],
]);
