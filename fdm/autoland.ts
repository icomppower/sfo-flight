// AUTO LAND (M1.2, Shift+L): the aircraft flies the route manager's way back to the SFO ILS in use and lands —
// turns, descends, slows, sets LANDING CONFIG at the planned point, captures LOC + G/S, autolands and brakes to a
// stop. The heavy twin through its own autopilot and autothrottle (the modes it drives are the MCP's, lit on the
// panel); the light single through the GAME ASSIST (fdm/assist.ts). Stick input or the button again disconnects it
// within the step. Runs inside Flight.step (fdm/flight.ts) from a recorded control (`auto`), so replays re-fly it.
import { type Sim, type Controls } from './sim.ts';
import { Autopilot, AP_EVENT } from './autopilot.ts';
import { GameAssist } from './assist.ts';
import { planRoute, guide, runwayInUse, RPARAMS, type Plan, type Guidance, type RouteParams } from './route.ts';
import type { IlsDef } from './ils.ts';
import type { Ground } from './sim.ts';
import type { AircraftData } from './aircraft/types.ts';
import { CONFIGS, vref } from './configs.ts';
import { clamp, DEG, FT, KT, wrap180 } from './math.ts';
import * as D from './dmath.ts';

export const AUTO_EVENT = { TOGGLE: 1 } as const;
// the stick deflection that counts as the pilot taking over (keyboard ramps reach it in ~50 ms)
export const TAKEOVER = 0.1;

// pod / wingtip clearance: the bank at which the first nacelle or wingtip reaches the runway with the wings' main gear
// strut fully compressed and zero pitch — from the aircraft's own contact geometry (777 ≈ 7.6°, nacelle)
export function bankMargin(ac: AircraftData): { deg: number; part: string } {
  let best = { deg: 90, part: 'wingtip' };
  for (const C of ac.contacts) {
    if (C.kind !== 'nacelle' && C.kind !== 'wingtip') continue;
    const G = ac.gear.filter((g) => g.brake).reduce((a, g) => (Math.sign(g.pos[1]) === Math.sign(C.pos[1]) ? g : a));
    const zw = G.pos[2] - G.travel, dy = Math.abs(C.pos[1]) - Math.abs(G.pos[1]);
    if (dy <= 0) continue;
    const deg = D.atan2(zw - C.pos[2], dy) / DEG;
    if (deg < best.deg) best = { deg, part: C.kind };
  }
  return best;
}
// flap-retraction floors (KIAS): the slowest speed each detent is flown at (777 manoeuvre margins at landing
// weights; 172 about 1.3 VS for the detent) — the route's speed never drops below the floor of the flaps set
const FLOOR: Record<string, number[]> = { b77w: [225, 205, 185, 165, 160, 155, 145], c172: [65, 60, 55, 50] };

// the heavy's flare under AUTO LAND: 60 ft (50 ft left the gusty-westerly touchdowns near 560 fpm) and a 7° pitch cap
// (the -300ER's tail strikes near 9°)
export const AL_FLARE = { ft: 60, pitchMax: 7, minSink: 0.4 };

// the final approach speed (KIAS): 777 Vref30 + the wind additive (½ the headwind + the gust, at least 5, at most 20);
// 172 65 KIAS + the gust factor (at most 10 — half of it, the POH rule, left touchdowns near the stall in the model's
// 15G22 gusts)
export function approachSpeed(ac: AircraftData, mass: number, wind: { dir: number; kt: number; gustKt?: number }, crs: number): number {
  const head = wind.kt * D.cos((wind.dir - crs) * DEG), gust = Math.max(0, (wind.gustKt ?? wind.kt) - wind.kt);
  if (ac.id === 'b77w') { const base = CONFIGS.b77w.landing.vrefAdd!; return Math.round(vref(ac, mass) + clamp(Math.max(base, 0.5 * Math.max(0, head) + gust), base, 20)); }
  return Math.round(CONFIGS.c172.landing.bugKt! + clamp(gust, 0, 10));
}

export type Caption = 'engage' | 'turn' | 'loc' | 'gs' | 'ldg' | 'ft500' | 'mins' | 'flare' | 'touchdown' | 'autobrake' | 'stopped' | 'off';

