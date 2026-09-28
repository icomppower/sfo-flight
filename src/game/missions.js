// M1.1 Missions and the guided checklist: each mission is a start (aircraft, position, runway, time, weather) plus
// the SPEC §11 steps. A step ticks itself when its condition on the sim state holds (for `hold` seconds of sim time
// where given); only the current step is evaluated. DOM-free: flight.js builds the context, ui.js draws it.
import { ilsDeviation } from '../../fdm/ils.ts';
import { CONFIGS, takeoffTrim } from '../../fdm/configs.ts';
const KT = 0.514444;

// ctx (flight.js ctxOf): t (sim s), sim, ap, thrEff (0..1, the levers the engines get), mcpOn, camMoved, onGround,
// aglFt, cas, phiDeg, altFt, xteM / hdgErr / gsDots (to the mission runway), touchdown, stopped, toCfg (bool)
export const MISSIONS = [
  { id: 1, ac: 'b77w', start: 'final9', rwy: '28R', time: 'golden', wx: 'westerly', startCfg: 'landing', steps: [
    { id: 'panel', hint: 'apPanel', cond: (x) => x.mcpOn },
    { id: 'at', hint: 'clickAT', cond: (x) => !!x.ap?.at },
    { id: 'ap', hint: 'clickAP', cond: (x) => !!x.ap?.on },
    { id: 'app', hint: 'clickAPP', cond: (x) => !!x.ap && (x.ap.gsArm || x.ap.vert === 'GS') },
    { id: 'hands', hint: 'none', cond: (x) => !!x.ap && x.ap.vert === 'GS' },
    { id: 'touch', hint: 'none', cond: (x) => x.touchdown },
    { id: 'stop', hint: 'none', cond: (x) => x.stopped },
  ] },
  { id: 2, ac: 'c172', start: 'final3', rwy: '28R', time: 'day', wx: 'calm', steps: [
    { id: 'centre', hint: 'roll', hold: 3, cond: (x) => Math.abs(x.xteM) < 40 && Math.abs(x.hdgErr) < 10, live: (x) => `${Math.abs(Math.round(x.xteM))} m ${x.xteM > 0 ? 'R' : 'L'}` },
    { id: 'path', hint: 'pitch', hold: 5, cond: (x) => x.cas >= 58 && x.cas <= 78 && Math.abs(x.gsDots) < 1.5, live: (x) => `${Math.round(x.cas)} kt · ${x.gsDots > 0.5 ? '▲ high' : x.gsDots < -0.5 ? '▼ low' : '● on path'}` },
    { id: 'idle', hint: 'thrIdle', cond: (x) => x.aglFt < 100 && x.thrEff <= 0.1, live: (x) => `${Math.round(x.aglFt)} ft · ${Math.round(x.thrEff * 100)} %` },
    { id: 'flare', hint: 'pitchUp', cond: (x) => x.touchdown },
    { id: 'brake', hint: 'brakes', cond: (x) => x.stopped },
  ] },
  { id: 3, ac: 'c172', start: 'runway', rwy: '28R', time: 'day', wx: 'calm', steps: [
    { id: 'tocfg', hint: 'toCfg', cond: (x) => x.toCfg },
    { id: 'full', hint: 'thrUp', cond: (x) => x.thrEff >= 0.95, live: (x) => `${Math.round(x.thrEff * 100)} % / 100 %` },
    { id: 'roll', hint: 'rudder', cond: (x) => x.cas >= 55, live: (x) => `${Math.round(x.cas)} / 55 kt` },
    { id: 'rotate', hint: 'pitchUp', cond: (x) => !x.onGround && x.aglFt > 20, live: (x) => `${Math.round(x.cas)} kt · ${Math.round(x.aglFt)} ft` },
    { id: 'climb', hint: 'pitch', hold: 5, cond: (x) => !x.onGround && x.cas >= 68 && x.cas <= 82, live: (x) => `${Math.round(x.cas)} kt (70–80)` },
    { id: 'flaps', hint: 'flapsUp', cond: (x) => !x.onGround && x.aglFt >= 300 && x.flap === 0, live: (x) => `${Math.round(x.aglFt)} ft · ${x.flapDeg}°` },
    { id: 'alt', hint: 'roll', cond: (x) => !x.onGround && x.aglFt >= 1000, live: (x) => `${Math.round(x.aglFt)} / 1,000 ft` },
  ] },
  { id: 4, ac: 'c172', start: 'ggb', rwy: '28R', time: 'golden', wx: 'calm', steps: [
    { id: 'cam', hint: 'camera', cond: (x) => x.camMoved },
    { id: 'bank', hint: 'roll', hold: 3, cond: (x) => !x.onGround && Math.abs(x.phiDeg) >= 10 && Math.abs(x.phiDeg) <= 35, live: (x) => `${Math.round(Math.abs(x.phiDeg))}° (10–30)` },
    { id: 'level', hint: 'roll', hold: 3, cond: (x) => !x.onGround && Math.abs(x.phiDeg) < 5, live: (x) => `${Math.round(Math.abs(x.phiDeg))}° (< 5)` },
    { id: 'hold', hint: 'pitch', hold: 10, cond: (x) => !x.onGround && x.altFt >= 1200 && x.altFt <= 1800, live: (x) => `${Math.round(x.altFt)} ft (1,200–1,800)` },
  ] },
];

