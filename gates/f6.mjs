// F6 Budget, low tier on the M4 (headless App, Dawn on Metal, 1920×1080, CPU + GPU serialised): a 10-minute scripted
// flight — the 777 from the Golden Gate on the autopilot over the city and the ring, then the coupled ILS 28R to a
// stop, the camera cycling chase / cockpit / tower — must hold the p95 fps floor (≥ 30, frozen at 0.8 × measured),
// the triangle and draw caps, the GPU memory cap, and log no console or GPU errors. Calibrated on the first run.
// --negative: 4K rendering, 1.5 GB of leaked GPU buffers, a 1.5 M-triangle stray mesh and an injected GPU error must
// each fail.
import { gate, R } from './lib/common.mjs';
import { readThresholds, freeze } from 'harbor-engine/gates/lib/thresholds.mjs';
import { runChild } from './lib/flight-headless.mjs';

const TARGET = 30, today = new Date().toISOString().slice(0, 10);
let T = readThresholds();
if (!('F6.fpsFloor' in T)) {
  const r = runChild(['--minutes', '10']);
  const fps95 = 1000 / r.p95;
  if (fps95 < TARGET || r.nErrors) { console.log(`F6 FAIL — calibration: ${R(fps95, 1)} fps at p95, ${r.nErrors} errors; not freezing`); process.exit(1); }
  freeze('F6.fpsFloor', Math.max(TARGET, Math.floor(0.8 * fps95)), `95th-percentile fps of the 10-minute scripted flight (gates/lib/flight-headless.mjs), 1920×1080 low tier, M4 (Metal), CPU+GPU serialised; measured ${R(fps95, 1)} fps on ${today}; floor = max( 30, 0.8 × measured )`);
  freeze('F6.frameTriangles', Math.ceil(r.maxTri * 1.25), `triangles per frame, all passes, same flight; measured max ${r.maxTri} (ring ${r.ringTris}) on ${today}; cap = 1.25 × measured`);
  freeze('F6.frameDraws', Math.ceil(r.maxDraws * 1.5), `draw calls per frame, same flight; measured max ${r.maxDraws} on ${today}; cap = 1.5 × measured`);
  freeze('F6.gpuMemoryMB', Math.ceil(r.gpuMB * 1.25), `peak GPU memory (footprint "(graphics)" categories) of the App process over the flight; measured ${R(r.gpuMB, 0)} MB on ${today}; cap = 1.25 × measured`);
  T = readThresholds();
}
export function judge(r) {
  const fail = [], fps95 = 1000 / r.p95;
  console.log(`${r.frames} frames: p50 ${R(r.p50, 1)} ms, p95 ${R(r.p95, 1)} ms (${R(fps95, 1)} fps, floor ${T['F6.fpsFloor']}), triangles ≤ ${r.maxTri} (cap ${T['F6.frameTriangles']}, ring ${r.ringTris}), draws ≤ ${r.maxDraws} (cap ${T['F6.frameDraws']}), GPU ${R(r.gpuMB, 0)} MB (cap ${T['F6.gpuMemoryMB']}), errors ${r.nErrors}, landed ${r.landed}`);
  if (fps95 < T['F6.fpsFloor']) fail.push(`p95 ${R(fps95, 1)} fps below the floor ${T['F6.fpsFloor']}`);
  if (r.maxTri > T['F6.frameTriangles']) fail.push(`${r.maxTri} triangles in a frame, cap ${T['F6.frameTriangles']}`);
  if (r.maxDraws > T['F6.frameDraws']) fail.push(`${r.maxDraws} draws in a frame, cap ${T['F6.frameDraws']}`);
  if (r.gpuMB > T['F6.gpuMemoryMB']) fail.push(`GPU memory ${R(r.gpuMB, 0)} MB, cap ${T['F6.gpuMemoryMB']}`);
  if (r.nErrors) fail.push(`${r.nErrors} console / GPU errors: ${r.errors.join(' | ').slice(0, 200)}`);
  if (r.crashed) fail.push(`the scripted flight crashed (${r.crashed})`);
  return fail;
}
await gate('F6', () => judge(runChild(['--minutes', '10'])), [
  ['rendering at 4K', () => judge(runChild(['--minutes', '1', '--uhd']))],
  ['1.5 GB of leaked GPU buffers', () => judge(runChild(['--minutes', '1', '--leak']))],
  ['1.5 M-triangle stray mesh', () => judge(runChild(['--minutes', '1', '--heavy']))],
  ['injected GPU error', () => judge(runChild(['--minutes', '1', '--error']))],
]);
