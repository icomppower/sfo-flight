# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| F0 Data | PASS | 2026-09-28 | 14 cached sources checksummed + licensed; baked terrain / ring / collision / aircraft match their indexes; C172 36 VERIFIED + 89 APPROX, 777 28 + 94 rows, all tagged; no GPL traces in fdm/; 43 frozen lines unchanged since 2e9eda0 (before fdm/sim.ts); 7/7 negatives |
| F1 FDM physics | PASS | 2026-09-28 | trimmed hands-off 120 s: ≤ 10.1 ft, ≤ 0.04 kt (4 configs); energy drift ≤ 0.066 %; parked on the SFO ramp: drift ≤ 0.9 mm, bounce 0; replay hash identical in the recording run, Node and Chrome (c172 4c8d69fc, b77w 581531e7); 4/4 negatives |
| F2 Performance | PASS | 2026-09-28 | C172: stall 52.4 / 48.3 KCAS, climb 699 fpm, TO roll 911 ft, landing roll 620 ft; 777: stall 119.4 / 160.7 KCAS, climb 2,970 fpm, 1.15 × TOD35 7,797 ft (roll 0.82), landing 6,007 ft-equivalent; 4/4 negatives |
| F3 Handling | PASS | 2026-09-28 | 6 conditions: SP ζ 0.48–0.64, phugoid ζ 0.10–0.22, dutch roll ζ ≥ 0.22 / ζωn ≥ 0.156, spirals stable or T2 577 s; roll 60° 2.21 s (C172), 30° 2.62 s (777); 10-min fuzz each clean; 4/4 negatives |
| F4 Autopilot | PASS | 2026-09-28 | holds (calm worst / gusty mean) within tolerance; ILS 28R 9 NM → 50 ft in 4 winds × 3 seeds: LOC ≤ 0.11 dot, G/S ≤ 0.40 dot, every autoland completed; 4/4 negatives |
| F5 World | PASS | 2026-09-28 | 18 ground starts ≤ 0.008 m from the drawn surface; NAIP runway axis 0–2 m from NASR; terrain / building / water / ring collisions detected; 4/4 negatives |
| F6 Budget | PASS | 2026-09-28 | 10-min scripted flight, 1920×1080 low tier, M4: p95 49.8 fps (floor 39), ≤ 1.88 M tris (cap 2.35 M), 252 draws (cap 378), 916 MB GPU (cap 1,145), 0 errors; 4/4 negatives |
| F7 Page | PASS | 2026-09-28 | build + audit clean; Chrome desktop: C172 right-hand pattern 28R via joystick fixture + keys, landed score 96 (A); replay director; 777 ILS via MCP clicks, autoland score 85; remap screen; phone 390×844 zh: 9/9 controls hit, no overflow, stick/throttle/flaps work; 4/4 negatives |
| F9 Easy (M1.1) | PASS | 2026-09-28 | trims = trimFly (6 rows); 4 missions load exact start from the menu; checklists tick in order within 1 s of the gate's own condition, never before; ③ throttle step stays open 6 s at idle; ① autoland score 94, ② robot landing 95; TAKEOFF/LANDING CONFIG exact on both aircraft, APP not armed outside the ILS window; checklist + config buttons hit-tested 1440×900 and 390×844 in en/zh; 6/6 negatives |
| F8 Look (advisory) | PASS | 2026-09-28 | stills in .verify/f8/: C172 over the Golden Gate at golden hour, 777 cockpit short final 28R at night, landing score, phone; 1/1 negative |

## Current

M1.1 (Easy flying) done 2026-09-28: Missions menu, guided checklist (zh/en, per-input key hints), TAKEOFF CONFIG (T),
LANDING CONFIG (L), 777 TO/GA (Shift+T); F0–F7 + F9 green in one clean `./verify.sh`. Next per SPEC §4: M2, M3.
