// Weather for a flight: from the URL (?wind=280/15G22&vis=10&qnh=29.92&temp=15), a METAR string (?metar=…) or a
// pick from public/flight/metars.json (real KSFO observations). Winds are true; the flight model runs on the UTM
// grid, so the direction turns by the grid convergence (airport.json trueNorthGridDeg).
export function parseMetar(s) {
  const o = {};
  const w = /\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/.exec(s);
  if (w) o.wind = { dir: w[1] === 'VRB' ? 0 : Number(w[1]), kt: Number(w[2]), gustKt: w[3] ? Number(w[3]) : Number(w[2]) };
  else if (/\b00000KT\b/.test(s)) o.wind = { dir: 0, kt: 0, gustKt: 0 };
  const v = /\s(\d+\/\d+|\d+)SM\b/.exec(s);
  if (v) o.visSM = v[1].includes('/') ? Number(v[1].split('/')[0]) / Number(v[1].split('/')[1]) : Number(v[1]);
  const t = /\s(M?\d{2})\/(M?\d{2})\s/.exec(s + ' ');
  if (t) o.tempC = Number(t[1].replace('M', '-'));
  const a = /\bA(\d{4})\b/.exec(s);
  if (a) o.altimInHg = Number(a[1]) / 100;
  return o;
}
export function weatherFrom(qs, picks, pickId) {
  const p = picks.find((x) => x.id === pickId) || picks.find((x) => x.id === 'westerly') || picks[0];
  let wx = { wind: { ...p.wind }, visSM: p.visSM, tempC: p.tempC, altimInHg: p.altimInHg, metar: p.metar, id: p.id };
  if (qs.get('metar')) wx = { ...wx, ...parseMetar(qs.get('metar')), metar: qs.get('metar'), id: 'custom' };
  if (qs.get('wind')) { const m = /^(\d{1,3})\/(\d{1,3})(?:G(\d{1,3}))?$/i.exec(qs.get('wind')); if (m) { wx.wind = { dir: +m[1], kt: +m[2], gustKt: m[3] ? +m[3] : +m[2] }; wx.id = 'custom'; } }
  if (qs.get('vis')) { wx.visSM = Number(qs.get('vis')); wx.id = 'custom'; }
  if (qs.get('qnh')) wx.altimInHg = Number(qs.get('qnh'));
  if (qs.get('temp')) wx.tempC = Number(qs.get('temp'));
  return wx;
}
// the flight model's Weather (grid wind direction)
export function fdmWeather(wx, trueNorthGridDeg) {
  return { wind: { dir: ((wx.wind.dir + trueNorthGridDeg) % 360 + 360) % 360, kt: wx.wind.kt, gustKt: Math.max(wx.wind.gustKt, wx.wind.kt), turbulence: wx.wind.kt > 0 ? 1 : 0 }, visM: (wx.visSM ?? 10) * 1609.34, qnhHpa: (wx.altimInHg ?? 29.92) * 33.8639, tempC: wx.tempC ?? 15 };
}
// haze density for the engine's AirHaze (1 ≈ 20 km visibility at sea level)
export const hazeFor = (visSM) => Math.max(0.6, Math.min(30, 20 / Math.max(0.2, (visSM ?? 10) * 1.609)));
