// The flight game in the real App (harbor-engine/tools/headless/app.mjs, Dawn on Metal): a scripted flight at the low
// tier, frame time = CPU + GPU serialised, triangles and draws per frame, GPU memory (footprint "(graphics)"), errors.
// One App per process, so gates spawn it:
//   node gates/lib/flight-headless.mjs --minutes 10 [--uhd] [--leak] [--heavy] [--error]      prints RESULT {...}
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(k);
export function gpuMemory(pid) {
  const r = spawnSync('footprint', ['-f', 'bytes', String(pid)], { encoding: 'utf8' });
  let gpu = 0;
  for (const line of (r.stdout || '').split('\n')) { const m = line.match(/^\s*(\d+)\s*B?\s+(\d+)\s*B?\s+(\d+)\s*B?\s+(\d+)\s+(.+)$/); if (m && /\(graphics\)/i.test(m[5])) gpu += Number(m[1]); }
  return gpu / 2 ** 20;
}
export function runChild(args) {
  const r = spawnSync(process.execPath, [join(root, 'gates/lib/flight-headless.mjs'), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 3600000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error('headless run failed: ' + (r.stderr || '').slice(-800));
  return JSON.parse(line.slice(7));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.env.HARBOR_TITLE = root;
  const minutes = Number(arg('--minutes', '10')), uhd = flag('--uhd');
  const { AP_EVENT } = await import('../../fdm/autopilot.ts');
  await import('../../src/game/flight.js');
  const { bootApp } = await import('harbor-engine/tools/headless/app.mjs');
  const H = await bootApp({ width: uhd ? 3840 : 1920, height: uhd ? 2160 : 1080, query: '?noAudio&tier=low&ac=b77w&start=ggb&cam=chase&autostart' });
  const app = H.app, errors = [];
  const origErr = console.error; console.error = (...a) => { errors.push(a.join(' ')); origErr(...a); };
  for (let k = 0; k < 50 && globalThis.__sfo?.state !== 'flying'; k++) { H.frames(1, 1 / 30); await new Promise((r) => setTimeout(r, 50)); }
  const g = globalThis.__sfo;
  if (flag('--leak')) for (let i = 0; i < 6; i++) { const b = H.GPU.device.createBuffer({ size: 256 * 2 ** 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); H.GPU.queue.writeBuffer(b, 0, new Uint8Array(256 * 2 ** 20).fill(1)); }
  if (flag('--heavy')) { const { BufferGeometry, BufferAttribute, Mesh } = await import('harbor-engine/src/engine/index.js'); const { Material } = await import('harbor-engine'); const n = 1500000, P = new Float32Array(n * 9); for (let i = 0; i < P.length; i++) P[i] = (i % 3 === 1 ? 50 : 0) + ((i * 7919) % 1000) * 0.01; const geo = new BufferGeometry(); geo.setAttribute('position', new BufferAttribute(P, 3)); const m = new Mesh(geo, new Material({ name: 'heavy' })); m.frustumCulled = false; app.scene.add(m); }
  const frames = Math.round(minutes * 60 * 30), dt = 1 / 30, half = Math.floor(frames / 2);
  const cams = ['chase', 'cockpit', 'tower', 'chase'];
  const script = async (i) => {
    const t = i * dt;
    // segment A: over the Golden Gate on the autopilot toward the airport; segment B: the coupled ILS 28R to a stop
    if (i === 30) g.pending = AP_EVENT.AP; if (i === 32) g.pending = AP_EVENT.AT; if (i === 34) { g.mcp.alt = 3000; g.pending = AP_EVENT.ALT; }
    if (i === 60) g.mcp.hdg = 150;
    if (i === half) { g.opts.start = 'final9'; g.opts.rwy = '28R'; await g.startFlight(); }
    if (i === half + 30) g.pending = AP_EVENT.AP; if (i === half + 32) g.pending = AP_EVENT.AT; if (i === half + 34) g.pending = AP_EVENT.APP;
    if (i === half + 36) g.mcp.spd = 170; if (i === half + 30 * 70) { g.c.flap = 6; g.mcp.spd = 154; }
    if (i % (30 * 15) === 0) { g.camIdx = Math.floor(t / 15) % cams.length; g.cams.mode = cams[g.camIdx]; }
    if (flag('--error') && i === 90) console.error('GPU validation error: injected fixture');
  };
  const ms = [], stats = () => app.engine.meshRenderer.stats;
  let maxTri = 0, maxDraws = 0, gpuMB = 0, ringTris = 0;
  for (let i = 0; i < 20; i++) { app.frame(dt); } await H.settle();
  for (let i = 0; i < frames; i++) {
    await script(i);
    const t0 = performance.now(); app.frame(dt); await H.settle(); ms.push(performance.now() - t0);
    maxTri = Math.max(maxTri, stats().triangles); maxDraws = Math.max(maxDraws, stats().draws); ringTris = Math.max(ringTris, g.ring?.triangles || 0);
    if (i % 900 === 450) gpuMB = Math.max(gpuMB, gpuMemory(process.pid));
  }
  const s = [...ms].sort((p, q) => p - q), q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  const sim = g.flight.sim;
  console.log('RESULT ' + JSON.stringify({ frames, p50: q(0.5), p95: q(0.95), p99: q(0.99), maxTri, maxDraws, ringTris, gpuMB, errors: [...errors, ...H.errors].slice(0, 5), nErrors: errors.length + H.errors.length, landed: !!g.flight.scorer.landing?.complete, crashed: sim.crashed }));
  process.exit(0);
}
