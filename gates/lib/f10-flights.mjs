// F10's headless flights on the real world (terrain, ring, roofs, ILS): the eight scattered starts, AUTO LAND from
// each (fdm/autoland.ts inside Flight.step, engaged by the recorded `auto` control), and GUIDE ME flown by an
// "obedient pilot" that acts only on what the instruction bar shows (src/game/guide.js state: the items, their
// countdowns, the cue) through the scripted pilot's control laws.
import { loadWorld } from './world.mjs';
import { Flight } from '../../fdm/flight.ts';
import { TestPilot } from '../../fdm/pilot.ts';
import { C172 } from '../../fdm/aircraft/c172.ts';
import { B77W } from '../../fdm/aircraft/b77w.ts';
import { AUTO_EVENT, AL_FLARE } from '../../fdm/autoland.ts';
import { Autopilot } from '../../fdm/autopilot.ts';
import { CONFIGS } from '../../fdm/configs.ts';
import { Guide, bankWarning, FLARE_FT } from '../../src/game/guide.js';

const FT = 0.3048, NM = 1852, D = Math.PI / 180, KT = 0.514444;
export const AC = { c172: C172, b77w: B77W };
export const WINDS = {
  calm: { wind: { dir: 0, kt: 0, gustKt: 0, turbulence: 0 }, visM: 20000, qnhHpa: 1013.25, tempC: 15 },
  west: { wind: { dir: 280, kt: 15, gustKt: 22 }, visM: 20000, qnhHpa: 1013.25, tempC: 15 }, // F4's gusty westerly (the "westerly" METAR is 27015G23)
};
export const START_NAMES = ['ggb', 'north', 'south', 'behind', 'high', 'fast', 'downwind', 'takeoff'];

// the SPEC §14 starts: over the Golden Gate, north of the bay, south, behind the airport (west, over the hills), too
// high, too fast, on downwind, just after takeoff (climbing out of 1R)
export function starts(W, id) {
  const H = id === 'b77w', m = H ? 250000 : 1080, ap = W.airport, gg = ap.places.goldenGate, g = ap.trueNorthGridDeg;
  const I = W.ils.find((i) => i.id === '28R'), un = Math.cos(I.crs * D), ue = Math.sin(I.crs * D);
  const clean = { flap: 0, gear: H ? 0 : 1, mass: m };
  const fin = (d, altFt, cas) => ({ n: I.thrN - un * d * NM, e: I.thrE - ue * d * NM, alt: altFt * FT, hdg: I.crs, cas, ...clean });
  const r1 = ap.runways.find((r) => r.ends.some((e) => e.id === '1R')), e1 = r1.ends.find((e) => e.id === '1R'), f1 = r1.ends.find((e) => e.id !== '1R');
  const crs1 = (Math.atan2(f1.end[0] - e1.thr[0], -(f1.end[1] - e1.thr[1])) / D + 360) % 360;
  return {
    ggb: { n: -gg.z, e: gg.x, alt: (H ? 3000 : 1500) * FT, hdg: gg.hdgTrue + g, cas: H ? 250 : 100, ...clean },
    north: { n: 30000, e: 3000, alt: (H ? 5000 : 2500) * FT, hdg: 200, cas: H ? 250 : 100, ...clean },
    south: { n: -22000, e: 4000, alt: (H ? 4000 : 2500) * FT, hdg: 330, cas: H ? 240 : 100, ...clean },
    behind: { n: 1500, e: -9000, alt: (H ? 4000 : 2000) * FT, hdg: 100, cas: H ? 230 : 95, ...clean },
    high: fin(H ? 12 : 6, H ? 9000 : 4500, H ? 230 : 90),
    fast: fin(H ? 25 : 10, H ? 6000 : 3000, H ? 320 : 140),
    downwind: { n: I.thrN - un * (H ? 2 : 0.5) * NM - ue * (H ? 3 : 1.2) * NM, e: I.thrE - ue * (H ? 2 : 0.5) * NM + un * (H ? 3 : 1.2) * NM, alt: (H ? 3000 : 1000) * FT, hdg: (I.crs + 180) % 360, cas: H ? 210 : 85, flap: H ? 1 : 0, gear: H ? 0 : 1, mass: m },
    takeoff: { n: -e1.thr[1] + Math.cos(crs1 * D) * 2600, e: e1.thr[0] + Math.sin(crs1 * D) * 2600, alt: (H ? 600 : 400) * FT, hdg: crs1, cas: H ? 175 : 70, flap: H ? 3 : 1, gear: 1, gamma: H ? 5 : 4, mass: H ? 300000 : 1080 },
  };
}

const radAlt = (s) => s.altMsl - Math.max(s.groundH, 0) - s.ac.model.gearGround;

