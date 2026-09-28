// F0 Data: every source in pipelines/data/sources.mjs is cached with its checksum and licence (sources.json and
// CREDITS.md); the baked outputs match their recorded checksums (terrain tiles, ring, collision layers, aircraft);
// every aerodynamic / mass / engine number in fdm/aircraft carries a source id and VERIFIED or APPROX; fdm/ has no
// trace of GPL/LGPL flight models; SPEC-THRESHOLDS.md was committed before the flight model existed and its frozen
// lines are unchanged since.
// --negative: a bad checksum, a licence missing from CREDITS.md, an untagged row, an unknown status, a changed frozen
// value, a baked file that no longer matches its index and a JSBSim reference in fdm/ must each be caught.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, gate } from './lib/common.mjs';
import { SOURCES } from '../pipelines/data/sources.mjs';
import { C172 } from '../fdm/aircraft/c172.ts';
import { B77W } from '../fdm/aircraft/b77w.ts';

const RAW = join(root, 'data/raw'), PUB = join(root, 'public');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const LIC = (f) => (/osm/.test(f) ? 'ODbL' : 'Public domain');
const AERO_KEYS = ['CL', 'CLq', 'CLadot', 'CLde', 'CLtrim', 'CD0', 'K', 'CDflap', 'CDgear', 'CDalpha', 'CDbeta', 'CYb', 'CYp', 'CYr', 'CYdr', 'Clb', 'Clp', 'Clr', 'Clda', 'Cldr', 'Cm0', 'Cma', 'Cmq', 'Cmadot', 'Cmde', 'Cmtrim', 'CmStall', 'CmGround', 'CmGear', 'Cnb', 'Cnp', 'Cnr', 'Cnda', 'Cndr', 'geOswaldK', 'geLift'];
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();

// walk an aircraft's data: every Scalar and every table row must be tagged
export function tags(ac) {
  const bad = [], count = { VERIFIED: 0, APPROX: 0 };
  const srcOk = (s) => typeof s === 'string' && s in ac.sources;
  const visit = (o, path) => {
    if (o == null || typeof o !== 'object') return;
    if ('v' in o && 'src' in o) { if (!srcOk(o.src)) bad.push(`${ac.id}.${path}: source "${o.src}" not in sources`); if (!(o.st in count)) bad.push(`${ac.id}.${path}: status "${o.st}"`); else count[o.st]++; return; }
    if (Array.isArray(o.rows)) { for (const [i, r] of o.rows.entries()) { const st = r[r.length - 1], src = r[r.length - 2]; if (!srcOk(src)) bad.push(`${ac.id}.${path}[${i}]: source "${src}"`); if (!(st in count)) bad.push(`${ac.id}.${path}[${i}]: status "${st}"`); else count[st]++; } return; }
    for (const [k, v] of Object.entries(o)) if (k !== 'sources') visit(v, path ? path + '.' + k : k);
  };
  visit({ geom: ac.geom, mass: ac.mass, inertia: ac.inertia, aero: ac.aero, engine: ac.engine, controls: ac.controls, flaps: ac.flaps, brakes: ac.brakes, tyre: ac.tyre }, '');
  for (const k of AERO_KEYS) if (!(k in ac.aero)) bad.push(`${ac.id}.aero.${k} missing`);
  return { bad, count };
}

