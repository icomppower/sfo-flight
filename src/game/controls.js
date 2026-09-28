// Pilot input → the flight model's Controls: keyboard (engine Input), mouse yoke, Gamepad API (remappable, saved per
// viewer in localStorage) and the phone's on-screen stick, throttle slider and buttons. One-shot actions (flaps,
// gear, camera, menu…) come out of `actions` once per press.
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const LS = 'sfo-flight.pad.v1';

export const PAD_ACTIONS = {
  axes: ['elev', 'ail', 'rud', 'thr'],
  buttons: ['brakes', 'flapDown', 'flapUp', 'gear', 'trimDown', 'trimUp', 'thrUp', 'thrDown', 'camera', 'menu', 'ap', 'spoiler'],
};
// standard-mapping gamepads: sticks and face buttons; joysticks (non-standard): X, Y, throttle lever, twist
export const DEFAULT_PAD = {
  standard: { axes: { ail: { i: 0 }, elev: { i: 1, inv: true }, rud: { i: 2 }, thr: null }, thrMode: 'rate',
    buttons: { brakes: 0, flapDown: 1, flapUp: 2, gear: 3, trimDown: 4, trimUp: 5, thrDown: 6, thrUp: 7, camera: 8, menu: 9, ap: 12, spoiler: 13 } },
  joystick: { axes: { ail: { i: 0 }, elev: { i: 1, inv: true }, thr: { i: 2, inv: true }, rud: { i: 5 } }, thrMode: 'absolute',
    buttons: { brakes: 0, flapDown: 1, flapUp: 2, gear: 3, trimDown: 4, trimUp: 5, camera: 6, menu: 7 } },
};
export function loadPadMap(kind) { if (!globalThis.document?.body) return JSON.parse(JSON.stringify(DEFAULT_PAD[kind])); try { const s = JSON.parse(localStorage.getItem(LS) || 'null'); if (s && s[kind]) return s[kind]; } catch { /* storage unavailable */ } return JSON.parse(JSON.stringify(DEFAULT_PAD[kind])); }
export function savePadMap(kind, map) { if (!globalThis.document?.body) return; try { const s = JSON.parse(localStorage.getItem(LS) || '{}') || {}; s[kind] = map; localStorage.setItem(LS, JSON.stringify(s)); } catch { /* ignore */ } }

