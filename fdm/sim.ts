// The flight model: one aircraft as a 6-DOF rigid body stepped at a fixed 120 Hz. Deterministic: the same aircraft,
// start, weather, seed and control sequence give the same state bit for bit (the only randomness is fdm/rng.ts, the
// only transcendental functions are the ones V8 implements identically in Node and the browser). No DOM, no clock.
//
// Frames: world NED from the title's origin (north, east, down; the title frame is x = east, z = south, y = up),
// body x forward, y right, z down. Units SI.
import { type V3, type Q4, rotate, unrotate, cross, dot, qIntegrate, qFromEuler, eulerFromQ, clamp, DEG, KT, G0, FT } from './math.ts';
import { atmosphere, casFromTas, tasFromCas, type Air } from './atmosphere.ts';
import { lerp1, lerp2 } from './table.ts';
import { Wind, type WindSpec } from './wind.ts';
import type { AircraftData, GearDef, PistonDef, FanDef } from './aircraft/types.ts';

export const HZ = 120, DT = 1 / HZ;

// ---- the world the aircraft flies in (terrain, water, buildings); fdm/world.ts builds one from baked data
export const SURF = { WATER: 0, PAVED: 1, GROUND: 2 } as const;
export interface Ground {
  height(n: number, e: number): number; // m above local MSL
  surface(n: number, e: number): number; // SURF
  roof(n: number, e: number): number; // top of a building / structure here, or -Infinity
}
export const flatGround = (h = 0, surface: number = SURF.PAVED): Ground => ({ height: () => h, surface: () => surface, roof: () => -Infinity });

// ---- pilot / system inputs for one step. The replay log stores these (fdm/replay.ts).
export interface Controls {
  elev: number; ail: number; rud: number; // −1..1: elev +1 = stick forward (nose down), ail +1 = roll right, rud +1 = yaw right
  thr: number[]; // 0..1 per engine lever
  flap: number; // detent index
  gear: number; // 1 down, 0 up
  brakeL: number; brakeR: number; park: number; // 0..1, park 0/1
  spoiler: number; // 0..1 lever; −1 = armed for landing
  trim: number; // −1 nose down, 0, +1 nose up (rate)
  tiller: number; // −1..1 (nose wheel, heavy only)
  autobrake: number; // 0 off, 1..5 (5 = MAX)
  mixture: number; mags: number; starter: number; master: number; // piston: 0..1, 0/1, 0/1, 0/1
  ap: number; // MCP event this step (fdm/autopilot.ts AP_EVENT), 0 = none
  mcpHdg: number; mcpAlt: number; mcpVs: number; mcpSpd: number; // deg true, ft, fpm, KIAS
}
export function neutralControls(ac: AircraftData): Controls {
  const n = ac.engine.kind === 'turbofan' ? (ac.engine as FanDef).count : 1;
  return { elev: 0, ail: 0, rud: 0, thr: new Array(n).fill(0), flap: 0, gear: 1, brakeL: 0, brakeR: 0, park: 0, spoiler: 0, trim: 0, tiller: 0, autobrake: 0,
    mixture: 1, mags: 1, starter: 0, master: 1, ap: 0, mcpHdg: 0, mcpAlt: 0, mcpVs: 0, mcpSpd: 0 };
}

export interface Weather { wind: WindSpec; visM: number; qnhHpa: number; tempC: number }
export const CALM: Weather = { wind: { dir: 0, kt: 0, gustKt: 0, turbulence: 0 }, visM: 50000, qnhHpa: 1013.25, tempC: 15 };

export interface Start {
  n: number; e: number; // m
  alt?: number; // m MSL (airborne); omitted = on the ground
  hdg: number; // deg true
  cas?: number; // kt (airborne)
  gamma?: number; // flight-path angle deg (airborne)
  flap?: number; gear?: number; // detent index, 1/0
  mass?: number; // kg total; default ref mass
  fuel?: number; // kg
  engineOn?: boolean; // piston cold-and-dark when false
  n1?: number; // turbofan spool at start (%)
}

// fixture switches for the physics gates (F1)
export interface Fixture { noDrag?: boolean; noThrust?: boolean; noGround?: boolean; noAeroMoments?: boolean; noLift?: boolean }

export type CrashReason = 'terrain' | 'water' | 'building' | 'hard-landing' | 'overstress' | 'gear-up' | 'nacelle' | 'wingtip' | 'nose' | 'prop';

export interface TouchdownEvent { t: number; n: number; e: number; sinkFpm: number; cas: number; gs: number; hdg: number; pitch: number; bank: number; nz: number; surface: number }

const gearRng = (g: GearDef, m: number, g0 = G0) => { const k = g.kShare * m * g0 / g.staticDefl; return k; };

