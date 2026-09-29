// GUIDE ME (M1.2): the route manager's way back to the runway (fdm/route.ts — the same brain AUTO LAND flies), told
// to the player as one instruction at a time with a countdown: turn, descend / climb, slow down, flaps, gear, LANDING
// CONFIG, follow the path down, idle and flare, brake. Each planned instruction is found by looking ahead along the
// route (0…LEAD s), so it shows before it is needed; it clears when the sim state says it is done. "Level the wings"
// (bank beyond the pod / wingtip margin below 100 ft) is a warning, shown at once. DOM-free: flight.js draws the
// state, the gate's obedient pilot (gates/f10.mjs) reads the same state.
import { planRoute, guide as routeGuide, runwayInUse, RPARAMS, gsAltAt, NM } from '../../fdm/route.ts';
import { ilsDeviation } from '../../fdm/ils.ts';
import { bankMargin, approachSpeed } from '../../fdm/autoland.ts';

const D = Math.PI / 180, FT = 0.3048, KT = 0.514444;
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;
export const LEAD = 12; // s: an instruction shows this long before it is needed
export const GET_READY = 4; // s: what is needed at once (on engage, a drift correction) gets this countdown
// the instructions GUIDE ME can give, in the order one shows when several are due together
export const KINDS = ['turn', 'climb', 'descend', 'ldg', 'gear', 'flaps', 'slow', 'follow', 'idle', 'brake'];
export const FLARE_FT = { c172: 15, b77w: 50 }; // ft: when "Idle — flare now" is due (the heavy needs its flare begun higher in this model: fdm/autoland.ts AL_FLARE)
const ONCE = new Set(['gear', 'ldg', 'follow', 'idle', 'brake']); // said once per approach

// bank warning: below 100 ft (radio) and beyond the pod / wingtip margin of the aircraft's own contact geometry
export function bankWarning(sim, margin) {
  const ra = sim.altMsl - Math.max(sim.groundH, 0) - sim.ac.model.gearGround;
  return !sim.onGround && ra < 100 * FT && Math.abs(sim.euler.phi / D) > margin;
}

export class Guide {
  constructor(ac, W, wind, o = {}) {
    this.ac = ac; this.id = ac.id; this.W = W; this.wind = wind; this.P = RPARAMS[ac.id];
    this.lead = o.lead ?? LEAD; this.flipTurns = !!o.flipTurns; // gate fixtures: an instruction shown late; turns flipped
    this.plan = null; this.rwy = null; this.items = new Map(); this.log = []; this.hdgSaid = null; this.t0 = null; this.margin = bankMargin(ac).deg;
    this.state = { items: [], warn: null, cue: null, g: null };
  }
  kin(s) { const trk = s.gs > 1 ? (Math.atan2(s.vel[1], s.vel[0]) / D + 360) % 360 : ((s.euler.psi / D) + 360) % 360; return { n: s.pos[0], e: s.pos[1], alt: s.altMsl, trk, gs: s.gs, cas: s.cas, t: s.t }; }
  start(sim) {
    const k = this.kin(sim);
    this.rwy = runwayInUse(this.W.ils, this.wind, k.n, k.e);
    this.plan = planRoute(this.id, k, this.rwy, this.W.ground);
    this.items.clear(); this.said = new Set(); this.hdgSaid = null; this.spdSaid = null; this.flapSaid = null; this.altSaid = null; this.t0 = sim.t; this.replanT = -1e9; this.replans = 0;
  }
  // heading to fly for a ground track, with the wind the air data shows
  headingFor(sim, trk) {
    const tas = Math.max(sim.tas, 20), w = sim.windNed, tn = Math.cos(trk * D), te = Math.sin(trk * D);
    const cross = -w[0] * te + w[1] * tn;
    return (trk - Math.asin(Math.max(-0.5, Math.min(0.5, cross / tas))) / D + 360) % 360;
  }
  // a point `sec` seconds ahead along the remaining route, as a kinematic state
  // (on a line leg it moves parallel to the leg — sequencing goes by the along-course position — then fix to fix)
  ahead(k, sec) {
    const pl = this.plan, F = pl.fixes; let d = Math.max(k.gs, 30) * sec, n = k.n, e = k.e, trk = k.trk;
    if (pl.leg > 0 && pl.leg < F.length) {
      const P0 = F[pl.leg - 1], P1 = F[pl.leg], L = Math.hypot(P1.n - P0.n, P1.e - P0.e), un = (P1.n - P0.n) / L, ue = (P1.e - P0.e) / L;
      const rem = (P1.n - n) * un + (P1.e - e) * ue;
      trk = (Math.atan2(ue, un) / D + 360) % 360;
      if (rem >= d) return { ...k, n: n + un * d, e: e + ue * d, trk };
      if (rem > 0) { n += un * rem; e += ue * rem; d -= rem; }
    }
    for (let i = pl.leg; i < F.length && d > 0; i++) {
      const L = Math.hypot(F[i].n - n, F[i].e - e);
      trk = (Math.atan2(F[i].e - e, F[i].n - n) / D + 360) % 360;
      if (L >= d) { n += (F[i].n - n) * d / L; e += (F[i].e - e) * d / L; d = 0; } else { n = F[i].n; e = F[i].e; d -= L; }
    }
    return { ...k, n, e, trk };
  }

