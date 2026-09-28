// The data an aircraft brings to the flight model. Every number is a tagged Scalar or a tagged table row
// (fdm/table.ts): source id (key of `sources`) and VERIFIED (read from the source) / APPROX (derived or tuned, with
// the rule in the note). Sign conventions (ours, not the sources'): body x forward, y right, z down; δe > 0 trailing
// edge down (nose down), δa > 0 rolls right, δr > 0 yaws right (right pedal). Rates non-dimensional as
// p̂ = p b / 2V, q̂ = q c̄ / 2V, r̂ = r b / 2V. Derivatives per radian.
import type { Scalar, Table1, Table2 } from '../table.ts';
import type { V3 } from '../math.ts';

export interface GearDef {
  id: string; pos: V3; // wheel bottom at full extension, body frame from the CG, m
  kShare: number; // share of the reference weight this strut carries at rest (sets the spring)
  staticDefl: number; zeta: number; travel: number; // m, damping ratio, max stroke m
  steerMax?: number; // rad (pedal range); tillerMax: rad below `tillerKt`
  tillerMax?: number; brake: 'L' | 'R' | null;
}
export interface Contact { id: string; pos: V3; kind: 'tail' | 'wingtip' | 'nacelle' | 'prop' | 'nose' | 'belly' }

export interface PistonDef {
  kind: 'piston'; powerW: Scalar; rpmMax: Scalar; idleRpm: Scalar; propD: Scalar; inertia: Scalar;
  cp: Table1; ct: Table1; // vs advance ratio J
  bsfc: Scalar; // kg/J
  pos: V3;
}
export interface FanDef {
  kind: 'turbofan'; count: number; thrustN: Scalar; n1Idle: Scalar; n1Max: Scalar; tau: Scalar; tauIdle: Scalar;
  thrustExp: Scalar; lapseM: Scalar; lapseM2: Scalar; densExp: Scalar; idleFrac: Scalar; tsfc: Scalar;
  pos: V3[]; // per engine, body frame m
}

export interface AircraftData {
  id: string; name: string; icao: string;
  sources: Record<string, string>;
  geom: { S: Scalar; b: Scalar; cbar: Scalar; length: Scalar };
  mass: { empty: Scalar; mtow: Scalar; mlw: Scalar; fuelMax: Scalar; ref: Scalar };
  inertia: { Ix: Scalar; Iy: Scalar; Iz: Scalar; Ixz: Scalar }; // kg m² at mass.ref, scaled with mass
  flaps: { detents: number[]; rate: Scalar; vfe: number[] }; // deg, deg/s, KIAS per detent
  gearRetract: boolean; gearTransit: number; // s
  controls: { deUp: Scalar; deDown: Scalar; da: Scalar; dr: Scalar; rate: Scalar; trimRange: [number, number]; trimRate: number; trimIsStab: boolean };
  aero: {
    CL: Table2; // alpha deg × flap deg (includes stall)
    CLq: Scalar; CLadot: Scalar; CLde: Scalar; CLtrim: Scalar;
    CD0: Scalar; K: Scalar; CDflap: Table1; CDgear: Scalar; CDalpha: Table1; CDbeta: Scalar;
    CYb: Scalar; CYp: Scalar; CYr: Scalar; CYdr: Scalar;
    Clb: Scalar; Clp: Table1; Clr: Scalar; Clda: Scalar; Cldr: Scalar;
    Cm0: Table1; Cma: Scalar; Cmq: Scalar; Cmadot: Scalar; Cmde: Scalar; Cmtrim: Scalar; CmStall: Table1; CmGround: Scalar; CmGear: Scalar;
    Cnb: Scalar; Cnp: Scalar; Cnr: Scalar; Cnda: Scalar; Cndr: Scalar;
    geOswaldK: Scalar; // ground effect: induced-drag factor φ = (16h/b)² / (1 + (16h/b)²)
    geLift: Scalar; // ground effect: lift-slope increase at h = 0 (fraction)
    spoiler?: { CL: Scalar; CD: Scalar; Cl: Scalar; Cm: Scalar };
  };
  engine: PistonDef | FanDef;
  gear: GearDef[];
  contacts: Contact[];
  brakes: { mu: Scalar; rampS: number; autobrake?: number[] }; // autobrake decel m/s² for settings 1..MAX
  tyre: { muSide: Scalar; roll: Scalar };
  fcs: { yawDamper: number; yawDamperTau: number; turnCoord: number };
  vspeeds: Record<string, number>; // KIAS, for the UI and the scripted pilots
  limits: { vne: number; nzCrash: number; sinkCrashFpm: number; sinkHardFpm: number };
  pilotEye: V3; // body frame, m
  model: { gearGround: number }; // m below the CG of the render model's origin (main-gear ground point)
}