export class Sim {
  ac: AircraftData; ground: Ground; weather: Weather; wind: Wind; fx: Fixture; seed: string;
  // rigid body
  pos: V3 = [0, 0, 0]; vel: V3 = [0, 0, 0]; q: Q4 = [1, 0, 0, 0]; w: V3 = [0, 0, 0];
  mass: number; fuel: number; t = 0; steps = 0;
  // actuators and systems
  de = 0; da = 0; dr = 0; trimPos = 0; flapDeg = 0; flapIdx = 0; gearPos = 1; gearCmd = 1; spoilerPos = 0;
  brakeL = 0; brakeR = 0;
  rpm = 0; running = false; starterT = 0; // piston
  n1: number[] = []; // turbofan
  // gear state
  comp: number[]; bristleA: number[]; bristleS: number[]; wow: boolean[];
  // derived each step (read by the render layer, the autopilot and the gates)
  air!: Air; alpha = 0; beta = 0; alphaDot = 0; tas = 0; cas = 0; mach = 0; qbar = 0; nz = 1; agl = 0; groundH = 0;
  windNed: V3 = [0, 0, 0]; forceB: V3 = [0, 0, 0]; thrust = 0; fuelFlow = 0; CL = 0; CD = 0;
  gearLoad: number[]; onGround = false; stall = false; ydWash = 0; ydOut = 0; autobrakeCmd = 0; abDecel = 0;
  vRef = 0; gRef = 0; uOut = 0; // heavy FBW: trim reference speed (kt) and flight path (rad), and the elevator term (rad)
  // events
  crashed: CrashReason | null = null; crashT = 0; tailstrike = false; touchdowns: TouchdownEvent[] = []; airborneT = 0; maxNz = 1;
  surfaceUnder = SURF.PAVED; lastVs = 0;
  private _prevAlpha = 0;
  private _brk: number[];

  constructor(ac: AircraftData, opt: { start: Start; ground?: Ground; weather?: Weather; seed?: string; fixture?: Fixture }) {
    this.ac = ac; this.ground = opt.ground || flatGround(0); this.weather = opt.weather || CALM; this.seed = opt.seed ?? 'sfo-flight'; this.fx = opt.fixture || {};
    this.wind = new Wind(this.weather.wind, this.seed);
    const s = opt.start;
    this.mass = s.mass ?? ac.mass.ref.v;
    this.fuel = s.fuel ?? Math.min(ac.mass.fuelMax.v, Math.max(0, this.mass - ac.mass.empty.v) * 0.5);
    const ng = ac.gear.length;
    this.comp = new Array(ng).fill(0); this.bristleA = new Array(ng).fill(0); this.bristleS = new Array(ng).fill(0); this.wow = new Array(ng).fill(false); this.gearLoad = new Array(ng).fill(0);
    this._brk = new Array(ng).fill(0);
    if (ac.engine.kind === 'turbofan') this.n1 = new Array((ac.engine as FanDef).count).fill(s.n1 ?? (ac.engine as FanDef).n1Idle.v);
    this.flapIdx = s.flap ?? 0; this.flapDeg = ac.flaps.detents[this.flapIdx];
    this.gearPos = this.gearCmd = s.gear ?? 1;
    const hdg = s.hdg * DEG;
    this.air = atmosphere(0, this.weather.tempC - 15, this.weather.qnhHpa * 100);
    if (s.alt == null) {
      // on the ground: place the CG so every wheel sits at its static deflection
      const h0 = this.ground.height(s.n, s.e);
      const mainZ = ac.gear.filter((g) => g.brake).map((g) => g.pos[2] - g.staticDefl);
      const noseG = ac.gear.find((g) => !g.brake)!;
      const zc = mainZ.reduce((a, b) => a + b, 0) / mainZ.length;
      const xm = ac.gear.filter((g) => g.brake)[0].pos[0];
      const theta = Math.atan2((noseG.pos[2] - noseG.staticDefl) - zc, noseG.pos[0] - xm); // pitch that puts every wheel on the ground
      this.q = qFromEuler(hdg, theta, 0);
      this.pos = [s.n, s.e, -(h0 + zc * Math.cos(theta) - xm * Math.sin(theta))];
      this.vel = [0, 0, 0];
      this.running = s.engineOn !== false;
      this.rpm = this.running && ac.engine.kind === 'piston' ? (ac.engine as PistonDef).idleRpm.v : 0;
      this.trimPos = 0;
      this.gearPos = this.gearCmd = 1;
    } else {
      const air = atmosphere(s.alt, this.weather.tempC - 15, this.weather.qnhHpa * 100);
      const tas = tasFromCas((s.cas ?? 100) * KT, air);
      const gam = (s.gamma ?? 0) * DEG;
      this.pos = [s.n, s.e, -s.alt];
      this.vel = [tas * Math.cos(gam) * Math.cos(hdg), tas * Math.cos(gam) * Math.sin(hdg), -tas * Math.sin(gam)];
      this.q = qFromEuler(hdg, gam, 0);
      this.running = true;
      if (ac.engine.kind === 'piston') this.rpm = (ac.engine as PistonDef).rpmMax.v * 0.85;
    }
    this.update(neutralControls(ac), true);
  }