export class AutoLand {
  ac: AircraftData; ap: Autopilot | null; assist: GameAssist | null; ils: IlsDef[]; ground: Ground | null; wind: { dir: number; kt: number; gustKt?: number };
  on = false; done = false; plan: Plan | null = null; g: Guidance | null = null; rwy: IlsDef | null = null;
  captions: { id: Caption; t: number }[] = []; disconnectReason = ''; landingSet = false; margin: { deg: number; part: string };
  // the configuration it has set (handed back to the pilot's controls every step, so a takeover keeps them)
  cfg = { flap: 0, gear: 1, spoiler: 0, autobrake: 0, spd: 0, park: 0 };
  patch: Partial<RouteParams> & { noTerrain?: boolean; noLandingCfg?: boolean; bankLow?: number; lowBankBias?: number; takeover?: number } = {}; // gate fixtures
  private q: number[] = []; private seen = new Set<string>(); private lastLeg = -1; private vsMode = '';

  constructor(ac: AircraftData, ap: Autopilot | null, ils: IlsDef[], ground: Ground | null, wind: { dir: number; kt: number; gustKt?: number }) {
    this.ac = ac; this.ap = ap; this.ils = ils; this.ground = ground; this.wind = wind;
    this.assist = ap ? null : new GameAssist();
    this.margin = bankMargin(ac);
  }
  private cap(id: Caption, t: number, key: string = id): void { if (!this.seen.has(key)) { this.seen.add(key); this.captions.push({ id, t }); } }
  private kin(s: Sim) { const trk = s.gs > 1 ? (D.atan2(s.vel[1], s.vel[0]) / DEG + 360) % 360 : ((s.euler.psi / DEG) + 360) % 360; return { n: s.pos[0], e: s.pos[1], alt: s.altMsl, trk, gs: s.gs, cas: s.cas, t: s.t }; }

  engage(s: Sim, c: Controls): void {
    if (s.onGround && s.gs < 5) return; // parked / holding: nothing to fly (SPEC: from wherever the aircraft is airborne)
    this.on = true; this.done = false; this.disconnectReason = ''; this.captions = []; this.seen.clear(); this.lastLeg = -1; this.landingSet = false; this.vsMode = '';
    const k = this.kin(s);
    this.rwy = runwayInUse(this.ils, this.wind, k.n, k.e);
    this.plan = planRoute(this.ac.id, k, this.rwy, this.ground, this.patch);
    this.cfg = { flap: Math.round(c.flap), gear: c.gear, spoiler: c.spoiler, autobrake: c.autobrake, spd: Math.round(s.cas), park: 0 };
    this.cap('engage', s.t);
    if (this.ap) {
      this.ap.ilsFix = this.rwy; this.ap.flareFt = AL_FLARE.ft; this.ap.flarePitchMax = AL_FLARE.pitchMax; this.ap.flareMin = AL_FLARE.minSink;
      this.q = [];
      if (!this.ap.on) this.q.push(AP_EVENT.AP);
      if (!this.ap.at) this.q.push(AP_EVENT.AT);
      this.q.push(AP_EVENT.HDG);
    } else { this.assist!.ils = this.rwy; this.assist!.engage(s); this.assist!.lat = 'HDG'; this.assist!.vert = 'ALT'; }
  }
  disengage(reason: string, s: Sim): void {
    if (!this.on) return;
    this.on = false; this.disconnectReason = reason; this.q = [];
    if (this.ap) { this.ap.off(reason); this.ap.at = false; this.restoreAp(); }
    else this.assist!.off(reason);
    this.cap('off', s.t, 'off' + s.t);
  }