export class PilotInput {
  constructor(app, dom) {
    this.app = app; this.input = app.input; this.dom = dom;
    this.elev = 0; this.ail = 0; this.rud = 0; this.thr = 0; this.brakes = 0; this.trim = 0;
    this.actions = [];
    this.yoke = false; this.mouse = { x: 0, y: 0 };
    this.touch = { x: 0, y: 0, active: false, thr: null, brakes: false };
    this.kind = null; this.mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    this.pad = null; this.padKind = 'standard'; this.padMap = loadPadMap('standard'); this._btn = [];
    if (typeof window.addEventListener !== 'function') return;
    // one-shot keys, with the modifier as it was at the press (a quick Shift+A is over before the next frame)
    window.addEventListener('keydown', (e) => {
      if (e.repeat || (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))) return;
      const sh = e.shiftKey;
      this.kind = 'kb';
      const act = { KeyF: sh ? 'flapUp' : 'flapDown', KeyG: 'gear', Slash: 'spoiler', KeyC: 'camera', KeyH: 'hud', Escape: 'menu', KeyR: 'replay', KeyP: 'pause', KeyT: sh ? 'toga' : 'toCfg', KeyL: 'ldgCfg' }[e.code]
        || (sh && e.code === 'KeyA' ? 'apPanel' : sh && e.code === 'KeyB' ? 'park' : sh && e.code === 'KeyE' ? 'startEngine' : null);
      if (act) this.press(act);
      if (e.code === 'KeyY') { this.yoke = !this.yoke; this.press('yoke'); }
    });
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.kind = 'touch'; }, true);
    window.addEventListener('mousemove', (e) => { const r = dom.getBoundingClientRect(); this.mouse.x = (e.clientX - r.left) / r.width * 2 - 1; this.mouse.y = (e.clientY - r.top) / r.height * 2 - 1; });
    window.addEventListener('wheel', (e) => { if (this.yoke) this.thr = clamp(this.thr - Math.sign(e.deltaY) * 0.05, 0, 1); }, { passive: true });
    window.addEventListener('gamepadconnected', () => this.pollPad());
  }
  press(a) { this.actions.push(a); }
  // the input the hints are written for: the last one used, else what this device most likely has
  inputKind() {
    if (this.yoke) return 'yoke';
    let k = this.kind;
    if (!k) k = globalThis.document?.documentElement.classList.contains('is-touch') ? 'touch' : this.pad ? 'pad' : 'kb';
    return k === 'kb' && this.mac ? 'mac' : k;
  }
  take() { const a = this.actions; this.actions = []; return a; }

  pollPad() {
    const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean);
    const p = pads[0] || null;
    if (p && (!this.pad || this.pad.id !== p.id)) { this.padKind = p.mapping === 'standard' ? 'standard' : 'joystick'; this.padMap = loadPadMap(this.padKind); }
    this.pad = p;
    return p;
  }

  // one frame of input; `ac` is the aircraft data, `sim` for context (ground speed for the tiller)
  update(dt, c, ac, sim) {
    const I = this.input, k = (code) => I.down(code), hit = (code) => I.hit(code), shift = k('ShiftLeft') || k('ShiftRight');
    // ---- keyboard axes: held keys drive toward ±1, release returns to centre
    const kElev = (k('ArrowUp') || k('KeyW') ? 1 : 0) - (k('ArrowDown') || k('KeyS') ? 1 : 0);
    const kAil = (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || (k('KeyA') && !shift) ? 1 : 0);
    const kRud = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);
    const ease = (v, t, r) => v + clamp(t - v, -r * dt, r * dt);
    let elev = ease(this.elev, kElev * 0.7, 2.2), ail = ease(this.ail, kAil * 0.8, 3), rud = ease(this.rud, kRud, 3);
    if (k('PageUp')) this.thr = clamp(this.thr + 0.5 * dt, 0, 1);
    if (k('PageDown')) this.thr = clamp(this.thr - 0.5 * dt, 0, 1);
    let trim = (k('End') || k('Numpad1') ? 1 : 0) - (k('Home') || k('Numpad7') ? 1 : 0);
    let brakes = k('KeyB') && !shift ? 1 : 0;
    // ---- mouse yoke
    if (this.yoke) { ail = clamp(this.mouse.x / 0.7, -1, 1); elev = clamp(-this.mouse.y / 0.7, -1, 1); }
    // ---- gamepad
    const p = this.pollPad();
    if (p) {
      const M = this.padMap, dz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
      const ax = (a) => (a && p.axes[a.i] != null ? dz(p.axes[a.i]) * (a.inv ? -1 : 1) : null);
      const e = ax(M.axes.elev), a = ax(M.axes.ail), r = ax(M.axes.rud), t = ax(M.axes.thr);
      if ([e, a, r].some((v) => v != null && Math.abs(v) > 0.3)) this.kind = 'pad';
      if (e != null && Math.abs(e) > 0) elev = e; if (a != null && Math.abs(a) > 0) ail = a; if (r != null && Math.abs(r) > 0) rud = r;
      if (t != null) { if (M.thrMode === 'absolute') this.thr = clamp((t + 1) / 2, 0, 1); else this.thr = clamp(this.thr + t * 0.6 * dt, 0, 1); }
      const b = (name) => { const i = M.buttons[name]; const bt = i != null ? p.buttons[i] : null; return bt ? (typeof bt === 'object' ? bt.value || (bt.pressed ? 1 : 0) : bt) : 0; };
      const edge = (name) => { const v = b(name) > 0.5, was = this._btn[name]; this._btn[name] = v; return v && !was; };
      brakes = Math.max(brakes, b('brakes'));
      if (b('thrUp') > 0.1) this.thr = clamp(this.thr + b('thrUp') * 0.5 * dt, 0, 1);
      if (b('thrDown') > 0.1) this.thr = clamp(this.thr - b('thrDown') * 0.5 * dt, 0, 1);
      if (b('trimDown') > 0.5) trim = -1; if (b('trimUp') > 0.5) trim = 1;
      for (const [name, act] of [['flapDown', 'flapDown'], ['flapUp', 'flapUp'], ['gear', 'gear'], ['camera', 'camera'], ['menu', 'menu'], ['ap', 'apToggle'], ['spoiler', 'spoiler']]) if (edge(name)) this.press(act);
    }
    // ---- touch stick / throttle / brakes
    if (this.touch.active) { ail = this.touch.x; elev = this.touch.y; }
    if (this.touch.thr != null) { this.thr = this.touch.thr; this.touch.thr = null; }
    if (this.touch.brakes) brakes = 1;
    this.elev = elev; this.ail = ail; this.rud = rud; this.brakes = brakes; this.trim = trim;
    // ---- into the flight model's controls
    c.elev = elev; c.ail = ail; c.rud = rud; c.trim = trim;
    c.brakeL = c.brakeR = brakes;
    c.thr = c.thr.map(() => this.thr);
    // heavy: the rudder axis turns the nose wheel tiller at taxi speed
    c.tiller = ac.gear.some((g) => g.tillerMax) && sim.onGround && sim.gs < 15 ? rud : 0;
    return c;
  }
}