  get euler() { return eulerFromQ(this.q); }
  get inertia() {
    const k = this.mass / this.ac.mass.ref.v, I = this.ac.inertia;
    return { Ix: I.Ix.v * k, Iy: I.Iy.v * k, Iz: I.Iz.v * k, Ixz: I.Ixz.v * k };
  }
  // ground speed, vertical speed (fpm), heading of the velocity
  get gs(): number { return Math.hypot(this.vel[0], this.vel[1]); }
  get vsFpm(): number { return -this.vel[2] / FT * 60; }
  get altMsl(): number { return -this.pos[2]; }

  // one fixed step
  step(c: Controls): void {
    if (this.crashed) { this.t += DT; this.steps++; return; }
    this.update(c, false);
  }

  private actuators(c: Controls): void {
    const ac = this.ac, C = ac.controls, r = C.rate.v * DT;
    let eCmd = c.elev >= 0 ? c.elev * C.deDown.v : c.elev * C.deUp.v; // stick forward → trailing edge down
    // heavy FBW (C*U-style): with the stick near neutral, speed away from the trim reference speed pitches the
    // aircraft back toward it (positive speed stability, phugoid damping). The reference re-latches on trim-switch
    // use, stick inputs, flap movement, on the ground and below 100 ft (flare).
    const kU = ac.fcs.speedStab ?? 0;
    this.uOut = 0;
    if (kU > 0) {
      const relatch = this.onGround || this.agl < 100 * FT || Math.abs(c.elev) > 0.25 || c.trim !== 0 || Math.abs(this.flapDeg - ac.flaps.detents[clamp(Math.round(c.flap), 0, ac.flaps.detents.length - 1)]) > 0.01 || c.ap > 0 || this.vRef === 0;
      const Vg = Math.hypot(this.vel[0], this.vel[1], this.vel[2]);
      const gam = Vg > 1 ? Math.asin(clamp(-this.vel[2] / Vg, -1, 1)) : 0;
      if (relatch) { this.vRef = this.cas; this.gRef = gam; }
      else { this.uOut = clamp(-kU * (this.cas - this.vRef) * KT + (ac.fcs.pathStab ?? 0) * (gam - this.gRef), -0.08, 0.08); eCmd += this.uOut; }
    }
    this.de += clamp(eCmd - this.de, -r, r);
    this.da += clamp(clamp(c.ail, -1, 1) * C.da.v - this.da, -r, r);
    // yaw damper (heavy): washed-out yaw rate to rudder, airborne only
    let yd = 0;
    if (ac.fcs.yawDamper > 0) {
      const a = Math.exp(-DT / ac.fcs.yawDamperTau);
      this.ydWash = a * this.ydWash + (1 - a) * this.w[2];
      const rw = this.w[2] - this.ydWash;
      yd = this.onGround ? 0 : clamp(-ac.fcs.yawDamper * rw, -0.15, 0.15);
    }
    this.ydOut = yd;
    this.dr += clamp(clamp(c.rud, -1, 1) * C.dr.v + yd - this.dr, -r, r);
    this.trimPos = clamp(this.trimPos - clamp(c.trim, -1, 1) * C.trimRate * DT, C.trimRange[0], C.trimRange[1]); // trim +1 = nose up = trailing edge / stabilizer nose-up (negative)
    // flaps toward the selected detent
    const fi = clamp(Math.round(c.flap), 0, ac.flaps.detents.length - 1);
    this.flapIdx = fi;
    const ft = ac.flaps.detents[fi];
    this.flapDeg += clamp(ft - this.flapDeg, -ac.flaps.rate.v * DT, ac.flaps.rate.v * DT);
    // gear
    if (ac.gearRetract) {
      this.gearCmd = c.gear >= 0.5 ? 1 : 0;
      if (this.gearCmd === 0 && this.wow.some((w) => w)) this.gearCmd = 1; // squat switch
      this.gearPos += clamp(this.gearCmd - this.gearPos, -DT / ac.gearTransit, DT / ac.gearTransit);
    }
    // spoilers: armed (−1) deploy on main-gear touchdown with the levers near idle; else the lever
    let sp = Math.max(0, c.spoiler);
    const mains = ac.gear.map((g, i) => (g.brake ? this.wow[i] : false)).some((x) => x);
    if (c.spoiler < 0 && mains && c.thr.every((x) => x < 0.15)) sp = 1;
    this.spoilerPos += clamp(sp - this.spoilerPos, -DT / 1.5, DT / 0.8);
    // brakes (ramped), park, autobrake
    const pk = c.park > 0.5 ? 1 : 0;
    let bL = Math.max(c.brakeL, pk), bR = Math.max(c.brakeR, pk);
    const ab = ac.brakes.autobrake;
    if (ab && c.autobrake > 0 && mains && c.thr.every((x) => x < 0.15) && c.brakeL < 0.2 && c.brakeR < 0.2) {
      const target = ab[clamp(Math.round(c.autobrake), 1, ab.length) - 1];
      // along-track deceleration from the velocity change of the last step
      // to a full stop (Boeing autobrake holds until disarmed by the throttles or the pedals)
      const decel = this.abDecel;
      this.autobrakeCmd = this.gs < 3 * KT ? Math.max(this.autobrakeCmd, 0.6) : clamp(this.autobrakeCmd + (target - decel) * 0.4 * DT, 0, 1);
      bL = Math.max(bL, this.autobrakeCmd); bR = Math.max(bR, this.autobrakeCmd);
    } else if (!(c.autobrake > 0 && mains)) this.autobrakeCmd = 0;
    const br = DT / ac.brakes.rampS;
    this.brakeL += clamp(bL - this.brakeL, -br * 3, br); this.brakeR += clamp(bR - this.brakeR, -br * 3, br);
  }