export class Checklist {
  constructor(mission, now) { this.m = mission; this.i = 0; this.since = null; this.ticks = []; this.stepAt = now; this.done = false; this.hidden = false; }
  get step() { return this.m.steps[this.i] || null; }
  update(x, now) {
    if (this.done) return;
    const st = this.step;
    if (!st.cond(x, this, now)) { this.since = null; return; }
    if (st.hold) { if (this.since == null) this.since = x.t; if (x.t - this.since < st.hold) return; }
    this.tick(now, false);
  }
  tick(now, skipped) {
    this.ticks.push({ id: this.step.id, at: now, skipped });
    this.i++; this.since = null; this.stepAt = now;
    if (this.i >= this.m.steps.length) this.done = true;
  }
  skip(now) { if (!this.done) this.tick(now, true); }
}

// the key for a step, for the active input: keyboard, Mac keyboard (fn for the page keys), mouse yoke, gamepad, phone
const HINT = {
  en: {
    apPanel: { kb: 'Shift+A', pad: 'Shift+A', yoke: 'Shift+A', touch: 'A/P button' },
    clickAT: { kb: 'click A/T', touch: 'tap A/T' }, clickAP: { kb: 'click A/P', touch: 'tap A/P' }, clickAPP: { kb: 'click APP', touch: 'tap APP' },
    none: { kb: 'hands off' },
    roll: { kb: '← →', pad: 'stick left / right', yoke: 'mouse left / right', touch: 'stick left / right' },
    pitch: { kb: '↓ nose up · ↑ nose down', pad: 'stick back = nose up', yoke: 'mouse down = nose up', touch: 'stick down = nose up' },
    pitchUp: { kb: 'hold ↓ gently', pad: 'ease the stick back', yoke: 'ease the mouse down', touch: 'ease the stick down' },
    thrUp: { kb: 'hold PgUp', mac: 'hold fn+↑', pad: 'throttle lever up', yoke: 'scroll up', touch: 'slider up' },
    thrIdle: { kb: 'hold PgDn', mac: 'hold fn+↓', pad: 'throttle lever down', yoke: 'scroll down', touch: 'slider down' },
    rudder: { kb: 'Q / E', pad: 'twist / rudder axis', yoke: 'Q / E', touch: 'stick left / right' },
    brakes: { kb: 'hold B', pad: 'brake button', yoke: 'hold B', touch: 'hold BRK' },
    camera: { kb: 'C', pad: 'camera button', yoke: 'C', touch: 'CAM' },
    toCfg: { kb: 'T', touch: 'TAKEOFF CFG' },
    flapsUp: { kb: 'Shift+F', pad: 'flap-up button', yoke: 'Shift+F', touch: 'F▲' },
  },
  zh: {
    apPanel: { kb: 'Shift+A', pad: 'Shift+A', yoke: 'Shift+A', touch: '按 A/P' },
    clickAT: { kb: '點 自動油門', touch: '點 自動油門' }, clickAP: { kb: '點 自駕', touch: '點 自駕' }, clickAPP: { kb: '點 進場', touch: '點 進場' },
    none: { kb: '放手' },
    roll: { kb: '← →', pad: '搖桿左右', yoke: '滑鼠左右', touch: '搖桿左右' },
    pitch: { kb: '↓ 抬頭 · ↑ 低頭', pad: '搖桿後拉 = 抬頭', yoke: '滑鼠下移 = 抬頭', touch: '搖桿下拉 = 抬頭' },
    pitchUp: { kb: '輕按住 ↓', pad: '輕拉搖桿', yoke: '滑鼠輕輕下移', touch: '搖桿輕輕下拉' },
    thrUp: { kb: '按住 PgUp', mac: '按住 fn+↑', pad: '油門桿推上', yoke: '滾輪向上', touch: '滑桿往上' },
    thrIdle: { kb: '按住 PgDn', mac: '按住 fn+↓', pad: '油門桿收回', yoke: '滾輪向下', touch: '滑桿往下' },
    rudder: { kb: 'Q / E', pad: '扭轉 / 方向舵軸', yoke: 'Q / E', touch: '搖桿左右' },
    brakes: { kb: '按住 B', pad: '剎車鍵', yoke: '按住 B', touch: '按住 BRK' },
    camera: { kb: 'C', pad: '視角鍵', yoke: 'C', touch: 'CAM' },
    toCfg: { kb: 'T', touch: '起飛設定' },
    flapsUp: { kb: 'Shift+F', pad: '收襟翼鍵', yoke: 'Shift+F', touch: 'F▲' },
  },
};
export function hintFor(lang, hint, kind) { const h = (HINT[lang] || HINT.en)[hint] || {}; return h[kind] ?? (kind === 'mac' ? h.kb : null) ?? h.kb ?? ''; }

