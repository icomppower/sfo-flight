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
import { MISSIONS, Checklist, ctxOf, hintFor } from './missions.js';
import { applyConfig, toga, TAKEOFF_ITEMS, LANDING_ITEMS } from './config.js';
import { CONFIGS, takeoffTrim, vref, RTO } from '../../fdm/configs.ts';
import { AUTO_EVENT, approachSpeed } from '../../fdm/autoland.ts';
import { RPARAMS, profileOf } from '../../fdm/route.ts';
import { ilsDeviation } from '../../fdm/ils.ts';
import { Guide, bankWarning, KINDS } from './guide.js';
import { ApproachViz, RIBBON, pathPoint } from './approachviz.js';
import { papiRead } from './airfield.js';

const AC = { c172: C172, b77w: B77W };
const FT = 0.3048, KT = 0.514444;
void approachSpeed;
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
    this.timeScale = Math.max(1, Math.min(16, Number(qs.get('timescale')) || 1)); // gate hook: more fixed steps per frame, same flight
    this.hudHidden = false; this.camIdx = 0; this.replayState = null; this.lastLog = null;
    this.mission = null; this.checklist = null; this.bug = null; this.atArm = false;
    this.guideOn = false; this.guide = null; this.gdState = null; this.autoCam = false; this.pendingAuto = 0; this.autoWas = false; this.autoMsgT = 0; this.planKey = ''; this.dirT = 0;
    this.wire();
    const mq = MISSIONS.find((m) => String(m.id) === qs.get('mission'));
    if (mq) this.startMission(mq.id); else if (qs.has('autostart') || qs.has('start')) this.startFlight(); else this.ui.showMenu('menu');
    globalThis.__sfo = this;
    this.tools = { TestPilot, AP_EVENT, MISSIONS, TAKEOFF_ITEMS, LANDING_ITEMS, CONFIGS, takeoffTrim, vref, RTO, papiRead, pathPoint, RIBBON, ilsDeviation, bankWarning }; // page gates: the scripted pilot's control laws (its outputs go through the Gamepad API), the M1.1 tables, the M1.2 references
  }

  wire() {
    const ui = this.ui;
    ui.on.menu = (go, o) => {
      this.opts = o; if (o.lang !== this.lang) { this.lang = o.lang; ui.setLang(o.lang); }
      if (go === 'resume') { ui.hideOverlay(); this.state = this.flight ? 'flying' : 'menu'; }
      else if (go === 'fly') this.startFlight();
      else if (go === 'replay') this.startReplay();
      else if (go === 'remap') ui.showRemap(this.pilot.padKind);
      else if (go === 'checklist') { if (this.checklist) this.checklist.hidden = false; ui.hideOverlay(); this.state = this.flight ? 'flying' : 'menu'; }
    };
    ui.on.mission = (id) => this.startMission(id);
    ui.on.howto = (state) => ui.showHowTo(this.pilot.inputKind(), () => ui.showMenu(state));
    ui.on.config = (w) => this.pilot.press(w === 'takeoff' ? 'toCfg' : w === 'landing' ? 'ldgCfg' : w === 'auto' ? 'autoLand' : w === 'guide' ? 'guide' : 'toga');
    ui.on.checklist = (a) => { if (!this.checklist) return; if (a === 'next') this.checklist.skip(performance.now()); else this.checklist.hidden = true; };
    ui.on.remapDone = () => { this.pilot.padMap = loadPadMap(this.pilot.padKind); ui.showMenu(this.flight && this.state !== 'menu' ? 'paused' : 'menu'); };
    ui.on.bind = (kind, map, what, done) => this.bindNext(kind, map, what, done);
    ui.on.result = (go) => { if (go === 'replay') this.startReplay(); else if (go === 'again') { if (this.mission) this.startMission(this.mission.id); else this.startFlight(); } else { this.state = 'menu'; ui.showMenu('menu'); } };
    ui.on.action = (a) => this.pilot.press(a);
    ui.on.brakes = (on) => { this.pilot.touch.brakes = on; };
    ui.on.stick = (x, y) => { this.pilot.touch.active = true; this.pilot.touch.x = x; this.pilot.touch.y = -y; };
    ui.on.stickEnd = () => { this.pilot.touch.active = false; };
    ui.on.throttle = (v) => { this.pilot.touch.thr = v; };
    ui.on.mcpEvent = (e) => { if (e === 'VS') this.mcp.vs = Math.round(this.flight.sim.vsFpm / 100) * 100; this.pending = AP_EVENT[e === 'VS' ? 'VS' : e]; };
    ui.on.mcpKnob = (k, d) => { const M = this.mcp; if (k === 'SPD') M.spd = clamp(M.spd + d, 60, 340); if (k === 'HDG') M.hdg = ((M.hdg + d) % 360 + 360) % 360; if (k === 'ALT') M.alt = clamp(M.alt + d * 100, 0, 40000); if (k === 'VS') M.vs = clamp(M.vs + d * 100, -6000, 6000); };
    ui.on.autobrake = (d) => { this.autobrake = clamp(this.autobrake + d, 0, RTO); };
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

  // a mission: its start, aircraft, runway, time and weather, and its guided checklist
  startMission(id) {
    const m = MISSIONS.find((x) => x.id === id); if (!m) return;
    this.opts = { ...this.opts, ac: m.ac, start: m.start, rwy: m.rwy, time: m.time, wx: m.wx, lang: this.lang };
    this.ui.opts = this.opts;
    return this.startFlight(m).then(() => { if (m.guide) this.setGuide(true); }); // GUIDE ME on for the landing missions (D23)
  }

  async startFlight(mission = null) {
    const o = this.opts, ac = AC[o.ac], W = this.W, app = this.app;
    this.mission = mission; this.checklist = null; this.ui.hasChecklist = !!mission;
    this.ui.hideOverlay();
    this.stopReplay();
    this.state = 'loading';
    const wx = weatherFrom(new URLSearchParams(o.wx === 'custom' ? `wind=${o.wind}&vis=${o.vis}` : ''), W.metars, o.wx === 'custom' ? null : o.wx);
    if (o.wx === 'custom' && app.qs.get('metar')) Object.assign(wx, weatherFrom(app.qs, W.metars, null));
    this.wx = wx;
    // mission ① starts stabilised in the landing configuration (flaps 30, Vref + 5), like SPEC §11's "already armed"
    const over = mission?.startCfg === 'landing' && o.ac === 'b77w' ? { flap: CONFIGS.b77w.landing.flap, cas: Math.round(vref(ac, makeStart(o.start, o.ac, o.rwy, W).mass) + CONFIGS.b77w.landing.vrefAdd) } : null;
    const start = { ...makeStart(o.start, o.ac, o.rwy, W), ...over, ...o.startOver }; // startOver: a gate fixture (e.g. another heading)
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
    this.bug = null; this.atArm = false; this.cfgApplied = null; this.camIdx0 = this.camIdx; this.cfgMsg = null;
    this.guideOn = false; this.guide = null; this.gdState = null; this.autoCam = false; this.pendingAuto = 0; this.autoWas = false; this.planKey = ''; this.viz?.hide();
    if (mission) this.checklist = new Checklist(mission, performance.now());
  }
  // trim to a setting: the flight model drives it there (at once on the ground, at the trim rate airborne)
  setTrim(v) { this.c.trimSet = 1; this.c.trimTgt = v; }

  magOf(psi) { return ((psi * 180 / Math.PI - this.W.airport.trueNorthGridDeg - this.W.airport.magVar) % 360 + 360) % 360; }
  gridOfMag(m) { return ((m + this.W.airport.magVar + this.W.airport.trueNorthGridDeg) % 360 + 360) % 360; }

  handleActions(actions) {
    const c = this.c, ac = this.ac, ui = this.ui;
    for (const a of actions) {
      if (a === 'menu') { if (this.state === 'flying') { this.state = 'paused'; ui.showMenu('paused'); } else if (this.state === 'paused') { ui.hideOverlay(); this.state = 'flying'; } continue; }
      if (a === 'replay' && (this.state === 'ended' || this.state === 'paused')) { this.startReplay(); continue; }
      if (a === 'camera') { if (this.autoCam) { this.autoCam = false; this.cams.mode = CAMS[this.camIdx]; continue; } this.camIdx = (this.camIdx + 1) % CAMS.length; this.cams.mode = CAMS[this.camIdx]; continue; }
      if (a === 'ribbon') { this.viz?.setRibbon(!this.viz.ribbonOn); continue; }
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
      else if (a === 'toCfg' || a === 'ldgCfg') { const w = a === 'toCfg' ? 'takeoff' : 'landing', why = applyConfig(this, w); this.cfgMsg = { text: why ? ui.L.cfg[why] || '' : ui.L.cfg.set[w], cls: why ? 'warn' : 'info', t: performance.now() }; }
      else if (a === 'toga') toga(this);
      else if (a === 'autoLand') {
        // AUTO LAND (Shift+L / button): a recorded event, so the flight model engages / disengages it in the step
        const sim = this.flight.sim;
        if (!this.flight.auto.on && sim.onGround) this.cfgMsg = { text: ui.L.auto.air, cls: 'warn', t: performance.now() };
        else { this.pendingAuto = AUTO_EVENT.TOGGLE; if (!this.flight.auto.on) { this.pilot.yoke = false; this.pilot.elev = this.pilot.ail = 0; } }
      }
      else if (a === 'guide') this.setGuide(!this.guideOn);
    }
  }

  // GUIDE ME on / off (the route is planned from where the aircraft is now)
  setGuide(on) {
    this.guideOn = on; this.gdState = null;
    if (on && this.flight) { const w = this.flight.weather.wind; this.guide = new Guide(this.ac, this.W, { dir: w.dir, kt: w.kt, gustKt: w.gustKt }); this.guide.start(this.flight.sim); }
    else this.guide = null;
    this.cfgMsg = { text: on ? this.ui.L.auto.guideOn : this.ui.L.auto.guideOff, cls: 'info', t: performance.now() };
    this.planKey = '';
  }
  // the world overlays for the active plan (AUTO LAND's or GUIDE ME's): route line, ribbon, localizer line
  syncViz() {
    const A = this.flight.auto, plan = A.on ? A.plan : this.guideOn && this.guide ? this.guide.plan : null;
    const key = plan ? `${plan.ils.id}|${plan.t}|${plan.fixes.length}|${this.ac.id}` : '';
    if (key === this.planKey || !this.viz) return;
    this.planKey = key;
    if (!plan) { this.viz.hide(); return; }
    const P = RPARAMS[this.ac.id];
    this.viz.setApproach(plan.ils, this.ac.id, P.dFafNm, P.dJoinNm);
    this.viz.setRoute(profileOf(plan, this.ac.id, Math.max(this.flight.sim.gs, 40)));
  }
  // guide / captions / ILS / cue / assist, for the HUD (10 Hz)
  approachHud(sim) {
    const ui = this.ui, L = ui.L, A = this.flight.auto, now = performance.now();
    // GUIDE ME bar
    let lines = null;
    if (this.guideOn && this.guide && !A.on && this.state === 'flying' && !sim.crashed) {
      const st = this.gdState = this.guide.update(sim, { flap: this.c.flap, gear: this.c.gear, ldgSet: this.cfgApplied === 'landing', thr: this.c.thr[0], brakes: this.c.brakeL });
      const fmt = (t, o) => t.replace(/\{(\w+)\}/g, (m, k) => o[k] ?? '');
      const text = (it) => { const G = L.gd; if (it.kind === 'turn') return fmt(it.now ? G.turnNow : G.turn, { dir: G[it.dir > 0 ? 'R' : 'L'], h: String(Math.round(this.magOf(it.hdg * Math.PI / 180))).padStart(3, '0') }); const phone = document.documentElement.classList.contains('is-touch'); return fmt((phone && G[it.kind + 'Short']) || G[it.kind], { a: (it.alt ?? 0).toLocaleString('en-US'), v: it.spd, d: it.deg }); };
      if (this.flight.ap?.on) lines = [{ kind: 'ap', text: L.auto.apFlying, now: true }];
      else lines = st.items.map((it) => ({ ...it, text: text(it) }));
      if (st.warn === 'bank') lines.unshift({ kind: 'bank', text: L.gd.bank, now: true, warn: true });
    }
    ui.showGuide(lines);
    // captions (AUTO LAND's phases, each for 4 s; the engage caption names the runway)
    const cap = A.captions.length ? A.captions[A.captions.length - 1] : null;
    ui.showCaption(cap && sim.t - cap.t < 4 ? L.cap[cap.id].replace('{rwy}', A.rwy?.id ?? '') : null);
    // ILS diamonds for the planned runway
    const rw = A.on ? A.rwy : this.guideOn && this.guide ? this.guide.rwy : null;
    if (rw) { const d = ilsDeviation(rw, sim.pos[0], sim.pos[1], sim.altMsl); ui.showIls(d.valid && d.distNm < 30 ? { loc: d.locDots, gs: d.gsDots, rwy: rw.id } : null); } else ui.showIls(null);
    // GAME ASSIST label (light single) / AUTO LAND modes (heavy)
    if (A.on) {
      const as = A.assist, ap = this.flight.ap, g = A.g;
      ui.showAssist(as ? `${L.auto.assist} · ${as.lat} ${as.lat === 'HDG' ? String(Math.round(this.magOf(as.hdg * Math.PI / 180))).padStart(3, '0') : ''} · ${as.vert} ${as.vert === 'ALT' ? Math.round(as.alt / FT) : ''} · ${as.spd} kt · ${A.rwy.id}` : `${L.auto.land} · ${A.rwy.id} · ${ap.lat}/${ap.vert} · ${A.cfg.spd} kt${g ? ' · ' + g.dtgNm.toFixed(1) + ' NM' : ''}`);
    } else ui.showAssist(null);
    // the cue: the target on the horizon (heading and flight path the guide wants), projected into the screen
    if (this.gdState?.cue && this.guideOn && !A.on && !sim.onGround) {
      const c = this.gdState.cue, cam = this.app.camera, D = Math.PI / 180, h = c.hdg * D, gm = c.gamma || 0;
      const p = new cam.position.constructor(cam.position.x + Math.sin(h) * Math.cos(gm) * 3000, cam.position.y + Math.sin(gm) * 3000, cam.position.z - Math.cos(h) * Math.cos(gm) * 3000);
      p.project(cam);
      const W = innerWidth, H = innerHeight, behind = p.z > 1 || p.z < -1;
      let x = (p.x * 0.5 + 0.5) * W, y = (-p.y * 0.5 + 0.5) * H;
      const onScreen = !behind && x > 24 && x < W - 24 && y > 24 && y < H - 24;
      let ang = 0;
      if (!onScreen) { let dx = x - W / 2, dy = y - H / 2; if (behind) { dx = -dx; dy = -dy; } ang = Math.atan2(dy, dx) + Math.PI / 2; const k = Math.min((W / 2 - 30) / Math.abs(dx || 1e-6), (H / 2 - 30) / Math.abs(dy || 1e-6)); x = W / 2 + dx * k; y = H / 2 + dy * k; }
      ui.showCue({ x, y, onScreen, ang });
    } else ui.showCue(null);
    void now; void KINDS;
  }

  update(dt) {
    const app = this.app;
    if (!app.freeCam) app.setFreeCam(true); // F is the flaps here, not the engine's walk/fly toggle
    if (app.autopilot) app.setAutopilot(false); // G is the gear here, not the ferry autopilot
    if (app.settings.timeSpeed) app.settings.timeSpeed = 0; // T is TAKEOFF CONFIG here, not the engine's time toggle
    if (app.localLights?.flashlight?.on) app.localLights.toggleFlashlight(false); // L is LANDING CONFIG, not the flashlight
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
      this.acc += Math.min(dt, 0.25) * this.timeScale;
      let n = 0;
      while (this.acc >= DT && n < 40 * this.timeScale) {
        if (this.pending) { c.ap = this.pending; this.pending = 0; }
        if (this.pendingAuto) { c.auto = this.pendingAuto; this.pendingAuto = 0; }
        AircraftView.poseOf(sim, this.pose0);
        this.flight.step(c);
        c.ap = 0; c.auto = 0; this.acc -= DT; n++;
      }
      // AUTO LAND hands its settings back into the controls every step (fdm/flight.ts): keep the page's own copies
      // (MCP, autobrake, throttle lever, the 172's speed bug) in step with them
      const A = this.flight.auto;
      if (A.on || this.autoWas) {
        if (this.ac.id === 'b77w') { this.mcp.spd = Math.round(c.mcpSpd); this.mcp.hdg = Math.round(this.magOf(c.mcpHdg * Math.PI / 180)) % 360; this.mcp.alt = Math.round(c.mcpAlt / 100) * 100; this.mcp.vs = Math.round(c.mcpVs / 100) * 100; this.autobrake = c.autobrake; }
        else if (A.landingSet) this.bug = A.cfg.spd;
        this.pilot.thr = c.thr[0];
        if (A.landingSet) this.cfgApplied = 'landing';
      }
      if (A.on && !this.autoWas) { this.autoCam = true; this.guideOn = false; this.guide = null; this.gdState = null; }
      if (!A.on && this.autoWas) { this.autoCam = false; if (!A.done) this.autoMsgT = performance.now(); }
      this.autoWas = A.on;
      this.airfield?.userData.approach?.setBoost(A.on || this.guideOn ? 1 : 0);
      this.syncViz();
      AircraftView.poseOf(sim, this.pose1);
      // a trim setting is done once reached, or when the pilot trims; RTO disarms after lift-off; the A/T arm clears
      if (c.trimSet && (c.trim !== 0 || Math.abs(sim.trimPos - c.trimTgt) < 1e-6)) c.trimSet = 0;
      if (this.autobrake === RTO && !sim.onGround && sim.agl > 10) this.autobrake = 0;
      if (this.atArm && this.flight.ap?.at) this.atArm = false;
      if (this.checklist) { const x = ctxOf(this); this.checklist.update(x, performance.now()); this.onFrame?.(this, x); }
      if ((sim.crashed || this.flight.scorer.landing?.complete) && !this.endT) this.endT = performance.now();
      if (this.endT && performance.now() - this.endT > (sim.crashed ? 1500 : 2500) && this.state === 'flying') this.finish();
    }
    this.render(dt, sim, this.acc / DT, this.cams.mode);
  }

  render(dt, sim, alpha, camName) {
    const app = this.app;
    // AUTO LAND's director (C returns to the chosen camera)
    if (this.state === 'flying' && this.autoCam && this.flight.auto.on) { this.dirT += dt; camName = this.cams.lastAuto = this.cams.directAuto(sim, this.dirT, this.flight.auto); }
    this.view.apply(this.pose0, this.pose1, clamp(alpha, 0, 1));
    const ground = (x, z) => this.W.ground.heightXZ(x, z);
    if (camName !== 'free') this.cams.place(dt, this.view, sim, camName, ground);
    this.view.ext.visible = camName !== 'cockpit'; // the eye sits inside the fuselage
    this.view.update(app.camera, camName === 'cockpit');
    if (this.ring) this.ring.update(app.camera);
    this.airfield?.userData.approach?.update([app.camera.position.x, app.camera.position.y, app.camera.position.z]);
    if (this.airfield) { const lens = app.camera.fov / 60; for (const ch of this.airfield.children) if (ch.material?.uniforms?.lens) ch.material.uniforms.lens.value = lens; }
    this.ui.root.classList.toggle('view-cockpit', camName === 'cockpit'); this.ui.root.classList.toggle('view-out', camName !== 'cockpit');
    // instruments at ~30 Hz
    this.instT += dt;
    if (this.instT > 1 / 30) {
      this.instT = 0;
      const touch = !this.headless && document.documentElement.classList.contains('is-touch');
      const ap = this.flight.ap, wind = this.flight.weather.wind;
      if (this.inst) this.inst.draw({ sim, ap, ac: this.ac, L: this.ui.L, airport: this.W.airport, hdgMag: this.magOf(sim.euler.psi), radAltFt: Math.max(0, sim.agl / FT), mcp: { spd: ap && ap.at ? this.mcp.spd : null, alt: ap && ap.on ? this.mcp.alt : null }, bug: this.bug, windFromMag: this.magOf(wind.dir * Math.PI / 180), spoilerArmed: this.c.spoiler < 0, autobrake: this.autobrake }, camName === 'cockpit' && !touch ? 'panel' : 'strip');
      if (this.ac.id === 'b77w') this.ui.showMcp(this.mcpOn && this.state !== 'replay', { ...this.mcp, ab: this.autobrake, atArm: this.atArm, spoilerArmed: this.c.spoiler < 0, lit: { AP: ap?.on, AT: ap?.at, LOC: ap && (ap.lat === 'LOC' || ap.locArm), APP: ap && (ap.vert === 'GS' || ap.gsArm), HDG: ap?.on && ap.lat === 'HDG', ALT: ap?.on && (ap.vert === 'ALT' || ap.vert === 'ALT*'), VS: ap?.on && ap.vert === 'VS' } });
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
      else if (bankWarning(sim, this.flight.auto.margin.deg)) msg = L.bankWarn;
      else if (sim.stall && !sim.onGround) msg = L.stall;
      else if (!sim.onGround && sim.agl < 500 * FT && sim.vsFpm < -2000) msg = L.pull;
      else if (sim.tailstrike && sim.onGround) msg = L.tail;
      else if (ap && ap.disconnectReason === 'override' && performance.now() - (this.apOffT || 0) < 3000) { msg = L.apOff; cls = 'info'; }
      else if (this.autoMsgT && performance.now() - this.autoMsgT < 3000) { msg = L.auto.off; cls = 'info'; }
      else if (this.cfgMsg && performance.now() - this.cfgMsg.t < 2500) { msg = this.cfgMsg.text; cls = this.cfgMsg.cls; }
      else if (this.c.park > 0.5 && sim.onGround) { msg = L.parked; cls = 'info'; }
      if (ap && ap.disconnectReason === 'override' && !this.apOffT) this.apOffT = performance.now();
      const camLabel = this.state === 'replay' ? L.replaying + ' · ' + (L.shots[this.cams.shot] || '') : this.autoCam && this.flight.auto.on ? L.auto.land + ' · ' + (L.shots[this.cams.lastAuto] || '') : L.cams[camName];
      const live = this.state === 'flying' || this.state === 'paused';
      this.ui.setCfgBar(live, { onGround: sim.onGround, toga: this.ac.id === 'b77w' && sim.onGround, auto: this.flight.auto.on, guide: this.guideOn });
      if (live) this.approachHud(sim); else { this.ui.showGuide(null); this.ui.showCaption(null); this.ui.showIls(null); this.ui.showCue(null); this.ui.showAssist(null); }
      const K = this.checklist;
      this.ui.showChecklist(live && K && !K.hidden ? { mission: K.m.id, i: K.i, n: K.m.steps.length, ids: K.m.steps.map((x) => x.id), step: K.step?.id, done: K.done, hint: K.step ? hintFor(this.lang, K.step.hint, this.pilot.inputKind()) : '', live: K.step?.live ? K.step.live(ctxOf(this), this.lang) : '' } : null);
      this.ui.hud({ ac: this.ac.name.replace(' (class)', ''), startName: this.startName, metar: this.wx.metar, cam: camLabel, camSub: this.state === 'paused' ? '⏸' : '', msg, msgCls: cls });
    }
  }

  finish() {
    this.state = 'ended';
    this.lastLog = JSON.parse(JSON.stringify(this.flight.log));
    this.ui.showResult(this.resultOf());
  }
  // the result screen's facts: the crash, in plain words with its number (D24), and the landing
  resultOf() {
    const s = this.flight.sim, r = { crash: s.crashed, landing: this.flight.scorer.landing, why: '' };
    const I = s.crashInfo, W = this.ui.L.why;
    if (s.crashed && I && W[s.crashed]) r.why = W[s.crashed].replace('{bank}', Math.abs(I.bank).toFixed(0)).replace('{pitch}', Math.abs(I.pitch).toFixed(0)).replace('{sink}', Math.round(Math.max(0, I.sinkFpm) / 10) * 10).replace('{cas}', Math.round(I.cas)).replace('{nz}', I.nz.toFixed(1));
    return r;
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
    for (const a of acts) { if (a === 'menu' || a === 'replay') { this.stopReplay(); this.state = 'ended'; this.ui.showResult(this.resultOf()); return; } }
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
    if (R.doneT && performance.now() - R.doneT > 3000) { this.stopReplay(); this.state = 'ended'; this.ui.showResult(this.resultOf()); }
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
    g.viz = new ApproachViz(app.scene, (x, z) => app.terrainData.heightAt(x, z));
    if (W.ring && !app.qs.has('noRing')) { g.ring = new Ring(W.ring, W.arrays); await g.ring.build(app.scene, app.quality?.name || 'low'); }
    app.setFreeCam(true);
    app.fly.speed = 60;
    return g;
  },
  update(app, dt, g) { g.update(dt); },
  view(app, g) { return { dispose: () => g.dispose() }; },
});