  private engines(c: Controls, air: Air, ub: number): { F: V3; M: V3 } {
    const ac = this.ac, F: V3 = [0, 0, 0], M: V3 = [0, 0, 0];
    this.thrust = 0; this.fuelFlow = 0;
    if (ac.engine.kind === 'piston') {
      const E = ac.engine as PistonDef, D = E.propD.v;
      const wEng = Math.max(this.rpm, 0) * Math.PI / 30;
      // start / stop
      const fuelOk = this.fuel > 0 && c.mixture > 0.25;
      if (this.running && (!fuelOk || c.mags < 0.5)) this.running = false;
      if (!this.running && c.starter > 0.5 && c.master > 0.5) { this.starterT += DT; if (this.starterT > 1.2 && this.rpm > 150 && fuelOk && c.mags > 0.5) this.running = true; } else this.starterT = 0;
      const n = Math.max(this.rpm, 1) / 60;
      const J = clamp(Math.max(ub, 0) / (n * D), 0, 2);
      const cp = lerp1(E.cp, J), ct = lerp1(E.ct, J);
      const rho = air.rho;
      const Pprop = cp * rho * n * n * n * D ** 5;
      let T = ct * rho * n * n * D ** 4;
      const dens = clamp((air.sigma - 0.117) / 0.883, 0, 1.2); // Gagg–Ferrar
      const thrF = 0.06 + 0.94 * clamp(c.thr[0], 0, 1);
      const Peng = this.running ? E.powerW.v * dens * (this.rpm / E.rpmMax.v) * thrF * (c.mixture > 0.25 ? 1 : 0) : 0;
      const Pfric = E.powerW.v * 0.035 * (this.rpm / E.rpmMax.v) ** 2 + (this.rpm > 1 ? 150 : 0);
      const Pstart = !this.running && c.starter > 0.5 && c.master > 0.5 ? 2500 : 0;
      const wMin = 20;
      const Q = (Peng + Pstart - Pprop - Pfric) / Math.max(wEng, wMin);
      let wNew = wEng + Q / E.inertia.v * DT;
      if (wNew < 0) wNew = 0;
      this.rpm = wNew * 30 / Math.PI;
      if (this.rpm < 1 && !this.running) { this.rpm = 0; T = 0; }
      if (this.fx.noThrust) T = 0;
      this.thrust = T;
      this.fuelFlow = Peng * E.bsfc.v;
      F[0] += T;
      const Mp = cross(E.pos, [T, 0, 0]);
      M[0] += Mp[0] - (this.fx.noThrust ? 0 : Pprop / Math.max(wEng, wMin)) * 1.0; M[1] += Mp[1]; M[2] += Mp[2];
    } else {
      const E = ac.engine as FanDef;
      const idle = E.n1Idle.v, mx = E.n1Max.v;
      const Mach = this.mach;
      const lapse = Math.pow(air.sigma, E.densExp.v) * (1 + E.lapseM.v * Mach + E.lapseM2.v * Mach * Mach);
      for (let i = 0; i < E.count; i++) {
        const cmd = this.fuel > 0 ? idle + (mx - idle) * clamp(c.thr[i] ?? 0, 0, 1) : 10;
        const u = clamp((this.n1[i] - idle) / (mx - idle), 0, 1);
        const tau = E.tauIdle.v + (E.tau.v - E.tauIdle.v) * u;
        this.n1[i] += (cmd - this.n1[i]) * (1 - Math.exp(-DT / tau));
        const un = clamp((this.n1[i] - idle) / (mx - idle), 0, 1.05);
        const frac = this.n1[i] < idle ? E.idleFrac.v * clamp(this.n1[i] / idle, 0, 1) ** 2 : E.idleFrac.v + (1 - E.idleFrac.v) * Math.pow(un, E.thrustExp.v);
        let T = E.thrustN.v * frac * lapse;
        if (this.fx.noThrust) T = 0;
        this.thrust += T;
        this.fuelFlow += T * E.tsfc.v;
        const f: V3 = [T, 0, 0];
        F[0] += T;
        const m = cross(E.pos[i], f);
        M[0] += m[0]; M[1] += m[1]; M[2] += m[2];
      }
    }
    return { F, M };
  }

