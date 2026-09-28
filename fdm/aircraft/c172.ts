// Light single, C172-class (Cessna 172S). Performance anchors from the POH (SPEC-THRESHOLDS F2); stability
// derivatives from the Navion general-aviation set in Nelson App. B Table B.1 (Teper 1969) — the published GA-class
// data the session could read; the C172's own geometry, masses, prop and speeds from the POH. Signs converted to
// fdm conventions (types.ts): Nelson's δa > 0 rolls left and δr > 0 yaws left, so Clδa, Cnδa, CYδr, Clδr, Cnδr flip;
// δe > 0 is trailing edge down in both.
import { S } from '../table.ts';
import type { AircraftData } from './types.ts';
import * as D from '../dmath.ts';

const LB = 0.45359237, FT = 0.3048, SLUGFT2 = 1.3558179, DG = Math.PI / 180;
const V = 'VERIFIED', A = 'APPROX';

export const C172: AircraftData = {
  id: 'c172', name: 'Cessna 172S Skyhawk (class)', icao: 'C172',
  sources: {
    POH: 'Cessna Model 172S Pilot\'s Operating Handbook, 8 July 1998, Revision 5 (19 July 2004): Section 1, Section 2, Figures 5-3, 5-5, 5-6, 5-11',
    NAV: 'R. C. Nelson, Flight Stability and Automatic Control (2nd ed.), Appendix B Table B.1, general aviation airplane (Navion), sea level, per radian; after G. L. Teper, STI TR 176-1 (1969)',
    GEN: 'Derived in this repo from the cited values by the rule in the note (docs: DECISIONS.md)',
    MIL: 'MIL-F-8785C (public domain), turbulence scales and handling criteria',
    TUNE: 'Fitted in this repo to the frozen POH performance targets (SPEC-THRESHOLDS.md F2); fit recorded in DECISIONS.md',
    MCC: 'B. W. McCormick, Aerodynamics, Aeronautics and Flight Mechanics (Wiley 1979), ground effect φ = (16h/b)² / (1 + (16h/b)²)',
  },
  geom: {
    S: S(174 * FT * FT, 'POH', V, 'wing area 174 sq ft (Sec. 1 note 4)'),
    b: S((36 + 1 / 12) * FT, 'POH', V, 'span 36 ft 1 in (Sec. 1 drawing)'),
    cbar: S(1.49, 'GEN', A, 'S / b × 1.01 (constant-chord inner wing)'),
    length: S((27 + 2 / 12) * FT, 'POH', V, 'length 27 ft 2 in'),
  },
  mass: {
    empty: S(1663 * LB, 'POH', V, 'standard empty weight 1,663 lb'),
    mtow: S(2550 * LB, 'POH', V, 'max takeoff weight 2,550 lb'),
    mlw: S(2550 * LB, 'POH', V, 'max landing weight 2,550 lb'),
    fuelMax: S(53 * 6 * LB, 'POH', V, '53 US gal usable × 6 lb/gal'),
    ref: S(2550 * LB, 'POH', V, 'reference mass for inertia and gear = MTOW'),
  },
  inertia: {
    Ix: S(1048 * SLUGFT2 * (2550 / 2750) * D.pow(11.0 / 10.18, 2), 'NAV', A, 'Navion Ix 1,048 slug ft² scaled by mass × span²'),
    Iy: S(3000 * SLUGFT2 * (2550 / 2750) * D.pow(8.28 / 8.33, 2), 'NAV', A, 'Navion Iy 3,000 slug ft² scaled by mass × length²'),
    Iz: S(3530 * SLUGFT2 * (2550 / 2750) * 1.08, 'NAV', A, 'Navion Iz 3,530 slug ft² scaled by mass × (span² + length²)/2'),
    Ixz: S(0, 'NAV', V, 'Navion Ixz = 0'),
  },
  flaps: { detents: [0, 10, 20, 30], rate: S(3.5, 'GEN', A, 'electric flaps, about 9 s 0→30°'), vfe: [163, 110, 85, 85] },
  gearRetract: false, gearTransit: 0,
  controls: {
    deUp: S(28 * DG, 'GEN', A, 'FAA TCDS 3A12 travel (elevator 28° up), from memory, not re-read'),
    deDown: S(23 * DG, 'GEN', A, 'FAA TCDS 3A12 travel (elevator 23° down), from memory'),
    da: S(17.5 * DG, 'GEN', A, 'mean of 20° up / 15° down (TCDS 3A12, from memory)'),
    dr: S(17 * DG, 'GEN', A, 'TCDS 3A12 about 17° either side, from memory'),
    rate: S(2.0, 'GEN', A, 'rad/s, cable controls: pilot-limited'),
    trimRange: [-0.25, 0.25], trimRate: 0.10, trimIsStab: false,
  },
  aero: {
    CL: { x: 'alpha', col: 'flap', cols: [0, 10, 20, 30], rows: [
      // CL0 + CLα α to 3.5° before the peak, quadratic cap to CLmax, post-stall drop, flat plate (GEN rule);
      // CLα 4.44 /rad [NAV, VERIFIED]; CLmax from the POH stall speeds: 1.54 / 1.73 / 1.81 / 1.88 [POH → GEN]
      [-20, -0.810, -0.570, -0.410, -0.290, 'GEN', A],
      [-12, -0.650, -0.410, -0.250, -0.130, 'GEN', A],
      [-8, -0.340, -0.100, 0.060, 0.180, 'GEN', A],
      [-4, -0.030, 0.210, 0.370, 0.490, 'GEN', A],
      [0, 0.280, 0.520, 0.680, 0.800, 'GEN', A],
      [4, 0.590, 0.830, 0.990, 1.110, 'GEN', A],
      [8, 0.900, 1.140, 1.300, 1.420, 'GEN', A],
      [10, 1.055, 1.295, 1.455, 1.575, 'GEN', A],
      [12, 1.210, 1.450, 1.610, 1.730, 'GEN', A],
      [13, 1.288, 1.528, 1.687, 1.800, 'GEN', A],
      [14, 1.365, 1.605, 1.750, 1.849, 'GEN', A],
      [15, 1.440, 1.668, 1.790, 1.875, 'GEN', A],
      [16, 1.495, 1.709, 1.809, 1.847, 'GEN', A],
      [17, 1.529, 1.729, 1.743, 1.744, 'GEN', A],
      [18, 1.540, 1.669, 1.644, 1.641, 'GEN', A],
      [19, 1.456, 1.574, 1.544, 1.537, 'GEN', A],
      [20, 1.371, 1.479, 1.445, 1.449, 'GEN', A],
      [22, 1.202, 1.316, 1.323, 1.338, 'GEN', A],
      [24, 1.125, 1.211, 1.216, 1.228, 'GEN', A],
      [30, 0.896, 0.896, 0.896, 0.896, 'GEN', A],
      [45, 1.150, 1.150, 1.150, 1.150, 'GEN', A],
      [60, 0.996, 0.996, 0.996, 0.996, 'GEN', A],
      [90, 0.000, 0.000, 0.000, 0.000, 'GEN', A],
    ] },
    CLq: S(3.8, 'NAV', V), CLadot: S(0, 'NAV', V), CLde: S(0.355, 'NAV', V), CLtrim: S(0.355, 'NAV', V, 'trim acts as elevator'),
    CD0: S(0.031, 'TUNE', A, 'fitted to 126 KTAS max at S.L. [POH Sec. 1]'),
    K: S(1 / (Math.PI * 0.75 * 7.485), 'GEN', A, 'Oswald e 0.75, AR 7.485 from POH span and area'),
    CDflap: { x: 'flap', rows: [[0, 0, 'GEN', A], [10, 0.008, 'TUNE', A], [20, 0.022, 'TUNE', A], [30, 0.040, 'TUNE', A]] },
    CDgear: S(0, 'GEN', A, 'fixed gear, inside CD0'),
    CDalpha: { x: 'alpha', rows: [[0, 0, 'GEN', A], [16, 0, 'GEN', A], [20, 0.10, 'GEN', A], [24, 0.22, 'GEN', A], [30, 0.45, 'GEN', A], [45, 0.9, 'GEN', A], [90, 1.3, 'GEN', A]] },
    CDbeta: S(0.4, 'GEN', A, 'ΔCD = CDβ β² (fuselage side area)'),
    CYb: S(-0.564, 'NAV', V), CYp: S(0, 'NAV', V, 'not given (Nelson: 0)'), CYr: S(0, 'NAV', V, 'not given (Nelson: 0)'), CYdr: S(-0.157, 'NAV', V, 'sign flipped'),
    Clb: S(-0.074, 'NAV', V),
    Clp: { x: 'alpha', rows: [[-10, -0.41, 'NAV', V], [15, -0.41, 'NAV', V], [19, -0.20, 'GEN', A], [24, -0.08, 'GEN', A], [90, -0.05, 'GEN', A]] },
    Clr: S(0.107, 'NAV', V), Clda: S(0.134, 'NAV', V, 'sign flipped'),
    Cldr: S(-0.0185, 'GEN', A, 'CYδr × z_fin / b = 0.157 × 1.2 / 10.18; the published 0.107 is inconsistent with CYδr and the geometry (DECISIONS)'),
    Cm0: { x: 'flap', rows: [[0, 0.034, 'GEN', A], [10, 0.044, 'GEN', A], [20, 0.034, 'GEN', A], [30, 0.024, 'GEN', A]] },
    Cma: S(-0.683, 'NAV', V), Cmq: S(-9.96, 'NAV', V), Cmadot: S(-4.36, 'NAV', V), Cmde: S(-0.923, 'NAV', V), Cmtrim: S(-0.923, 'NAV', V, 'trim acts as elevator'),
    CmStall: { x: 'alpha', rows: [[0, 0, 'GEN', A], [17, 0, 'GEN', A], [20, -0.08, 'GEN', A], [25, -0.2, 'GEN', A], [30, -0.3, 'GEN', A], [90, -0.5, 'GEN', A]] },
    CmGround: S(-0.03, 'GEN', A, 'nose-down in ground effect'), CmGear: S(0, 'GEN', A),
    Cnb: S(0.071, 'NAV', V), Cnp: S(-0.0575, 'NAV', V), Cnr: S(-0.125, 'NAV', V), Cnda: S(0.0035, 'NAV', V, 'sign flipped'), Cndr: S(0.072, 'NAV', V, 'sign flipped'),
    geOswaldK: S(1, 'MCC', V), geLift: S(0.12, 'MCC', A, 'lift slope +12 % at the ground'),
  },
  engine: {
    kind: 'piston',
    powerW: S(180 * 745.7, 'POH', V, 'IO-360-L2A 180 BHP at 2,700 RPM'),
    rpmMax: S(2700, 'POH', V), idleRpm: S(650, 'GEN', A),
    propD: S(76 * 0.0254, 'POH', V, 'fixed pitch 76 in'),
    inertia: S(2.2, 'GEN', A, 'kg m², prop + crank'),
    cp: { x: 'J', rows: [[0, 0.0591, 'TUNE', A], [0.2, 0.0581, 'TUNE', A], [0.4, 0.0550, 'TUNE', A], [0.6, 0.0498, 'TUNE', A], [0.8, 0.0427, 'TUNE', A], [1.0, 0.0334, 'TUNE', A], [1.2, 0.0221, 'TUNE', A], [1.4, 0.0087, 'TUNE', A], [2.0, -0.04, 'TUNE', A]] },
    ct: { x: 'J', rows: [[0, 0.0957, 'TUNE', A], [0.2, 0.0919, 'TUNE', A], [0.4, 0.0804, 'TUNE', A], [0.6, 0.0614, 'TUNE', A], [0.8, 0.0346, 'TUNE', A], [1.0, 0.0003, 'TUNE', A], [1.2, -0.04, 'TUNE', A], [1.4, -0.09, 'TUNE', A], [2.0, -0.2, 'TUNE', A]] },
    bsfc: S(0.45 * LB / (745.7 * 3600), 'GEN', A, '0.45 lb/hp/h'),
    pos: [1.9, 0, 0.3],
  },
  gear: [
    { id: 'nose', pos: [1.39, 0, 1.14], kShare: 0.16, staticDefl: 0.10, zeta: 0.6, travel: 0.16, steerMax: 10 * DG, brake: null },
    { id: 'left', pos: [-0.262, -1.2, 1.13], kShare: 0.42, staticDefl: 0.09, zeta: 0.6, travel: 0.14, brake: 'L' },
    { id: 'right', pos: [-0.262, 1.2, 1.13], kShare: 0.42, staticDefl: 0.09, zeta: 0.6, travel: 0.14, brake: 'R' },
  ],
  contacts: [
    { id: 'prop', pos: [1.95, 0, 0.754], kind: 'prop' },
    { id: 'tail', pos: [-5.2, 0, 0.04], kind: 'tail' }, // tie-down about 1 m above the ground: strikes near 11° pitch
    { id: 'wingL', pos: [-0.3, -5.5, -1.2], kind: 'wingtip' },
    { id: 'wingR', pos: [-0.3, 5.5, -1.2], kind: 'wingtip' },
  ],
  brakes: { mu: S(0.45, 'TUNE', A, 'effective braking friction, fitted to the POH landing roll'), rampS: 0.6 },
  tyre: { muSide: S(0.75, 'GEN', A), roll: S(0.02, 'GEN', A, 'paved') },
  fcs: { yawDamper: 0, yawDamperTau: 1, turnCoord: 0 },
  vspeeds: { vr: 51, vx: 62, vy: 74, vapp: 65, vappShort: 61, vs0: 40, vs1: 48, vno: 129, vne: 163, cruise: 110 },
  limits: { vne: 163, nzCrash: 5.7, sinkCrashFpm: 1100, sinkHardFpm: 600 },
  pilotEye: [0.15, -0.3, -0.56],
  model: { gearGround: 1.04 },
};
