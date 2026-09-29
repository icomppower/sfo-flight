// M1.2 route manager: from wherever the aircraft is, the way back to an SFO ILS runway in use — a heading leg to a
// base point, a 30° intercept leg to a join point on the extended centreline, the final approach fix and the glide
// path — with the altitude, speed and configuration for each part, and a minimum safe altitude per leg from the
// terrain and the roof grid under it. One brain for two users: AUTO LAND (fdm/autoland.ts, inside the replayed loop)
// flies it; GUIDE ME (src/game/guide.js) tells the player how to fly it. Pure and deterministic (no Math.*
// transcendentals: fdm/dmath.ts).
import type { IlsDef } from './ils.ts';
import type { Ground } from './sim.ts';
import { DEG, FT, KT, clamp, wrap180 } from './math.ts';
import * as D from './dmath.ts';

export const NM = 1852;
export interface RouteParams {
  dFafNm: number; dJoinNm: number; dBaseNm: number; interceptDeg: number; // geometry (SPEC §14: FAF 10 NM 777 / 4 NM 172)
  belowGsFt: number; // intercept altitude this far below the glide path at the FAF (capture from below)
  descentDeg: number; // planned descent path before the join point
  clearFt: number; corridorM: number; // terrain / obstacle clearance and half width of the corridor it is taken over
  bankDeg: number; // planning bank for turns
  decelKtS: number; // level deceleration (idle) for the "too fast" extension
  spd: { far: number; mid: number; join: number; faf: number; gs: number }; // kt by segment (landing speed from the config)
  flap: { far: number; mid: number; join: number; faf: number; gs: number; landing: number }; // detent index per segment
  landingNm: number; // LANDING CONFIG this far from the threshold (on the localizer)
  replanNm: number; // cross-track from the active leg that triggers a new plan
}
export const RPARAMS: Record<string, RouteParams> = {
  b77w: { dFafNm: 10, dJoinNm: 3, dBaseNm: 4, interceptDeg: 30, belowGsFt: 200, descentDeg: 2.5, clearFt: 1000, corridorM: 900, bankDeg: 25, decelKtS: 0.8,
    spd: { far: 230, mid: 210, join: 190, faf: 180, gs: 170 }, flap: { far: 0, mid: 1, join: 2, faf: 3, gs: 4, landing: 6 }, landingNm: 7.5, replanNm: 1.5 },
  c172: { dFafNm: 4, dJoinNm: 1.5, dBaseNm: 1.5, interceptDeg: 30, belowGsFt: 100, descentDeg: 3, clearFt: 500, corridorM: 400, bankDeg: 25, decelKtS: 1.5,
    spd: { far: 95, mid: 90, join: 80, faf: 75, gs: 70 }, flap: { far: 0, mid: 0, join: 1, faf: 1, gs: 2, landing: 3 }, landingNm: 2.5, replanNm: 0.8 },
};

// the glide-slope ribbon's corridor (src/game/approachviz.js draws it; gate F10's "inside the ribbon" uses it), m
export const RIBBON: Record<string, { halfW: number; halfH: number }> = { b77w: { halfW: 45, halfH: 25 }, c172: { halfW: 25, halfH: 20 } }; // 172: ≈ 0.6 dot of glide slope at 3 NM

export type FixKind = 'base' | 'join' | 'faf' | 'thr';
export interface Fix { n: number; e: number; kind: FixKind }
export interface Plan {
  ils: IlsDef; fixes: Fix[]; leg: number; side: number; ext: number; hFaf: number; // hFaf: intercept altitude m MSL
  cruise: number; // m MSL: the altitude to hold before the descent profile (the engage altitude, at least hFaf)
  msa: number[]; // per leg (index = fix index): minimum safe altitude m MSL (−Infinity on the approach legs)
  path: number[][]; // [n, e] polyline of the planned ground track from the aircraft (turn arc + legs) for drawing / checks
  lengthNm: number; // along the path to the threshold
  t: number; // sim time planned
}
export interface Kin { n: number; e: number; alt: number; trk: number; gs: number; cas: number; t: number } // trk deg (grid), gs m/s

