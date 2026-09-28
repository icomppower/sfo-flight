// Handling (gate F3): the modes of the Sim itself, linearized numerically about a trimmed flight condition (central
// differences through one 120 Hz step of a cloned Sim, α̇ effects included by a second pass), MIL-F-8785C roll
// performance, and a random-input fuzz. Calm air, controls fixed at trim (the 777's yaw damper on, as flown).
import { type Sim, type Controls, DT, flatGround } from '../sim.ts';
import { trimFly } from '../pilot.ts';
import { rotate, unrotate, qFromEuler, eulerFromQ, clamp, DEG, KT, type V3 } from '../math.ts';
import { eig, type C } from './eig.ts';
import { Rng } from '../rng.ts';
import type { AircraftData } from '../aircraft/types.ts';
import * as D from '../dmath.ts';

interface Mode { name: string; re: number; im: number; wn: number; zeta: number; tDouble?: number; tau?: number }

function evalLong(base: Sim, c: Controls, x: number[], lat: number[]): number[] {
  const e0 = base.euler;
  const f = (adot: number) => {
    const s = base.clone();
    const [u, w, q, th] = x, [v, p, r, ph] = lat;
    s.q = qFromEuler(e0.psi, th, ph);
    s.vel = rotate(s.q, [u, v, w]);
    s.w = [p, q, r];
    const a = D.atan2(w, u);
    s.alphaDot = adot; s.setPrevAlpha(a - adot * DT);
    const vb0: V3 = [u, v, w], eu0 = { theta: th, phi: ph, psi: e0.psi }, w0: V3 = [p, q, r];
    s.step(c);
    const vb1 = unrotate(s.q, s.vel), eu1 = eulerFromQ(s.q);
    const d = (a1: number, a0: number) => (a1 - a0) / DT;
    const out = [d(vb1[0], vb0[0]), d(vb1[2], vb0[2]), d(s.w[1], w0[1]), d(eu1.theta, eu0.theta), d(vb1[1], vb0[1]), d(s.w[0], w0[0]), d(s.w[2], w0[2]), d(eu1.phi, eu0.phi)];
    return out;
  };
  const p1 = f(0);
  const [u, w] = x;
  const adot = (u * p1[1] - w * p1[0]) / (u * u + w * w);
  return f(adot);
}

export function linearize(base: Sim, c: Controls): { long: number[][]; lat: number[][] } {
  const vb = unrotate(base.q, base.vel), e = base.euler;
  const x0 = [vb[0], vb[2], base.w[1], e.theta], l0 = [vb[1], base.w[0], base.w[2], e.phi];
  const dl = [0.2, 0.2, 0.004, 0.004], dt = [0.2, 0.004, 0.004, 0.004];
  const long = [0, 1, 2, 3].map(() => [0, 0, 0, 0]), lat = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  for (let j = 0; j < 4; j++) {
    const xp = x0.slice(), xm = x0.slice(); xp[j] += dl[j]; xm[j] -= dl[j];
    const fp = evalLong(base, c, xp, l0), fm = evalLong(base, c, xm, l0);
    for (let i = 0; i < 4; i++) long[i][j] = (fp[i] - fm[i]) / (2 * dl[j]);
    const yp = l0.slice(), ym = l0.slice(); yp[j] += dt[j]; ym[j] -= dt[j];
    const gp = evalLong(base, c, x0, yp), gm = evalLong(base, c, x0, ym);
    for (let i = 0; i < 4; i++) lat[i][j] = (gp[4 + i] - gm[4 + i]) / (2 * dt[j]);
  }
  return { long, lat };
}

const modeOf = (name: string, a: C, b?: C): Mode => {
  if (b && a[1] === 0 && b[1] === 0) { const wn = Math.sqrt(Math.abs(a[0] * b[0])); return { name, re: (a[0] + b[0]) / 2, im: 0, wn, zeta: -(a[0] + b[0]) / (2 * wn) }; }
  const wn = D.hypot(a[0], a[1]); return { name, re: a[0], im: Math.abs(a[1]), wn, zeta: -a[0] / wn };
};

