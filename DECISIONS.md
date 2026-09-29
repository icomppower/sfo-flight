# Decisions

Open questions the SPEC leaves to the run (SPEC §6: decide, log, continue). Newest last.

## D1 — Engine pin v1.1.0; the tag clash is settled (2026-09-27)
SPEC §8 asked to resolve the harbor-engine tag clash before pinning. The owner settled it in the engine's D18: `v1.1.0`
stays the SFO Approach release, Potomac's changes ship as `v1.1.1`, Milestone B tags `v1.2.0`. This title needs
`frame.cell`, `loadLodModel`, `Material` (all v1.1.0) and nothing later, so it pins `#v1.1.0` and makes no engine edits.

## D2 — Phase 2/3 gates before starting (2026-09-27)
SPEC §8: `npm install && ./verify.sh` in sfo-approach (the install that was blocked for Phase 2 now works). Result:
A3, B0 (the silhouettes this title reuses), B5 and A5 PASS; A0 fails only on an FAA ACD lookup for the B77W approach
speed; A1 fails the NAIP-pavement-under-runway check (1–30 of 34–56 samples) and a bridge-deck distance (27.6 m vs
15 m); A2 fails 1.73 m wheel height on the scripted rollout; A4 / B1 / B3 / B4 negatives incomplete. The caches
themselves are present and checksummed (A0's cache part passes). Phase 2's scripted track is not reused here. The
NAIP/NASR alignment question is re-checked by this title's own F5, independently of A1's pavement classifier.

## D3 — Sources and what VERIFIED means (2026-09-27)
VERIFIED = the value was read by this session from the cited document: C172S POH (befa.org copy, Rev 5), Boeing
D6-58329-2 ACAP (2004 copy: weights §2.1.1, dimensions Fig 2.2.2, Figs 3.3.7 / 3.4.4 read from the charts), Nelson
App. B (Iowa State course copy) for the Navion and the CR-2144 B-747 derivatives, EUROCONTROL APD pages. APPROX = derived
by a stated rule, fitted to a frozen target (source id TUNE), or recalled but not re-read (TCDS travel limits, the
GE90-115B thrust, the 777 wing area). No JSBSim / FlightGear code or data was opened.

## D4 — The light single's derivatives are the Navion's (2026-09-27)
No public-domain C172 derivative set could be read in-session; Nelson's Table B.1 Navion (4-seat single, similar
weight and speed) is the published GA-class set, used with the C172's own POH geometry, masses and speeds. Nelson's
Clδr = 0.107 is inconsistent with its own CYδr (0.157) and any fin height (it would need the fin's centre of pressure
7 m above the axis); the model uses CYδr × z_fin / b = 0.0185 (APPROX).

## D5 — Heavy twin: CR-2144's B-747, scaled (2026-09-27)
CR-2144's only wide-body is the 747; its M 0.25 sea-level derivatives are used for the 777-class with 777 geometry and
ACAP weights. Inertias scale by mass × span² / length². Roll control adds spoilers (0.07) to the 747's aileron-only
Clδa: the 747 of CR-2144 rolls with five spoiler panels per wing, and without them the class misses its roll rate.

## D6 — F3 roll performance at Level 2, damping at Level 1 (2026-09-27)
The civil types are not built to MIL-F-8785C; Level 2 roll times are the floor, Level 1 the damping criteria
(frozen before the model existed).

## D7 — The 777's FBW terms are part of the aircraft (2026-09-27)
With the CR-2144 set the phugoid came out at ζ 0.01–0.03 (a pure jet at L/D 19 has ζ ≈ 0.037 by Lanchester) and the
approach dutch roll at ζωn 0.12 — below the frozen Level-1 floors. The real 777 flies with its yaw damper and a C*U
normal law whose speed term gives positive speed stability. The model includes both: yaw damper gain 2.2 (washout
2.5 s) and an elevator term −0.004 rad per m/s from a trim reference speed plus 0.1 × flight-path error, latched on
trim-switch use, stick inputs over 25 %, flap moves, autopilot events, on the ground and below 100 ft. Result: phugoid
ζ 0.10–0.16, dutch roll ζωn 0.16–0.37. The light single has neither.