// AUTO LAND from a start; `patch` → AutoLand.patch (gate fixtures), `each(f)` every step
export function autoLand(W, id, name, wx, { seed = 'f10', patch = {}, each = null, maxS = 1800 } = {}) {
  const f = new Flight(AC[id], starts(W, id)[name], WINDS[wx], seed, { ground: W.ground, ils: W.ils, runways: W.runways });
  Object.assign(f.auto.patch, patch);
  const c = { ...f.initial, thr: f.initial.thr.slice() };
  c.auto = AUTO_EVENT.TOGGLE; f.step(c); c.auto = 0;
  const out = { plan: f.auto.plan && { ...f.auto.plan }, maxBankLow: 0, ldgAt: null, track: [] };
  for (let i = 0; i < 120 * maxS && !f.sim.crashed && !f.scorer.landing?.complete; i++) {
    f.step(c);
    const s = f.sim, ra = radAlt(s);
    if (!s.onGround && ra < 100 * FT) out.maxBankLow = Math.max(out.maxBankLow, Math.abs(s.euler.phi / D));
    if (f.auto.landingSet && out.ldgAt == null) out.ldgAt = { t: s.t, dtgNm: f.auto.g.dtgNm, raFt: ra / FT };
    if (i % 120 === 0) out.track.push([s.pos[0], s.pos[1], s.altMsl, ra]);
    if (each) each(f, i);
  }
  return { f, ...out, landing: f.scorer.landing, crashed: f.sim.crashed, planned: f.auto.rwy?.id, margin: f.auto.margin.deg, captions: f.auto.captions };
}

// the obedient pilot: holds the last heading / altitude / speed it was told, and on each instruction's "now" does
// exactly that instruction; on the final it follows the cue (the arrow: heading and flight path); "idle — flare"
// → power off and the flare; "brake" → brakes. Nothing else reaches the controls. Its hands: the light single's
// through the scripted pilot's laws; the heavy's through the MCP (HDG / ALT / V/S / SPD of a private autopilot
// instance, set only from what the bar said), the way a 777 crew flies spoken vectors — the cue's path as V/S.
// the robot's own hands: the scripted pilot's gains, firmer on the flight path for the heavy (a human flies the path
// with attention; the trim-run gains are for calm air)
export const PILOT_GAINS = { b77w: {}, c172: {} };