  // ground reaction: spring-damper struts with bristle friction; contacts (tail, tips, pods); crash checks
  private gearForces(c: Controls, Fned: V3, Mb: V3): void {
    const ac = this.ac, g = this.ground;
    let any = false;
    const wB = this.w;
    const brakeMu = ac.brakes.mu.v, muSide = ac.tyre.muSide.v, roll = ac.tyre.roll.v;
    for (let i = 0; i < ac.gear.length; i++) {
      const G = ac.gear[i];
      this.gearLoad[i] = 0;
      const ext = ac.gearRetract ? this.gearPos : 1;
      if (ext < 0.98) { this.wow[i] = false; this.comp[i] = 0; this.bristleA[i] = this.bristleS[i] = 0; continue; }
      const rB = G.pos;
      const P = rotate(this.q, rB);
      const pn = this.pos[0] + P[0], pe = this.pos[1] + P[1], pd = this.pos[2] + P[2];
      const h = g.height(pn, pe);
      const pen = pd + h; // > 0: wheel below the surface
      if (pen <= 0) { this.wow[i] = false; this.comp[i] = 0; this.bristleA[i] = this.bristleS[i] = 0; continue; }
      // surface normal from the height gradient (1 m central differences)
      const hn = (g.height(pn + 1, pe) - g.height(pn - 1, pe)) / 2, he = (g.height(pn, pe + 1) - g.height(pn, pe - 1)) / 2;
      const nl = Math.sqrt(hn * hn + he * he + 1);
      const Nup: V3 = [-hn / nl, -he / nl, -1 / nl];
      const surf = g.surface(pn, pe);
      if (surf === SURF.WATER) { this.crash('water'); return; }
      const vp = add3(this.vel, rotate(this.q, cross(wB, rB)));
      const k = gearRng(G, ac.mass.ref.v), cdamp = 2 * G.zeta * Math.sqrt(k * G.kShare * ac.mass.ref.v);
      const d = pen / nl;
      const ddot = -dot(vp, Nup);
      let Fn = k * d + cdamp * ddot;
      if (d > G.travel) Fn += k * 20 * (d - G.travel); // bottoming
      if (Fn < 0) Fn = 0;
      this.comp[i] = d; this.gearLoad[i] = Fn; this.wow[i] = true; any = true;
      // wheel axes on the surface
      let steer = 0;
      if (G.steerMax) steer = clamp(c.rud, -1, 1) * G.steerMax + (G.tillerMax ? clamp(c.tiller, -1, 1) * G.tillerMax : 0);
      const fw = rotate(this.q, [Math.cos(steer), Math.sin(steer), 0]);
      const fdn = dot(fw, Nup);
      let f: V3 = [fw[0] - fdn * Nup[0], fw[1] - fdn * Nup[1], fw[2] - fdn * Nup[2]];
      const fl = Math.hypot(f[0], f[1], f[2]) || 1; f = [f[0] / fl, f[1] / fl, f[2] / fl];
      const right = cross(f, Nup); // forward × up-normal = right
      const va = dot(vp, f), vs = dot(vp, right);
      const surfRoll = surf === SURF.PAVED ? roll : roll * 2.5;
      // rolling resistance (Coulomb, smoothed)
      let Fa = -clamp(va / 0.3, -1, 1) * surfRoll * Fn;
      // brake: bristle (stiction) model so a braked wheel holds against idle thrust and slopes
      const b = G.brake === 'L' ? this.brakeL : G.brake === 'R' ? this.brakeR : 0;
      const capA = brakeMu * b * Fn * (surf === SURF.PAVED ? 1 : 0.7);
      if (capA > 1) {
        const kb = capA / 0.02;
        this.bristleA[i] += va * DT;
        let f1 = -kb * this.bristleA[i] - (capA / 0.3) * va;
        if (Math.abs(f1) > capA) { f1 = Math.sign(f1) * capA; this.bristleA[i] = -f1 / kb; }
        Fa += f1;
        this._brk[i] = f1;
      } else { this.bristleA[i] = 0; this._brk[i] = 0; }
      // side force: bristle model, saturating at μ N
      const capS = muSide * Fn * (surf === SURF.PAVED ? 1 : 0.8);
      const ks = capS / 0.03;
      this.bristleS[i] += vs * DT;
      let Fs = -ks * this.bristleS[i] - (capS / 0.3) * vs;
      if (Math.abs(Fs) > capS) { Fs = Math.sign(Fs) * capS; this.bristleS[i] = -Fs / ks; }
      const Fw: V3 = [Nup[0] * Fn + f[0] * Fa + right[0] * Fs, Nup[1] * Fn + f[1] * Fa + right[1] * Fs, Nup[2] * Fn + f[2] * Fa + right[2] * Fs];
      Fned[0] += Fw[0]; Fned[1] += Fw[1]; Fned[2] += Fw[2];
      const Fb = unrotate(this.q, Fw);
      const m = cross(rB, Fb);
      Mb[0] += m[0]; Mb[1] += m[1]; Mb[2] += m[2];
    }
    // contacts: tail, wingtips, nacelles, prop, nose, belly
    for (const C of ac.contacts) {
      if (C.kind === 'belly' && (!ac.gearRetract || this.gearPos > 0.5)) continue;
      const P = rotate(this.q, C.pos);
      const pn = this.pos[0] + P[0], pe = this.pos[1] + P[1], pd = this.pos[2] + P[2];
      const h = g.height(pn, pe), pen = pd + h;
      if (pen <= 0) continue;
      if (g.surface(pn, pe) === SURF.WATER) { this.crash('water'); return; }
      const vp = add3(this.vel, rotate(this.q, cross(wB, C.pos)));
      if (C.kind === 'tail' && pen < 0.5 && vp[2] < 3) {
        // a scrape: stiff contact and sliding friction, flagged
        this.tailstrike = true;
        const Fn = Math.max(0, this.mass * G0 * 2 * pen / 0.1 + this.mass * 2 * vp[2]);
        const Fw: V3 = [-vp[0] / (Math.hypot(vp[0], vp[1]) + 0.3) * 0.5 * Fn, -vp[1] / (Math.hypot(vp[0], vp[1]) + 0.3) * 0.5 * Fn, -Fn];
        Fned[0] += Fw[0]; Fned[1] += Fw[1]; Fned[2] += Fw[2];
        const m = cross(C.pos, unrotate(this.q, Fw)); Mb[0] += m[0]; Mb[1] += m[1]; Mb[2] += m[2];
        continue;
      }
      this.crash(C.kind === 'belly' ? 'gear-up' : C.kind === 'nacelle' ? 'nacelle' : C.kind === 'wingtip' ? 'wingtip' : C.kind === 'prop' ? 'prop' : C.kind === 'nose' ? 'nose' : 'terrain');
      return;
    }
    // the fuselage itself (the CG sphere) and buildings
    const hc = g.height(this.pos[0], this.pos[1]);
    if (-this.pos[2] < hc + 0.2 && !any) { this.crash('terrain'); return; }
    for (const p of [[0, 0, 0], ...ac.contacts.filter((x) => x.kind === 'wingtip' || x.kind === 'nose' || x.kind === 'tail').map((x) => x.pos)] as V3[]) {
      const P = rotate(this.q, p);
      const roof = g.roof(this.pos[0] + P[0], this.pos[1] + P[1]);
      if (roof > -1e9 && -(this.pos[2] + P[2]) < roof) { this.crash('building'); return; }
    }
    this.onGround = any;
  }