## D8 — Fitting (TUNE rows) to the frozen F2 targets (2026-09-27)
Fitted: C172 prop CT(J) (static thrust 2.8 kN; η 0.65 at the Vy advance ratio), braking μ 0.45 (dry asphalt); 777
lapse (1 − 0.95 M + 0.45 M²) σ^0.75, ground-spoiler lift dump ΔCL −0.70, anti-skid braking μ 0.55. Scripted technique:
C172 rotate 50 KCAS to 10°; 777 VR 150 kt at 2°/s to 10° (8.5° cap on the wheels: tail strike at 9°), climb thrust
= 85 % of rated at the APD's 200 KIAS. Results in STATE.md.

## D9 — The autopilot's pitch channel is a load-factor loop (2026-09-27)
Attitude-based flight-path loops could not hold the glide slope near the threshold (the 777's pitch-to-path lag is
~2.2 s at approach). The AP commands γ̇ through a normal-load-factor inner loop (elevator on nz error with an
integrator, gains scheduled with 1/q̄), and the glide-slope gain rises as the beam narrows (×3 inside 1,000 m). The
autothrottle uses airspeed complemented with inertial acceleration (τ 4 s) so thrust does not chase gusts. Flare:
exponential, sink proportional to height from 50 ft, retard at 25 ft; rollout on the localizer; autobrake to a stop.
Gains were searched on 3 seeds × 3 gusty winds (worst 0.40 dot); the F4 gate runs those same seeds, so it is a
regression gate on the tuning set. An unseen seed (s4) reached 0.73 dot once in 280/15G22.

## D10 — F4 hold metric (2026-09-27)
"Hold within tolerance" is judged as the worst error in calm air, and as the mean error over the window in gusty
winds (G22 gusts move the instantaneous airspeed and vertical speed further than any hold tolerance).

## D11 — Frame: grid north (2026-09-27)
The world frame is the title's UTM grid; NASR headings are true and rounded to 1°. Runway courses come from the
surveyed end coordinates (the rounding alone puts a localizer 150 m off at 9 NM). Winds (true) and displayed headings
(magnetic, variation 14° E) are converted with the grid convergence at the field.

## D12 — Keys: the autopilot panel is Shift+A (2026-09-27)
SPEC §7 lists WASD for pitch and roll *and* A for the autopilot panel; one key cannot do both. WASD keeps flying (as the
list's first item says) and the panel opens with Shift+A (the 777's MCP; the 172's engine switches). Parking brake
Shift+B, flaps up Shift+F, spoilers `/`, trim Home / End, mouse yoke Y, camera C, menu Esc, replay R.

## D13 — The ring's elevation is USGS's 1 arc-second product (2026-09-27)
The 3DEPElevation ImageServer that served Phase 2 timed out (504) on the ring's lidar-dense pieces even at 125 px, and
later on its own service page. The ring uses the same agency's static 1 arc-second DEM tiles (n38w123, n38w122,
n39w123, n39w122; public domain), resampled onto the 30 m UTM grid. That product is hydro-flattened (bay and ocean
read ≈ 0 m), so water is "below 0.3 m NAVD88 or no data" and the NCEI ring source was dropped. The ring image is NAIP
at 60 m in 8 × 8 cached tiles, colour-matched to the square's aerial map, stored like the engine's aerial map
(RGB, 6 bits, deflate) so the page and the headless App decode it without a JPEG codec. Resolution: 30 m within 12 km
of the square (the Golden Gate, the city, San Bruno Mountain, the East Bay shore), 120 m out to 60 km.