export function guided(W, id, name, wx, { seed = 'f10', guideOpts = {}, maxS = 1800, each = null, gains = null } = {}) {
  const ac = AC[id], H = id === 'b77w';
  const f = new Flight(ac, starts(W, id)[name], WINDS[wx], seed, { ground: W.ground, ils: W.ils, runways: W.runways });
  const G = new Guide(ac, W, { dir: WINDS[wx].wind.dir, kt: WINDS[wx].wind.kt, gustKt: WINDS[wx].wind.gustKt }, guideOpts);
  const c = { ...f.initial, thr: f.initial.thr.slice() };
  const s = f.sim, tp = new TestPilot(s, H ? 0.45 : 0.6);
  if (gains || PILOT_GAINS[id]) tp.g = { ...tp.g, ...PILOT_GAINS[id], ...gains };
  const mem = { hdg: ((s.euler.psi / D) + 360) % 360, alt: s.altMsl, spd: Math.round(s.cas), mode: 'fly', ldgSet: false, brakes: 0, levelUntil: -1, flareTh: 0 };
  const seen = new Map(), acted = new Set(), shown = [];
  let st = null, tpMode = '';
  const hand = H ? new Autopilot(W.ils) : null;
  if (hand) { hand.flareFt = FLARE_FT.b77w; hand.flarePitchMax = AL_FLARE.pitchMax; hand.flareMin = AL_FLARE.minSink; }
  const setMode = (m) => { if (tpMode !== m) { tpMode = m; tp.thetaCmd = null; tp.gamSpd = null; } };
  for (let i = 0; i < 120 * maxS && !s.crashed && !f.scorer.landing?.complete; i++) {
    if (i % 12 === 0) {
      st = G.update(s, { flap: c.flap, gear: c.gear, ldgSet: mem.ldgSet, thr: c.thr[0], brakes: mem.brakes });
      for (const it of st.items) {
        const key = it.kind + ':' + (G.items.get(it.kind)?.showT ?? '');
        if (!seen.has(key)) { seen.set(key, s.t); shown.push({ ...it, t: s.t, hdgNow: ((s.euler.psi / D) + 360) % 360 }); }
        if (!it.now || acted.has(key)) continue;
        acted.add(key);
        if (it.kind === 'turn') mem.hdg = it.hdg;
        else if (it.kind === 'climb' || it.kind === 'descend') mem.alt = it.alt * FT;
        else if (it.kind === 'slow') mem.spd = it.spd;
        else if (it.kind === 'flaps') c.flap = it.flap;
        else if (it.kind === 'gear') c.gear = 1;
        else if (it.kind === 'ldg') { const L = CONFIGS[id].landing; c.flap = L.flap; if (H) { c.gear = 1; c.spoiler = -1; c.autobrake = L.autobrake; } mem.spd = it.spd; mem.ldgSet = true; }
        else if (it.kind === 'follow') mem.mode = 'follow';
        else if (it.kind === 'idle') { mem.mode = 'flare'; mem.flareTh = s.euler.theta; mem.flareSink = Math.max(0.5, s.vel[2]); }
        else if (it.kind === 'brake') mem.brakes = 1;
      }
      if (st.warn === 'bank') mem.levelUntil = s.t + 2;
    }
    const ra = radAlt(s), cue = st.cue;
    if (hand && !s.onGround) {
      // MCP hands: the told heading / altitude / speed; the cue on the final; the flare on "idle — flare"
      c.elev = 0; c.ail = 0; c.ap = 0;
      if (!hand.on) { hand.on = true; hand.at = true; hand.thr = c.thr[0]; hand.nzF = s.nz; }
      const err = (s.altMsl - mem.alt) / FT;
      c.mcpSpd = mem.spd; c.mcpAlt = Math.round(mem.alt / FT);
      if (mem.mode === 'flare') { if (hand.vert !== 'FLARE') { hand.vert = 'FLARE'; hand.flareSink = Math.max(1.5, s.vel[2]); hand.flareTheta = s.euler.theta; } }
      else if (mem.mode === 'follow') { hand.vert = 'VS'; c.mcpVs = Math.round(s.gs / KT * 101.27 * Math.tan(cue.gamma)); c.mcpAlt = -1000; }
      else if (Math.abs(err) > 200) { hand.vert = 'VS'; c.mcpVs = -Math.sign(err) * 1500; }
      else if (hand.vert !== 'ALT' && hand.vert !== 'ALT*') hand.vert = 'ALT';
      hand.lat = 'HDG'; c.mcpHdg = mem.mode === 'fly' ? mem.hdg : cue.hdg;
      if (mem.levelUntil > s.t) hand.lat = 'ROLL';
      hand.apply(s, c);
      f.step(c);
      if (each) each(f, G, i);
      continue;
    }
    if (hand && hand.on) { hand.off('landed'); hand.at = false; c.thr = c.thr.map(() => 0); }
    let T;
    if (s.onGround) { T = { pitch: s.euler.theta, thr: 0, bank: 0 }; }
    else if (mem.mode === 'flare') {
      const fl = (H ? 30 : 15) * FT, vs = -Math.max(Math.max(ra, 0) / fl * mem.flareSink, H ? 0.6 : 0.3), td = (H ? 5 : 4) * D, th0 = Math.max(-1.5 * D, Math.min(2 * D, mem.flareTh));
      T = { pitch: th0 + (td - th0) * Math.max(0, Math.min(1, 1 - ra / fl)) + Math.max(-0.03, Math.min(0.06, (vs + s.vel[2]) * 0.05)), thr: 0, hdg: cue.hdg };
      setMode('flare');
    } else if (mem.mode === 'follow') { T = { hdg: cue.hdg, gamma: cue.gamma, cas: mem.spd }; setMode('path'); }
    else {
      const err = (s.altMsl - mem.alt) / FT;
      T = { hdg: mem.hdg, cas: mem.spd };
      if (Math.abs(err) > 200) { T.vs = -Math.sign(err) * (H ? 1500 : 500) * FT / 60; setMode('vs'); } else { T.alt = mem.alt; setMode('alt'); }
    }
    if (mem.levelUntil > s.t && !s.onGround) { delete T.hdg; T.bank = 0; }
    tp.fly(c, T);
    if (s.onGround) {
      const R = W.runways.find((r) => r.id === st.rwy) || W.runways[0], dn = s.pos[0] - R.thrN, de = s.pos[1] - R.thrE, lat = -dn * Math.sin(R.crs * D) + de * Math.cos(R.crs * D);
      c.rud = Math.max(-1, Math.min(1, (((R.crs - s.euler.psi / D + 540) % 360) - 180) * D * 5 - lat * 0.01)); c.ail = 0;
      c.brakeL = c.brakeR = mem.brakes && s.cas < (H ? 120 : 50) ? 1 : 0;
    }
    f.step(c);
    if (each) each(f, G, i);
  }
  return { f, G, shown, log: G.log.concat([...G.items.values()]), landing: f.scorer.landing, crashed: f.sim.crashed, rwy: G.rwy?.id };
}
export { loadWorld, bankWarning };