const dirOf = (crs: number) => [D.cos(crs * DEG), D.sin(crs * DEG)];
const brg = (n0: number, e0: number, n1: number, e1: number) => (D.atan2(e1 - e0, n1 - n0) / DEG + 360) % 360;
export const gsAltAt = (I: IlsDef, distFromThrM: number) => I.gsH + (distFromThrM + D.hypot(I.gsN - I.thrN, I.gsE - I.thrE)) * D.tan(I.gsDeg * DEG);

// the runway in use: the ILS ends with the least tailwind (28L/28R in a westerly or calm); among those, the one nearest
// to the aircraft's position along the plan. `wind` is the mean wind (from, kt).
export function runwayInUse(ils: IlsDef[], wind: { dir: number; kt: number }, n: number, e: number): IlsDef {
  const cands = ils.filter((I) => I.id === '28L' || I.id === '28R' || I.id === '19L'); // SFO's ILS/DME ends (NASR)
  const head = (I: IlsDef) => wind.kt * D.cos((wind.dir - I.crs) * DEG);
  let use = cands.filter((I) => I.id.startsWith('28'));
  if (use.length && head(use[0]) < -5) { const best = Math.max(...cands.map(head)); use = cands.filter((I) => head(I) >= best - 1); }
  let bestI = use[0] || ils[0], bestD = Infinity;
  for (const I of use) {
    // distance to the join side of this runway's final (a parallel pair: the nearer centreline)
    const [un, ue] = dirOf(I.crs), dn = n - I.thrN, de = e - I.thrE, xte = -dn * ue + de * un;
    const d = Math.abs(xte) + (I.id.endsWith('R') ? 0.5 : 0); // tie → R (the ALSF-2 runway)
    if (d < bestD) { bestD = d; bestI = I; }
  }
  return bestI;
}

// a turn from (n, e) on track trk at ground speed gs and `bankDeg` toward the point (tn, te): the arc samples, then
// the straight line; returns the ground track polyline (every ~step m)
export function turnPath(n: number, e: number, trk: number, gs: number, bankDeg: number, tn: number, te: number, step = 150): number[][] {
  const R = Math.max(150, gs * gs / (9.80665 * D.tan(bankDeg * DEG)));
  const out: number[][] = [[n, e]];
  let pn = n, pe = e, h = trk;
  for (let k = 0; k < 400; k++) {
    const want = brg(pn, pe, tn, te), err = wrap180(want - h);
    if (Math.abs(err) < 3) break;
    // the turn circle cannot reach a point inside it: fly straight until it can (a wider turn)
    const dist = D.hypot(tn - pn, te - pe);
    if (dist < 2 * R * Math.abs(D.sin(err * DEG)) && Math.abs(err) > 90) { /* keep turning: the loop re-evaluates */ }
    const dh = Math.sign(err) * Math.min(Math.abs(err), step / R / DEG);
    h += dh;
    const [un, ue] = dirOf(h);
    pn += un * step; pe += ue * step;
    out.push([pn, pe]);
  }
  const L = D.hypot(tn - pn, te - pe), m = Math.max(1, Math.round(L / step));
  for (let i = 1; i <= m; i++) out.push([pn + (tn - pn) * i / m, pe + (te - pe) * i / m]);
  return out;
}

// the highest terrain / roof within `corr` m either side of a polyline (samples along and across)
export function maxObstacle(ground: Ground, poly: number[][], corr: number): number {
  let hi = -Infinity;
  for (let i = 1; i < poly.length; i++) {
    const [n0, e0] = poly[i - 1], [n1, e1] = poly[i], L = D.hypot(n1 - n0, e1 - e0);
    if (L < 1e-6) continue;
    const un = (n1 - n0) / L, ue = (e1 - e0) / L, m = Math.max(1, Math.ceil(L / 150));
    for (let k = 0; k <= m; k++) {
      const pn = n0 + (n1 - n0) * k / m, pe = e0 + (e1 - e0) * k / m;
      for (const w of [-1, -0.5, 0, 0.5, 1]) {
        const qn = pn - ue * w * corr, qe = pe + un * w * corr;
        const h = Math.max(ground.height(qn, qe), ground.roof(qn, qe));
        if (h > hi) hi = h;
      }
    }
  }
  return hi;
}

const cum = (poly: number[][]) => { let L = 0; for (let i = 1; i < poly.length; i++) L += D.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]); return L; };

