// F4 Autopilot (777): HDG / ALT / V/S / SPD holds — worst error in calm air, mean error in the gusty winds (D10) —
// and the coupled ILS 28R from 9 NM to 50 ft AGL within ±½ dot of localizer and glide slope, in every wind of the
// gate's set (calm, 280/15G22, 330/18, 240/12G20) on three turbulence seeds (the tuning set, D9).
// --negative: localizer tracking off, the glide-slope correction reversed, the autothrottle's proportional gain zeroed and
// the flight-path gain cut to a tenth must each fail.
import { gate } from './lib/common.mjs';
import { readThresholds } from 'harbor-engine/gates/lib/thresholds.mjs';
import { loadWorld } from './lib/world.mjs';
import { holds, coupledIls, WIND_SET } from '../fdm/tests/ap.ts';

const T = readThresholds(), SEEDS = ['f4-ils', 's1', 's2'];
const DOT = { loc: T['F4.locHalfDotDdm'] / 0.0775, gs: T['F4.gsHalfDotDdm'] / 0.0875 }; // ½ dot in dots
export function check(ap = {}, { seeds = SEEDS } = {}) {
  const fail = [], req = (ok, s) => { if (!ok) fail.push(s); };
  const W = loadWorld(), world = { ils: W.ils, runways: W.runways }, I = W.ils.find((i) => i.id === '28R');
  const tol = { hdg: T['F4.hdgDeg'], alt: T['F4.altFt'], vs: T['F4.vsFpm'], spd: T['F4.spdKt'] };
  for (const [wi, Wd] of WIND_SET.entries()) {
    const h = holds(world, Wd.w, ap);
    const calm = wi === 0;
    console.log(`${Wd.name.padEnd(10)} holds: ${Object.entries(h).map(([k, v]) => `${k} worst ${v.worst.toFixed(1)} mean ${v.mean.toFixed(1)}`).join(' · ')}`);
    for (const k of Object.keys(tol)) { const v = calm ? h[k].worst : h[k].mean; req(v <= tol[k], `${Wd.name} ${k.toUpperCase()} hold: ${calm ? 'worst' : 'mean'} error ${v.toFixed(1)} (≤ ${tol[k]})`); }
    for (const sd of seeds) {
      const r = coupledIls(world, I, Wd.w, I.thrH, sd, ap);
      console.log(`${Wd.name.padEnd(10)} ILS 28R seed ${sd.padEnd(6)}: LOC ${r.maxLoc.toFixed(3)} dot, G/S ${r.maxGs.toFixed(3)} dot (worst at ${r.worstAt.toFixed(2)} NM), landed ${r.landed}${r.flight.scorer.landing ? ` score ${r.flight.scorer.landing.score}` : ''}`);
      req(r.maxLoc <= DOT.loc, `${Wd.name} seed ${sd}: localizer ${r.maxLoc.toFixed(3)} dot (≤ ${DOT.loc})`);
      req(r.maxGs <= DOT.gs, `${Wd.name} seed ${sd}: glide slope ${r.maxGs.toFixed(3)} dot (≤ ${DOT.gs})`);
      req(!r.flight.sim.crashed, `${Wd.name} seed ${sd}: crashed (${r.flight.sim.crashed})`);
    }
  }
  return fail;
}
if (process.argv[1]?.endsWith('f4.mjs')) await gate('F4', () => check(), [
  ['localizer tracking off', () => check({ kLoc: 0, kLocD: 0 }, { seeds: ['f4-ils'] })],
  ['glide-slope correction reversed', () => check({ kGs: -0.003 }, { seeds: ['f4-ils'] })],
  ['autothrottle gain zeroed', () => check({ kAt: 0 }, { seeds: ['f4-ils'] })],
  ['flight-path gain a tenth', () => check({ kGam: 0.05 }, { seeds: ['f4-ils'] })],
]);
