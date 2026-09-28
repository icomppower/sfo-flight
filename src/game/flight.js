// The "flight" game (Harbor Engine registerGame): the player flies the flight model (fdm/) in the real-data bay.
// Menu → flight → result (landing score / crash) → replay with the director's cameras. The engine draws the world;
// this module owns the aircraft, the airfield, the ring, the cameras, the instruments and the HUD.
import { registerGame } from 'harbor-engine';
import { Flight } from '../../fdm/flight.ts';
import { neutralControls, DT } from '../../fdm/sim.ts';
import { AP_EVENT } from '../../fdm/autopilot.ts';
import { C172 } from '../../fdm/aircraft/c172.ts';
import { B77W } from '../../fdm/aircraft/b77w.ts';
import { loadWorld } from './worlddata.js';
import { buildAirfield } from './airfield.js';
import { Ring } from './ring.js';
import { AircraftView } from './aircraft.js';
import { Cameras, CAMS } from './cameras.js';
import { PilotInput, loadPadMap, savePadMap } from './controls.js';
import { Instruments } from './instruments.js';
import { GameUI, NullUI, TIMES } from './ui.js';
import { makeStart } from './starts.js';
import { weatherFrom, fdmWeather, hazeFor } from './weather.js';
import { pickLang } from './i18n.js';
import { TestPilot } from '../../fdm/pilot.ts';

const AC = { c172: C172, b77w: B77W };
const FT = 0.3048, KT = 0.514444;
const base = () => (import.meta.env && import.meta.env.BASE_URL) || '/';
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

class FlightGame {
  constructor(app, W, index, tower) {
    this.app = app; this.W = W; this.index = index;
    const qs = app.qs;
    this.lang = pickLang(qs);
    this.opts = { ac: qs.get('ac') === 'b77w' ? 'b77w' : qs.get('ac') === 'c172' ? 'c172' : 'c172', start: qs.get('start') || 'runway', rwy: (qs.get('rwy') || '28R').toUpperCase(), wx: qs.get('metar') || qs.get('wind') ? 'custom' : (qs.get('wx') || 'westerly'), wind: qs.get('wind') || '', vis: qs.get('vis') || '', time: qs.get('time') && TIMES[qs.get('time')] ? qs.get('time') : 'golden', lang: this.lang };
    this.headless = typeof document === 'undefined' || !document.body;
    this.ui = this.headless ? new NullUI(this.lang, W.metars, this.opts) : new GameUI(this.lang, W.metars, this.opts);
    this.inst = this.headless ? null : new Instruments(this.ui.dom.panel);
    this.pilot = new PilotInput(app, app.renderer.domElement || document.getElementById('app'));
    this.cams = new Cameras(app, tower);
    this.views = {};
    this.state = 'menu'; this.acc = 0; this.pose0 = {}; this.pose1 = {}; this.instT = 0; this.hudT = 0; this.endT = 0;
    this.mcp = { spd: 170, hdg: 280, alt: 3000, vs: 0 }; this.mcpOn = false; this.autobrake = 0; this.eng = { master: true, mags: true, mixture: true };
    this.hudHidden = false; this.camIdx = 0; this.replayState = null; this.lastLog = null;
    this.wire();
    if (qs.has('autostart') || qs.has('start')) this.startFlight(); else this.ui.showMenu('menu');
    globalThis.__sfo = this;
    this.tools = { TestPilot, AP_EVENT }; // page gates: the scripted pilot's control laws (its outputs go through the Gamepad API)
  }