export function modes(base: Sim, c: Controls): { long: Mode[]; lat: Mode[]; A: { long: number[][]; lat: number[][] } } {
  const A = linearize(base, c);
  const lr = eig(A.long).sort((p, q) => D.hypot(q[0], q[1]) - D.hypot(p[0], p[1]));
  const long = [modeOf('short period', lr[0], lr[1]), modeOf('phugoid', lr[2], lr[3])];
  const la = eig(A.lat);
  const cx = la.filter((r) => r[1] !== 0), re = la.filter((r) => r[1] === 0).sort((p, q) => Math.abs(q[0]) - Math.abs(p[0]));
  const lat: Mode[] = [];
  if (cx.length >= 2) lat.push(modeOf('dutch roll', cx[0]));
  else if (re.length >= 4) { lat.push(modeOf('dutch roll', re[1], re[2])); re.splice(1, 2); }
  if (re.length) { const r = re[0]; lat.push({ name: 'roll', re: r[0], im: 0, wn: Math.abs(r[0]), zeta: 1, tau: -1 / r[0] }); }
  if (re.length > 1) { const r = re[re.length - 1]; lat.push({ name: 'spiral', re: r[0], im: 0, wn: Math.abs(r[0]), zeta: 1, tDouble: r[0] > 0 ? D.log(2) / r[0] : Infinity }); }
  return { long, lat, A };
}

export function trimmed(ac: AircraftData, o: { alt: number; cas: number; flap: number; gear: number; mass: number }) {
  const t = trimFly(ac, { ...o, seconds: 240 });
  t.sim.ground = flatGround(-3000);
  return t;
}

// MIL-F-8785C roll performance: time for the bank to change by `deg` after a full-aileron step, rudder fixed
export function rollTime(ac: AircraftData, o: { alt: number; cas: number; mass: number; deg: number }): number {
  const { sim, c } = trimmed(ac, { alt: o.alt, cas: o.cas, flap: 0, gear: ac.gearRetract ? 0 : 1, mass: o.mass });
  const phi0 = sim.euler.phi, t0 = sim.t;
  c.ail = 1;
  for (let i = 0; i < 120 * 15; i++) { sim.step(c); if ((sim.euler.phi - phi0) / DEG >= o.deg) return sim.t - t0; }
  return Infinity;
}

// random smooth inputs for `minutes`; restart from altitude after a crash; any NaN or |ω| ≥ 3 rad/s fails
export function fuzz(ac: AircraftData, minutes: number, seed: string): { ok: boolean; restarts: number; maxRate: number; steps: number; why: string } {
  const rng = new Rng('fuzz:' + seed);
  const start = () => trimmed(ac, { alt: 2500, cas: ac.id === 'c172' ? 95 : 230, flap: 0, gear: ac.gearRetract ? 0 : 1, mass: ac.mass.ref.v });
  let { sim, c } = start();
  const f = { e: 0, a: 0, r: 0, t: 0.6 };
  let restarts = 0, maxRate = 0;
  const n = Math.round(minutes * 60 * 120);
  for (let i = 0; i < n; i++) {
    const k = 0.004;
    f.e += (rng.normal() * 0.6 - f.e) * k; f.a += (rng.normal() * 0.7 - f.a) * k; f.r += (rng.normal() * 0.5 - f.r) * k; f.t = clamp(f.t + rng.normal() * 0.01, 0, 1);
    c.elev = clamp(f.e, -1, 1); c.ail = clamp(f.a, -1, 1); c.rud = clamp(f.r, -1, 1); c.thr = c.thr.map(() => f.t);
    if (i % 1200 === 0) { c.flap = Math.floor(rng.next() * ac.flaps.detents.length); if (ac.gearRetract) c.gear = rng.next() < 0.5 ? 1 : 0; c.trim = (rng.next() - 0.5) * 2; }
    if (i % 1200 === 300) c.trim = 0;
    sim.step(c);
    const st = [...sim.pos, ...sim.vel, ...sim.q, ...sim.w, sim.alpha, sim.beta, sim.cas];
    if (!st.every(Number.isFinite)) return { ok: false, restarts, maxRate, steps: i, why: 'non-finite state' };
    const rate = Math.max(...sim.w.map(Math.abs));
    if (!sim.crashed) { maxRate = Math.max(maxRate, rate); if (rate >= 3) return { ok: false, restarts, maxRate, steps: i, why: `|ω| ${rate.toFixed(2)} rad/s` }; }
    if (sim.crashed || sim.altMsl < 300) { restarts++; ({ sim, c } = start()); }
  }
  void KT;
  return { ok: true, restarts, maxRate, steps: n, why: '' };
}
