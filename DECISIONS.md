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
