# Calibrated thresholds (frozen)

Measured at first run and frozen (SPEC §5). Each line: key, value, how it was measured. Never lowered to pass;
changing a frozen value needs a BLOCKED.md.

## Performance targets (F2) — frozen 2026-09-27, before the flight model existed

Sourced values and their tolerances. Conditions for every target: ISA sea level (15 °C, 1013.25 hPa), zero wind,
paved dry level runway. Speeds are calibrated airspeed (KCAS). VERIFIED = read by this session from the cited
document; APPROX = derived from a cited document by the stated rule.

Sources:
- [POH] Cessna Model 172S Pilot's Operating Handbook, 1998 (Revision 5), Section 1 and Figures 5-3, 5-5, 5-6, 5-11.
- [ACAP] Boeing D6-58329-2, 777-200LR/-300ER Airplane Characteristics for Airport Planning, §2.1.1, Figures 3.3.7, 3.4.4.
- [APD] EUROCONTROL Aircraft Performance Database, B77W and C172 pages (learningzone.eurocontrol.int/ilp/customs/ATCPFDB).
- [ACD] FAA Aircraft Characteristics Database (via sfo-tower data/derived): B77W approach speed 149 kt.
- [TXT] D. P. Raymer, Aircraft Design: A Conceptual Approach (AIAA), typical clean CLmax of swept-wing transports 1.2–1.6.
- [MIL] MIL-F-8785C, Flying Qualities of Piloted Airplanes (US DoD, public domain), §3.2–3.3.
- [ICAO] ICAO Annex 10 Vol I §3.1: localizer 0.155 DDM at 105 m either side of the centreline at threshold; glide path 0.0875 DDM at 0.12 θ.

