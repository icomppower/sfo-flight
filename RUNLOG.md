# Run log

- 2026-09-28 full ./verify.sh #1: F0–F5 PASS, F6 FAIL (negative "1.5 GB leaked GPU buffers" missed: constant fill compressed, buffers unreferenced), F7 PASS, F8 PASS.
- 2026-09-28 full ./verify.sh #2 (clean): F0 F1 F2 F3 F4 F5 F6 F7 PASS, all negatives caught; F8 PASS (advisory). ALL REQUIRED GATES GREEN.
- 2026-09-28 full ./verify.sh #3 (clean, M1.1): F0 F1 F2 F3 F4 F5 F6 F7 F9 PASS, all negatives caught (F9 6/6); F8 PASS (advisory). ALL REQUIRED GATES GREEN.
- 2026-09-28 full ./verify.sh #4 (clean, step-by-step checklist: full list with ✓, Next, live values, mission ③ flaps-up step): F0–F7 F9 PASS, F9 6/6 negatives; F8 PASS (advisory). ALL REQUIRED GATES GREEN.
- 2026-09-29 full ./verify.sh #5 (M1.2): F6 FAIL (p95 20 fps) — another session's headless Chromium was on the GPU; the unchanged M1.1 commit read 18.9 fps under the same load (A/B), so environmental. F0–F5 F7 F9 F10 PASS, F10 11/11 negatives.
- 2026-09-29 full ./verify.sh #6 (clean, M1.2, F6 listed first and run in a quiet-GPU window agreed with the other sessions): F6 F0 F1 F2 F3 F4 F5 F7 F9 F10 PASS, every negative caught (F10 11/11); F8 PASS (advisory). ALL REQUIRED GATES GREEN.
