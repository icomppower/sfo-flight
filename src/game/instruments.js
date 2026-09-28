// Instruments, drawn on a canvas the game owns (bottom of the screen in the cockpit view, a compact strip in the
// outside views): the light single's six-pack, tachometer, fuel, flaps and trim; the heavy's primary flight display,
// navigation display and an engine / configuration strip. They read the Sim (and the autopilot) only.
const D = Math.PI / 180, FT = 0.3048;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const C = { bg: '#101216', face: '#15171b', rim: '#2a2d33', ink: '#eef2f6', dim: '#8d96a0', green: '#3ad06a', white: '#f4f4f4', yellow: '#f2c230', red: '#e5413a', sky: '#2f6fb5', gnd: '#7b5530', mag: '#e36be0', cyan: '#4fd4ff', amber: '#ffb000' };

export class Instruments {
  constructor(canvas) { this.cv = canvas; this.g = canvas.getContext('2d'); this.lastT = 0; }
  // hdg: magnetic heading of the aircraft (deg); ctx: { sim, ap, ac, mcp, lang, mag (grid→magnetic offset), ils }
  draw(ctx, mode) {
    const cv = this.cv, g = this.g, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!w || !h) return;
    if (mode === 'strip') return this.strip(ctx, w, h, dpr);
    g.fillStyle = C.bg; g.fillRect(0, 0, w, h);
    if (ctx.ac.id === 'c172') this.sixPack(ctx, w, h, dpr); else this.glass(ctx, w, h, dpr);
  }

  // ---------------------------------------------------------------- common bits
  dial(x, y, r) { const g = this.g; g.fillStyle = C.face; g.strokeStyle = C.rim; g.lineWidth = r * 0.06; g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill(); g.stroke(); }
  needle(x, y, r, a, col = C.white, w = 0.05) { const g = this.g; g.strokeStyle = col; g.lineWidth = r * w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x - Math.sin(a) * r * 0.12, y + Math.cos(a) * r * 0.12); g.lineTo(x + Math.sin(a) * r * 0.86, y - Math.cos(a) * r * 0.86); g.stroke(); g.fillStyle = C.rim; g.beginPath(); g.arc(x, y, r * 0.07, 0, 7); g.fill(); }
  text(t, x, y, px, col = C.ink, align = 'center', bold = false) { const g = this.g; g.fillStyle = col; g.font = `${bold ? 700 : 500} ${px}px "JetBrains Mono", ui-monospace, monospace`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t, x, y); }
  arcBand(x, y, r, a0, a1, col, w) { const g = this.g; g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, r, a0 - Math.PI / 2, a1 - Math.PI / 2); g.stroke(); }
  ticks(x, y, r, from, to, step, map, label, px) {
    const g = this.g;
    for (let v = from; v <= to + 1e-6; v += step) {
      const a = map(v), major = label(v) != null;
      g.strokeStyle = C.ink; g.lineWidth = major ? r * 0.03 : r * 0.015;
      g.beginPath(); g.moveTo(x + Math.sin(a) * r * (major ? 0.78 : 0.85), y - Math.cos(a) * r * (major ? 0.78 : 0.85)); g.lineTo(x + Math.sin(a) * r * 0.94, y - Math.cos(a) * r * 0.94); g.stroke();
      const L = label(v); if (L != null) this.text(L, x + Math.sin(a) * r * 0.62, y - Math.cos(a) * r * 0.62, px);
    }
  }

  // ---------------------------------------------------------------- light single
  sixPack(ctx, w, h) {
    const s = ctx.sim, g = this.g, e = s.euler;
    const rows = 2, cols = 4, r = Math.min(w / (cols * 2.3), h / (rows * 2.25)), gx = w / 2 - (cols - 1) * r * 1.15, gy = h / 2 - r * 1.1;
    const at = (i, j) => [gx + i * r * 2.3, gy + j * r * 2.2];
    // airspeed: 0–200 kt over 330°
    { const [x, y] = at(0, 0); this.dial(x, y, r); const m = (v) => clamp(v, 0, 200) / 200 * 330 * D + 15 * D;
      this.arcBand(x, y, r * 0.9, m(40), m(85), C.white, r * 0.06); this.arcBand(x, y, r * 0.96, m(48), m(129), C.green, r * 0.06); this.arcBand(x, y, r * 0.96, m(129), m(163), C.yellow, r * 0.06); this.arcBand(x, y, r * 0.96, m(162.5), m(164), C.red, r * 0.08);
      this.ticks(x, y, r, 40, 200, 10, m, (v) => (v % 20 === 0 ? String(v) : null), r * 0.15); this.text('KNOTS', x, y + r * 0.35, r * 0.11, C.dim); this.needle(x, y, r, m(s.cas)); }
    // attitude
    { const [x, y] = at(1, 0); this.dial(x, y, r); g.save(); g.beginPath(); g.arc(x, y, r * 0.9, 0, 7); g.clip();
      g.translate(x, y); g.rotate(-e.phi); const py = e.theta / D * r * 0.045;
      g.fillStyle = C.sky; g.fillRect(-r * 2, -r * 2 + py, r * 4, r * 2); g.fillStyle = C.gnd; g.fillRect(-r * 2, py, r * 4, r * 2);
      g.strokeStyle = C.white; g.lineWidth = r * 0.02; for (const p of [-20, -10, 10, 20]) { const yy = py - p * r * 0.045; g.beginPath(); g.moveTo(-r * 0.22, yy); g.lineTo(r * 0.22, yy); g.stroke(); }
      g.beginPath(); g.moveTo(-r, py); g.lineTo(r, py); g.stroke(); g.restore();
      g.strokeStyle = C.amber; g.lineWidth = r * 0.05; g.beginPath(); g.moveTo(x - r * 0.45, y); g.lineTo(x - r * 0.15, y); g.lineTo(x - r * 0.08, y + r * 0.08); g.moveTo(x + r * 0.45, y); g.lineTo(x + r * 0.15, y); g.lineTo(x + r * 0.08, y + r * 0.08); g.stroke(); }
    // altimeter
    { const [x, y] = at(2, 0); this.dial(x, y, r); const ft = s.altMsl / FT; const m = (v) => (v % 1000) / 1000 * 2 * Math.PI;
      this.ticks(x, y, r, 0, 900, 100, (v) => v / 1000 * 2 * Math.PI, (v) => String(v / 100), r * 0.16);
      this.text(String(Math.round(ft)).padStart(5, ' '), x, y + r * 0.38, r * 0.14, C.ink, 'center', true);
      this.needle(x, y, r * 0.6, (ft % 10000) / 10000 * 2 * Math.PI, C.white, 0.09); this.needle(x, y, r, m(ft)); }
    // turn coordinator
    { const [x, y] = at(0, 1); this.dial(x, y, r); const rate = clamp(s.w[2] / (3 * D), -2, 2);
      g.save(); g.translate(x, y); g.rotate(rate * 15 * D); g.strokeStyle = C.white; g.lineWidth = r * 0.06; g.beginPath(); g.moveTo(-r * 0.6, 0); g.lineTo(r * 0.6, 0); g.moveTo(0, 0); g.lineTo(0, -r * 0.15); g.stroke(); g.restore();
      g.fillStyle = '#222'; g.fillRect(x - r * 0.45, y + r * 0.35, r * 0.9, r * 0.18); g.fillStyle = C.ink; g.beginPath(); g.arc(x + clamp(-s.beta / (8 * D), -1, 1) * r * 0.36, y + r * 0.44, r * 0.08, 0, 7); g.fill();
      this.text('L', x - r * 0.72, y + r * 0.18, r * 0.14); this.text('R', x + r * 0.72, y + r * 0.18, r * 0.14); this.text('2 MIN', x, y - r * 0.45, r * 0.1, C.dim); }
    // heading indicator (magnetic)
    { const [x, y] = at(1, 1); this.dial(x, y, r); const hd = ctx.hdgMag;
      g.save(); g.translate(x, y); g.rotate(-hd * D);
      for (let a = 0; a < 360; a += 10) { g.rotate(10 * D); g.strokeStyle = C.ink; g.lineWidth = r * 0.02; g.beginPath(); g.moveTo(0, -r * 0.88); g.lineTo(0, -r * (a % 30 === 20 ? 0.72 : 0.8)); g.stroke(); if (a % 30 === 20) { const v = (a + 10) % 360; this.text(v === 0 ? 'N' : v === 90 ? 'E' : v === 180 ? 'S' : v === 270 ? 'W' : String(v / 10), 0, -r * 0.6, r * 0.15); } }
      g.restore(); g.fillStyle = C.amber; g.beginPath(); g.moveTo(x, y - r * 0.9); g.lineTo(x - r * 0.07, y - r * 0.75); g.lineTo(x + r * 0.07, y - r * 0.75); g.fill();
      g.strokeStyle = C.amber; g.lineWidth = r * 0.04; g.beginPath(); g.moveTo(x, y - r * 0.35); g.lineTo(x, y + r * 0.3); g.moveTo(x - r * 0.25, y); g.lineTo(x + r * 0.25, y); g.stroke(); }
    // vertical speed ±2000 fpm
    { const [x, y] = at(2, 1); this.dial(x, y, r); const m = (v) => -90 * D + clamp(v, -2000, 2000) / 2000 * 170 * D;
      this.ticks(x, y, r, -2000, 2000, 500, m, (v) => (v % 1000 === 0 ? String(Math.abs(v / 100)) : null), r * 0.15); this.text('VS ×100', x + r * 0.2, y, r * 0.1, C.dim); this.needle(x, y, r, m(s.vsFpm)); }
    // tachometer
    { const [x, y] = at(3, 0); this.dial(x, y, r); const m = (v) => -120 * D + clamp(v, 0, 3500) / 3500 * 240 * D;
      this.arcBand(x, y, r * 0.95, m(2100), m(2700), C.green, r * 0.06); this.arcBand(x, y, r * 0.95, m(2690), m(2710), C.red, r * 0.1);
      this.ticks(x, y, r, 0, 3500, 500, m, (v) => (v % 500 === 0 ? String(v / 100) : null), r * 0.14); this.text('RPM', x, y + r * 0.38, r * 0.11, C.dim); this.needle(x, y, r, m(s.rpm)); }
    // fuel / flaps / trim
    { const [x, y] = at(3, 1), L = ctx.L; g.fillStyle = C.face; g.fillRect(x - r, y - r, r * 2, r * 2);
      const bar = (yy, frac, label, col) => { this.text(label, x - r * 0.9, yy, r * 0.13, C.dim, 'left'); g.fillStyle = '#2a2d33'; g.fillRect(x - r * 0.1, yy - r * 0.08, r * 1.0, r * 0.16); g.fillStyle = col; g.fillRect(x - r * 0.1, yy - r * 0.08, r * clamp(frac, 0, 1), r * 0.16); };
      bar(y - r * 0.6, s.fuel / s.ac.mass.fuelMax.v, L.fuel, C.green); bar(y - r * 0.15, s.flapDeg / 30, L.flaps, C.white); bar(y + r * 0.3, (0.25 - s.trimPos) / 0.5, L.trim, C.cyan);
      this.text(`${Math.round(s.flapDeg)}°`, x + r * 0.95, y - r * 0.15, r * 0.12, C.ink, 'right');
      this.text(s.brakeL > 0.3 ? L.brakes.toUpperCase() : '', x, y + r * 0.72, r * 0.14, C.red, 'center', true); }
  }

  // ---------------------------------------------------------------- heavy: PFD + ND + strip
  glass(ctx, w, h) {
    // PFD | ND | engine strip, centred, clear of the engine's panel rail on the right edge
    const pad = h * 0.04, ew = h * 0.5, pw = Math.min(h * 1.05, w * 0.36), nw = Math.min(h * 1.05, w * 0.34);
    const total = pw + nw + ew + pad * 2, x0 = Math.max(pad, (w - 80 * (window.devicePixelRatio || 1) - total) / 2);
    this.pfd(ctx, x0, pad, pw, h - pad * 2);
    this.nd(ctx, x0 + pw + pad, pad, nw, h - pad * 2);
    this.eicas(ctx, x0 + pw + nw + pad * 2, pad, ew, h - pad * 2);
  }
  pfd(ctx, x0, y0, w, h) {
    const g = this.g, s = ctx.sim, e = s.euler, ap = ctx.ap;
    g.fillStyle = '#000'; g.fillRect(x0, y0, w, h);
    const cx = x0 + w * 0.5, cy = y0 + h * 0.52, ar = Math.min(w * 0.3, h * 0.34);
    // attitude
    g.save(); g.beginPath(); g.rect(cx - ar, cy - ar, ar * 2, ar * 2); g.clip(); g.translate(cx, cy); g.rotate(-e.phi);
    const pp = ar / 20, py = e.theta / D * pp;
    g.fillStyle = C.sky; g.fillRect(-ar * 3, -ar * 3 + py, ar * 6, ar * 3); g.fillStyle = C.gnd; g.fillRect(-ar * 3, py, ar * 6, ar * 3);
    g.strokeStyle = C.white; g.lineWidth = 2;
    for (let p = -30; p <= 30; p += 2.5) { if (!p) continue; const yy = py - p * pp, half = p % 10 === 0 ? ar * 0.3 : p % 5 === 0 ? ar * 0.16 : ar * 0.08; g.beginPath(); g.moveTo(-half, yy); g.lineTo(half, yy); g.stroke(); if (p % 10 === 0) this.text(String(Math.abs(p)), -half - ar * 0.1, yy, ar * 0.09); }
    g.beginPath(); g.moveTo(-ar * 3, py); g.lineTo(ar * 3, py); g.stroke(); g.restore();
    // aircraft symbol, bank pointer
    g.strokeStyle = '#000'; g.fillStyle = C.amber; g.fillRect(cx - ar * 0.55, cy - 3, ar * 0.3, 6); g.fillRect(cx + ar * 0.25, cy - 3, ar * 0.3, 6); g.fillRect(cx - 4, cy - 4, 8, 8);
    g.save(); g.translate(cx, cy); g.rotate(-e.phi); g.fillStyle = C.white; g.beginPath(); g.moveTo(0, -ar * 0.98); g.lineTo(-7, -ar * 0.88); g.lineTo(7, -ar * 0.88); g.fill(); g.restore();
    if (s.stall) this.text(ctx.L.stall, cx, cy - ar * 0.55, ar * 0.16, C.red, 'center', true);
    // speed tape
    const tw = w * 0.14, th = ar * 2, sx = x0 + w * 0.04, ty = cy - ar;
    g.fillStyle = '#333a44'; g.fillRect(sx, ty, tw, th);
    g.save(); g.beginPath(); g.rect(sx, ty, tw, th); g.clip();
    for (let v = Math.floor((s.cas - 60) / 10) * 10; v <= s.cas + 60; v += 10) { const yy = cy - (v - s.cas) * th / 120; g.strokeStyle = C.white; g.beginPath(); g.moveTo(sx + tw - 8, yy); g.lineTo(sx + tw, yy); g.stroke(); if (v % 20 === 0 && v >= 0) this.text(String(v), sx + tw * 0.45, yy, th * 0.045); }
    if (ctx.mcp.spd) { const yy = cy - (ctx.mcp.spd - s.cas) * th / 120; g.fillStyle = C.mag; g.fillRect(sx + tw - 10, yy - 3, 10, 6); }
    g.restore();
    g.fillStyle = '#000'; g.fillRect(sx, cy - th * 0.05, tw, th * 0.1); g.strokeStyle = C.white; g.strokeRect(sx, cy - th * 0.05, tw, th * 0.1);
    this.text(String(Math.round(s.cas)), sx + tw / 2, cy, th * 0.06, C.white, 'center', true);
    this.text(String(ctx.mcp.spd || Math.round(s.cas)), sx + tw / 2, ty - th * 0.05, th * 0.05, C.mag);
    // altitude tape
    const ax = x0 + w * 0.82, ft = s.altMsl / FT;
    g.fillStyle = '#333a44'; g.fillRect(ax, ty, tw, th);
    g.save(); g.beginPath(); g.rect(ax, ty, tw, th); g.clip();
    for (let v = Math.floor((ft - 600) / 100) * 100; v <= ft + 600; v += 100) { const yy = cy - (v - ft) * th / 1200; g.strokeStyle = C.white; g.beginPath(); g.moveTo(ax, yy); g.lineTo(ax + 8, yy); g.stroke(); if (v % 200 === 0) this.text(String(v), ax + tw * 0.55, yy, th * 0.04); }
    if (ctx.mcp.alt != null) { const yy = clamp(cy - (ctx.mcp.alt - ft) * th / 1200, ty, ty + th); g.fillStyle = C.mag; g.fillRect(ax, yy - 3, 10, 6); }
    g.restore();
    g.fillStyle = '#000'; g.fillRect(ax, cy - th * 0.05, tw * 1.05, th * 0.1); g.strokeStyle = C.white; g.strokeRect(ax, cy - th * 0.05, tw * 1.05, th * 0.1);
    this.text(String(Math.round(ft)), ax + tw / 2, cy, th * 0.055, C.white, 'center', true);
    this.text(String(ctx.mcp.alt ?? ''), ax + tw / 2, ty - th * 0.05, th * 0.05, C.mag);
    // vertical speed
    const vx = ax + tw * 1.15, vs = s.vsFpm; g.fillStyle = '#333a44'; g.fillRect(vx, ty + th * 0.15, w * 0.035, th * 0.7);
    g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.moveTo(vx, cy); g.lineTo(vx + w * 0.035, cy - clamp(vs / 6000, -1, 1) * th * 0.35); g.stroke();
    this.text(Math.abs(vs) > 400 ? String(Math.round(vs / 50) * 50) : '', vx + w * 0.02, vs > 0 ? ty + th * 0.1 : ty + th * 0.9, th * 0.04);
    // heading strip
    const hy = y0 + h * 0.93, hd = ctx.hdgMag; g.fillStyle = '#333a44'; g.fillRect(cx - ar, hy - h * 0.04, ar * 2, h * 0.08);
    g.save(); g.beginPath(); g.rect(cx - ar, hy - h * 0.04, ar * 2, h * 0.08); g.clip();
    for (let a = Math.floor(hd / 5) * 5 - 40; a <= hd + 40; a += 5) { const xx = cx + (a - hd) * ar / 40; g.strokeStyle = C.white; g.beginPath(); g.moveTo(xx, hy - h * 0.04); g.lineTo(xx, hy - h * (a % 10 === 0 ? 0.015 : 0.03)); g.stroke(); if (a % 10 === 0) this.text(String(((a % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), xx, hy + h * 0.012, h * 0.028); }
    g.restore(); this.text(String(Math.round(((hd % 360) + 360) % 360)).padStart(3, '0'), cx, hy - h * 0.065, h * 0.035, C.white, 'center', true);
    // ILS deviation
    const d = ap && ap.dev && ap.ilsSel ? ap.dev : null;
    if (d && d.distNm < 30) {
      const dot = ar * 0.18;
      g.strokeStyle = C.white; for (const k of [-2, -1, 1, 2]) { g.beginPath(); g.arc(cx + k * dot, cy + ar * 1.08, 3, 0, 7); g.stroke(); g.beginPath(); g.arc(cx + ar * 1.08, cy + k * dot, 3, 0, 7); g.stroke(); }
      g.fillStyle = C.mag; const lx = cx - clamp(d.locDots, -2.5, 2.5) * dot, gy = cy + clamp(d.gsDots, -2.5, 2.5) * dot;
      g.beginPath(); g.moveTo(lx, cy + ar * 1.08 - 6); g.lineTo(lx + 6, cy + ar * 1.08); g.lineTo(lx, cy + ar * 1.08 + 6); g.lineTo(lx - 6, cy + ar * 1.08); g.fill();
      g.beginPath(); g.moveTo(cx + ar * 1.08 - 6, gy); g.lineTo(cx + ar * 1.08, gy - 6); g.lineTo(cx + ar * 1.08 + 6, gy); g.lineTo(cx + ar * 1.08, gy + 6); g.fill();
      this.text(`ILS ${ap.ilsSel.id}  ${d.distNm.toFixed(1)} NM`, cx - ar, y0 + h * 0.13, h * 0.032, C.mag, 'left');
    }
    // radio altitude
    const ra = ctx.radAltFt; if (ra < 2500) this.text(String(Math.round(ra)), cx, cy + ar * 0.8, ar * 0.13, ra < 500 ? C.amber : C.white, 'center', true);
    // FMA
    const fma = ap ? [ap.at ? 'SPD' : '', ap.on ? (ap.lat === 'ROLLOUT' ? 'ROLLOUT' : ap.lat) + (ap.locArm ? ' · LOC' : '') : '', ap.on ? (ap.vert === 'ALT*' ? 'ALT*' : ap.vert) + (ap.gsArm ? ' · G/S' : '') : ''] : ['', '', ''];
    fma.forEach((t, i) => this.text(t, x0 + w * (0.2 + i * 0.3), y0 + h * 0.05, h * 0.035, C.green));
    if (ap && ap.on) this.text('A/P', cx, y0 + h * 0.18, h * 0.035, C.green, 'center', true);
  }
  nd(ctx, x0, y0, w, h) {
    const g = this.g, s = ctx.sim;
    if (w < 60) return;
    g.fillStyle = '#000'; g.fillRect(x0, y0, w, h);
    const cx = x0 + w / 2, cy = y0 + h * 0.82, R = Math.min(w * 0.48, h * 0.72), hd = ctx.hdgMag, range = ctx.ndRange || 10;
    g.strokeStyle = C.white; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R, -Math.PI * 0.85, -Math.PI * 0.15); g.stroke();
    for (let a = -60; a <= 60; a += 10) { const m = Math.round(hd + a); const aa = (Math.floor(m / 10) * 10 - hd) * D; g.beginPath(); g.moveTo(cx + Math.sin(aa) * R, cy - Math.cos(aa) * R); g.lineTo(cx + Math.sin(aa) * R * 0.95, cy - Math.cos(aa) * R * 0.95); g.stroke(); }
    for (let v = Math.ceil((hd - 50) / 30) * 30; v <= hd + 50; v += 30) { const aa = (v - hd) * D; this.text(String(((v % 360) + 360) % 360 / 10).padStart(2, '0'), cx + Math.sin(aa) * R * 0.88, cy - Math.cos(aa) * R * 0.88, h * 0.035); }
    // track line first (the runways and the course draw over it)
    { const trk = Math.atan2(s.vel[1], s.vel[0]) - s.euler.psi; g.strokeStyle = C.green; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(trk) * R, cy - Math.cos(trk) * R); g.stroke(); }
    // runways within range, drawn from their ends (grid → heading-up), and the tuned localizer course
    const toScreen = (n, e) => { const dn = n - s.pos[0], de = e - s.pos[1]; const gh = s.euler.psi; const x = de * Math.cos(gh) - dn * Math.sin(gh), y = dn * Math.cos(gh) + de * Math.sin(gh); return [cx + x / (range * 1852) * R, cy - y / (range * 1852) * R]; };
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    g.strokeStyle = C.white; g.lineWidth = 3;
    for (const r of ctx.airport.runways) { const [a, b] = r.ends; const p = toScreen(-a.end[1], a.end[0]), q = toScreen(-b.end[1], b.end[0]); g.beginPath(); g.moveTo(...p); g.lineTo(...q); g.stroke(); }
    if (ctx.ap && ctx.ap.ilsSel) { const I = ctx.ap.ilsSel, L = 15 * 1852; const p = toScreen(I.thrN, I.thrE), q = toScreen(I.thrN - Math.cos(I.crs * D) * L, I.thrE - Math.sin(I.crs * D) * L); g.strokeStyle = C.mag; g.lineWidth = 1.5; g.setLineDash([8, 6]); g.beginPath(); g.moveTo(...p); g.lineTo(...q); g.stroke(); g.setLineDash([]); }
    g.restore();
    // own ship, track
    g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy - 12); g.lineTo(cx - 8, cy + 8); g.moveTo(cx, cy - 12); g.lineTo(cx + 8, cy + 8); g.stroke();
    // wind
    const wn = s.windNed, ws = Math.hypot(wn[0], wn[1]) / 0.514444; if (ws > 1) { const wd = Math.atan2(wn[1], wn[0]) - s.euler.psi; const wx = x0 + w * 0.12, wy = y0 + h * 0.2; g.strokeStyle = C.white; g.beginPath(); g.moveTo(wx - Math.sin(wd) * 18, wy + Math.cos(wd) * 18); g.lineTo(wx + Math.sin(wd) * 18, wy - Math.cos(wd) * 18); g.stroke(); this.text(`${Math.round(ctx.windFromMag).toString().padStart(3, '0')}°/${Math.round(ws)}`, wx, wy + 30, h * 0.03); }
    this.text(`GS ${Math.round(s.gs / 0.514444)}  TAS ${Math.round(s.tas / 0.514444)}`, x0 + 6, y0 + h * 0.06, h * 0.032, C.white, 'left');
    this.text(`${range} NM`, x0 + w - 6, y0 + h * 0.06, h * 0.03, C.cyan, 'right');
  }
  eicas(ctx, x0, y0, w, h) {
    const g = this.g, s = ctx.sim, L = ctx.L;
    g.fillStyle = '#000'; g.fillRect(x0, y0, w, h);
    const n1 = s.n1, r = Math.min(w * 0.2, h * 0.14);
    n1.forEach((v, i) => { const x = x0 + w * (0.28 + i * 0.44), y = y0 + h * 0.2; g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, -Math.PI, -Math.PI + 1.3 * Math.PI * clamp(v / 110, 0, 1) - 0.0001); g.stroke(); g.strokeStyle = '#555'; g.beginPath(); g.arc(x, y, r, -Math.PI, 0.3 * Math.PI); g.stroke(); this.text(v.toFixed(1), x, y + r * 0.7, r * 0.45, C.white, 'center', true); });
    this.text('N1', x0 + w / 2, y0 + h * 0.2, r * 0.4, C.cyan);
    const row = (i, k, v, col = C.white) => { this.text(k, x0 + w * 0.08, y0 + h * (0.45 + i * 0.09), h * 0.04, C.dim, 'left'); this.text(v, x0 + w * 0.92, y0 + h * (0.45 + i * 0.09), h * 0.042, col, 'right', true); };
    row(0, L.flaps, s.flapIdx ? String(s.ac.flaps.detents[s.flapIdx]) : 'UP', Math.abs(s.flapDeg - s.ac.flaps.detents[s.flapIdx]) > 0.3 ? C.mag : C.green);
    row(1, L.gear, s.gearPos > 0.99 ? 'DOWN' : s.gearPos < 0.01 ? 'UP' : 'TRANSIT', s.gearPos > 0.99 ? C.green : s.gearPos < 0.01 ? C.white : C.amber);
    row(2, 'SPLR', ctx.spoilerArmed ? 'ARMED' : s.spoilerPos > 0.05 ? 'EXT' : '—', ctx.spoilerArmed ? C.green : s.spoilerPos > 0.05 ? C.amber : C.white);
    row(3, 'A/BRK', ctx.autobrake ? (ctx.autobrake === 5 ? 'MAX' : String(ctx.autobrake)) : 'OFF', ctx.autobrake ? C.green : C.white);
    row(4, L.fuel, `${(s.fuel / 1000).toFixed(1)} t`);
    row(5, L.trim, `${(-s.trimPos / D).toFixed(1)}`, C.cyan);
    if (s.brakeL > 0.5 && s.onGround) this.text(L.parked, x0 + w / 2, y0 + h * 0.97, h * 0.04, C.amber, 'center', true);
  }

  // outside views and phones: a compact strip
  strip(ctx, w, h) {
    const g = this.g, s = ctx.sim, L = ctx.L;
    g.fillStyle = 'rgba(8,14,22,0.55)'; g.fillRect(0, 0, w, h);
    const items = [['KIAS', Math.round(s.cas)], ['ALT', Math.round(s.altMsl / FT)], ['V/S', Math.round(s.vsFpm / 50) * 50], ['HDG', String(Math.round(((ctx.hdgMag % 360) + 360) % 360)).padStart(3, '0')], [s.ac.id === 'c172' ? 'RPM' : 'N1', s.ac.id === 'c172' ? Math.round(s.rpm) : s.n1[0].toFixed(0)], [L.flaps, s.ac.flaps.detents[s.flapIdx]]];
    const cw = w / items.length;
    items.forEach(([k, v], i) => { this.text(k, cw * (i + 0.5), h * 0.3, h * 0.2, C.dim); this.text(String(v), cw * (i + 0.5), h * 0.68, h * 0.32, C.ink, 'center', true); });
    if (s.stall) this.text(L.stall, w / 2, h * 0.5, h * 0.4, C.red, 'center', true);
  }
}
