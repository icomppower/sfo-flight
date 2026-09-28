// The airport and start positions: FAA NASR runway geometry (via the pinned sfo-tower package, as in SFO Approach)
// in the title frame, the grid convergence (true north's azimuth on the UTM grid), and the named positions the
// game starts from. Deterministic, no network.  node pipelines/airport/build.mjs → public/flight/airport.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toLocal } from '../lib/utm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SIM = process.env.SFO_TOWER || join(root, 'node_modules/sfo-tower');
const FT = 0.3048, R2 = (v) => Math.round(v * 100) / 100, R3 = (v) => Math.round(v * 1000) / 1000;

export function mslOffset(rawDir = join(root, 'data/raw')) {
  const f = join(rawDir, 'noaa-datums-9414523.json');
  const d = JSON.parse(readFileSync(f, 'utf8')), v = (n) => d.datums.find((x) => x.name === n).value;
  return R3(v('MSL') - v('NAVD88'));
}

// named places (WGS84) → title frame; sources in the note
export const PLACES = {
  ramp: { lat: 37.616713, lon: -122.394045, hdg: 118, note: 'west-field apron (OSM aeroway=apron centroid): SFO has no GA ramp mapped; FBO traffic parks on the west field' },
  goldenGate: { lat: 37.8199, lon: -122.4783, hdg: 145, note: 'Golden Gate Bridge mid-span (USGS GNIS 1655041 coordinates, rounded)' },
};

export function buildAirport() {
  const f = join(SIM, 'data/derived/ksfo-airport.json');
  if (!existsSync(f)) throw new Error(`airport: ${f} missing (npm install)`);
  const apt = JSON.parse(readFileSync(f, 'utf8')).nasr;
  const msl = mslOffset();
  const runways = apt.runways.map((r) => {
    const ends = apt.ends.filter((e) => e.runway === r.id).map((e) => {
      const [x, z] = toLocal(e.endLat, e.endLon), thr = e.displacedThrLat ? toLocal(e.displacedThrLat, e.displacedThrLon) : [x, z];
      return { id: e.id, hdg: e.trueHeading, end: [R2(x), R2(z)], thr: [R2(thr[0]), R2(thr[1])], displacedFt: e.displacedThrLenFt || 0, elevM: R3((e.endElevFt ?? apt.elevFt) * FT - msl), tdzeM: R3((e.tdzeFt ?? e.endElevFt) * FT - msl),
        ils: e.ils, gsDeg: e.glidePathDeg, tchFt: e.tchFt, approachLights: e.approachLights, latLon: [e.endLat, e.endLon], thrLatLon: e.displacedThrLat ? [e.displacedThrLat, e.displacedThrLon] : [e.endLat, e.endLon] };
    });
    return { id: r.id, lengthFt: r.lengthFt, widthFt: r.widthFt, widthM: R2(r.widthFt * FT), surface: r.surface, ends };
  });
  const [ax, az] = toLocal(apt.lat, apt.lon);
  // true north on the grid: the frame direction of a short step north from the ARP (degrees clockwise from grid north)
  const [nx, nz] = toLocal(apt.lat + 0.01, apt.lon);
  const trueNorthGridDeg = R3(Math.atan2(nx - ax, -(nz - az)) * 180 / Math.PI);
  const places = Object.fromEntries(Object.entries(PLACES).map(([k, p]) => { const [x, z] = toLocal(p.lat, p.lon); return [k, { x: R2(x), z: R2(z), hdgTrue: p.hdg, lat: p.lat, lon: p.lon, note: p.note }]; }));
  return { format: 'sfo-airport/1', icao: apt.icao, name: apt.name, source: 'FAA NASR via sfo-tower data/derived/ksfo-airport.json', effective: apt.effective, arp: [R2(ax), R2(az)], elevFt: apt.elevFt, elevM: R3(apt.elevFt * FT - msl), magVar: apt.magVar, msl, trueNorthGridDeg, runways, places };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(root, 'public/flight');
  mkdirSync(out, { recursive: true });
  const a = buildAirport();
  writeFileSync(join(out, 'airport.json'), JSON.stringify(a, null, 1) + '\n');
  console.log(`airport: ${a.runways.length} runways, true north at grid ${a.trueNorthGridDeg}°, places ${Object.keys(a.places).join(', ')}`);
}
