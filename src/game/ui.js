// The game's DOM: HUD line, instrument canvas, the 777's mode control panel, the 172's engine switches, the menu,
// the landing-score and crash screens, the gamepad remap screen and the phone controls. It only raises events
// (this.on[...]) and shows state; flight.js owns the logic.
import { T } from './i18n.js';
import { STARTS, RUNWAYS } from './starts.js';
import { PAD_ACTIONS, loadPadMap, savePadMap, DEFAULT_PAD } from './controls.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const TIMES = { dawn: 6.6, day: 12.0, golden: 17.4, night: 20.6 }; // local solar time (the engine's timeOfDay)

export class GameUI {
  constructor(lang, metars, opts) {
    this.lang = lang; this.metars = metars; this.on = {}; this.opts = opts; // opts: { ac, start, rwy, wx, time }
    const root = this.root = el('div', 'sf-root');
    root.innerHTML = `
      <div class="sf-top"><div class="sf-id"><b></b><span></span></div><div class="sf-cam"><em></em><i></i></div></div>
      <div class="sf-msg"></div>
      <canvas class="sf-panel"></canvas>
      <div class="sf-mcp" hidden></div>
      <div class="sf-eng" hidden></div>
      <div class="sf-help"></div>
      <div class="sf-touch">
        <div class="sf-stick"><i></i></div>
        <div class="sf-thr"><input type="range" min="0" max="100" value="0" aria-label="throttle"></div>
        <div class="sf-btns"><button data-a="flapUp">F▲</button><button data-a="flapDown">F▼</button><button data-a="gear">GEAR</button><button data-a="brakes">BRK</button><button data-a="camera">CAM</button><button data-a="apPanel">A/P</button><button data-a="menu">☰</button></div>
      </div>
      <div class="sf-overlay" hidden></div>`;
    document.body.append(root);
    const q = (s) => root.querySelector(s);
    this.dom = { id: q('.sf-id b'), sub: q('.sf-id span'), cam: q('.sf-cam em'), camSub: q('.sf-cam i'), msg: q('.sf-msg'), panel: q('.sf-panel'), mcp: q('.sf-mcp'), eng: q('.sf-eng'), help: q('.sf-help'), overlay: q('.sf-overlay'), stick: q('.sf-stick'), knob: q('.sf-stick i'), thr: q('.sf-thr input'), btns: q('.sf-btns') };
    for (const b of root.querySelectorAll('.sf-btns button')) {
      const a = b.dataset.a;
      if (a === 'brakes') { b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.on.brakes?.(true); }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => this.on.brakes?.(false)); }
      else b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.on.action?.(a); });
    }
    // on-screen stick (capture phase, own pointer id)
    const st = this.dom.stick; let pid = null;
    const move = (e) => { const r = st.getBoundingClientRect(), x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)), y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)); this.dom.knob.style.transform = `translate(${x * 38}px, ${y * 38}px)`; this.on.stick?.(x, y); };
    st.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; st.setPointerCapture(pid); move(e); });
    st.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
    const up = (e) => { if (e.pointerId !== pid) return; pid = null; this.dom.knob.style.transform = ''; this.on.stickEnd?.(); };
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    this.dom.thr.addEventListener('input', () => this.on.throttle?.(Number(this.dom.thr.value) / 100));
    for (const ev of ['pointerdown', 'touchstart']) this.dom.thr.addEventListener(ev, (e) => e.stopPropagation());
    this.setLang(lang);
  }
  setLang(lang) { this.lang = lang; this.L = T(lang); this.dom.help.textContent = this.L.help; document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en'; }

  hud({ ac, startName, metar, cam, camSub, msg, msgCls }) {
    const d = this.dom;
    if (d.id.textContent !== ac) d.id.textContent = ac;
    const sub = `${startName} · ${metar}`; if (d.sub.textContent !== sub) d.sub.textContent = sub;
    if (d.cam.textContent !== cam) d.cam.textContent = cam;
    if (d.camSub.textContent !== camSub) d.camSub.textContent = camSub;
    if (d.msg.textContent !== msg) { d.msg.textContent = msg; d.msg.className = 'sf-msg ' + (msgCls || ''); }
  }
  setThrottleSlider(v) { if (document.activeElement !== this.dom.thr) this.dom.thr.value = String(Math.round(v * 100)); }

  // ---- 777 mode control panel
  showMcp(on, st) {
    const d = this.dom.mcp; d.hidden = !on; if (!on) return;
    const L = this.L.mcp;
    if (!d.dataset.built) {
      d.dataset.built = '1';
      d.innerHTML = `<div class="mcp-row">${['AT', 'AP', 'LOC', 'APP'].map((k) => `<button data-e="${k}">${L[k]}</button>`).join('')}</div>
        ${['SPD', 'HDG', 'ALT', 'VS'].map((k) => `<div class="mcp-knob"><small>${L[k]}</small><button data-k="${k}" data-d="-1">−</button><b data-v="${k}"></b><button data-k="${k}" data-d="1">+</button>${k === 'HDG' ? `<button data-e="HDG">SEL</button>` : k === 'ALT' ? `<button data-e="ALT">HOLD</button>` : k === 'VS' ? `<button data-e="VS">V/S</button>` : ''}</div>`).join('')}
        <div class="mcp-knob"><small>${L.AB}</small><button data-ab="-1">−</button><b data-v="AB"></b><button data-ab="1">+</button><button data-sp="1">SPLR</button></div>`;
      d.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('button'); if (!b) return; e.preventDefault(); e.stopPropagation();
        if (b.dataset.e) this.on.mcpEvent?.(b.dataset.e);
        if (b.dataset.k) this.on.mcpKnob?.(b.dataset.k, Number(b.dataset.d) * (e.shiftKey ? 10 : 1));
        if (b.dataset.ab) this.on.autobrake?.(Number(b.dataset.ab));
        if (b.dataset.sp) this.on.action?.('spoiler');
      });
    }
    const set = (k, v) => { const b = d.querySelector(`[data-v="${k}"]`); if (b.textContent !== v) b.textContent = v; };
    set('SPD', String(st.spd)); set('HDG', String(st.hdg).padStart(3, '0')); set('ALT', String(st.alt)); set('VS', String(st.vs)); set('AB', st.ab ? (st.ab === 5 ? 'MAX' : String(st.ab)) : 'OFF');
    for (const b of d.querySelectorAll('[data-e]')) b.classList.toggle('on', !!st.lit[b.dataset.e]);
    d.querySelector('[data-sp]').classList.toggle('on', st.spoilerArmed);
  }
  // ---- 172 engine switches (cold and dark)
  showEngine(on, st) {
    const d = this.dom.eng; d.hidden = !on; if (!on) return;
    const L = this.L;
    if (!d.dataset.built) {
      d.dataset.built = '1';
      d.innerHTML = `<b>${L.engine}</b><button data-s="master"></button><button data-s="mags"></button><button data-s="mixture"></button><button data-s="starter">${L.starter}</button>`;
      d.addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); e.stopPropagation(); this.on.engineSwitch?.(b.dataset.s, true); });
      d.addEventListener('pointerup', (e) => { const b = e.target.closest('button'); if (b) this.on.engineSwitch?.(b.dataset.s, false); });
    }
    const set = (k, t, lit) => { const b = d.querySelector(`[data-s="${k}"]`); if (t && b.textContent !== t) b.textContent = t; b.classList.toggle('on', lit); };
    set('master', `${L.master} ${st.master ? 'ON' : 'OFF'}`, st.master); set('mags', `${L.mags} ${st.mags ? 'BOTH' : 'OFF'}`, st.mags); set('mixture', `${L.mixture} ${st.mixture ? 'RICH' : 'CUT'}`, st.mixture); set('starter', null, st.running);
  }

  // ---- menu
  showMenu(state) {
    const L = this.L, o = this.opts, d = this.dom.overlay;
    d.hidden = false; d.className = 'sf-overlay sf-menu';
    const opt = (v, t, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${t}</option>`;
    d.innerHTML = `<div class="sf-card">
      <h1>${L.title}</h1><p class="sf-tag">${L.tagline}</p>
      <div class="sf-grid">
        <label>${L.aircraft}<select data-o="ac">${opt('c172', L.c172, o.ac === 'c172')}${opt('b77w', L.b77w, o.ac === 'b77w')}</select></label>
        <label>${L.startAt}<select data-o="start">${STARTS.filter((s) => s !== 'rampCold' || o.ac === 'c172').map((s) => opt(s, L[s], o.start === s)).join('')}</select></label>
        <label>Runway<select data-o="rwy">${RUNWAYS.map((r) => opt(r, r, o.rwy === r)).join('')}</select></label>
        <label>${L.weather}<select data-o="wx">${this.metars.map((m) => opt(m.id, `${m[this.lang === 'zh' ? 'zh' : 'en']}`, o.wx === m.id)).join('')}${opt('custom', L.custom, o.wx === 'custom')}</select></label>
        <label class="sf-custom">${L.wind}<input data-o="wind" placeholder="280/15G22" value="${o.wind || ''}"></label>
        <label class="sf-custom">${L.vis} (SM)<input data-o="vis" inputmode="decimal" value="${o.vis ?? ''}"></label>
        <label>${L.time}<select data-o="time">${Object.keys(TIMES).map((k) => opt(k, L[k], o.time === k)).join('')}</select></label>
        <label>${L.lang}<select data-o="lang">${opt('en', 'English', this.lang === 'en')}${opt('zh', '中文', this.lang === 'zh')}</select></label>
      </div>
      <p class="sf-metar"></p>
      <div class="sf-actions">
        ${state === 'paused' ? `<button data-go="resume" class="primary">${L.resume}</button>` : ''}
        <button data-go="fly" class="${state === 'paused' ? '' : 'primary'}">${L.fly}</button>
        ${state === 'paused' ? `<button data-go="replay">${L.replay}</button>` : ''}
        <button data-go="remap">${L.remap}</button>
      </div>
      <p class="sf-keys">${L.help}</p></div>`;
    const sync = () => {
      for (const s of d.querySelectorAll('[data-o]')) o[s.dataset.o] = s.value;
      d.querySelectorAll('.sf-custom').forEach((x) => { x.hidden = o.wx !== 'custom'; });
      const m = this.metars.find((x) => x.id === o.wx); d.querySelector('.sf-metar').textContent = m ? m.metar : '';
      d.querySelector('[data-o="rwy"]').closest('label').hidden = !['runway', 'final9', 'final3'].includes(o.start);
    };
    d.querySelectorAll('[data-o]').forEach((s) => s.addEventListener('change', () => { sync(); if (s.dataset.o === 'lang') { this.setLang(o.lang); this.showMenu(state); } if (s.dataset.o === 'ac') this.showMenu(state); }));
    d.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { sync(); this.on.menu?.(b.dataset.go, o); }));
    sync();
  }
  hideOverlay() { this.dom.overlay.hidden = true; this.dom.overlay.innerHTML = ''; }

  // ---- end of flight
  showResult(r) {
    const L = this.L, d = this.dom.overlay; d.hidden = false; d.className = 'sf-overlay sf-result';
    const lnd = r.landing;
    d.innerHTML = `<div class="sf-card">
      <h2>${r.crash ? L.crashed : L.landed}${lnd && !r.crash ? ` · ${lnd.runway ?? ''}` : ''}</h2>
      ${r.crash ? `<p class="sf-crash">${L.crash[r.crash] || r.crash}</p>` : ''}
      ${lnd ? `<div class="sf-score"><div class="sf-grade">${lnd.grade}</div><div><b>${lnd.score}</b><small>${L.score}</small></div></div>
      <table>
        <tr><td>${L.sink}</td><td>${Math.round(lnd.sinkFpm)} fpm</td><td>${Math.round(lnd.sinkScore)}</td></tr>
        <tr><td>${L.centre}</td><td>${Math.abs(lnd.xteM).toFixed(1)} m ${lnd.xteM > 0 ? 'R' : 'L'}</td><td>${Math.round(lnd.clScore)}</td></tr>
        <tr><td>${L.tdz}</td><td>${Math.round(lnd.alongM)} m</td><td>${Math.round(lnd.tdzScore)}</td></tr>
        <tr><td>${L.bounces}</td><td>${lnd.bounces}</td><td></td></tr>
        ${lnd.stoppedM != null ? `<tr><td>${L.stop}</td><td>${Math.round(lnd.stoppedM)} m</td><td></td></tr>` : ''}
      </table>` : ''}
      <div class="sf-actions"><button data-go="replay" class="primary">${L.replay}</button><button data-go="again">${L.again}</button><button data-go="menu">${L.menu}</button></div></div>`;
    d.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => this.on.result?.(b.dataset.go)));
  }

  // ---- gamepad remap
  showRemap(kind) {
    const L = this.L, d = this.dom.overlay; d.hidden = false; d.className = 'sf-overlay sf-remap';
    const map = loadPadMap(kind);
    const row = (type, a) => { const v = type === 'axes' ? (map.axes[a] ? `axis ${map.axes[a].i}${map.axes[a].inv ? ' (inv)' : ''}` : '—') : (map.buttons[a] != null ? `button ${map.buttons[a]}` : '—'); return `<tr><td>${a}</td><td>${v}</td><td><button data-bind="${type}:${a}">bind</button></td></tr>`; };
    d.innerHTML = `<div class="sf-card"><h2>${L.remap} · ${kind}</h2><p>${L.axisHelp}</p>
      <table>${PAD_ACTIONS.axes.map((a) => row('axes', a)).join('')}${PAD_ACTIONS.buttons.map((a) => row('buttons', a)).join('')}</table>
      <label>throttle <select data-thr><option value="rate"${map.thrMode === 'rate' ? ' selected' : ''}>rate</option><option value="absolute"${map.thrMode === 'absolute' ? ' selected' : ''}>absolute</option></select></label>
      <div class="sf-actions"><button data-go="reset">${L.reset}</button><button data-go="done" class="primary">${L.done}</button></div></div>`;
    d.querySelector('[data-thr]').addEventListener('change', (e) => { map.thrMode = e.target.value; savePadMap(kind, map); });
    d.querySelectorAll('[data-bind]').forEach((b) => b.addEventListener('click', () => this.on.bind?.(kind, map, b.dataset.bind, () => this.showRemap(kind))));
    d.querySelector('[data-go="reset"]').addEventListener('click', () => { savePadMap(kind, JSON.parse(JSON.stringify(DEFAULT_PAD[kind]))); this.showRemap(kind); });
    d.querySelector('[data-go="done"]').addEventListener('click', () => this.on.remapDone?.());
  }
  dispose() { this.root.remove(); }
}

// the headless App (gates) has no DOM: the same interface, doing nothing
export class NullUI {
  constructor(lang, metars, opts) { this.lang = lang; this.metars = metars; this.opts = opts; this.on = {}; this.L = T(lang); this.dom = { panel: null }; this.root = { classList: { toggle() {} } }; }
  setLang(lang) { this.lang = lang; this.L = T(lang); }
  hud() {} setThrottleSlider() {} showMcp() {} showEngine() {} showMenu() {} hideOverlay() {} showResult() {} showRemap() {} dispose() {}
}