  // before the autopilot and the step: `c` is the applied copy of the pilot's controls (fdm/flight.ts)
  apply(s: Sim, c: Controls, pilot: Controls): Controls {
    if (c.auto === AUTO_EVENT.TOGGLE) { if (this.on) this.disengage('button', s); else this.engage(s, c); }
    if (!this.on) return c;
    // takeover: any stick input
    const tk = this.patch.takeover ?? TAKEOVER;
    if (Math.abs(pilot.elev) > tk || Math.abs(pilot.ail) > tk) { this.disengage('override', s); return c; }
    if (s.crashed) { this.on = false; return c; }
    const k = this.kin(s), P = { ...RPARAMS[this.ac.id], ...this.patch }, heavy = !!this.ap;
    // established on the localizer: the route is the final (no re-plans); else re-plan when the aircraft has drifted
    const locNow = heavy ? this.ap!.lat === 'LOC' || this.ap!.lat === 'ROLLOUT' : this.assist!.lat === 'LOC' || this.assist!.lat === 'ROLLOUT';
    const pl = this.plan!;
    if (locNow && !pl.fixes[pl.leg].kind.match(/faf|thr/)) {
      const fi = pl.fixes.findIndex((f) => f.kind === 'faf'), dn = pl.ils.thrN - k.n, de = pl.ils.thrE - k.e;
      pl.leg = fi >= 0 && D.hypot(dn, de) > P.dFafNm * 1852 + 300 ? fi : pl.fixes.length - 1;
    } else if (!locNow && this.g?.replan && !this.g.onFinal) this.plan = planRoute(this.ac.id, k, this.rwy!, this.ground, this.patch);
    const g = this.g = guide(this.plan!, this.ac.id, k, this.patch);
    const radAlt = s.altMsl - Math.max(s.groundH, 0) - this.ac.model.gearGround;
    const cfg = this.cfg, ap = this.ap, as = this.assist;
    // ---- configuration: flaps toward the segment's detent inside the placard speeds, gear, LANDING CONFIG
    const vfe = this.ac.flaps.vfe, floor = FLOOR[this.ac.id];
    const want = this.landingSet ? P.flap.landing : g.flap;
    if (want > cfg.flap && s.cas <= vfe[cfg.flap + 1] - 5) cfg.flap++;
    else if (want < cfg.flap && s.cas >= floor[cfg.flap - 1] - 5 && !s.onGround) cfg.flap--;
    if (heavy) {
      if (!s.onGround && radAlt > 100 * FT && s.vsFpm > 300 && !g.onFinal && cfg.gear === 1 && !this.landingSet) cfg.gear = 0;
      if ((g.onFinal && (ap!.vert === 'GS' || g.dtgNm < P.dFafNm + 1)) || this.landingSet) cfg.gear = 1;
      cfg.spoiler = this.landingSet ? -1 : 0;
    }
    if (g.landing && !this.landingSet && !this.patch.noLandingCfg && !s.onGround) {
      // LANDING CONFIG, the M1.1 set (fdm/configs.ts): full flaps (as the placard allows), gear, spoilers armed,
      // autobrake 3, SPD = Vref + 5 (777) / 65 KIAS (172)
      this.landingSet = true;
      if (heavy) { cfg.gear = 1; cfg.spoiler = -1; cfg.autobrake = CONFIGS.b77w.landing.autobrake!; }
      this.cap('ldg', s.t);
    }
    const land = approachSpeed(this.ac, s.mass, this.wind, this.rwy?.crs ?? 0);
    cfg.spd = Math.round(this.landingSet ? land : Math.max(g.spd, floor[cfg.flap], land));
    c.flap = cfg.flap; c.gear = cfg.gear; c.spoiler = cfg.spoiler; c.autobrake = cfg.autobrake;
    // speedbrake (heavy) when well above the target speed in a descent
    if (heavy && !this.landingSet && s.cas > cfg.spd + 15 && s.vsFpm < -300) c.spoiler = 0.5;
    // ---- lateral: the route's ground track as a heading (wind correction from the air data)
    const tas = Math.max(s.tas, 20), w = s.windNed, [tn, te] = [D.cos(g.trk * DEG), D.sin(g.trk * DEG)];
    const cross = -w[0] * te + w[1] * tn; // wind toward the right of the track, m/s
    const hdg = (g.trk - D.asin(clamp(cross / tas, -0.5, 0.5)) / DEG + 360) % 360;
    const arm = g.kind === 'join' || g.onFinal;
    // ---- vertical: VS toward the profile altitude (never below the leg's MSA), ALT capture by the mode logic
    const errFt = (s.altMsl - g.alt) / FT;
    let vsFpm = 0, mode = 'ALT';
    if (errFt > 250) { mode = 'VS'; vsFpm = -clamp(300 + errFt, 400, heavy ? 2500 : 800); if (s.cas > cfg.spd + 10) vsFpm *= clamp(1 - (s.cas - cfg.spd - 10) / 20, 0.3, 1); }
    else if (errFt < -250) { mode = 'VS'; vsFpm = clamp(300 - errFt, 500, heavy ? 2500 : 700); }
    if (heavy) {
      c.mcpSpd = cfg.spd; c.mcpAlt = Math.round(g.alt / FT); c.mcpVs = Math.round(vsFpm / 100) * 100;
      if (ap!.lat !== 'LOC' && ap!.lat !== 'ROLLOUT') c.mcpHdg = hdg;
      ap!.bankLow = this.patch.bankLow ?? Math.max(2, this.margin.deg - 2.5); ap!.bankBiasLow = this.patch.lowBankBias ?? 0;
      // the MCP events, one per step: AP / AT / HDG at engage, then V/S or ALT HOLD as the profile needs (not once
      // APP is armed: the glide slope takes the vertical), APP on the intercept
      if (!this.q.length && !s.touchdowns.length) {
        if (!ap!.on) this.q.push(AP_EVENT.AP);
        else if (!ap!.at && !s.onGround) this.q.push(AP_EVENT.AT);
        else if (arm && !ap!.gsArm && ap!.vert !== 'GS' && ap!.vert !== 'FLARE' && ap!.lat !== 'ROLLOUT') this.q.push(AP_EVENT.APP);
        else if (!ap!.gsArm && ap!.vert !== 'GS' && ap!.vert !== 'FLARE') {
          if (mode === 'VS' && ap!.vert !== 'VS' && this.vsMode !== 'VS' + Math.sign(vsFpm)) { this.q.push(AP_EVENT.VS); this.vsMode = 'VS' + Math.sign(vsFpm); }
          else if (mode === 'ALT' && ap!.vert === 'VS' && Math.abs(errFt) < 150) { this.q.push(AP_EVENT.ALT); this.vsMode = ''; }
          else if (ap!.vert === 'ALT' || ap!.vert === 'ALT*') this.vsMode = '';
        }
      }
      if (this.q.length && !c.ap) c.ap = this.q.shift()!;
    } else {
      as!.spd = cfg.spd; as!.bankLow = this.patch.bankLow ?? Math.min(25, this.margin.deg - 5);
      if (as!.lat === 'HDG' || as!.lat === 'LVL') { as!.lat = 'HDG'; as!.hdg = hdg; }
      if (arm && as!.lat === 'HDG' && !as!.locArm) { as!.locArm = true; as!.gsArm = true; }
      if (as!.vert === 'ALT' && mode === 'VS') as!.setVert('VS');
      else if (as!.vert === 'VS' && Math.abs(errFt) < 120) as!.setVert('ALT');
      as!.alt = g.alt; as!.vs = vsFpm * FT / 60;
      as!.apply(s, c);
    }
    // ---- captions (each once)
    if (g.leg !== this.lastLeg) { this.lastLeg = g.leg; }
    const baseIdx = this.plan!.fixes.findIndex((f) => f.kind === 'base');
    if (!s.onGround && ((baseIdx >= 0 && g.leg > baseIdx) || g.kind === 'join' || (!g.onFinal && Math.abs(wrap180(g.trk - k.trk)) > 20))) this.cap('turn', s.t); // turning to intercept (off the base leg)
    const lat = heavy ? ap!.lat : as!.lat, vert = heavy ? ap!.vert : as!.vert;
    if (lat === 'LOC') this.cap('loc', s.t);
    if (vert === 'GS') this.cap('gs', s.t);
    if (g.onFinal && !s.onGround && s.vel[2] > 0) { if (radAlt < 500 * FT) this.cap('ft500', s.t); if (radAlt < 200 * FT) this.cap('mins', s.t); }
    if (vert === 'FLARE') this.cap('flare', s.t);
    if (s.touchdowns.length) {
      this.cap('touchdown', s.touchdowns[0].t);
      if (s.onGround && s.abDecel > 0.8) this.cap('autobrake', s.t);
      if (s.onGround && s.gs < 0.5) {
        this.cap('stopped', s.t); this.on = false; this.done = true; c.park = 1; c.thr = c.thr.map(() => 0); cfg.park = 1;
        if (ap) { ap.off('rollout complete'); ap.at = false; this.restoreAp(); }
      }
    }
    return c;
  }

  private restoreAp(): void { const a = this.ap!; a.ilsFix = null; a.flareFt = 50; a.flarePitchMax = 99; a.flareMin = 0.6; a.bankBiasLow = 0; a.bankLow = 8; }

  // what AUTO LAND has set, into the pilot's controls, so that a takeover (or the end) keeps it
  handBack(pilot: Controls, applied: Controls): void {
    pilot.flap = applied.flap; pilot.gear = applied.gear; pilot.spoiler = applied.spoiler === 0.5 ? 0 : applied.spoiler; pilot.autobrake = applied.autobrake;
    pilot.mcpSpd = applied.mcpSpd; pilot.mcpHdg = applied.mcpHdg; pilot.mcpAlt = applied.mcpAlt; pilot.mcpVs = applied.mcpVs;
    pilot.thr = applied.thr.slice(); pilot.park = applied.park;
  }
}
void KT;
