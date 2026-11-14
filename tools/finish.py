"""마무리 — 네 구간 영상을 이어 붙이고 음악을 넣은 뒤, 형식 검사를 모두 돌려 보고서를 쓴다.

  python tools/finish.py [--music music/color_longform.wav]

먼저 있어야 하는 것(make.py render 가 만듦):
  out/s12.mp4 · out/s34.mp4 · out/s56.mp4 · out/end.mp4      구간 영상(560 · 800 · 600 · 440프레임)
  gates/<구간>_fwd.json · gates/<구간>_rev.json               정순 · 역순 프레임 해시
검사(형식 측정만 — 보기 좋은지 · 듣기 좋은지는 사람이 판정):
  1) 결정론: 구간마다 정순 해시 = 역순 해시(모든 프레임) — 어느 프레임을 어떤 순서로 그려도 같은 픽셀
  2) 프레임 수: 해시 수 = 구간 영상 프레임 수 · 합 2400 · 1920×1080 @30
  3) 번쩍임: 어느 1초에도 3번 이하(tools/flash_check.py)
  4) 음량(AAC 로 넣은 뒤): 통합 −14 ± 0.5 LUFS · 트루피크 ≤ −1.0 dBTP · 무음 구간(132.5~136박 = 44.17~45.33초) 소리 0
출력: out/color_longform.mp4 · gates/report.json
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SCENES = [("s12", 560), ("s34", 800), ("s56", 600), ("end", 440)]
MUSIC = ROOT / (sys.argv[sys.argv.index("--music") + 1] if "--music" in sys.argv else "music/color_longform.wav")
OUT, GATES = ROOT / "out", ROOT / "gates"


def run(cmd, binary=False):
    return subprocess.run(cmd, capture_output=True, **({} if binary else dict(text=True, encoding="utf-8", errors="replace")))


def frames(path):
    info = json.loads(run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames", "-of", "json", str(path)]).stdout)
    s = info["streams"][0]
    return int(s["nb_read_frames"]), (int(s["width"]), int(s["height"]), s["r_frame_rate"])


def main():
    rep, ok = {}, {}
    det = {}
    for name, n in SCENES:
        f, r = GATES / f"{name}_fwd.json", GATES / f"{name}_rev.json"
        if not f.exists() or not r.exists():
            sys.exit(f"{f.name} / {r.name} 가 없습니다 — 먼저 python make.py render")
        a, b = json.loads(f.read_text()), json.loads(r.read_text())
        same = sum(1 for k in a if b.get(k) == a[k])
        det[name] = f"{same}/{n}"
        ok[f"det_{name}"] = same == n == len(a) == len(b)
    rep["determinism_fwd_vs_rev"] = det
    counts = {}
    for name, n in SCENES:
        v = OUT / f"{name}.mp4"
        if not v.exists():
            sys.exit(f"{v} 가 없습니다 — 먼저 python make.py render")
        nf, spec = frames(v)
        counts[name] = nf
        ok[f"frames_{name}"] = nf == n and spec == (1920, 1080, "30/1")
    rep["frames"] = counts
    lst = OUT / "concat.txt"
    lst.write_text("".join(f"file '{(OUT / f'{n}.mp4').as_posix()}'\n" for n, _ in SCENES), encoding="utf-8")
    full = OUT / "video_full.mp4"
    r = run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(full)])
    if r.returncode:
        sys.exit(r.stderr)
    nf, spec = frames(full)
    rep["frames_total"] = nf
    ok["frames_total"] = nf == 2400 and spec == (1920, 1080, "30/1")
    fl = run([sys.executable, str(ROOT / "tools/flash_check.py"), str(full)])
    flash = json.loads(fl.stdout) if fl.stdout.strip().startswith("{") else {"error": fl.stderr}
    rep["flash"] = {k: flash.get(k) for k in ("worst_1s_flashes", "worst_window_starts_at_frame", "jumps_over_20", "rule")}
    ok["flash"] = bool(flash.get("passed"))
    if not MUSIC.exists():
        sys.exit(f"음악 파일이 없습니다: {MUSIC}")
    final = OUT / "color_longform.mp4"
    r = run(["ffmpeg", "-v", "error", "-y", "-i", str(full), "-i", str(MUSIC), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
             "-map_metadata", "-1", "-movflags", "+faststart", "-shortest", str(final)])
    if r.returncode:
        sys.exit(r.stderr)
    r = run(["ffmpeg", "-nostats", "-hide_banner", "-i", str(final), "-af", "ebur128=peak=true", "-f", "null", "-"])
    tail = r.stderr[r.stderr.rfind("Summary:"):]
    I, TP = float(re.search(r"I:\s+(-?[\d.]+) LUFS", tail).group(1)), float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail).group(1))
    raw = run(["ffmpeg", "-v", "error", "-i", str(final), "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], binary=True).stdout
    a = np.frombuffer(raw, np.int16)
    hole = int(np.abs(a[int(44.2 * 48000):int(45.3 * 48000)]).max()) if len(a) else -1
    rep["loudness"] = dict(integrated_lufs=I, true_peak_dbtp=TP, silence_44_2_to_45_3s_peak=hole)
    ok["loudness"] = -14.5 <= I <= -13.5 and TP <= -1.0
    ok["silence"] = hole <= 64                                   # AAC 로 넣으면 완전 0 은 아닐 수 있음(아주 작은 잡음 허용)
    rep["output"] = dict(path=str(final.relative_to(ROOT)), bytes=final.stat().st_size, sha256=hashlib.sha256(final.read_bytes()).hexdigest())
    rep["pass"] = ok
    rep["all_pass"] = all(ok.values())
    rep["note"] = "형식 측정만. 그림이 내 캐릭터답게 보이는지 · 음악과 화면이 맞는지는 사람이 끝까지 보고 판정한다. 다른 컴퓨터에서 같은 픽셀이 나오는지는 확인하지 않았다."
    GATES.mkdir(exist_ok=True)
    (GATES / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(rep, ensure_ascii=False, indent=1))
    sys.exit(0 if rep["all_pass"] else 1)


if __name__ == "__main__":
    main()