C172 (2,550 lb = 1,156.7 kg, the POH's figures):
- `F2.c172.stallCleanKcas`: 53 — [POH] Fig 5-3, flaps UP, power off, 0° bank, 2,550 lb — VERIFIED
- `F2.c172.stallLandKcas`: 48 — [POH] Fig 5-3, flaps 30°, power off, 0° bank — VERIFIED
- `F2.c172.stallTolKt`: 3 — tolerance ± kt on both stall speeds
- `F2.c172.climbFpm`: 730 — [POH] Fig 5-6, max rate of climb at 74 KIAS, S.L., interpolated 0 °C 785 / 20 °C 710 → 15 °C 729; Section 1 also 730 FPM — VERIFIED
- `F2.c172.climbTolFrac`: 0.15 — tolerance ± fraction
- `F2.c172.takeoffRollFt`: 960 — [POH] Section 1 and Fig 5-5 (flaps 10°, full throttle before brake release, lift-off 51 KIAS), S.L. 15 °C interpolated 925/995 → 960 — VERIFIED
- `F2.c172.takeoffTolFrac`: 0.15 — tolerance ± fraction
- `F2.c172.landingRollFt`: 575 — [POH] Section 1 and Fig 5-11 (flaps 30°, power off, maximum braking, 61 KIAS at 50 ft), S.L. 15 °C — VERIFIED
- `F2.c172.landingTolFrac`: 0.20 — tolerance ± fraction

777-300ER (GE90-115B; MTOW 351,533 kg, MLW 251,290 kg [ACAP §2.1.1] — VERIFIED):
- `F2.b77w.stallLandKcas`: 121 — flaps 30, gear down, MLW: Vref 149 kt [ACD, APD Vat 149 kt — VERIFIED] ÷ 1.23 (FAR 25.125 Vref ≥ 1.23 VSR) — APPROX
- `F2.b77w.stallCleanKcas`: 158 — flaps up, MLW: CLmax 1.4 [TXT] with S = 436.8 m² — APPROX
- `F2.b77w.stallLandTolKt`: 6 — tolerance ± kt
- `F2.b77w.stallCleanTolKt`: 10 — tolerance ± kt
- `F2.b77w.climbFpm`: 3000 — [APD] initial climb to 5,000 ft at 200 KIAS, 3,000 ft/min (weight not stated; flown at 300,000 kg, flaps 5, gear up, climb thrust) — VERIFIED value, APPROX conditions
- `F2.b77w.climbTolFrac`: 0.25 — tolerance ± fraction
- `F2.b77w.takeoffFieldFt`: 9900 — [ACAP] Fig 3.3.7, F.A.R. takeoff runway length, standard day S.L., MTOW 775,000 lb (read from the chart; [APD] take-off distance 3,000 m agrees) — VERIFIED
- `F2.b77w.takeoffFieldLoFrac`: 0.75 — the gate flies all engines: 1.15 × (distance to 35 ft) must be within [0.75, 1.05] × the field length (the F.A.R. length is the larger of that and the one-engine-inoperative case, which usually governs a heavy twin) — APPROX rule
- `F2.b77w.takeoffFieldHiFrac`: 1.05
- `F2.b77w.takeoffRollFrac`: 0.85 — ground roll / distance to 35 ft must be at most this (jet transports 0.75–0.85 [TXT]) — APPROX
- `F2.b77w.landingFieldFt`: 5800 — [ACAP] Fig 3.4.4, F.A.R. landing runway length, flaps 30, dry, S.L., MLW 554,000 lb (read from the chart; [APD] landing distance 1,800 m agrees) — VERIFIED
- `F2.b77w.landingTolFrac`: 0.15 — the gate flies 50 ft → stop with maximum manual braking; (distance ÷ 0.6) must be within ± this fraction of the field length (F.A.R. 25.125 / 121.195 factor 0.6)

## Handling (F3) — MIL-F-8785C, frozen 2026-09-27

C172 = Class I, 777 = Class III; flight phase Category B (cruise/climb) unless noted. The civil types are not built to
the military standard; Level 1 is required for damping, Level 2 is the floor for roll performance (DECISIONS D6).
- `F3.shortPeriodZetaMin`: 0.30 — [MIL] Table IV, Level 1, Cat B
- `F3.shortPeriodZetaMax`: 2.0 — [MIL] Table IV
- `F3.phugoidZetaMin`: 0.04 — [MIL] 3.2.1.2 Level 1
- `F3.dutchRollZetaMin`: 0.08 — [MIL] Table VI Level 1 Cat B (777 with its yaw damper, as flown)
- `F3.dutchRollZetaWnMin`: 0.15 — [MIL] Table VI Level 1 Cat B, rad/s
- `F3.spiralDoubleMinS`: 20 — [MIL] Table VIII Level 1 Cat B/C: time to double bank ≥ 20 s if divergent
- `F3.c172.roll60S`: 2.5 — [MIL] Table IX Class I Level 2 Cat B: 60° bank change within 2.5 s, full aileron at 1.3 VS clean
- `F3.b77w.roll30S`: 3.2 — [MIL] Table IX Class III Level 2 Cat B: 30° bank change within 3.2 s
- `F3.fuzzMinutes`: 10 — random-input fuzz per aircraft, no NaN, |p,q,r| < 3 rad/s, altitude and speed finite

## Physics (F1) — frozen 2026-09-27
- `F1.trimAltFt`: 50 — trimmed level flight, hands off, 120 s: altitude within ± ft
- `F1.trimSpeedKt`: 3 — same run: CAS within ± kt
- `F1.energyDriftFrac`: 0.001 — no drag, no thrust, no ground: specific energy (h + V²/2g) drift over 60 s, fraction
- `F1.restDriftM`: 0.05 — parked 60 s, brakes on, calm: horizontal drift, m
- `F1.restBounceM`: 0.02 — same run after 5 s settling: vertical peak-to-peak, m

## Autopilot (F4) — frozen 2026-09-27
- `F4.hdgDeg`: 2 — steady-state heading error (after 60 s)
- `F4.altFt`: 50 — altitude hold error
- `F4.vsFpm`: 150 — vertical speed hold error
- `F4.spdKt`: 3 — autothrottle speed error
- `F4.locHalfDotDdm`: 0.03875 — ½ dot: Boeing PFD 2 dots = 0.155 DDM full scale [ICAO]
- `F4.gsHalfDotDdm`: 0.04375 — ½ dot: 2 dots = 0.175 DDM [ICAO]

## World (F5) — frozen 2026-09-27
- `F5.surfaceM`: 0.3 — SPEC §5: aircraft at a start position sits on the surface within ± m
- `F5.thresholdM`: 10 — NASR threshold vs terrain runway flattening and NAIP pavement, horizontal m
- `F6.fpsFloor`: 39 — 95th-percentile fps of the 10-minute scripted flight (gates/lib/flight-headless.mjs), 1920×1080 low tier, M4 (Metal), CPU+GPU serialised; measured 49.9 fps on 2026-09-28; floor = max( 30, 0.8 × measured )
- `F6.frameTriangles`: 2354038 — triangles per frame, all passes, same flight; measured max 1883230 (ring 810094) on 2026-09-28; cap = 1.25 × measured
- `F6.frameDraws`: 378 — draw calls per frame, same flight; measured max 252 on 2026-09-28; cap = 1.5 × measured
- `F6.gpuMemoryMB`: 1145 — peak GPU memory (footprint "(graphics)" categories) of the App process over the flight; measured 916 MB on 2026-09-28; cap = 1.25 × measured