  crash(r: CrashReason): void { if (!this.crashed) { this.crashed = r; this.crashT = this.t; this.vel = [0, 0, 0]; this.w = [0, 0, 0]; } }

  // forces, moments, integration; `init` evaluates without advancing time
  private update(c: Controls, init: boolean): void {
    const ac = this.ac;
    const h = -this.pos[2];
    const air = (this.air = atmosphere(h, this.weather.tempC - 15, this.weather.qnhHpa * 100));
    this.groundH = this.ground.height(this.pos[0], this.pos[1]);
    this.agl = h - Math.max(this.groundH, 0) - ac.model.gearGround;
    this.surfaceUnder = this.ground.surface(this.pos[0], this.pos[1]);
    // air-relative velocity
    const wind = init ? this.wind.mean(Math.max(this.agl, 1), [0, 0, 0]) : this.wind.step(Math.max(this.agl, 1), this.tas, DT, [0, 0, 0]);
    this.windNed = [wind[0], wind[1], wind[2]];
    const va: V3 = [this.vel[0] - wind[0], this.vel[1] - wind[1], this.vel[2] - wind[2]];
    const vb = unrotate(this.q, va);
    const V = Math.sqrt(vb[0] * vb[0] + vb[1] * vb[1] + vb[2] * vb[2]);
    this.tas = V; this.mach = V / air.a; this.cas = casFromTas(V, air) / KT;
    const alpha = V > 0.5 ? Math.atan2(vb[2], vb[0]) : 0;
    const beta = V > 0.5 ? Math.asin(clamp(vb[1] / V, -1, 1)) : 0;
    if (!init) { const raw = (alpha - this._prevAlpha) / DT; this.alphaDot += (clamp(raw, -2, 2) - this.alphaDot) * 0.25; }
    this._prevAlpha = alpha;
    this.alpha = alpha; this.beta = beta;
    const qbar = (this.qbar = 0.5 * air.rho * V * V);
    if (!init) this.actuators(c); // after the air data: the FBW terms read this step's airspeed
    const A = ac.aero, S = ac.geom.S.v, b = ac.geom.b.v, cb = ac.geom.cbar.v;
    const Vn = Math.max(V, 5);
    const ph = this.w[0] * b / (2 * Vn), qh = this.w[1] * cb / (2 * Vn), rh = this.w[2] * b / (2 * Vn);
    const aDeg = alpha / DEG;
    // ground effect: wing height above the surface (≈ gear-ground height of the CG)
    const hw = Math.max(0.1, h - Math.max(this.groundH, 0) - 0.4 * ac.model.gearGround);
    const x16 = (16 * hw / b) ** 2, phi = x16 / (1 + x16);
    const sp = this.spoilerPos;
    let CL = lerp2(A.CL, aDeg, this.flapDeg) * (1 + A.geLift.v * (1 - phi)) + A.CLq.v * qh + A.CLadot.v * this.alphaDot * cb / (2 * Vn) + A.CLde.v * this.de + A.CLtrim.v * this.trimPos;
    if (A.spoiler) CL += A.spoiler.CL.v * sp;
    if (this.fx.noLift) CL = 0;
    let CD = A.CD0.v + A.K.v * phi * CL * CL + lerp1(A.CDflap, this.flapDeg) + A.CDgear.v * (ac.gearRetract ? this.gearPos : 1) + lerp1(A.CDalpha, Math.abs(aDeg)) + A.CDbeta.v * beta * beta;
    if (A.spoiler) CD += A.spoiler.CD.v * sp;
    if (this.fx.noDrag) CD = 0;
    this.CL = CL; this.CD = CD;
    const CY = A.CYb.v * beta + A.CYp.v * ph + A.CYr.v * rh + A.CYdr.v * this.dr;
    const trimE = ac.controls.trimIsStab ? 0 : this.trimPos; // tab trim acts as elevator
    const Cl = A.Clb.v * beta + lerp1(A.Clp, aDeg) * ph + A.Clr.v * rh + A.Clda.v * this.da + A.Cldr.v * this.dr;
    const Cm = lerp1(A.Cm0, this.flapDeg) + A.Cma.v * alpha + A.Cmq.v * qh + A.Cmadot.v * this.alphaDot * cb / (2 * Vn) + A.Cmde.v * (this.de + trimE) + (ac.controls.trimIsStab ? A.Cmtrim.v * this.trimPos : 0)
      + lerp1(A.CmStall, aDeg) + A.CmGround.v * (1 - phi) + (A.spoiler ? A.spoiler.Cm.v * sp : 0);
    const Cn = A.Cnb.v * beta + A.Cnp.v * ph + A.Cnr.v * rh + A.Cnda.v * this.da + A.Cndr.v * this.dr;
    this.stall = aDeg > lerp2Peak(A.CL, this.flapDeg) - 2;
    // body forces: drag along −v, lift ⊥ v in the symmetry plane, side force along y
    const Fb: V3 = [0, 0, 0];
    if (V > 0.5) {
      const L = qbar * S * CL, Dg = qbar * S * CD, Y = qbar * S * CY;
      const ex = vb[0] / V, ey = vb[1] / V, ez = vb[2] / V;
      Fb[0] += -Dg * ex + L * Math.sin(alpha); Fb[1] += -Dg * ey + Y; Fb[2] += -Dg * ez - L * Math.cos(alpha);
    }
    const Mb: V3 = this.fx.noAeroMoments ? [0, 0, 0] : [qbar * S * b * Cl, qbar * S * cb * Cm, qbar * S * b * Cn];
    const E = this.engines(c, air, vb[0]);
    Fb[0] += E.F[0]; Fb[1] += E.F[1]; Fb[2] += E.F[2];
    Mb[0] += E.M[0]; Mb[1] += E.M[1]; Mb[2] += E.M[2];
    // world forces: aero + thrust rotated, gravity, gear
    const Fn = rotate(this.q, Fb);
    Fn[2] += this.mass * G0;
    const wowBefore = this.wow.some((x) => x);
    const vzBefore = this.vel[2];
    if (!this.fx.noGround) this.gearForces(c, Fn, Mb);
    if (this.crashed) return;
    // specific force along body z (load factor) — aero + thrust + gear
    const Fspec = unrotate(this.q, [Fn[0], Fn[1], Fn[2] - this.mass * G0]);
    this.nz = -Fspec[2] / (this.mass * G0);
    this.forceB = Fb;
    if (init) return;
    if (this.nz > this.maxNz) this.maxNz = this.nz;
    // touchdown event: first main-gear contact after 3 s airborne
    const mainsNow = this.ac.gear.some((G, i) => G.brake && this.wow[i]);
    if (!wowBefore && mainsNow && this.airborneT > 3) {
      const e = this.euler;
      const td: TouchdownEvent = { t: this.t, n: this.pos[0], e: this.pos[1], sinkFpm: vzBefore / FT * 60, cas: this.cas, gs: this.gs / KT, hdg: ((e.psi / DEG) + 360) % 360, pitch: e.theta / DEG, bank: e.phi / DEG, nz: this.nz, surface: this.ground.surface(this.pos[0], this.pos[1]) };
      this.touchdowns.push(td);
      if (td.sinkFpm > ac.limits.sinkCrashFpm) { this.crash('hard-landing'); return; }
    }
    this.airborneT = this.onGround ? 0 : this.airborneT + DT;
    if (this.nz > ac.limits.nzCrash || this.nz < -ac.limits.nzCrash * 0.4) { this.crash('overstress'); return; }
    // translation: semi-implicit Euler with the trapezoid position update (exact for constant acceleration)
    const m = this.mass;
    const v0: V3 = [this.vel[0], this.vel[1], this.vel[2]];
    this.vel = [v0[0] + Fn[0] / m * DT, v0[1] + Fn[1] / m * DT, v0[2] + Fn[2] / m * DT];
    this.pos = [this.pos[0] + (v0[0] + this.vel[0]) * 0.5 * DT, this.pos[1] + (v0[1] + this.vel[1]) * 0.5 * DT, this.pos[2] + (v0[2] + this.vel[2]) * 0.5 * DT];
    // along-track deceleration for the autobrake
    const gs0 = Math.hypot(v0[0], v0[1]), gs1 = Math.hypot(this.vel[0], this.vel[1]);
    this.abDecel = (gs0 - gs1) / DT;
    // rotation: Euler's equations with the xz product of inertia
    const I = this.inertia, w = this.w;
    const Iw: V3 = [I.Ix * w[0] - I.Ixz * w[2], I.Iy * w[1], -I.Ixz * w[0] + I.Iz * w[2]];
    const gyro = cross(w, Iw);
    const L = Mb[0] - gyro[0], M = Mb[1] - gyro[1], N = Mb[2] - gyro[2];
    const det = I.Ix * I.Iz - I.Ixz * I.Ixz;
    const pd = (I.Iz * L + I.Ixz * N) / det, qd = M / I.Iy, rd = (I.Ixz * L + I.Ix * N) / det;
    const w0: V3 = [w[0], w[1], w[2]];
    this.w = [w[0] + pd * DT, w[1] + qd * DT, w[2] + rd * DT];
    this.q = qIntegrate(this.q, [(w0[0] + this.w[0]) / 2, (w0[1] + this.w[1]) / 2, (w0[2] + this.w[2]) / 2], DT);
    // fuel
    this.fuel = Math.max(0, this.fuel - this.fuelFlow * DT);
    this.mass = Math.max(this.ac.mass.empty.v, this.mass - this.fuelFlow * DT);
    this.lastVs = -this.vel[2];
    this.t += DT; this.steps++;
    if (!Number.isFinite(this.pos[0] + this.pos[1] + this.pos[2] + this.w[0] + this.w[1] + this.w[2])) this.crash('overstress');
  }

