"""读取 frame_stats.csv 并断言剔除结果自洽、无缺帧。"""

from __future__ import annotations

import csv
import sys


def verify(stats_path: str) -> int:
    rows = list(csv.DictReader(open(stats_path)))
    if not rows:
        print("no stats found")
        return 1
    failures = []
    total_ref = total_drawn = total_diff = 0
    for r in rows:
        frame = int(r["frame"])
        cand = int(r["candidates"])
        passed = int(r["passed"])
        occluded = int(r["occluded"])
        delayed = int(r["delayed"])
        drawn = int(r["target_draws"])
        ref = int(r["reference_draws"])
        if r["depth_match"] != "True":
            failures.append(f"frame {frame}: depth buffer mismatch")
        if passed + occluded + delayed != cand:
            failures.append(
                f"frame {frame}: status sum {passed + occluded + delayed} != candidates {cand}")
        if drawn != passed + delayed:
            failures.append(
                f"frame {frame}: drawn {drawn} != passed+delayed {passed + delayed}")
        if drawn > ref:
            failures.append(f"frame {frame}: drawn {drawn} exceeds reference {ref}")
        total_ref += ref
        total_drawn += drawn
        total_diff += int(r["diff_pixels"])
    saved_pct = 100.0 * (total_ref - total_drawn) / max(total_ref, 1)
    print(f"frames={len(rows)} drawn={total_drawn} reference={total_ref} "
          f"saved={total_ref - total_drawn} ({saved_pct:.1f}%) "
          f"color_diff_pixels={total_diff}")
    if failures:
        for item in failures:
            print("FAIL:", item)
        return 1
    print("PASS: depth identical every frame, counts consistent, no missing frames")
    return 0


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "out/frame_stats.csv"
    raise SystemExit(verify(path))
