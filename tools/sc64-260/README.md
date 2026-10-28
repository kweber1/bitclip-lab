# 260 note door (PAL, MAP 0x71 Statue Room): console test kit for the SummerCart64

**Question:** can something a player does put **one long game update (3+ VI)** on a census crack hold near the 260 door, at the exact frame the bit clip needs it?

**What this kit contains:**
- the clip spots and their exact frame windows, from the lab's own engine;
- an agent ROM change that reaches the room and can force a long update as a positive control;
- a console runner with five lag-hunting plans.

## 1. Clip spots near the 260 door

Door: (3845, 1250, 281), rot 270. All spots are on the 260-door floor (y 1250). There are two sources in `data/map0x71.gz.wasm`:
- `holds`: the Oct 18 door census, sampled points;
- `holdsA`: the full every-float census, whose nearest clip spot is 894 from the door.

`clipsetup-cli.js` runs the site's exact clip-setup search (`bkclipsetup.js`) on the 10 nearest. The search covers:
- a punch cancel with no stick, at 4 facings;
- the cancel on update 2–4;
- A held 3–14 updates;
- one long update anywhere.

| # | Spot (x, y, z) | From door | Clip setups | Long update must start at (VI after B) |
|---|---|---|---|---|
| 1 | (3391.24951, 1250, 252.128098) | 455 | 674 | cancel upd 2, A 7 upd: **B+42 or B+44**; A 9: B+48 |
| 2 | (3366.24585, 1250, 255.316818) | 479 | 210 | cancel 2, A 6: B+44 |
| 6 | (3276.11035, 1250, 251.161057) | 570 | 74 | cancel 3, A 9: B+50 |
| 8 | (3325.77026, 1250, 571.927856) | 595 | 504 | cancel 2, A 7: B+44 or B+46 |
| 3, 4, 5, 9, 10 | 546–894 | | 0 | they hold (1,500–5,000 setups each) but no single long update clips |
| 7 | (3274.05518, 1245.39, 250.347031) | 572 | 0 | no exact start lands on it (sloped tile) |

- **Facing doesn't matter** (every tested facing gives the same windows).
- **No-lag setups:** 0 clip without a long update.
- **Where Banjo goes:** the clip drops him into the void under the 1250 floor. Nothing is under that tile in the room collision. A recovery past the door (flutter / Beak Buster under the floor, as at 810) is **not** checked yet.
- **Files:**
  - `cases-260.json`: every clip setup, with exact start floats, facing, inputs, the long update's index and its VI offset after B;
  - `clipsetup-cli.js`: regenerates it (`node tools/sc64-260/clipsetup-cli.js --map 0x71 --door 260 --max 10 --dirs 4 --lags 1 --out ...`). Add `--lags 2` for two-lag patterns (much slower).

## 2. Agent v6 (`agent/sc64pal-v6.c`, diff in `agent/v5-to-v6.diff`)

PAL Practice SC64 agent v5 plus two changes:

1. **ROOM job takes a map.**
   - job[3] = entry, job[4] = map (0 = 0x79), job[5] = note-door open flag to clear (0 = 0x39 as before).
   - For 260: `[MAGIC, 1, 0, 1, 0x71, 0x3C]` (entry 1 = higher exit on the door side; FILEPROG_3C = 260 door open).
   - The door only opens within 290 of it and every spot is ≥ 455 away, so it stays shut. The "not enough notes" text also needs < 290, so it never fires.
2. **F_FORCE (16), a working forced lag.**
   - The 765 `sc64_pal_forcelag.py` timed pokes of 0x80384E60/64 never changed a step. All its rows have the same y path, because `time_setDeltaReal_frames` rewrites both at the next frame start.
   - v6 replaces that function (PAL 0x8033E154, found by its `s_dTimeReal_frames` stores; US 0x8033DD04) with `pal_setframes`. It behaves identically except that, in a TEST with F_FORCE, the first frame starting ≥ job[53] VI after B gets job[54] frames (default 3 = the 0.06 s cap), once. res[30] = the B-relative VI it hit.

**Build:**
- Same as v5: in `mods\snapper-practice-pal-sc64-v5`'s folder, `bash build.sh sc64pal-v6.c`.
- The v5 sources rebuilt this way are byte-identical to the v5 ROM.
- ROM SHA-256 `6a678f11ab0deb0ef11a216c6d8efbae0ae32ddac6ea27c818bdb407793caf65`. The ROM is not in this repo.

**BizHawk check (`agent/bk_pal_agent_v6_check.lua`, output `agent/agent-v6-check-bizhawk.txt`):**
- PING v6, ROOM to 0x71 in 120 VI.
- Spot 1 punch cancel (J 14) arrives on the crack bits, held at B+40..44, then popped (no clip).
- Forced 3-frame update:

  | Long update starts at | Result |
  |---|---|
  | B+42 | **CLIP**, falls to y 97 |
  | B+44 | **CLIP**, falls to y 145 |
  | B+36, 38, 40, 46, 48, 50 | no clip |

  This is exactly the model's window: the engine port, the agent and the window agree.