// plan from the aircraft's kinematic state to `ils` (ac: 'c172' | 'b77w'); `patch` overrides parameters (gate fixtures)
export function planRoute(ac: string, k: Kin, ils: IlsDef, ground: Ground | null, patch: Partial<RouteParams> & { noTerrain?: boolean } = {}): Plan {
  const P = { ...RPARAMS[ac], ...patch };
  const [un, ue] = dirOf(ils.crs), rn = -ue, re = un; // along the course; right of it
  const T = [ils.thrN, ils.thrE];
  const rel = (n: number, e: number) => ({ along: (n - T[0]) * un + (e - T[1]) * ue, xte: (n - T[0]) * rn + (e - T[1]) * re });
  const A = rel(k.n, k.e);
  // the side of the final the aircraft is on (on the centreline: the side its track points to)
  let side = A.xte > 0 ? 1 : -1;
  if (Math.abs(A.xte) < 300) { const [tn, te] = dirOf(k.trk); side = tn * rn + te * re >= 0 ? 1 : -1; }
  const hFaf = gsAltAt(ils, P.dFafNm * NM) - P.belowGsFt * FT;
  const cruise = Math.max(k.alt, hFaf);
  const ia = P.interceptDeg * DEG, vn = un * D.cos(ia) - side * rn * D.sin(ia), ve = ue * D.cos(ia) - side * re * D.sin(ia);
  const faf: Fix = { n: T[0] - un * P.dFafNm * NM, e: T[1] - ue * P.dFafNm * NM, kind: 'faf' };
  const thr: Fix = { n: T[0], e: T[1], kind: 'thr' };
  const gsKt = Math.max(k.gs / KT, 60);
  let fixes: Fix[] = [], path: number[][] = [], ext = 0;
  const trkAligned = Math.abs(wrap180(k.trk - ils.crs));
  for (let it = 0; it < 30; it++) {
    const dJ = (P.dFafNm + P.dJoinNm) * NM + ext * NM;
    const join: Fix = { n: T[0] - un * dJ, e: T[1] - ue * dJ, kind: 'join' };
    const base: Fix = { n: join.n - vn * P.dBaseNm * NM, e: join.e - ve * P.dBaseNm * NM, kind: 'base' };
    const toJ = brg(k.n, k.e, join.n, join.e);
    const nearGs = k.alt - gsAltAt(ils, -A.along) < P.belowGsFt * FT * 2 && k.alt > gsAltAt(ils, -A.along) - 600 * FT && k.cas < P.spd.faf + 25;
    if (ext === 0 && nearGs && Math.abs(A.xte) < P.replanNm * NM * 0.5 && A.along > -dJ && A.along < -0.3 * NM && trkAligned < 45) fixes = A.along < -P.dFafNm * NM ? [faf, thr] : [thr];
    else if (A.along < -dJ - NM && Math.abs(wrap180(toJ - ils.crs)) <= 40 && Math.abs(wrap180(k.trk - toJ)) <= 100) fixes = [join, faf, thr];
    else fixes = [base, join, faf, thr];
    path = turnPath(k.n, k.e, k.trk, gsKt * KT, P.bankDeg, fixes[0].n, fixes[0].e);
    for (const f of fixes.slice(1)) path.push([f.n, f.e]);
    // enough track miles before the FAF to descend on the planned path and slow down?
    let toFaf = cum(path) - P.dFafNm * NM;
    const need = Math.max(0, k.alt - hFaf) / D.tan(P.descentDeg * DEG) + Math.max(0, k.cas - P.spd.faf) / P.decelKtS * (k.cas + P.spd.faf) / 2 * KT;
    if (fixes[0].kind !== 'base' && fixes[0].kind !== 'join') toFaf = Infinity; // established: the glide path does it
    if (toFaf >= need) break;
    ext += Math.max(1, Math.ceil((need - toFaf) / NM / 2));
  }
  // minimum safe altitude per leg: leg 0 is the turn + line to the first fix, later legs fix to fix; the approach
  // legs (to the FAF and the threshold) are the ILS itself
  const msa: number[] = [];
  const firstEnd = path.length - (fixes.length - 1);
  const legs: number[][][] = [path.slice(0, firstEnd)];
  for (let i = 1; i < fixes.length; i++) legs.push([[fixes[i - 1].n, fixes[i - 1].e], [fixes[i].n, fixes[i].e]]);
  for (let i = 0; i < fixes.length; i++) {
    const approach = fixes[i].kind === 'faf' || fixes[i].kind === 'thr';
    msa.push(approach || !ground || patch.noTerrain ? -Infinity : maxObstacle(ground, legs[i], P.corridorM) + P.clearFt * FT);
  }
  return { ils, fixes, leg: 0, side, ext, hFaf, cruise: Math.max(cruise, ...msa.filter((x) => Number.isFinite(x))), msa, path, lengthNm: cum(path) / NM, t: k.t };
}