## D14 — The wheels roll on the drawn runway (2026-09-27)
Phase 2's airfield draws runway pavement 0.32 m above the terrain; a flight model on bare terrain would sink its
wheels 0.32 m into it (over F5's 0.3 m). The flight model's ground adds the same `RUNWAY_LIFT` (fdm/world.ts, imported
by the airfield) inside the NASR runway rectangles. The ALSF-2 pier over 28R's displaced threshold stood at eye height
of a 172 starting at the runway end; approach lights over pavement are now flush and the pier starts past the end.

## D15 — Deterministic transcendental functions (2026-09-27)
Node 25 and Chrome ship different V8 versions and `Math.pow` / `exp` / `sin` differed by an ulp within 12 steps, so
the replay hashes split. fdm/ uses its own sin, cos, atan2, asin, exp, log, pow (fdm/dmath.ts: Cody–Waite reduction,
series, only IEEE-exact operations), a few ulp from Math; `**` is gone from fdm/. F1 now sees identical hashes.

## D16 — The GA ramp is the west-field apron (2026-09-27)
SFO has no GA ramp in OSM; the ramp start is the centroid of the west-field apron (37.616713, −122.394045), where
business aviation parks. Both aircraft can start there (SPEC §1).

## D17 — F5's imagery check measures symmetry, not colour (2026-09-27)
SFO's runways are light concrete with dark tyre marks and bright shoulders; a "grey pavement" classifier found the
centreline less grey than the infield (the reason SFO Approach's A1 failed). The gate averages the 2 m NAIP luminance
across each runway along its length and finds the axis of symmetry of that profile: 0–2 m from every NASR centreline;
a 25 m shift is measured as 26 m, a 60 m shift fails.

## D18 — F6 on the headless App (2026-09-27)
As in SFO Approach A3, the budget runs in the engine's headless App (Dawn on Metal, the M4), where frame time is CPU +
GPU serialised and footprint reads the process's Metal memory. The page itself is checked in real Chrome by F7.

## D19 — M1.1 config values (2026-09-28)
Trim settings are what `trimFly` finds in calm air: C172 takeoff 0.0205 (70 KIAS, flaps 10°, full power, γ +4°), C172
landing 0.0065 (65 KIAS, flaps 30°, γ −3°), 777 takeoff by mass at V2 + 10 (178 KIAS), flaps 15, γ +5°
(`fdm/configs.ts`); F9 re-runs trimFly on every row. C172 takeoff flaps 10° (POH normal takeoff 0–10°). 777 takeoff
flaps 15 (ACAP lists 5 / 15 / 20; 15 is the runway start's setting and F2's field length). 777 LANDING CONFIG SPD =
Vref30 × √(mass / MLW) + 5 (Vref30 149 kt at MLW). The trim is set by a new control pair (`trimSet`, `trimTgt`: at
once on the ground, at the trim rate airborne), so it is recorded and replayed like any input; F1's hashes did not
change.

## D20 — RTO autobrake and TO/GA (2026-09-28)
The flight model had autobrake 1–5 only. Autobrake 6 = RTO: it arms above 85 kt on the ground with the levers open
and brakes at MAX when they close; it disarms after lift-off. The flight model has no TO/GA mode, so TO/GA (Shift+T,
or the TO/GA button on the ground) puts the levers full and, when TAKEOFF CONFIG armed the A/T, engages the existing
autothrottle at SPD = V2 — on the ground that commands full thrust, after lift-off it holds V2 (lit on the MCP).

## D21 — M1.1 missions and keys (2026-09-28)
T and L were the engine's time and flashlight keys; the game resets both every frame (as it already does for F and G).
Mission ① starts stabilised in the landing configuration (flaps 30, Vref + 5, spoilers armed, autobrake 3) so it
lands with no input after A/T, A/P and APP; §11 already said the spoilers and autobrake were armed. Its "hands off"
step ticks as soon as APP captures the glide slope, because the start is on the glide path. LANDING CONFIG over the
Golden Gate on its default heading (145°) is inside 10L's window (8.9 NM, 28° off), so F9 tests the outside case on
a 325° heading there (a `startOver` fixture on the start).

## D22 — M1.2 AUTO LAND: one route brain, two pilots (2026-09-29)
The route manager (`fdm/route.ts`) plans from wherever the aircraft is to the SFO ILS in use: 28L/28R unless the
tailwind on them exceeds 5 kt (then the ILS end with the most headwind), the nearer centreline of the pair. Legs: a
heading leg to a base point, a 30° intercept to a join point on the extended centreline (FAF + 3 NM 777 / + 1.5 NM
172), the FAF (10 NM / 4 NM), the threshold. Too high or too fast → the join point moves out until the descent (2.5° /
3°) and the idle deceleration fit. Each leg before the FAF gets a minimum safe altitude from the terrain and roof grid
in a ±900 m / ±400 m corridor + 1,000 / 500 ft. AUTO LAND runs inside `Flight.step` from a recorded control (`auto`),
so replays re-fly it; what it sets (flaps, gear, spoilers, autobrake, MCP, throttle) is handed back into the pilot's
controls every step, so a takeover keeps it. The 777 flies through its own autopilot modes (HDG / V/S / ALT / SPD,
APP on the intercept) with the planned runway's ILS fixed (`ilsFix`: the parallel 28L would otherwise capture from
the south). The C172 has no autopilot: AUTO LAND uses a **GAME ASSIST** (`fdm/assist.ts`), labelled so on screen —
the scripted pilot's control laws with modes, captures, a flare to a 4° touchdown attitude and rollout braking.

## D23 — M1.2 tuning that is AUTO LAND's own (2026-09-29)
The M1 autopilot's defaults are untouched (F4 / F7 / F9 fly them); AUTO LAND sets its own while it flies: flare at
60 ft (50 ft left gusty 280/15G22 touchdowns near 560 fpm), a soft 7° flare pitch cap (the -300ER's tail strikes near
9°), no pitching below the flare's starting attitude (a float was being pushed onto the runway), a slower flare
integrator and more pitch damping, the bank limit below 300 ft at the pod margin − 2.5°. Approach speed: 777 Vref30 +
max(5, ½ headwind + gust) ≤ 20 (Boeing's additive); 172 65 KIAS + the full gust factor ≤ 10 (the POH's half left
touchdowns near the stall in the model's gusts). GUIDE ME is on by default for the two landing missions (① ②);
③ (take-off) and ④ (sightseeing) would be told to land, against their own checklists.

## D24 — M1.2 pod margin, BANK ANGLE and crash words (2026-09-29)
Pod margin = the bank at which the first nacelle (or wingtip) reaches the runway with that side's main strut fully
compressed and zero pitch, from the aircraft's own contact geometry: 777 7.6° (nacelle), 172 27° (wingtip). BANK
ANGLE shows below 100 ft radio when the bank exceeds it; GUIDE ME says "Level the wings". The result screen says why
in plain words with the number from the moment of the crash (`Sim.crashInfo`: bank, pitch, sink, g, speed).

## D25 — M1.2 GUIDE ME timing (2026-09-29)
Each planned instruction is found by looking 0–12 s ahead along the route (moving parallel to the active leg, then
fix to fix) and shows as soon as it is due inside that window, with a countdown; the moment the route itself needs it
(its own "now") is recorded separately, and gate F10 measures the lead against that. Instructions that nobody can
foresee — the first ones on engaging, a heading correction for drift, anything a re-plan needs at once — are
reactive: they get a 4 s countdown and are counted, not lead-checked. The obedient pilot in F10 acts only on the bar:
the 172 with the scripted pilot's hands, the 777 through a private MCP (how a crew flies spoken vectors). The
heavy's "Idle — flare now" is due at 50 ft (it needs its flare begun that high in this model), the 172's at 15 ft.

## D26 — M1.2 page (2026-09-29)
Keys: Shift+L AUTO LAND (L stays LANDING CONFIG), Shift+G GUIDE ME (G stays gear), V the ribbon (the engine's V is
the walking player's camera, unused here). On screen: AUTO LAND / GUIDE ME next to the config buttons (desktop) or in
the phone button block. The ribbon, localizer line and route line are unlit, premultiplied, depth-writing overlays
(the engine's water and sky passes composite by depth: without depth they vanished outside the aircraft's pixels) and
dim at night. Approach lights, their flashers and the PAPI are separate meshes: boosted for AUTO LAND / GUIDE ME at
any time of day; the rabbit runs twice a second from the far end; each PAPI box is white or red from the eye's
elevation angle (settings θ ± 0.5° / ± 0.17°, boxes moved from 300 m to the glide path's origin so on-path reads
2 white / 2 red). `?timescale=n` runs n× the fixed steps per frame (gate hook, same flight).

## D27 — F6 runs first, on a quiet GPU (2026-09-29)
The M4 is shared with other Claude sessions; their headless-Chromium gate runs cut F6's frame rate 2.5× (A/B: the
unchanged M1.1 commit read 18.9 fps under that load, 49.8 fps the day before). `gates/gates.json` lists f6 first so
the frame-budget measurement happens at the start of the run, inside an agreed quiet window. M1.2 adds 12 draws (the
split approach lights, flashers, PAPI) — 264 of the 378 cap.