## 3. Console runner: `sc64_pal260.py`

Copy it next to the PC scripts in `E:\banjo\mods\sc64-crack-brute`. It needs `sc64_crack_brute.py`, `sc64_pal765b.py`, `sc64_pal_v3.py` and `sc64_pal_viewsurvey.py` there, plus `cases-260.json`.

**How a try works:**
- The start origin is measured and closed-loop calibrated on the console (same as the 765 runs).
- A = 2 × hold updates VI.
- Each update logs the hook interval and the game's own frame time (game dt).
- **Only game dt ≥ 3 counts as lag.** Hook 3,1 with game dt 2 is controller jitter (see the 765 notes in the project).

Output is `sc64-pal260-<plan>\results.csv` with these columns:
- `long_gamedt_rel_B`: real long updates, VI after B;
- `long_in_window`: the ones inside the spot's clip window;
- `pattern_dvi` / `pattern_gamedt`;
- `traces\` for every held try with a long update or a clip.

## 4. Test plan (run in this order)

| Step | Command | What it answers | Pass / next |
|---|---|---|---|
| 0. Upload v6 | `python sc64_upload.py <path>\BK-Snapper-PAL-Practice-SC64-v6.z64`, press Reset, load the save | — | `PING` reports v6 |
| 1. Positive control | `python sc64_pal260.py --plan force --spots 1,8 --facings 0,270 --repeat 1` | Does the console clip with one long update at the model's window? Confirms the spots, origins, hold timing and the window on hardware | Clips only at the window (B+42/44 for spot 1). If the hold time differs from the BizHawk B+40..44, every window below shifts by the same amount |
| 2. Baseline frame boundaries | `--plan base --spots 1,2,6,8 --facings 0,90,180,270 --repeat 6` | The room's own cadence along the jump at each spot and facing (765 was a flat 2 VI). Any natural long update at B+38..52? | Note every `long_gamedt_rel_B`; a non-empty `long_in_window` is a lead |
| 3. Camera-induced lag | `--plan cam --spots 1,8 --facings 0,90,180,270` | C-Left / C-Right / R / C-Down taps landing B+30..48; zoom 1–2 set before the punch; first person in, out after 50/70 VI (+ a stick turn), punch 0–30 VI after leaving. At 765 the only real long updates came from first person: 37–44 VI after entering, ~9–11 after leaving | Look for the exit lag landing in the window: exit + ~10 ≈ B+42..46 means leaving first person ~32–36 VI after B, which can't be done (first person blocks the punch). So the target is a camera tap whose long update lags it by a fixed amount |
| 4. Animation timing | `--plan anim --spots 1,8 --facings 0,270` | Idle time before B (0–120 VI: idle-animation phase and reloads) and stand-up after a crouch (Z 10/30 VI, release, B 10–60 later). At 765 the idle/stand-up reload gave W ≈ 2.0–2.4, the only heavy frames besides first person | Any long update that moves with the idle/stand-up time into B+42..46 |
| 5. Frame-boundary phase | `--plan phase --spots 1 --facings 0,270 --repeat 6` | Shifts B by 0–7 VI against the console cadence. Checks the hold always starts at the same B-relative VI and that a long update isn't tied to an odd/even VI | Hold VIs identical across shifts; any phase-locked long updates |
| 6. Egg spam | `--plan eggs --spots 1,8 --facings 0,270` | Forward/back eggs (1, 3, 8, 14; gaps 6/8; waits 15–60) and zoom + laid eggs. On the PAL console eggs gave 0 long updates in 765 (the BizHawk egg lag was an emulator artefact), so this checks the 260 room is the same | Expect none. Anything in the window is a lead |
| 7. Leads | `--plan custom --styles "c:<start>-<len>-<BTN>/...@<act>"` | Narrow any lead from steps 2–6 to its timing, 30+ repeats, then try the A hold/cancel that puts the hold on it (`cases-260.json` lists every window) | Repeatable long update in the window → clip attempts |
| 8. Recovery (if a clip is found) | BizHawk first | Where the void fall can be steered: flutter + air control under the 1250 floor toward x > 3845, Beak Buster, as at 810 | — |

**Notes:**
- **Origin placement** (writing the start x/z one claw step before the crack) is DIAGNOSTIC, as in all the 765/810 console runs. It stands in for a human approach to the exact float.
- **Forced lag (step 1)** is a positive control only.
- **The real 765 lag picture** (first-person lower-lobby view, door-text freeze) is in the project docs: `claude/765-pal-console-lag-20261024.md`, `claude/765-lag-cold-asset-loads-20261024.md`.
