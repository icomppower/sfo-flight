# SFO Flight — SPEC (Phase 4 of SFO Tower: fly it yourself, C172 + 777)

Mirror of the Notion SPEC (3e91f269eaea8187bad4df2c9d94f958), the frozen gate ladder this run is judged by. Notion
holds status.

## 1. Deliverable
A browser flight simulator on Harbor Engine, live at `icomppower.github.io/sfo-flight/`, in the real-data Bay of
Phase 2 (sfo-approach). Light single (C172-class): cold-and-dark optional, taxi, pattern work, sightseeing. Heavy twin
(777-300ER-class): takeoff from 1L/1R or 28L/28R, basic autopilot, ILS 28L/28R to a full stop. Starts: GA ramp, on the
runway, 3 NM / 9 NM final, airborne over the Golden Gate. Day/night from the engine cycle; wind and visibility from the
URL or a METAR picker. zh/en UI. Replay of the last flight with Phase 2's director cameras.

## 2. Reuse
World re-baked here from Phase 2's checksummed caches and pipelines (not copied build output). Phase 3's B0 silhouettes
(heavy twin, light single) are the exterior models; new low-poly Blender cockpits. Cameras, day/night, captions from
Harbor Engine only; no engine edits. Phase 2's scripted track is not reused.

## 3. Frozen rules
- `fdm/`: headless, zero-dependency TypeScript, fixed 120 Hz, deterministic for seed + input log (same replay hash in
  Node and the browser). The render layer only reads it.
- 6-DOF rigid body; coefficient-table aero (lift, drag, side force, pitch/roll/yaw moments vs alpha, beta, flaps,
  gear, controls, rates), ground effect, spring-damper gear with brakes and nosewheel steering, ISA, wind with gusts.
- Engines: piston + fixed-pitch prop (C172); two turbofans with N1 spool lag (777).
- Aero data from public-domain or published sources only, each row tagged with source and VERIFIED / APPROX.
  No code or data from GPL/LGPL projects (JSBSim, FlightGear): clean-room.
- Performance targets frozen in SPEC-THRESHOLDS.md before tuning; never lowered to pass. Phase 2 look is the ceiling.

## 4. M1 scope
FDM, both aircraft, keyboard + mouse yoke + Gamepad API (remappable), instruments (C172 six-pack, tach, fuel; 777
simplified PFD + ND), 777 autopilot (HDG, ALT, V/S, SPD A/T, LOC/GS capture 28L/28R), crash/landing detection with a
landing score (touchdown rate, centreline, touchdown zone). Low-detail ring (30 m terrain, downsampled imagery, flat
water) out to ~60 km.

## 5. Gates (negative fixtures on every gate; `./verify.sh`)
| Gate | Checks |
|---|---|
| F0 Data | caches present and checksummed, licences recorded, aero tables complete with source tags, SPEC-THRESHOLDS.md frozen |
| F1 FDM physics | trimmed level flight holds; energy conserved (no drag/thrust); ground contact at rest does not drift or bounce; same seed + input log → same hash in Node and the browser |
| F2 Performance | headless scripted flights: stall (clean, landing flap), best-rate climb, takeoff ground roll, landing roll within frozen tolerances |
| F3 Handling | short period, phugoid, dutch roll, spiral stable/damped (or mildly divergent where the real type is); control response reaches commanded rates; no NaN across a random-input fuzz |
| F4 Autopilot | 777 HDG/ALT/V/S/SPD hold; coupled ILS 28R 9 NM → 50 ft AGL within ±½ dot LOC and GS in the gate's wind set |
| F5 World | start positions on the surface (≤ 0.3 m); NASR thresholds line up with terrain and imagery; terrain and building collision detected |
| F6 Budget | low tier on the M4: p95 fps floor (≥ 30, frozen at 0.8 × measured), triangle/draw caps, GPU memory cap, no console/GPU errors in a 10-minute scripted flight |
| F7 Page | build + audit; real Chrome desktop with keyboard and a gamepad fixture; 390×844 with on-screen stick, throttle and buttons hit-tested; zh UI; scripted C172 pattern and 777 ILS through the UI path |
| F8 Look (advisory) | stills: C172 over the Golden Gate at golden hour, 777 cockpit short final 28R at night, landing score screen, phone frame |

## 6. Stop rules
Three failed attempts at one gate, data not fetchable by script, a frozen threshold that would have to move, an aero
source that cannot be licensed, or a needed engine / pinned-sim change → BLOCKED.md + Notion. Open questions: decide,
log in DECISIONS.md, continue.

## 9. DONE (M1)
F0–F7 green in one clean `./verify.sh` run, live on GitHub Pages, Notion updated, Live Projects Bookmark row added.