  wire() {
    const ui = this.ui;
    ui.on.menu = (go, o) => {
      this.opts = o; if (o.lang !== this.lang) { this.lang = o.lang; ui.setLang(o.lang); }
      if (go === 'resume') { ui.hideOverlay(); this.state = this.flight ? 'flying' : 'menu'; }
      else if (go === 'fly') this.startFlight();
      else if (go === 'replay') this.startReplay();
      else if (go === 'remap') ui.showRemap(this.pilot.padKind);
    };
    ui.on.remapDone = () => { this.pilot.padMap = loadPadMap(this.pilot.padKind); ui.showMenu(this.flight && this.state !== 'menu' ? 'paused' : 'menu'); };
    ui.on.bind = (kind, map, what, done) => this.bindNext(kind, map, what, done);
    ui.on.result = (go) => { if (go === 'replay') this.startReplay(); else if (go === 'again') this.startFlight(); else { this.state = 'menu'; ui.showMenu('menu'); } };
    ui.on.action = (a) => this.pilot.press(a);
    ui.on.brakes = (on) => { this.pilot.touch.brakes = on; };
    ui.on.stick = (x, y) => { this.pilot.touch.active = true; this.pilot.touch.x = x; this.pilot.touch.y = -y; };
    ui.on.stickEnd = () => { this.pilot.touch.active = false; };
    ui.on.throttle = (v) => { this.pilot.touch.thr = v; };
    ui.on.mcpEvent = (e) => { if (e === 'VS') this.mcp.vs = Math.round(this.flight.sim.vsFpm / 100) * 100; this.pending = AP_EVENT[e === 'VS' ? 'VS' : e]; };
    ui.on.mcpKnob = (k, d) => { const M = this.mcp; if (k === 'SPD') M.spd = clamp(M.spd + d, 60, 340); if (k === 'HDG') M.hdg = ((M.hdg + d) % 360 + 360) % 360; if (k === 'ALT') M.alt = clamp(M.alt + d * 100, 0, 40000); if (k === 'VS') M.vs = clamp(M.vs + d * 100, -6000, 6000); };
    ui.on.autobrake = (d) => { this.autobrake = clamp(this.autobrake + d, 0, 5); };
    ui.on.engineSwitch = (s, down) => { if (s === 'starter') this.starter = down; else if (down) this.eng[s] = !this.eng[s]; };
  }