  // ctx: { flap (detent index), gear (0/1), ldgSet (LANDING CONFIG applied), thr (0..1), brakes (0..1) }
  update(sim, ctx) {
    if (!this.plan) this.start(sim);
    const t = sim.t, k = this.kin(sim), P = this.P, heavy = this.id === 'b77w';
    let g = routeGuide(this.plan, this.id, k);
    if (g.replan && !g.onFinal) { this.plan = planRoute(this.id, k, this.rwy, this.W.ground); g = routeGuide(this.plan, this.id, k); this.replanT = t; this.replans++; }
    const dev = ilsDeviation(this.rwy, k.n, k.e, k.alt);
    const ra = sim.altMsl - Math.max(sim.groundH, 0) - this.ac.model.gearGround;
    const hdgNow = ((sim.euler.psi / D) + 360) % 360, sink = Math.max(0.5, sim.vel[2]);
    const onLoc = g.onFinal && Math.abs(dev.locDots) < 1.2;
    const vref = approachSpeed(this.ac, sim.mass, this.wind, this.rwy.crs);
    // ---- what each instruction needs, looking ahead 0…lead s along the route (first second it becomes due)
    const due = {}, now0 = {}; // now0: the route says it is needed now (the reference the gate measures lead against)
    const look = (kind, fn) => { now0[kind] = !!fn(0); for (let s = 0; s <= this.lead; s++) { const v = fn(s); if (v) { due[kind] = { inS: s, ...v }; return; } } };
    const gAt = (s) => { if (s === 0) return g; const copy = { ...this.plan }; return routeGuide(copy, this.id, this.ahead(k, s)); };
    const cache = []; const G = (s) => (cache[s] ??= gAt(s));
    if (!g.onFinal || !onLoc) {
      const hdgWant = Math.round(this.headingFor(sim, g.trk)), pend = this.items.get('turn');
      // a planned turn: the route's own track, sampled along the look-ahead, swings by 15° or more (any number of legs
      // ahead); it is needed when the route's track at the aircraft has swung to it
      for (let s2 = 1; s2 <= this.lead && !g.onFinal; s2++) {
        const x = G(s2); if (x.onFinal && x.kind === 'thr') break;
        const dd = ((x.crs - g.crs) % 360 + 540) % 360 - 180;
        if (Math.abs(dd) >= 15 && x.leg !== g.leg) { due.turn = { inS: s2, dir: Math.sign(((x.crs - hdgNow) % 360 + 540) % 360 - 180) || Math.sign(dd), hdg: Math.round(this.headingFor(sim, x.crs)), trk: x.crs }; break; }
      }
      now0.turn = !!pend && pend.trk != null && Math.abs(((g.crs - pend.trk) % 360 + 540) % 360 - 180) < 10;
      // a heading the route wants now that nobody announced (engage, drift, a re-plan): a correction, given at once
      if (!due.turn && (this.hdgSaid == null || Math.abs(wrap180(hdgWant - this.hdgSaid)) > 10 || (Math.abs(wrap180(hdgWant - hdgNow)) > 10 && !pend))) due.turn = { inS: 0, dir: Math.sign(wrap180(hdgWant - hdgNow)) || 1, hdg: hdgWant, now: true, reactive: true };
    }
    // altitude: climb to / descend to a level (the intercept altitude or the leg's safe altitude), said once per level
    const lvl = (x) => Math.ceil(Math.max(this.plan.hFaf, Number.isFinite(x.msa) ? x.msa : -1e9) / FT / 100) * 100;
    look('climb', (s) => { const x = G(s), a = lvl(x); return x.kind !== 'thr' && k.alt < a * FT - 250 * FT && a > (this.altSaid ?? -1e9) + 50 ? { alt: a } : null; }); // the floor, not the descent profile
    look('descend', (s) => { const x = G(s), a = lvl(x); return x.kind !== 'thr' && k.alt > x.alt + 300 * FT && a < (this.altSaid ?? 1e9) - 50 ? { alt: a } : null; });
    // speed and flaps follow the route's schedule (what was last said), not every gust
    if (this.spdSaid == null) { this.spdSaid = Math.max(g.spd, Math.round(sim.cas)); this.flapSaid = ctx.flap; if (sim.cas > g.spd + 12) due.slow = { inS: 0, spd: g.spd, reactive: true }; }
    if (!due.slow) look('slow', (s) => { const x = G(s); return !ctx.ldgSet && !x.landing && x.spd < this.spdSaid - 3 ? { spd: x.spd } : null; });
    look('flaps', (s) => { const x = G(s); return !ctx.ldgSet && !x.landing && x.flap > Math.max(ctx.flap, this.flapSaid) ? { flap: x.flap, deg: this.ac.flaps.detents[x.flap] } : null; });
    if (heavy) look('gear', (s) => { const x = G(s); return !ctx.gear && x.onFinal && x.dtgNm < P.dFafNm + 1.5 ? {} : null; });
    look('ldg', (s) => (G(s).landing && !ctx.ldgSet ? { spd: Math.round(vref) } : null));
    look('follow', (s) => { const x = G(s); return x.onFinal && (x.kind === 'thr' || x.dtgNm < P.dFafNm + 0.5) ? {} : null; });
    if (g.onFinal && !sim.onGround && ra < 300 * FT) {
      const flare = FLARE_FT[this.id] * FT, tIdle = (ra - flare) / sink;
      if (tIdle <= this.lead) due.idle = { inS: Math.max(0, Math.ceil(tIdle)) };
      if (ra / sink <= this.lead) due.brake = { inS: Math.max(0, Math.ceil(ra / sink)) };
      now0.idle = tIdle <= 0;
    }
    if (sim.onGround && sim.touchdowns.length) { due.brake = { inS: 0 }; now0.brake = true; }
    // ---- instructions: appear when due (and stay with their own need time), clear when done
    const done = {
      turn: (it) => Math.abs(wrap180(it.hdg - hdgNow)) < 6,
      climb: (it) => k.alt >= it.alt * FT - 150 * FT,
      descend: (it) => k.alt <= it.alt * FT + 150 * FT,
      slow: (it) => sim.cas <= it.spd + 5,
      flaps: (it) => ctx.flap >= it.flap,
      gear: () => ctx.gear > 0.5,
      ldg: () => ctx.ldgSet,
      follow: () => sim.onGround || ra < 100 * FT,
      idle: () => ctx.thr <= 0.05 && (sim.onGround || ra < FLARE_FT[this.id] * FT),
      brake: () => sim.onGround && sim.gs < 1,
    };
    // established on the localizer: a heading still pending is superseded by the cue
    if (g.onFinal && onLoc && this.items.has('turn')) { const it = this.items.get('turn'); it.doneT = t; it.superseded = true; this.log.push(it); this.items.delete('turn'); }
    for (const kind of KINDS) {
      const d = due[kind], it = this.items.get(kind);
      if (it) {
        if (it.needT == null && t >= it.dueT) it.needT = t;
        if (it.trueT == null && now0[kind]) it.trueT = t;
        if (it.needT != null && done[kind](it)) { it.doneT = t; this.log.push(it); this.items.delete(kind); if (kind === 'turn') this.hdgSaid = it.hdg; if (kind === 'slow') this.spdSaid = it.spd; if (kind === 'climb' || kind === 'descend') this.altSaid = it.alt; if (kind === 'flaps') this.flapSaid = it.flap; this.said.add(kind); continue; }
        // a newer, tighter target of the same kind updates the pending line (slow to less, more flap, lower / higher)
        if (d && kind === 'slow' && d.spd < it.spd) it.spd = d.spd;
        if (d && kind === 'flaps' && d.flap > it.flap) { it.flap = d.flap; it.deg = d.deg; }
        if (d && kind === 'descend' && d.alt < it.alt) it.alt = d.alt;
        if (d && kind === 'climb' && d.alt > it.alt) it.alt = d.alt;
        // height-based countdowns follow the aircraft (sink rate changes); the rest keep the time they were given
        if ((kind === 'idle' || kind === 'brake') && d && it.needT == null && t < it.dueT) it.dueT = Math.max(t + Math.min(d.inS, GET_READY), t + d.inS);
        if (kind === 'turn' && d && d.hdg !== it.hdg && Math.abs(wrap180(d.hdg - it.hdg)) > 10 && it.needT == null) { it.hdg = d.hdg; it.dir = d.dir; }
        continue;
      }
      if (!d || (ONCE.has(kind) && this.said.has(kind))) continue;
      // what is due at once (engage, a correction) gets a get-ready countdown; the rest shows `inS` early
      const inS = Math.max(d.inS, d.now || t - this.t0 < 1 || d.inS < GET_READY ? GET_READY : 0);
      const dir = kind === 'turn' && this.flipTurns ? -d.dir : d.dir;
      const atStart = t - this.t0 < 1 || t - this.replanT < 1; // what a (re)plan needs at once cannot be foretold
      this.items.set(kind, { kind, ...d, dir, showT: t, dueT: t + inS, needT: null, trueT: d.reactive || atStart ? t : now0[kind] ? t : null, reactive: !!d.reactive || atStart });
    }
    // the bar: the most urgent three (one big line, two small)
    const list = [...this.items.values()].sort((a, b) => a.dueT - b.dueT || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)).slice(0, 3)
      .map((it) => ({ kind: it.kind, dir: it.dir, hdg: it.hdg, alt: it.alt, spd: it.spd, flap: it.flap, deg: it.deg, inS: Math.max(0, Math.ceil(it.dueT - t)), now: t >= it.dueT }));
    // the cue: where to point the nose (heading) and the flight path (3° on the glide path, level otherwise)
    const cr = this.rwy.crs * D, xteRate = -Math.sin(cr) * sim.vel[0] + Math.cos(cr) * sim.vel[1];
    const cueTrk = g.onFinal ? (this.rwy.crs + Math.max(-15, Math.min(15, -0.12 * dev.xte - 2.5 * xteRate)) + 360) % 360 : g.trk;
    const gsGamma = g.onFinal && (g.kind === 'thr' || dev.gsDots > -0.3) ? -this.rwy.gsDeg * D + Math.max(-0.02, Math.min(0.02, -dev.gsErrM * 0.002)) : 0;
    const warn = bankWarning(sim, this.margin) ? 'bank' : null;
    this.state = { items: list, warn, cue: { hdg: Math.round(this.headingFor(sim, cueTrk)), gamma: gsGamma, trk: cueTrk }, g, dev, rwy: this.rwy.id };
    return this.state;
  }
}
export { gsAltAt, NM, KT };
