# Run log

- 2026-09-28 full ./verify.sh #1: F0–F5 PASS, F6 FAIL (negative "1.5 GB leaked GPU buffers" missed: constant fill compressed, buffers unreferenced), F7 PASS, F8 PASS.
- 2026-09-28 full ./verify.sh #2 (clean): F0 F1 F2 F3 F4 F5 F6 F7 PASS, all negatives caught; F8 PASS (advisory). ALL REQUIRED GATES GREEN.
- 2026-09-28 full ./verify.sh #3 (clean, M1.1): F0 F1 F2 F3 F4 F5 F6 F7 F9 PASS, all negatives caught (F9 6/6); F8 PASS (advisory). ALL REQUIRED GATES GREEN.