// the context the conditions read, from the live flight (also used by the headless tests)
export function ctxOf(g) {
  const f = g.flight, s = f.sim, ap = f.ap, FT = 0.3048, D = Math.PI / 180;
  const m = g.mission, rwy = g.W.runways.find((r) => r.id === (m ? m.rwy : g.opts.rwy)) || g.W.runways[0];
  const u = [Math.cos(rwy.crs * D), Math.sin(rwy.crs * D)], dn = s.pos[0] - rwy.thrN, de = s.pos[1] - rwy.thrE;
  const along = dn * u[0] + de * u[1], xte = -dn * u[1] + de * u[0];
  const I = g.W.ils.find((i) => i.id === rwy.id);
  const gsDots = I ? ilsDeviation(I, s.pos[0], s.pos[1], s.altMsl).gsDots : 0;
  const thrEff = Math.max(...f.applied.thr);
  const cfgT = CONFIGS[g.ac.id].takeoff;
  return {
    t: s.t, sim: s, ap, thrEff, mcpOn: !!g.mcpOn, camMoved: g.camIdx !== g.camIdx0, onGround: s.onGround,
    aglFt: Math.max(0, s.agl / FT), cas: s.cas, phiDeg: s.euler.phi / D, altFt: s.altMsl / FT,
    xteM: xte, hdgErr: ((s.euler.psi / D - rwy.crs + 540) % 360) - 180, gsDots,
    touchdown: s.onGround && s.touchdowns.length > 0, stopped: !!f.scorer.landing?.complete || (s.onGround && s.touchdowns.length > 0 && s.gs < 1 * KT),
    flap: g.c.flap, flapDeg: g.ac.flaps.detents[g.c.flap],
    toCfg: g.c.park < 0.5 && g.c.flap === cfgT.flap && (g.ac.id !== 'c172' || g.c.mixture > 0.5) && Math.abs(s.trimPos - takeoffTrim(g.ac, s.mass)) < 0.002,
  };
}