export interface Guidance {
  leg: number; fix: Fix; kind: FixKind; trk: number; crs: number; // desired ground track; the leg's own course (deg grid)
  distFixM: number; dtgNm: number; // to the active fix; along the route to the threshold
  alt: number; msa: number; spd: number; flap: number; // targets (alt m MSL)
  onFinal: boolean; landing: boolean; // on the localizer legs; LANDING CONFIG due
  xteM: number; // from the active leg (line legs), + right
  turn: { dir: number; hdg: number; inS: number } | null; // the next turn: direction (+1 right), the new track, seconds until it starts
  replan: boolean;
}

// guidance for the current state; advances plan.leg (sequencing) — call once per step or frame
export function guide(plan: Plan, ac: string, k: Kin, patch: Partial<RouteParams> = {}): Guidance {
  const P = { ...RPARAMS[ac], ...patch }, F = plan.fixes;
  const R = Math.max(150, k.gs * k.gs / (9.80665 * D.tan(P.bankDeg * DEG)));
  let replan = false;
  // sequencing: turn anticipation onto the next leg, or the fix already abeam / behind
  for (let guard = 0; guard < 3 && plan.leg < F.length - 1; guard++) {
    const f = F[plan.leg], nx = F[plan.leg + 1];
    const nextCrs = brg(f.n, f.e, nx.n, nx.e), inCrs = plan.leg === 0 ? brg(k.n, k.e, f.n, f.e) : brg(F[plan.leg - 1].n, F[plan.leg - 1].e, f.n, f.e);
    const turnDeg = Math.abs(wrap180(nextCrs - inCrs));
    const lead = Math.min(R * D.tan(Math.min(turnDeg, 150) / 2 * DEG), 5 * NM);
    const d = D.hypot(f.n - k.n, f.e - k.e);
    // passed: on a line leg, beyond the fix along the inbound course; homing, the fix behind and too close to turn back to
    const [in_, ie] = dirOf(inCrs), past = (k.n - f.n) * in_ + (k.e - f.e) * ie;
    const behind = Math.abs(wrap180(brg(k.n, k.e, f.n, f.e) - k.trk)) > 90;
    // (turn anticipation only toward a fix the aircraft is heading for: a homing fix behind it is turned back to first)
    const toward = plan.leg > 0 || Math.abs(wrap180(brg(k.n, k.e, f.n, f.e) - k.trk)) < 30;
    if (d <= Math.max(toward ? lead : 0, 250) || (plan.leg > 0 && past > 0) || (plan.leg === 0 && behind && d < 0.6 * R)) plan.leg++;
    else break;
  }
  const leg = plan.leg, f = F[leg];
  const prev = leg > 0 ? F[leg - 1] : null;
  const onFinal = f.kind === 'faf' || f.kind === 'thr';
  // lateral: line legs track the line with an intercept angle from the cross-track; the first leg homes on its fix
  let trk: number, xte = 0, legCrs: number;
  if (prev) {
    const crs = legCrs = brg(prev.n, prev.e, f.n, f.e), [cn, ce] = dirOf(crs);
    xte = -(k.n - prev.n) * ce + (k.e - prev.e) * cn;
    trk = (crs + clamp(-xte * (onFinal ? 0.02 : 0.012), -P.interceptDeg - 10, P.interceptDeg + 10) + 360) % 360;
    // re-plan when well off the leg and still drifting away from it (closing on it after a wide turn is fine)
    const [kn, ke] = dirOf(k.trk), xteRate = (-kn * ce + ke * cn) * k.gs;
    if (Math.abs(xte) > P.replanNm * NM && xteRate * Math.sign(xte) > -1) replan = true;
  } else trk = legCrs = brg(k.n, k.e, f.n, f.e);
  const distFix = D.hypot(f.n - k.n, f.e - k.e);
  let dtg = distFix;
  for (let i = leg + 1; i < F.length; i++) dtg += D.hypot(F[i].n - F[i - 1].n, F[i].e - F[i - 1].e);
  const dtgNm = dtg / NM;
  // vertical: the descent profile back from the join point, never below the intercept altitude or the leg's MSA
  const dFaf = dtg - P.dFafNm * NM;
  const prof = plan.hFaf + Math.max(0, dFaf - P.dJoinNm * NM * 0.5) * D.tan(P.descentDeg * DEG);
  const msa = Math.max(plan.msa[leg] ?? -Infinity, leg + 1 < F.length && !onFinal ? plan.msa[leg + 1] ?? -Infinity : -Infinity);
  const alt = Math.max(Math.min(prof, plan.cruise), plan.hFaf, Number.isFinite(msa) ? msa : -Infinity);
  // speed and flaps by segment
  const S = P.spd, FL = P.flap;
  const seg = onFinal ? (f.kind === 'thr' || dFaf < 0 ? 'gs' : 'faf') : f.kind === 'join' ? 'join' : dtgNm - P.dFafNm < 8 ? 'mid' : 'far';
  const spd = S[seg as keyof typeof S], flap = FL[seg as keyof typeof FL];
  // the next turn: from the active fix onto the following leg (or, homing, the turn onto the fix's bearing)
  let turn: Guidance['turn'] = null;
  if (leg < F.length - 1) {
    const nx = F[leg + 1], inCrs = prev ? brg(prev.n, prev.e, f.n, f.e) : brg(k.n, k.e, f.n, f.e), outCrs = brg(f.n, f.e, nx.n, nx.e);
    const dd = wrap180(outCrs - inCrs), lead = Math.min(R * D.tan(Math.min(Math.abs(dd), 150) / 2 * DEG), 5 * NM);
    if (Math.abs(dd) >= 5) turn = { dir: Math.sign(dd), hdg: outCrs, inS: Math.max(0, (distFix - Math.max(lead, 250)) / Math.max(k.gs, 20)) };
  }
  if (!prev) { const dd = wrap180(trk - k.trk); if (Math.abs(dd) >= 15) turn = { dir: Math.sign(dd), hdg: trk, inS: 0 }; }
  return { leg, fix: f, kind: f.kind, trk, crs: legCrs, distFixM: distFix, dtgNm, alt, msa, spd, flap, onFinal, landing: onFinal && dtgNm <= P.landingNm, xteM: xte, turn, replan };
}