function check({ patch = {}, credits = readFileSync(join(root, 'CREDITS.md'), 'utf8'), aircraft = [C172, B77W], thresholds = readFileSync(join(root, 'SPEC-THRESHOLDS.md'), 'utf8'), fdmText = null } = {}) {
  const fail = [], req = (ok, m) => { if (!ok) fail.push(m); return ok; };
  // ---- the raw cache
  const man = Object.fromEntries(readFileSync(join(RAW, 'MANIFEST.sha256'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/).reverse()));
  const sources = JSON.parse(readFileSync(join(RAW, 'sources.json'), 'utf8'));
  for (const s of SOURCES) {
    if (!req(existsSync(join(RAW, s.file)), `${s.file} missing from the cache`)) continue;
    req(man[s.file] === (patch[s.file] ?? sha(readFileSync(join(RAW, s.file)))), `${s.file}: checksum does not match MANIFEST.sha256`);
    req(sources[s.file]?.licence, `${s.file}: no licence in sources.json`);
    const line = credits.split('\n').find((l) => l.includes(s.file));
    req(line && line.includes(LIC(s.file)), `CREDITS.md does not record ${s.file} with its ${LIC(s.file)} licence`);
  }
  // ---- baked outputs against their indexes
  const ti = JSON.parse(readFileSync(join(PUB, 'terrain/index.json'), 'utf8'));
  for (const f of ti.files) req((patch['terrain/' + f.name] ?? sha(readFileSync(join(PUB, 'terrain', f.name)))) === f.sha256, `terrain/${f.name}: checksum does not match terrain/index.json`);
  const ri = JSON.parse(readFileSync(join(PUB, 'ring/index.json'), 'utf8'));
  for (const k of ['band', 'outer', 'imagery']) req((patch['ring/' + ri[k].file] ?? sha(readFileSync(join(PUB, 'ring', ri[k].file)))) === ri[k].sha256, `ring/${ri[k].file}: checksum does not match ring/index.json`);
  const ci = JSON.parse(readFileSync(join(PUB, 'flight/collision.json'), 'utf8'));
  for (const k of ['paved', 'roofs']) req(sha(readFileSync(join(PUB, 'flight', ci[k].file))) === ci[k].sha256, `flight/${ci[k].file}: checksum does not match collision.json`);
  const ai = JSON.parse(readFileSync(join(PUB, 'aircraft/index.json'), 'utf8'));
  for (const T of Object.values(ai.types)) for (const l of [...T.lods, T.cockpit]) req(sha(readFileSync(join(PUB, 'aircraft', l.name))) === l.sha256, `aircraft/${l.name}: checksum does not match aircraft/index.json`);
  // ---- aero data: every number tagged
  const counts = {};
  for (const ac of aircraft) { const t = tags(ac); fail.push(...t.bad); counts[ac.id] = t.count; req(t.count.VERIFIED > 20, `${ac.id}: only ${t.count.VERIFIED} VERIFIED values`); }
  // ---- clean room: no GPL flight-model code or data in fdm/
  const files = readdirSync(join(root, 'fdm'), { recursive: true }).filter((f) => f.endsWith('.ts'));
  for (const f of files) { const s = fdmText && f === 'sim.ts' ? fdmText : readFileSync(join(root, 'fdm', f), 'utf8'); req(!/jsbsim|flightgear|\bGPL\b/i.test(s), `fdm/${f} mentions a GPL flight model`); }
  // ---- thresholds frozen before the flight model, unchanged since
  const firstT = git('log', '--diff-filter=A', '--format=%H %ct', '--', 'SPEC-THRESHOLDS.md').split('\n').pop().split(' ');
  const firstF = git('log', '--diff-filter=A', '--format=%H %ct', '--', 'fdm/sim.ts').split('\n').pop().split(' ');
  req(Number(firstT[1]) <= Number(firstF[1]) && firstT[0] !== firstF[0], `SPEC-THRESHOLDS.md (${firstT[0].slice(0, 7)}) is not older than fdm/sim.ts (${firstF[0].slice(0, 7)})`);
  const frozen = git('show', `${firstT[0]}:SPEC-THRESHOLDS.md`).split('\n').filter((l) => /^- `F\d/.test(l));
  for (const l of frozen) req(thresholds.split('\n').includes(l), `frozen line changed or removed: ${l.slice(0, 70)}`);
  req(frozen.length >= 40, `only ${frozen.length} frozen F-lines`);
  if (!fail.length) console.log('aero tags', JSON.stringify(counts), '· frozen lines', frozen.length, '· sources', SOURCES.length);
  return fail;
}

const clone = (ac) => JSON.parse(JSON.stringify(ac));
await gate('F0', () => check(), [
  ['bad checksum', () => check({ patch: { 'terrain-3dep.tif': '0'.repeat(64) } })],
  ['licence missing from CREDITS', () => check({ credits: readFileSync(join(root, 'CREDITS.md'), 'utf8').split('\n').filter((l) => !l.includes('ring-naip.tif')).join('\n') })],
  ['untagged aero row', () => { const a = clone(C172); a.aero.CL.rows[3][5] = 'NOPE'; return check({ aircraft: [a, B77W] }); }],
  ['unknown status', () => { const a = clone(B77W); a.aero.Cma.st = 'GUESS'; return check({ aircraft: [C172, a] }); }],
  ['frozen value moved', () => check({ thresholds: readFileSync(join(root, 'SPEC-THRESHOLDS.md'), 'utf8').replace('`F2.c172.stallCleanKcas`: 53', '`F2.c172.stallCleanKcas`: 56') })],
  ['baked ring file changed', () => check({ patch: { 'ring/outer.bin': '1'.repeat(64) } })],
  ['JSBSim in fdm/', () => check({ fdmText: '// ported from JSBSim FGAerodynamics\n' })],
]);
