"""한 번에 돌리기 — 준비 → 스팟 → 전체 렌더(정순 해시) → 역순 해시 → 마무리(검사 · 음악 넣기).

  python make.py prep   [--character examples/sample]   캐릭터 준비물 build/ (+ build/check.png 확인 그림)
  python make.py spot                                    구간마다 몇 프레임만 PNG → spot/<구간>_sheet.jpg (먼저 눈으로 볼 것)
  python make.py render                                  네 구간 전체 → out/<구간>.mp4 + gates/<구간>_fwd.json · 이어서 역순 해시 gates/<구간>_rev.json
  python make.py finish                                  결정론 · 프레임 수 · 번쩍임 · 음량 검사 + 음악 넣기 → out/color_longform.mp4 · gates/report.json
  python make.py all    [--character examples/sample]   위 네 단계를 차례로(중간에 실패하면 멈춤)
  python make.py short                                   (선택) 롱폼의 드롭 ~ 끝을 세로 숏폼으로 → out/color_longform_short.mp4
시간(참고 · 이 키트를 만든 컴퓨터): prep 약 1분 · 영상 굽기 구간당 1.5~3분 · 역순 해시 구간당 1~2분 · all 전체 약 14분.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCENES = ["s12", "s34", "s56", "end"]
SPOTS = {"s12": "30,100,115,200,300,440,545", "s34": "20,200,400,520,600,700,790", "s56": "5,150,220,260,300,420,560,599", "end": "100,125,200,260,330,439"}


def sh(cmd):
    print("$", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode:
        sys.exit(f"실패: {' '.join(cmd)} (종료 코드 {r.returncode})")


def prep():
    extra = sys.argv[sys.argv.index("--character"):sys.argv.index("--character") + 2] if "--character" in sys.argv else []
    sh([sys.executable, "tools/prep.py", *extra])


def spot():
    for s in SCENES:
        sh(["node", "render.mjs", "--page", f"scenes/{s}.html", "--spot", SPOTS[s], "--out", f"spot/{s}"])
        sh([sys.executable, "tools/sheet.py", f"spot/{s}"])


def render():
    for s in SCENES:
        sh(["node", "render.mjs", "--page", f"scenes/{s}.html", "--video", f"out/{s}.mp4", "--name", f"{s}_fwd"])
    for s in SCENES:
        sh(["node", "render.mjs", "--page", f"scenes/{s}.html", "--sha-only", "--order", "rev", "--name", f"{s}_rev"])


def finish():
    extra = sys.argv[sys.argv.index("--music"):sys.argv.index("--music") + 2] if "--music" in sys.argv else []
    sh([sys.executable, "tools/finish.py", *extra])


def short():
    extra = sys.argv[sys.argv.index("--music"):sys.argv.index("--music") + 2] if "--music" in sys.argv else []
    sh([sys.executable, "tools/make_short.py", *extra])


STEPS = {"prep": [prep], "spot": [spot], "render": [render], "finish": [finish], "short": [short], "all": [prep, spot, render, finish]}
if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in STEPS:
        sys.exit(__doc__)
    for fn in STEPS[sys.argv[1]]:
        fn()
