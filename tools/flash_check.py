"""번쩍임 검사 — 영상에서 「어느 1초에도 번쩍임 3번 이하」인지 잰다(WCAG 2.3.1 일반 번쩍임 기준을 단순화한 형식 측정).

  python tools/flash_check.py out/video_full.mp4

방법: 프레임마다 64×36 회색으로 줄여 평균 밝기(0~255) → 이웃 프레임 사이 변화가 20 을 넘으면 「점프」 →
      방향이 반대인 점프 두 개가 이어지면 번쩍임 1번 → 30프레임(1초) 창을 한 칸씩 밀며 창 안 번쩍임 수의 최댓값.
기준: 최댓값 ≤ 3 이면 통과. 장면을 크게 바꿨다면(특히 박마다 밝음 ↔ 어둠이 뒤집히는 구간) 꼭 다시 잴 것.
한계: 화면 평균 밝기만 본다 — 작은 영역의 번쩍임 · 빨강 번쩍임(같은 기준의 다른 항목)은 이 검사로 잡히지 않는다.
"""
import json
import subprocess
import sys

import numpy as np

FPS, THR, LIMIT = 30, 20.0, 3


def luma_series(path):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=64:36,format=gray", "-f", "rawvideo", "-"], capture_output=True)
    if r.returncode:
        sys.exit(r.stderr.decode("utf-8", "replace"))
    return np.frombuffer(r.stdout, np.uint8).reshape(-1, 36 * 64).astype(float).mean(1)


def count_flashes(jumps):
    n, pend = 0, None
    for _, sgn in jumps:
        if pend is not None and sgn != pend:
            n, pend = n + 1, None
        else:
            pend = sgn
    return n


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    lum = luma_series(path)
    dm = np.diff(lum)
    big = np.where(np.abs(dm) > THR)[0]
    jumps = [(int(i), 1 if dm[i] > 0 else -1) for i in big]
    worst, at = 0, 0
    for s in range(0, max(1, len(dm) - FPS + 1)):
        n = count_flashes([j for j in jumps if s <= j[0] < s + FPS])
        if n > worst:
            worst, at = n, s
    rep = dict(video=path, frames=len(lum), jumps_over_20=len(jumps), worst_1s_flashes=worst, worst_window_starts_at_frame=at,
               jump_frames=[i + 1 for i, _ in jumps][:60], rule=f"1초(30프레임) 안 반대 방향 밝기 점프(>{THR:g}/255) 쌍 ≤ {LIMIT}", passed=worst <= LIMIT)
    print(json.dumps(rep, ensure_ascii=False, indent=1))
    sys.exit(0 if worst <= LIMIT else 1)


if __name__ == "__main__":
    main()