  // gamepad remap: wait for the next moved axis / pressed button (or a key)
  bindNext(kind, map, what, done) {
    const [type, action] = what.split(':');
    const p0 = this.pilot.pollPad(); const rest = p0 ? p0.axes.slice() : [];
    const t0 = performance.now();
    const tick = () => {
      const p = this.pilot.pollPad();
      if (p) {
        if (type === 'axes') { const i = p.axes.findIndex((v, k) => Math.abs(v - (rest[k] ?? 0)) > 0.5); if (i >= 0) { map.axes[action] = { i, inv: (action === 'elev' || action === 'thr') && p.axes[i] < (rest[i] ?? 0) }; savePadMap(kind, map); done(); return; } }
        else { const i = p.buttons.findIndex((b) => b.pressed); if (i >= 0) { map.buttons[action] = i; savePadMap(kind, map); done(); return; } }
      }
      if (performance.now() - t0 < 8000) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  }

  async startFlight() {
    const o = this.opts, ac = AC[o.ac], W = this.W, app = this.app;
    this.ui.hideOverlay();
    this.stopReplay();
    this.state = 'loading';
    const wx = weatherFrom(new URLSearchParams(o.wx === 'custom' ? `wind=${o.wind}&vis=${o.vis}` : ''), W.metars, o.wx === 'custom' ? null : o.wx);
    if (o.wx === 'custom' && app.qs.get('metar')) Object.assign(wx, weatherFrom(app.qs, W.metars, null));
    this.wx = wx;
    const start = makeStart(o.start, o.ac, o.rwy, W);
    this.flight = new Flight(ac, start, fdmWeather(wx, W.airport.trueNorthGridDeg), app.qs.get('seed') || 'sfo-flight', { ground: W.ground, ils: W.ils, runways: W.runways });
    this.c = { ...this.flight.initial, thr: this.flight.initial.thr.slice() };
    this.pilot.thr = this.c.thr[0];
    if (start.engineOn === false) this.eng = { master: false, mags: false, mixture: false }; else this.eng = { master: true, mags: true, mixture: true };
    this.ac = ac; this.startName = this.ui.L[o.start] + (['runway', 'final9', 'final3'].includes(o.start) ? ' ' + o.rwy : '');
    const s = this.flight.sim, mag = this.magOf(s.euler.psi);
    this.mcp = { spd: Math.round(start.cas ?? ac.vspeeds.v2 ?? 150), hdg: Math.round(mag), alt: o.start.startsWith('final') ? 3000 : Math.round((s.altMsl / FT + 2000) / 100) * 100, vs: 0 };
    this.autobrake = o.ac === 'b77w' && o.start.startsWith('final') ? 3 : 0;
    if (o.ac === 'b77w' && o.start.startsWith('final')) this.c.spoiler = -1;
    for (const v of Object.values(this.views)) { v.ext.visible = false; v.cock.visible = false; }
    this.view = this.views[o.ac] || (this.views[o.ac] = await AircraftView.load(app, this.index, o.ac));
    this.view.ext.visible = true;
    app.settings.timeOfDay = app.qs.has('hour') ? Number(app.qs.get('hour')) : TIMES[o.time];
    if (app.haze) app.haze.density.value = hazeFor(wx.visSM);
    AircraftView.poseOf(s, this.pose0); AircraftView.poseOf(s, this.pose1);
    this.acc = 0; this.endT = 0; this.state = 'flying'; this.camIdx = Math.max(0, CAMS.indexOf(app.qs.get('cam') || 'cockpit')); this.cams.mode = CAMS[this.camIdx]; this.msgT = 0;
    this.ui.showMcp(false); this.mcpOn = false;
  }

  magOf(psi) { return ((psi * 180 / Math.PI - this.W.airport.trueNorthGridDeg - this.W.airport.magVar) % 360 + 360) % 360; }
  gridOfMag(m) { return ((m + this.W.airport.magVar + this.W.airport.trueNorthGridDeg) % 360 + 360) % 360; }

  handleActions(actions) {
    const c = this.c, ac = this.ac, ui = this.ui;
    for (const a of actions) {
      if (a === 'menu') { if (this.state === 'flying') { this.state = 'paused'; ui.showMenu('paused'); } else if (this.state === 'paused') { ui.hideOverlay(); this.state = 'flying'; } continue; }
      if (a === 'replay' && (this.state === 'ended' || this.state === 'paused')) { this.startReplay(); continue; }
      if (a === 'camera') { this.camIdx = (this.camIdx + 1) % CAMS.length; this.cams.mode = CAMS[this.camIdx]; continue; }
      if (a === 'hud') { this.hudHidden = !this.hudHidden; ui.root.classList.toggle('is-hidden', this.hudHidden); continue; }
      if (a === 'pause') { if (this.state === 'flying') this.state = 'paused'; else if (this.state === 'paused') this.state = 'flying'; continue; }
      if (this.state !== 'flying') continue;
      if (a === 'flapDown') c.flap = Math.min(ac.flaps.detents.length - 1, c.flap + 1);
      else if (a === 'flapUp') c.flap = Math.max(0, c.flap - 1);
      else if (a === 'gear') { if (ac.gearRetract) c.gear = c.gear > 0.5 ? 0 : 1; }
      else if (a === 'park') c.park = c.park > 0.5 ? 0 : 1;
      else if (a === 'spoiler') c.spoiler = c.spoiler === 0 ? -1 : c.spoiler < 0 ? 1 : 0;
      else if (a === 'apPanel') { if (ac.id === 'b77w') this.mcpOn = !this.mcpOn; else this.engOn = !this.engOn; }
      else if (a === 'apToggle' && ac.id === 'b77w') this.pending = AP_EVENT.AP;
      else if (a === 'startEngine' && ac.id === 'c172') { this.eng = { master: true, mags: true, mixture: true }; this.starterAuto = 2.5; }
      else if (a === 'brakes') { /* touch brakes are held via ui.on.brakes */ }
    }
  }

  update(dt) {
    const app = this.app;
    if (!app.freeCam) app.setFreeCam(true); // F is the flaps here, not the engine's walk/fly toggle
    if (app.autopilot) app.setAutopilot(false); // G is the gear here, not the ferry autopilot
    // no pointer lock: the menus, the MCP and the mouse yoke need a cursor (look-around works by dragging)
    if (!this.headless && document.pointerLockElement) document.exitPointerLock?.();
    // keys are read in every state (Esc resumes, R replays); the controls only reach the aircraft while flying
    if (!this.flight) { this.pilot.update(dt, this.scratch || (this.scratch = neutralControls(C172)), C172, { onGround: true, gs: 0 }); if (this.pilot.take().includes('menu') && this.state === 'menu') this.ui.showMenu('menu'); return; }
    if (!this.view || this.state === 'loading') return;
    const sim = this.flight.sim;
    const target = this.state === 'flying' ? this.c : (this.scratch2 || (this.scratch2 = { ...this.c, thr: this.c.thr.slice() }));
    const thrHold = this.pilot.thr;
    this.pilot.update(dt, target, this.ac, sim);
    if (this.state !== 'flying') this.pilot.thr = thrHold;
    if (this.state === 'flying' && this.cams.mode === 'free') { this.c.elev = 0; this.c.ail = 0; this.c.rud = 0; }
    const acts = this.pilot.take();
    if (this.state === 'replay') { this.updateReplay(dt, acts); return; }
    this.handleActions(acts);
    // engine switches (172) and the MCP (777) into the controls
    const c = this.c;
    if (this.ac.id === 'c172') {
      if (this.starterAuto > 0) this.starterAuto -= dt;
      c.master = this.eng.master ? 1 : 0; c.mags = this.eng.mags ? 1 : 0; c.mixture = this.eng.mixture ? 1 : 0; c.starter = this.starter || this.starterAuto > 0 ? 1 : 0;
    } else {
      c.mcpSpd = this.mcp.spd; c.mcpHdg = this.gridOfMag(this.mcp.hdg); c.mcpAlt = this.mcp.alt; c.mcpVs = this.mcp.vs; c.autobrake = this.autobrake;
    }
    if (this.state === 'flying') {
      this.acc += Math.min(dt, 0.25);
      let n = 0;
      while (this.acc >= DT && n < 40) {
        if (this.pending) { c.ap = this.pending; this.pending = 0; }
        AircraftView.poseOf(sim, this.pose0);
        this.flight.step(c);
        c.ap = 0; this.acc -= DT; n++;
      }
      AircraftView.poseOf(sim, this.pose1);
      if (n === 0) { /* keep the previous pair */ }
      if ((sim.crashed || this.flight.scorer.landing?.complete) && !this.endT) this.endT = performance.now();
      if (this.endT && performance.now() - this.endT > (sim.crashed ? 1500 : 2500) && this.state === 'flying') this.finish();
    }
    this.render(dt, sim, this.acc / DT, this.cams.mode);
  }

  render(dt, sim, alpha, camName) {
    const app = this.app;
    this.view.apply(this.pose0, this.pose1, clamp(alpha, 0, 1));
    const ground = (x, z) => this.W.ground.heightXZ(x, z);
    if (camName !== 'free') this.cams.place(dt, this.view, sim, camName, ground);
    this.view.ext.visible = camName !== 'cockpit'; // the eye sits inside the fuselage
    this.view.update(app.camera, camName === 'cockpit');
    if (this.ring) this.ring.update(app.camera);
    if (this.airfield) { const lens = app.camera.fov / 60; for (const ch of this.airfield.children) if (ch.material?.uniforms?.lens) ch.material.uniforms.lens.value = lens; }
    this.ui.root.classList.toggle('view-cockpit', camName === 'cockpit'); this.ui.root.classList.toggle('view-out', camName !== 'cockpit');
    // instruments at ~30 Hz
    this.instT += dt;
    if (this.instT > 1 / 30) {
      this.instT = 0;
      const touch = !this.headless && document.documentElement.classList.contains('is-touch');
      const ap = this.flight.ap, wind = this.flight.weather.wind;
      if (this.inst) this.inst.draw({ sim, ap, ac: this.ac, L: this.ui.L, airport: this.W.airport, hdgMag: this.magOf(sim.euler.psi), radAltFt: Math.max(0, sim.agl / FT), mcp: { spd: ap && ap.at ? this.mcp.spd : null, alt: ap && ap.on ? this.mcp.alt : null }, windFromMag: this.magOf(wind.dir * Math.PI / 180), spoilerArmed: this.c.spoiler < 0, autobrake: this.autobrake }, camName === 'cockpit' && !touch ? 'panel' : 'strip');
      if (this.ac.id === 'b77w') this.ui.showMcp(this.mcpOn && this.state !== 'replay', { ...this.mcp, ab: this.autobrake, spoilerArmed: this.c.spoiler < 0, lit: { AP: ap?.on, AT: ap?.at, LOC: ap && (ap.lat === 'LOC' || ap.locArm), APP: ap && (ap.vert === 'GS' || ap.gsArm), HDG: ap?.on && ap.lat === 'HDG', ALT: ap?.on && (ap.vert === 'ALT' || ap.vert === 'ALT*'), VS: ap?.on && ap.vert === 'VS' } });
      else this.ui.showEngine((this.engOn || !sim.running) && this.state !== 'replay', { ...this.eng, running: sim.running });
      this.ui.setThrottleSlider(this.pilot.thr);
    }
    this.hudT += dt;
    if (this.hudT > 0.1) {
      this.hudT = 0;
      const L = this.ui.L, ap = this.flight.ap;
      let msg = '', cls = 'warn';
      if (this.state === 'replay') { msg = ''; }
      else if (sim.crashed) msg = L.crash[sim.crashed] || sim.crashed;
      else if (sim.stall && !sim.onGround) msg = L.stall;
      else if (!sim.onGround && sim.agl < 500 * FT && sim.vsFpm < -2000) msg = L.pull;
      else if (sim.tailstrike && sim.onGround) msg = L.tail;
      else if (ap && ap.disconnectReason === 'override' && performance.now() - (this.apOffT || 0) < 3000) { msg = L.apOff; cls = 'info'; }
      else if (this.c.park > 0.5 && sim.onGround) { msg = L.parked; cls = 'info'; }
      if (ap && ap.disconnectReason === 'override' && !this.apOffT) this.apOffT = performance.now();
      const camLabel = this.state === 'replay' ? L.replaying + ' · ' + (L.shots[this.cams.shot] || '') : L.cams[camName];
      this.ui.hud({ ac: this.ac.name.replace(' (class)', ''), startName: this.startName, metar: this.wx.metar, cam: camLabel, camSub: this.state === 'paused' ? '⏸' : '', msg, msgCls: cls });
    }
  }

  finish() {
    this.state = 'ended';
    this.lastLog = JSON.parse(JSON.stringify(this.flight.log));
    this.ui.showResult({ crash: this.flight.sim.crashed, landing: this.flight.scorer.landing });
  }

  // ---- replay: re-fly the log (same start, weather, seed, inputs) with the director's cameras
  startReplay() {
    const log = this.lastLog || (this.flight && JSON.parse(JSON.stringify(this.flight.log)));
    if (!log) return;
    this.ui.hideOverlay();
    const f = new Flight(AC[log.aircraft], log.start, log.weather, log.seed, { ground: this.W.ground, ils: this.W.ils, runways: this.W.runways });
    this.replayState = { log, f, c: { ...f.initial, thr: f.initial.thr.slice() }, k: 0, step: 0, acc: 0, t: 0 };
    this.state = 'replay';
    AircraftView.poseOf(f.sim, this.pose0); AircraftView.poseOf(f.sim, this.pose1);
  }
  stopReplay() { this.replayState = null; }
  updateReplay(dt, acts) {
    const R = this.replayState, c = R.c, ch = R.log.changes;
    for (const a of acts) { if (a === 'menu' || a === 'replay') { this.stopReplay(); this.state = 'ended'; this.ui.showResult({ crash: this.flight.sim.crashed, landing: this.flight.scorer.landing }); return; } }
    R.acc += Math.min(dt, 0.25);
    while (R.acc >= DT && R.step < R.log.steps) {
      while (R.k < ch.length && ch[R.k][0] === R.step) { const [, key, v] = ch[R.k++]; if (key.startsWith('thr')) c.thr[Number(key.slice(3))] = v / 1024; else c[key] = v / 1024; }
      AircraftView.poseOf(R.f.sim, this.pose0);
      R.f.step(c); R.step++; R.acc -= DT;
    }
    AircraftView.poseOf(R.f.sim, this.pose1);
    R.t += dt;
    const s = R.f.sim;
    const near = this.W.runways.some((r) => Math.hypot(s.pos[0] - r.thrN, s.pos[1] - r.thrE) < 6000);
    this.cams.shot = this.cams.direct(s, R.t, near);
    const prevAc = this.ac; this.ac = AC[R.log.aircraft];
    this.render(dt, s, R.acc / DT, this.cams.shot);
    this.ac = prevAc;
    if (R.step >= R.log.steps && !R.doneT) R.doneT = performance.now();
    if (R.doneT && performance.now() - R.doneT > 3000) { this.stopReplay(); this.state = 'ended'; this.ui.showResult({ crash: this.flight.sim.crashed, landing: this.flight.scorer.landing }); }
  }

  // browser gate hook: replay a log headless on this page's world and return its hash
  traceOf(log, every = 12) { const out = []; Flight.replay(log, AC[log.aircraft], { ground: this.W.ground, ils: this.W.ils, runways: this.W.runways }, (f, i) => { if (i % every === 0) { const s = f.sim; out.push([i, ...s.pos, ...s.vel, ...s.q, ...s.w, s.rpm, ...s.n1, s.de, s.trimPos, s.alphaDot, s.tas]); } }); return out; }
  hashOf(log) { const f = Flight.replay(log, AC[log.aircraft], { ground: this.W.ground, ils: this.W.ils, runways: this.W.runways }); return { hash: f.finalHash(), pos: f.sim.pos, crashed: f.sim.crashed }; }
  dispose() { this.ui.dispose(); }
}

registerGame('flight', {
  requires: [],
  async init(app) {
    const W = await loadWorld(app);
    const [index, lm] = await Promise.all(['aircraft/index.json', 'landmarks/index.json'].map(async (f) => { const r = await fetch(base() + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); }));
    const tw = lm.landmarks.find((l) => l.slug === 'sfo-tower');
    const tower = tw ? [tw.anchor[0], (tw.ground ?? 0) + 62, tw.anchor[1]] : [-3619, 64, -378];
    const g = new FlightGame(app, W, index, tower);
    g.airfield = buildAirfield(W.airport, (x, z) => app.terrainData.heightAt(x, z));
    app.scene.add(g.airfield);
    if (W.ring && !app.qs.has('noRing')) { g.ring = new Ring(W.ring, W.arrays); await g.ring.build(app.scene, app.quality?.name || 'low'); }
    app.setFreeCam(true);
    app.fly.speed = 60;
    return g;
  },
  update(app, dt, g) { g.update(dt); },
  view(app, g) { return { dispose: () => g.dispose() }; },
});
