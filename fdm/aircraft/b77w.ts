// Heavy twin, 777-300ER-class. Dimensions, weights and field lengths from Boeing's airport-planning document (ACAP);
// stability derivatives from the Boeing 747 powered-approach set of NASA CR-2144 (Heffley & Jewell 1972, public
// domain) as reproduced in Nelson App. B Table B.27 (M 0.25, sea level) — the heavy-transport class the SPEC names.
// CR-2144 uses δa > 0 = right roll (kept) and δr > 0 = nose left (flipped: CYδr, Clδr, Cnδr); δe > 0 trailing edge down.
import { S } from '../table.ts';
import type { AircraftData } from './types.ts';

const LB = 0.45359237, SLUGFT2 = 1.3558179, D = Math.PI / 180;
const V = 'VERIFIED', A = 'APPROX';
const MLW = 251290, M747 = 636600 * LB; // 747 reference weight of the CR-2144 derivative set (Nelson Fig. B.27)
const sb = (64.80 / 59.64) ** 2, sl = (73.86 / 70.66) ** 2; // span² and length² ratios 777-300ER / 747-100

export const B77W: AircraftData = {
  id: 'b77w', name: 'Boeing 777-300ER (class)', icao: 'B77W',
  sources: {
    ACAP: 'Boeing D6-58329-2, 777-200LR/-300ER Airplane Characteristics for Airport Planning (June 2004): §2.1.1, Fig. 2.2.2, Fig. 3.3.7, Fig. 3.4.4',
    CR2144: 'R. K. Heffley, W. F. Jewell, Aircraft Handling Qualities Data, NASA CR-2144 (1972), B-747, via Nelson App. B Table B.27 (M 0.25, sea level), per radian',
    APD: 'EUROCONTROL Aircraft Performance Database, B77W (V2 168 kt, Vat 149 kt)',
    ACD: 'FAA Aircraft Characteristics Database, B77W approach speed 149 kt',
    TCDS: 'GE90-115B take-off thrust 115,540 lbf (FAA TCDS E00049EN, as quoted by secondary sources; not re-read)',
    FAR: '14 CFR 25.125 (Vref ≥ 1.23 VSR), 25.473 (10 ft/s limit descent velocity), 33.73 (idle → 95 % thrust in 5 s)',
    TXT: 'D. P. Raymer, Aircraft Design: A Conceptual Approach (AIAA): swept-wing transport CLmax clean 1.2–1.6, thrust lapse of high-bypass fans',
    MCC: 'B. W. McCormick, Aerodynamics, Aeronautics and Flight Mechanics (Wiley 1979), ground effect',
    GEN: 'Derived in this repo from the cited values by the rule in the note',
    TUNE: 'Fitted in this repo to the frozen performance targets (SPEC-THRESHOLDS.md F2); fit recorded in DECISIONS.md',
    BOE: 'Boeing 777 technical characteristics: wing area 4,702 sq ft (from memory, not re-read this session)',
  },
  geom: {
    S: S(436.8, 'BOE', A, '4,702 sq ft'),
    b: S(64.80, 'ACAP', V, 'span 212 ft 7 in, Fig. 2.2.2'),
    cbar: S(7.0, 'GEN', A, 'S / b × 1.04 for the taper'),
    length: S(73.86, 'ACAP', V, 'length 242 ft 4 in'),
  },
  mass: {
    empty: S(167829, 'ACAP', V, 'operating empty weight 370,000 lb'),
    mtow: S(351533, 'ACAP', V, 'max design takeoff weight 775,000 lb'),
    mlw: S(MLW, 'ACAP', V, 'max design landing weight 554,000 lb'),
    fuelMax: S(145541, 'ACAP', A, 'usable fuel 47,890 US gal (ACAP §2.1.1 -200LR column, same wing tanks)'),
    ref: S(MLW, 'ACAP', V, 'reference mass for inertia and gear = MLW'),
  },
  inertia: {
    Ix: S(18.2e6 * SLUGFT2 * (MLW / M747) * sb, 'CR2144', A, '747 Ix 18.2e6 slug ft² scaled by mass × span²'),
    Iy: S(33.1e6 * SLUGFT2 * (MLW / M747) * sl, 'CR2144', A, '747 Iy 33.1e6 slug ft² scaled by mass × length²'),
    Iz: S(49.7e6 * SLUGFT2 * (MLW / M747) * (sb + sl) / 2, 'CR2144', A, '747 Iz 49.7e6 slug ft² scaled by mass × (span² + length²)/2'),
    Ixz: S(0.97e6 * SLUGFT2 * (MLW / M747), 'CR2144', A, '747 Ixz 0.97e6 slug ft² scaled by mass'),
  },
  flaps: { detents: [0, 1, 5, 15, 20, 25, 30], rate: S(1.2, 'GEN', A, 'deg/s: about 25 s 0 → 30'), vfe: [340, 255, 235, 215, 195, 185, 170] },
  gearRetract: true, gearTransit: 10,
  controls: {
    deUp: S(30 * D, 'GEN', A), deDown: S(25 * D, 'GEN', A), da: S(25 * D, 'GEN', A, 'flaperon + aileron'), dr: S(27 * D, 'GEN', A),
    rate: S(1.0, 'GEN', A, 'rad/s, hydraulic actuators'),
    trimRange: [-0.21, 0.07], trimRate: 0.009, trimIsStab: true,
  },
  aero: {
    CL: { x: 'alpha', col: 'flap', cols: [0, 1, 5, 15, 20, 25, 30], rows: [
      // CL0 + CLα α to 3.5° before the peak, quadratic cap to CLmax, post-stall drop, flat plate (GEN rule);
      // CLα 5.70 /rad [CR2144, VERIFIED]; CLmax 1.40 clean [TXT], 2.38 flaps 30 (Vref 149 kt / 1.23 at MLW) [ACD, FAR → GEN]
      [-20, -1.000, -0.954, -0.734, -0.554, -0.474, -0.394, -0.334, 'GEN', A],
      [-12, -0.994, -0.794, -0.574, -0.394, -0.314, -0.234, -0.174, 'GEN', A],
      [-8, -0.596, -0.396, -0.176, 0.004, 0.084, 0.164, 0.224, 'GEN', A],
      [-4, -0.198, 0.002, 0.222, 0.402, 0.482, 0.562, 0.622, 'GEN', A],
      [0, 0.200, 0.400, 0.620, 0.800, 0.880, 0.960, 1.020, 'GEN', A],
      [4, 0.598, 0.798, 1.018, 1.198, 1.278, 1.358, 1.418, 'GEN', A],
      [8, 0.996, 1.196, 1.416, 1.596, 1.676, 1.756, 1.816, 'GEN', A],
      [10, 1.195, 1.395, 1.615, 1.795, 1.875, 1.955, 2.015, 'GEN', A],
      [12, 1.353, 1.553, 1.812, 1.991, 2.071, 2.153, 2.214, 'GEN', A],
      [13, 1.391, 1.591, 1.886, 2.062, 2.142, 2.230, 2.297, 'GEN', A],
      [14, 1.385, 1.583, 1.932, 2.105, 2.185, 2.279, 2.351, 'GEN', A],
      [15, 1.308, 1.495, 1.950, 2.120, 2.200, 2.299, 2.378, 'GEN', A],
      [16, 1.231, 1.407, 1.855, 2.005, 2.081, 2.201, 2.304, 'GEN', A],
      [17, 1.154, 1.319, 1.748, 1.889, 1.960, 2.074, 2.173, 'GEN', A],
      [18, 1.089, 1.243, 1.641, 1.772, 1.839, 1.948, 2.042, 'GEN', A],
      [19, 1.073, 1.214, 1.534, 1.656, 1.718, 1.821, 1.911, 'GEN', A],
      [20, 1.057, 1.185, 1.470, 1.586, 1.643, 1.729, 1.804, 'GEN', A],
      [22, 1.025, 1.127, 1.356, 1.448, 1.493, 1.562, 1.622, 'GEN', A],
      [24, 0.993, 1.069, 1.241, 1.310, 1.344, 1.396, 1.441, 'GEN', A],
      [30, 0.896, 0.896, 0.896, 0.896, 0.896, 0.896, 0.896, 'GEN', A],
      [45, 1.150, 1.150, 1.150, 1.150, 1.150, 1.150, 1.150, 'GEN', A],
      [60, 0.996, 0.996, 0.996, 0.996, 0.996, 0.996, 0.996, 'GEN', A],
      [90, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 'GEN', A],
    ] },
    CLq: S(5.4, 'CR2144', V), CLadot: S(6.7, 'CR2144', V), CLde: S(0.338, 'CR2144', V), CLtrim: S(0.75, 'GEN', A, 'CLδe / τe with τe 0.45 (whole stabilizer)'),
    CD0: S(0.017, 'TUNE', A, 'wide-body low-speed parasite drag'),
    K: S(1 / (Math.PI * 0.82 * 9.613), 'GEN', A, 'Oswald e 0.82, AR 9.613 from span and area'),
    CDflap: { x: 'flap', rows: [[0, 0, 'GEN', A], [1, 0.004, 'TUNE', A], [5, 0.010, 'TUNE', A], [15, 0.022, 'TUNE', A], [20, 0.030, 'TUNE', A], [25, 0.042, 'TUNE', A], [30, 0.052, 'TUNE', A]] },
    CDgear: S(0.018, 'TUNE', A),
    CDalpha: { x: 'alpha', rows: [[0, 0, 'GEN', A], [14, 0, 'GEN', A], [18, 0.08, 'GEN', A], [24, 0.30, 'GEN', A], [30, 0.55, 'GEN', A], [45, 1.0, 'GEN', A], [90, 1.4, 'GEN', A]] },
    CDbeta: S(0.5, 'GEN', A, 'ΔCD = CDβ β²'),
    CYb: S(-0.96, 'CR2144', V), CYp: S(0, 'CR2144', V, 'not given (0)'), CYr: S(0, 'CR2144', V, 'not given (0)'), CYdr: S(-0.175, 'CR2144', V, 'sign flipped'),
    Clb: S(-0.221, 'CR2144', V),
    Clp: { x: 'alpha', rows: [[-10, -0.45, 'CR2144', V], [13, -0.45, 'CR2144', V], [18, -0.25, 'GEN', A], [25, -0.10, 'GEN', A], [90, -0.05, 'GEN', A]] },
    Clr: S(0.101, 'CR2144', V),
    Clda: S(0.0461 + 0.07, 'CR2144', A, 'aileron 0.0461 [VERIFIED] + roll spoilers 0.07 (the 747 of CR-2144 rolls with five spoiler panels per wing; spoiler share sized to the class roll rate)'),
    Cldr: S(-0.007, 'CR2144', V, 'sign flipped'),
    Cm0: { x: 'flap', rows: [[0, 0.03, 'GEN', A], [1, 0.02, 'GEN', A], [5, 0, 'GEN', A], [15, -0.02, 'GEN', A], [20, -0.03, 'GEN', A], [25, -0.04, 'GEN', A], [30, -0.05, 'GEN', A]] },
    Cma: S(-1.26, 'CR2144', V), Cmq: S(-20.8, 'CR2144', V), Cmadot: S(-3.2, 'CR2144', V), Cmde: S(-1.34, 'CR2144', V),
    Cmtrim: S(-1.34 / 0.45, 'GEN', A, 'Cmδe / τe, τe 0.45 (whole stabilizer)'),
    CmStall: { x: 'alpha', rows: [[0, 0, 'GEN', A], [14, 0, 'GEN', A], [17, -0.10, 'GEN', A], [22, -0.30, 'GEN', A], [30, -0.50, 'GEN', A], [90, -0.8, 'GEN', A]] },
    CmGround: S(-0.05, 'GEN', A), CmGear: S(0, 'GEN', A),
    Cnb: S(0.150, 'CR2144', V), Cnp: S(-0.121, 'CR2144', V), Cnr: S(-0.30, 'CR2144', V), Cnda: S(0.0064, 'CR2144', V), Cndr: S(0.109, 'CR2144', V, 'sign flipped'),
    geOswaldK: S(1, 'MCC', V), geLift: S(0.15, 'MCC', A, 'lift slope +15 % at the ground'),
    spoiler: { CL: S(-0.70, 'TUNE', A, 'full ground spoilers: lift dump to about a third of the flaps-30 ground-roll lift'), CD: S(0.10, 'GEN', A), Cl: S(0.07, 'GEN', A), Cm: S(0.02, 'GEN', A) },
  },
  engine: {
    kind: 'turbofan', count: 2,
    thrustN: S(115540 * 4.4482216, 'TCDS', A, 'GE90-115B take-off thrust 115,540 lbf'),
    n1Idle: S(21, 'GEN', A), n1Max: S(100, 'GEN', A, 'N1 100 % = rated take-off thrust (normalised)'),
    tau: S(1.2, 'FAR', A, 'spool time constant high N1; with tauIdle gives idle → 95 % in about 5 s (33.73)'),
    tauIdle: S(3.2, 'FAR', A, 'spool time constant near idle'),
    thrustExp: S(2.0, 'GEN', A, 'thrust fraction ∝ N1 fraction²'),
    lapseM: S(-0.95, 'TXT', A, 'T/T0 = σ^0.75 (1 − 0.95 M + 0.45 M²), high-bypass installed lapse (fitted within the textbook band)'), lapseM2: S(0.45, 'TXT', A), densExp: S(0.75, 'TXT', A),
    idleFrac: S(0.05, 'GEN', A, 'flight idle thrust 5 % of rated'),
    tsfc: S(0.30 * LB / (4.4482216 * 3600), 'TXT', A, '0.30 lb/lbf/h at low altitude'),
    pos: [[8, -9.61, 2.8], [8, 9.61, 2.8]],
  },
  gear: [
    { id: 'nose', pos: [29.0, 0, 5.3], kShare: 0.07, staticDefl: 0.25, zeta: 0.55, travel: 0.55, steerMax: 7 * D, tillerMax: 70 * D, brake: null },
    { id: 'left', pos: [-2.22, -5.485, 5.3], kShare: 0.465, staticDefl: 0.30, zeta: 0.55, travel: 0.6, brake: 'L' },
    { id: 'right', pos: [-2.22, 5.485, 5.3], kShare: 0.465, staticDefl: 0.30, zeta: 0.55, travel: 0.6, brake: 'R' },
  ],
  contacts: [
    { id: 'tail', pos: [-30, 0, 0.6], kind: 'tail' },
    { id: 'podL', pos: [5, -9.61, 4.15], kind: 'nacelle' },
    { id: 'podR', pos: [5, 9.61, 4.15], kind: 'nacelle' },
    { id: 'wingL', pos: [-8, -32.4, -1.6], kind: 'wingtip' },
    { id: 'wingR', pos: [-8, 32.4, -1.6], kind: 'wingtip' },
    { id: 'nose', pos: [34.9, 0, 2.2], kind: 'nose' },
    { id: 'belly', pos: [0, 0, 3.1], kind: 'belly' },
  ],
  brakes: { mu: S(0.55, 'TUNE', A, 'anti-skid maximum manual braking, fitted to the ACAP landing length'), rampS: 1.0, autobrake: [1.2, 1.5, 2.1, 2.7, 3.4] },
  tyre: { muSide: S(0.7, 'GEN', A), roll: S(0.015, 'GEN', A) },
  fcs: { yawDamper: 2.2, yawDamperTau: 2.5, turnCoord: 0, speedStab: 0.004, pathStab: 0.1 }, // yaw damper and the C*U speed term of the 777's normal-mode FBW (gains fitted to MIL-F-8785C Level 1)
  vspeeds: { v1: 150, vr: 158, v2: 168, vref30: 149, vref25: 154, vapp: 154, climb: 250, vmo: 330, vs1: 158 },
  limits: { vne: 330, nzCrash: 3.75, sinkCrashFpm: 1200, sinkHardFpm: 600 },
  pilotEye: [31.5, -0.55, -2.3],
  model: { gearGround: 5.0 },
};
