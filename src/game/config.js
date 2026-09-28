// TAKEOFF CONFIG (T, on the ground) and LANDING CONFIG (L, airborne): each is a list of named items that set the
// controls, the switches or the MCP of the flying game `g` (flight.js). They set configuration only — the one
// autopilot effect is arming LOC + APP, lit on the panel. F9 checks the resulting state item by item.
import { CONFIGS, takeoffTrim, vref, RTO } from '../../fdm/configs.ts';
import { ilsDeviation } from '../../fdm/ils.ts';
import { AP_EVENT } from '../../fdm/autopilot.ts';

const D = Math.PI / 180;
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;

// the runway the aircraft is lined up on (within 20° and on the pavement), else null
export function runwayUnder(g) {
  const s = g.flight.sim;
  for (const r of g.W.runways) {
    const u = [Math.cos(r.crs * D), Math.sin(r.crs * D)], dn = s.pos[0] - r.thrN, de = s.pos[1] - r.thrE;
    const along = dn * u[0] + de * u[1], xte = -dn * u[1] + de * u[0];
    if (Math.abs(wrap180(s.euler.psi / D - r.crs)) < 20 && Math.abs(xte) < r.widthM && along > -600 && along < r.lengthM) return r;
  }
  return null;
}
// an SFO ILS within `nm` and `deg` of its course, ahead of the aircraft
export function ilsWindow(g, nm, deg) {
  const s = g.flight.sim;
  return g.W.ils.find((I) => { const d = ilsDeviation(I, s.pos[0], s.pos[1], s.altMsl); return d.distNm > 0 && d.distNm <= nm && Math.abs(wrap180(s.euler.psi / D - I.crs)) <= deg; }) || null;
}

export const TAKEOFF_ITEMS = {
  c172: [
    ['park', (g) => { g.c.park = 0; }],
    ['flap', (g) => { g.c.flap = CONFIGS.c172.takeoff.flap; }],
    ['trim', (g) => { g.setTrim(takeoffTrim(g.ac, g.flight.sim.mass)); }],
    ['mixture', (g) => { g.eng.mixture = true; g.c.mixture = 1; }],
  ],
  b77w: [
    ['park', (g) => { g.c.park = 0; }],
    ['flap', (g) => { g.c.flap = CONFIGS.b77w.takeoff.flap; }],
    ['trim', (g) => { g.setTrim(takeoffTrim(g.ac, g.flight.sim.mass)); }],
    ['spoiler', (g) => { g.c.spoiler = 0; }],
    ['autobrake', (g) => { g.autobrake = RTO; }],
    ['spd', (g) => { g.mcp.spd = g.ac.vspeeds.v2; }],
    ['hdg', (g) => { const r = runwayUnder(g); g.mcp.hdg = Math.round(g.magOf((r ? r.crs : g.flight.sim.euler.psi / D) * D)) % 360; }],
    ['alt', (g) => { g.mcp.alt = CONFIGS.b77w.takeoff.mcpAlt; }],
    ['atArm', (g) => { g.atArm = true; }],
  ],
};
export const LANDING_ITEMS = {
  c172: [
    ['flap', (g) => { g.c.flap = CONFIGS.c172.landing.flap; }],
    ['trim', (g) => { g.setTrim(CONFIGS.c172.landing.trim); }],
    ['bug', (g) => { g.bug = CONFIGS.c172.landing.bugKt; }],
  ],
  b77w: [
    ['gear', (g) => { g.c.gear = 1; }],
    ['flap', (g) => { g.c.flap = CONFIGS.b77w.landing.flap; }],
    ['spoiler', (g) => { g.c.spoiler = -1; }],
    ['autobrake', (g) => { g.autobrake = CONFIGS.b77w.landing.autobrake; }],
    ['spd', (g) => { g.mcp.spd = Math.round(vref(g.ac, g.flight.sim.mass) + CONFIGS.b77w.landing.vrefAdd); }],
    ['app', (g, o) => { const L = CONFIGS.b77w.landing; if (o.arm !== false && ilsWindow(g, L.ilsNm, L.ilsDeg)) g.pending = AP_EVENT.APP; }],
  ],
};

// → '' when applied, else the reason it was refused (the HUD shows it)
export function applyConfig(g, which, o = {}) {
  const s = g.flight?.sim;
  if (!s || g.state !== 'flying') return 'not flying';
  if (which === 'takeoff' && !s.onGround) return 'ground';
  if (which === 'landing' && s.onGround) return 'air';
  for (const [, fn] of (which === 'takeoff' ? TAKEOFF_ITEMS : LANDING_ITEMS)[g.ac.id]) fn(g, o);
  g.cfgApplied = which;
  return '';
}

// 777 TO/GA: the levers full; with the A/T armed it engages the autothrottle (SPD = V2 then holds it)
export function toga(g) {
  if (g.state !== 'flying' || g.ac.id !== 'b77w') return;
  g.pilot.thr = 1;
  if (g.atArm && !g.flight.ap.at) g.pending = AP_EVENT.AT;
  g.atArm = false;
}