// the planned profile along the path (for the gate's terrain check and the page's magenta line): [n, e, alt] every
// ~300 m, from a fresh copy of the plan (the plan passed in is not advanced)
export function profileOf(plan: Plan, ac: string, gsMs: number, patch: Partial<RouteParams> = {}): number[][] {
  const P = { ...RPARAMS[ac], ...patch }, out: number[][] = [];
  const copy = { ...plan, leg: 0 };
  const pts = plan.path;
  for (let i = 0; i < pts.length - 1; i++) {
    const [n0, e0] = pts[i], [n1, e1] = pts[i + 1], L = D.hypot(n1 - n0, e1 - e0), m = Math.max(1, Math.ceil(L / 300));
    for (let s = 0; s < m; s++) {
      const n = n0 + (n1 - n0) * s / m, e = e0 + (e1 - e0) * s / m;
      const trk = brg(n0, e0, n1, e1);
      const g = guide(copy, ac, { n, e, alt: plan.cruise, trk, gs: gsMs, cas: 0, t: 0 }, P);
      const dThr = D.hypot(n - plan.ils.thrN, e - plan.ils.thrE);
      out.push([n, e, g.onFinal && g.kind === 'thr' ? Math.min(g.alt, gsAltAt(plan.ils, dThr)) : g.alt]);
    }
  }
  const last = pts[pts.length - 1];
  out.push([last[0], last[1], plan.ils.thrH]);
  return out;
}
