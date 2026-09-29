# SFO Flight

Fly a Cessna 172 or a Boeing 777 from San Francisco International over the real bay — a Harbor Engine title
(Phase 4 of SFO Tower). Live: https://icomppower.github.io/sfo-flight/

- **World:** SFO Approach's real-data square (USGS 3DEP, NOAA NCEI, NAIP, OpenStreetMap, FAA NASR), re-baked here,
  plus a low-detail ring out to 60 km (USGS 1 arc-second, NAIP).
- **Flight model** (`fdm/`): headless, zero-dependency TypeScript, 6-DOF at 120 Hz, deterministic (the same replay
  hash in Node and Chrome). Coefficient tables from published sources — the C172S POH, NASA CR-2144 (via Nelson),
  Boeing's 777 airport-planning document — every number tagged with its source and VERIFIED / APPROX.
- **777 autopilot:** SPD, HDG, ALT, V/S, LOC, APP with autoland, rollout and autobrake. **Landing score** on touchdown
  rate, centreline and touchdown zone; **replay** with the director's cameras.
- **Controls:** keyboard, mouse yoke (Y), any gamepad or joystick (remap in the menu), phone stick and throttle.
  Starts: ramp (172 cold and dark optional), runway, 9 / 3 NM final, over the Golden Gate. Real KSFO METARs or your
  own wind. English / 中文.
- **Easy flying (M1.1):** four one-tap **Missions** (watch the 777 autoland, land the Cessna, take off, sightsee the
  Golden Gate) with a guided checklist that ticks itself and shows the key for your input; **TAKEOFF CONFIG** (T) and
  **LANDING CONFIG** (L) for both aircraft, TO/GA (Shift+T) on the 777; **How to fly** in the menu.
- **AUTO LAND / GUIDE ME (M1.2):** **AUTO LAND** (Shift+L or the button) flies either aircraft from anywhere back to
  the SFO ILS in use and lands it (the 172 through a labelled GAME ASSIST); **GUIDE ME** (Shift+G) tells you each
  turn, descent, speed, flap and flare with a countdown. Glide-slope ribbon (V), LOC / G/S diamonds, lit approach
  lights with the rabbit and PAPI, phase captions, director cameras, BANK ANGLE and plain-words crash reasons.

URL parameters: `ac=c172|b77w`, `start=ramp|rampCold|runway|final9|final3|ggb`, `rwy=28R`, `wx=<metar pick>`,
`wind=280/15G22`, `vis=10`, `metar=…`, `time=dawn|day|golden|night`, `cam=cockpit|chase|tower|free`, `lang=zh`, `mission=1..4`, `timescale=n` (test hook).

Build: `npm install && npm run dev`. Data: `npm run fetch-data && npm run bake`. Gates: `./verify.sh` (F0–F7, F9, F10; F8
advisory). Decisions in `DECISIONS.md`, sources in `CREDITS.md`, frozen targets in `SPEC-THRESHOLDS.md`.
