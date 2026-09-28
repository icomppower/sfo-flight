// F7 Page: the production build (vite build + npm audit) in real Chrome (WebGPU):
//  - desktop 1440×900: the menu drives the start (clicks); a C172 flies a right-hand traffic pattern on 28R from the
//    runway to a full stop, closed-loop by a robot pilot whose outputs reach the aircraft only through a joystick
//    fixture on the Gamepad API and keyboard keys (flaps, brakes); the landing-score screen appears; the 777 flies the
//    ILS 28R from 9 NM on its autopilot engaged by clicks on the mode control panel, to an autoland and a stop; the
//    replay plays with the director's cameras; the gamepad remap screen opens;
//  - phone 390×844 (touch, zh): Chinese UI, no horizontal overflow, the stick, the throttle slider and every button
//    hit-tested with elementFromPoint and working (stick rolls the aircraft, slider sets the power, flaps move).
// --negative: a button covered by another element, an English-only page, a joystick axis that never reaches the
// aircraft and a page error must each fail.
import { execFileSync } from 'node:child_process';
import { root, gate } from './lib/common.mjs';
import { serve, launch, openPage, sleep } from './lib/browser.mjs';

const PAD = () => { const pad = { id: 'SFO fixture joystick', index: 0, connected: true, mapping: '', timestamp: 0, axes: [0, 0, 1, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__padBroken ? null : pad]; window.__pad = pad; };

// the robot: the test pilot's control laws, on the live sim, written to the joystick fixture every frame
const ROBOT = () => {
  const g = window.__sfo, pad = window.__pad, TP = g.tools.TestPilot, D = Math.PI / 180, FT = 0.3048;
  const R = g.W.runways.find((r) => r.id === '28R');
  const u = [Math.cos(R.crs * D), Math.sin(R.crs * D)], rt = [-u[1], u[0]], thrH = g.W.ils.find((i) => i.id === '28R').thrH;
  const st = window.__robot = { phase: 'roll', flaps: 0, brakes: false, log: [], done: false };
  let P = null, c = { elev: 0, ail: 0, rud: 0, thr: [1], trim: 0 }, flareSink = 0, flareTh = 0;
  const put = (i, v) => { pad.axes[i] = v === 0 ? 0 : Math.sign(v) * (Math.min(1, Math.abs(v)) * 0.92 + 0.08); };
  const tick = () => {
    const s = g.flight?.sim; if (!s || g.state === 'ended' || st.done) { st.done = true; return; }
    if (!P || P.sim !== s) P = new TP(s, 0.6);
    const e = s.euler, dn = s.pos[0] - R.thrN, de = s.pos[1] - R.thrE, along = dn * u[0] + de * u[1], lat = dn * rt[0] + de * rt[1];
    const agl = s.altMsl - thrH - 1.0, hdgTo = (h) => ((h % 360) + 360) % 360;
    const set = (p) => { if (st.phase !== p) { st.phase = p; st.log.push([p, Math.round(s.t)]); P.thetaCmd = null; P.gamSpd = null; } };
    let T;
    switch (st.phase) {
      case 'roll': T = { pitch: e.theta, thr: 1, bank: 0 }; if (s.cas > 52) set('rotate'); break;
      case 'rotate': T = { pitch: 9 * D, thr: 1, bank: 0 }; if (agl > 60 * FT) set('climb'); break;
      case 'climb': T = { cas: 75, speedOnPitch: true, thr: 1, hdg: R.crs }; if (agl > 600 * FT) set('xwind'); break;
      case 'xwind': T = agl < 1000 * FT - 30 ? { cas: 75, speedOnPitch: true, thr: 1, hdg: hdgTo(R.crs + 90) } : { alt: thrH + 1000 * FT, cas: 90, hdg: hdgTo(R.crs + 90) }; if (lat > 1400) set('downwind'); break;
      case 'downwind': T = { alt: thrH + 1000 * FT, cas: 90, hdg: hdgTo(R.crs + 180) }; if (along < -2400) { set('base'); st.flaps = 2; } break;
      case 'base': T = { vs: -2.6, cas: 72, hdg: hdgTo(R.crs + 270) }; if (lat < 450) { set('final'); st.flaps = 3; } break;
      case 'final': { const gp = Math.max(0, 300 - along) * Math.tan(3 * D); T = { gamma: -3 * D + Math.max(-0.05, Math.min(0.05, (gp - agl) * 0.01)), cas: 65, track: { n: R.thrN, e: R.thrE, crs: R.crs } }; if (agl < 15 * FT) { set('flare'); flareSink = Math.abs(s.vel[2]); flareTh = e.theta; } break; }
      case 'flare': { const vs = -Math.max(agl / (15 * FT) * flareSink, 0.35); T = { pitch: flareTh + Math.max(-0.02, Math.min(0.12, (vs + s.vel[2]) * 0.05)), thr: 0, track: { n: R.thrN, e: R.thrE, crs: R.crs } }; if (s.onGround && s.touchdowns.length) set('rollout'); break; }
      case 'rollout': T = { pitch: e.theta, thr: 0, bank: 0 }; st.brakes = s.cas < 50; st.flaps = 0; if (g.flight.scorer.landing?.complete) st.done = true; break;
    }
    P.fly(c, T);
    if (s.onGround) { const he = ((R.crs - e.psi / D + 540) % 360) - 180; c.rud = Math.max(-1, Math.min(1, he * D * 5 - lat * 0.01)); if (st.phase === 'roll' || st.phase === 'rollout') c.ail = 0; }
    put(0, c.ail); put(1, -c.elev); pad.axes[2] = 1 - 2 * Math.max(0, Math.min(1, c.thr[0])); put(5, c.rud);
    pad.buttons[4] = { pressed: c.trim < -0.3, value: c.trim < -0.3 ? 1 : 0 }; pad.buttons[5] = { pressed: c.trim > 0.3, value: c.trim > 0.3 ? 1 : 0 };
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function desktop(br, url, fx = {}) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(m); return ok; };
  const { page, errors } = await openPage(br, url, { query: '&lang=en', init: PAD });
  try { await (async () => {
    // ---- menu → C172, runway 28R, calm
    await page.waitForSelector('.sf-menu select[data-o="ac"]', { timeout: 20000 });
    await page.select('.sf-menu select[data-o="ac"]', 'c172');
    await page.select('.sf-menu select[data-o="start"]', 'runway');
    await page.select('.sf-menu select[data-o="rwy"]', '28R');
    await page.select('.sf-menu select[data-o="wx"]', 'calm');
    await page.select('.sf-menu select[data-o="time"]', 'day');
    await page.click('.sf-menu button[data-go="fly"]');
    await page.waitForFunction(() => window.__sfo.state === 'flying', { timeout: 30000 });
    if (fx.padBroken) await page.evaluate(() => { window.__padBroken = true; });
    await page.evaluate(ROBOT);
    // keyboard: flaps as the robot asks, brakes held on the rollout
    let flaps = 0, braking = false, t0 = Date.now(), phase = '', tPhase = Date.now();
    await page.keyboard.press('KeyF'); // flaps 10 for the take-off (keyboard path)
    flaps = 1;
    while (Date.now() - t0 < 600000) {
      const r = await page.evaluate(() => ({ ...window.__robot, flap: window.__sfo.flight.sim.flapIdx, state: window.__sfo.state, crashed: window.__sfo.flight.sim.crashed, cas: window.__sfo.flight.sim.cas, alt: window.__sfo.flight.sim.altMsl }));
      if (r.phase !== phase) { phase = r.phase; tPhase = Date.now(); console.log(`  c172 ${phase} (cas ${r.cas.toFixed(0)} kt, alt ${(r.alt / 0.3048).toFixed(0)} ft)`); }
      if (phase === 'climb' && flaps === 1 && r.alt > 150) { await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyF'); await page.keyboard.up('ShiftLeft'); flaps = 0; }
      while (r.flaps > flaps) { await page.keyboard.press('KeyF'); flaps++; }
      if (r.brakes && !braking) { await page.keyboard.down('KeyB'); braking = true; }
      if (r.done || r.crashed || r.state === 'ended') break;
      if (Date.now() - tPhase > 150000) { console.log(`  c172 robot stuck in ${phase}`); break; }
      await sleep(250);
    }
    if (braking) await page.keyboard.up('KeyB');
    await page.waitForFunction(() => window.__sfo.state === 'ended', { timeout: 30000 }).catch(() => {});
    const c1 = await page.evaluate(() => ({ state: window.__sfo.state, crashed: window.__sfo.flight.sim.crashed, landing: window.__sfo.flight.scorer.landing, log: window.__robot.log, result: !!document.querySelector('.sf-result .sf-grade'), thrAxis: window.__sfo.pilot.thr }));
    console.log(`  c172 pattern: ${JSON.stringify(c1.log)} → ${c1.crashed ? 'crashed ' + c1.crashed : c1.landing ? `landed ${c1.landing.runway} score ${c1.landing.score} (${c1.landing.grade}), sink ${Math.round(c1.landing.sinkFpm)} fpm, ${Math.round(c1.landing.alongM)} m past the threshold` : 'no landing'}`);
    req(!c1.crashed && c1.landing?.complete && c1.landing.runway === '28R', `C172 pattern did not complete: crashed ${c1.crashed}, landing ${JSON.stringify(c1.landing)}`);
    req(c1.log.some((p) => p[0] === 'downwind') && c1.log.some((p) => p[0] === 'base'), `C172 did not fly the pattern legs: ${JSON.stringify(c1.log)}`);
    req(c1.result, 'the landing-score screen did not appear');
    // ---- replay with the director
    await page.click('.sf-result button[data-go="replay"]');
    await page.waitForFunction(() => window.__sfo.state === 'replay', { timeout: 10000 });
    const shots = new Set();
    for (let i = 0; i < 24; i++) { await sleep(1000); shots.add(await page.evaluate(() => window.__sfo.cams.shot)); }
    console.log(`  replay director shots: ${[...shots].join(', ')}`);
    req(shots.size >= 2, `the replay director used ${shots.size} shot(s)`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__sfo.state === 'ended', { timeout: 10000 });
    // ---- 777 ILS 28R from 9 NM through the menu and the MCP
    await page.click('.sf-result button[data-go="menu"]');
    await page.waitForSelector('.sf-menu select[data-o="ac"]');
    await page.select('.sf-menu select[data-o="ac"]', 'b77w');
    await page.waitForSelector('.sf-menu select[data-o="start"]');
    await page.select('.sf-menu select[data-o="start"]', 'final9');
    await page.select('.sf-menu select[data-o="rwy"]', '28R');
    await page.select('.sf-menu select[data-o="wx"]', 'westerly');
    await page.click('.sf-menu button[data-go="fly"]');
    await page.waitForFunction(() => window.__sfo.state === 'flying' && window.__sfo.ac.id === 'b77w', { timeout: 30000 });
    await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyA'); await page.keyboard.up('ShiftLeft');
    await page.waitForSelector('.sf-mcp:not([hidden]) button[data-e="AP"]', { timeout: 5000 });
    for (const e of ['AT', 'AP', 'APP']) { await page.click(`.sf-mcp button[data-e="${e}"]`); await sleep(150); }
    const ap = await page.evaluate(() => ({ on: window.__sfo.flight.ap.on, at: window.__sfo.flight.ap.at, gsArm: window.__sfo.flight.ap.gsArm || window.__sfo.flight.ap.vert === 'GS', lat: window.__sfo.flight.ap.lat }));
    req(ap.on && ap.at && ap.gsArm, `MCP clicks did not engage A/P + A/T + APP: ${JSON.stringify(ap)}`);
    let slowed = false; const t1 = Date.now();
    while (Date.now() - t1 < 480000) {
      const r = await page.evaluate(() => { const g = window.__sfo, s = g.flight.sim, d = g.flight.ap.dev; return { nm: d ? d.distNm : 99, state: g.state, crashed: s.crashed, landed: !!g.flight.scorer.landing?.complete, vert: g.flight.ap.vert }; });
      if (!slowed && r.nm < 6) { for (let k = 0; k < 2; k++) await page.keyboard.press('KeyF'); for (let k = 0; k < 16; k++) { await page.click('.sf-mcp button[data-k="SPD"][data-d="-1"]'); } slowed = true; }
      if (r.landed || r.crashed || r.state === 'ended') break;
      await sleep(500);
    }
    await page.waitForFunction(() => window.__sfo.state === 'ended', { timeout: 30000 }).catch(() => {});
    const c2 = await page.evaluate(() => ({ crashed: window.__sfo.flight.sim.crashed, landing: window.__sfo.flight.scorer.landing, flap: window.__sfo.flight.sim.flapIdx, mcpSpd: window.__sfo.mcp.spd }));
    console.log(`  777 ILS: ${c2.crashed ? 'crashed ' + c2.crashed : c2.landing ? `landed ${c2.landing.runway} score ${c2.landing.score} (${c2.landing.grade}), sink ${Math.round(c2.landing.sinkFpm)} fpm, stopped ${Math.round(c2.landing.stoppedM ?? -1)} m` : 'no landing'} (flaps ${c2.flap}, SPD ${c2.mcpSpd})`);
    req(!c2.crashed && c2.landing?.complete && c2.landing.runway === '28R', `777 ILS did not complete: ${JSON.stringify(c2)}`);
    // ---- remap screen
    await page.click('.sf-result button[data-go="menu"]');
    await page.click('.sf-menu button[data-go="remap"]');
    const rows = await page.$$eval('.sf-remap [data-bind]', (b) => b.length);
    req(rows >= 16, `remap screen lists ${rows} bindable actions`);
    const errs = errors.filter((e) => !/favicon/.test(e));
    req(!errs.length, `page errors: ${errs.slice(0, 3).join(' | ')}`);
  })(); } catch (e) { fail.push(`desktop flow stopped: ${e.message.split('\n')[0]}`); } finally { await page.close(); }
  return fail;
}

async function phone(br, url, fx = {}) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(m); return ok; };
  const { page, errors } = await openPage(br, url, { viewport: { width: 390, height: 844 }, touch: true, query: `&touch${fx.english ? '' : '&lang=zh'}&ac=c172&start=runway&rwy=28R&wx=calm&hour=12` });
  try {
    await page.waitForFunction(() => window.__sfo.state === 'flying', { timeout: 30000 });
    if (fx.injectError) await page.evaluate(() => { setTimeout(() => { throw new Error('injected fixture error'); }, 0); });
    await sleep(800);
    if (fx.cover) await page.evaluate(() => { const b = document.querySelector('.sf-btns button[data-a="gear"]').getBoundingClientRect(); const d = document.createElement('div'); d.style.cssText = `position:fixed;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;z-index:99;pointer-events:auto`; document.body.append(d); });
    const L = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.sf-stick, .sf-thr input, .sf-btns button')];
      const hits = els.map((e) => { const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, h = document.elementFromPoint(x, y); return { id: e.dataset.a || e.className || e.tagName, ok: !!h && (h === e || e.contains(h) || h.closest('.sf-stick') === e), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, r: [r.left, r.top, r.right, r.bottom] }; });
      const over = []; for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) { const a = hits[i].r, b = hits[j].r; if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) over.push(hits[i].id + '/' + hits[j].id); }
      return { hits, over, sw: document.documentElement.scrollWidth, lang: document.documentElement.lang, title: document.querySelector('.sf-cam em')?.textContent, help: document.querySelector('.sf-btns')?.textContent };
    });
    console.log(`  phone: ${L.hits.length} controls, ${L.hits.filter((h) => h.ok && h.inView).length} hit and in view, overlaps ${L.over.length}, scrollWidth ${L.sw}, lang ${L.lang}, camera label "${L.title}"`);
    for (const h of L.hits) req(h.ok && h.inView, `phone control ${h.id} not reachable (hit ${h.ok}, in view ${h.inView})`);
    req(!L.over.length, `phone controls overlap: ${L.over.join(', ')}`);
    req(L.sw <= 390, `horizontal overflow: scrollWidth ${L.sw}`);
    req(L.lang === 'zh-Hant' && /[一-鿿]/.test(L.title || ''), `UI not in Chinese: lang ${L.lang}, "${L.title}"`);
    // the controls work: stick rolls, slider sets power, flaps button
    const box = async (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    const [sx, sy, sw, sh] = await box('.sf-stick');
    const a0 = await page.evaluate(() => window.__sfo.flight.sim.da);
    await page.touchscreen.touchStart(sx + sw / 2, sy + sh / 2); await page.touchscreen.touchMove(sx + sw * 0.95, sy + sh / 2); await sleep(400);
    const a1 = await page.evaluate(() => window.__sfo.flight.sim.da);
    await page.touchscreen.touchEnd();
    req(a1 > a0 + 0.05, `stick: aileron ${a0.toFixed(3)} → ${a1.toFixed(3)} rad`);
    const [tx, ty, tw, th] = await box('.sf-thr input');
    await page.touchscreen.touchStart(tx + tw / 2, ty + th - 4); await page.touchscreen.touchMove(tx + tw / 2, ty + 6); await page.touchscreen.touchEnd(); await sleep(1500);
    const rpm = await page.evaluate(() => ({ thr: window.__sfo.pilot.thr, rpm: window.__sfo.flight.sim.rpm }));
    req(rpm.thr > 0.8 && rpm.rpm > 1800, `throttle slider: lever ${rpm.thr.toFixed(2)}, ${Math.round(rpm.rpm)} rpm`);
    const f0 = await page.evaluate(() => window.__sfo.c.flap);
    const [bx, by, bw, bh] = await box('.sf-btns button[data-a="flapDown"]');
    await page.touchscreen.tap(bx + bw / 2, by + bh / 2); await sleep(300);
    const f1 = await page.evaluate(() => window.__sfo.c.flap);
    req(f1 === f0 + 1, `flaps button: ${f0} → ${f1}`);
    console.log(`  phone controls: aileron ${a0.toFixed(2)} → ${a1.toFixed(2)} rad, throttle ${rpm.thr.toFixed(2)} (${Math.round(rpm.rpm)} rpm), flaps ${f0} → ${f1}`);
    const errs = errors.filter((e) => !/favicon/.test(e));
    req(!errs.length, `phone page errors: ${errs.slice(0, 3).join(' | ')}`);
  } finally { await page.close(); }
  return fail;
}

async function check(fx = {}) {
  const fail = [];
  execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore' });
  const audit = JSON.parse(execFileSync('npm', ['audit', '--json', '--omit=dev'], { cwd: root, encoding: 'utf8' }).toString() || '{}');
  const v = audit.metadata?.vulnerabilities || {}; const bad = (v.high || 0) + (v.critical || 0);
  console.log(`build ok; npm audit (production): ${JSON.stringify(v)}`);
  if (bad) fail.push(`npm audit: ${bad} high/critical vulnerabilities`);
  const srv = await serve(), br = await launch();
  try {
    if (!fx.phoneOnly) fail.push(...await desktop(br, srv.url, fx));
    fail.push(...await phone(br, srv.url, fx));
  } finally { await br.close(); srv.close(); }
  return fail;
}
if (process.argv[1]?.endsWith('f7.mjs')) await gate('F7', () => check(), [
  ['a phone button covered', () => check({ phoneOnly: true, cover: true })],
  ['English-only page', () => check({ phoneOnly: true, english: true })],
  ['joystick axes never reach the aircraft', () => check({ padBroken: true })],
  ['a page error', () => check({ phoneOnly: true, injectError: true })],
]);