  // a deep copy of the dynamic state (shares the aircraft data and the ground): for the linearization of gate F3
  // and for "what-if" probes; the copy steps independently
  clone(): Sim {
    const o = Object.create(Sim.prototype) as Sim;
    for (const [k, v] of Object.entries(this)) (o as any)[k] = Array.isArray(v) ? v.map((x) => (Array.isArray(x) ? x.slice() : x)) : v;
    o.wind = Object.assign(Object.create(Object.getPrototypeOf(this.wind)), this.wind, { rng: Object.assign(Object.create(Object.getPrototypeOf(this.wind.rng)), this.wind.rng) });
    (o as any)._prevAlpha = (this as any)._prevAlpha;
    return o;
  }
  setPrevAlpha(a: number): void { this._prevAlpha = a; }
  // take over a trimmed state (attitude, rates, surfaces, engines, FBW references) from another Sim flown in calm
  // air, placed at this sim's start position, with the mean wind added to the velocity
  adopt(t: Sim): void {
    const pos = this.pos;
    for (const k of ['q', 'w', 'de', 'da', 'dr', 'trimPos', 'flapDeg', 'flapIdx', 'gearPos', 'gearCmd', 'spoilerPos', 'rpm', 'running', 'n1', 'alphaDot', 'vRef', 'gRef', 'ydWash', 'mass', 'fuel'] as const) {
      const v = (t as any)[k]; (this as any)[k] = Array.isArray(v) ? v.slice() : v;
    }
    this._prevAlpha = (t as any)._prevAlpha;
    const hdgT = t.euler.psi, hdg = this.euler.psi;
    void hdgT; void hdg;
    const agl = -pos[2] - Math.max(this.ground.height(pos[0], pos[1]), 0);
    const wm = this.wind.mean(Math.max(agl, 1), [0, 0, 0]);
    this.vel = [t.vel[0] + wm[0], t.vel[1] + wm[1], t.vel[2] + wm[2]];
    this.update(neutralControls(this.ac), true);
  }

  // the render model's origin (main-gear ground point) in NED, and the attitude — what the render layer reads
  renderOrigin(): V3 {
    const mains = this.ac.gear.filter((g) => g.brake);
    const x = mains[0].pos[0], z = mains.reduce((a, g, i) => a + g.pos[2] - (this.comp[this.ac.gear.indexOf(g)] || 0), 0) / mains.length;
    const P = rotate(this.q, [x, 0, z]);
    return [this.pos[0] + P[0], this.pos[1] + P[1], this.pos[2] + P[2]];
  }
}

function add3(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
// alpha (deg) of the lift peak for a flap setting
const peakCache = new WeakMap<object, Map<number, number>>();
function lerp2Peak(t: { rows: (number | string)[][]; cols: number[] }, flap: number): number {
  let m = peakCache.get(t); if (!m) { m = new Map(); peakCache.set(t, m); }
  const key = Math.round(flap * 10); const hit = m.get(key); if (hit != null) return hit;
  let best = -1e9, ab = 0;
  for (let a = 0; a <= 30; a += 0.25) { const v = lerp2(t as never, a, flap); if (v > best) { best = v; ab = a; } }
  m.set(key, ab); return ab;
}
