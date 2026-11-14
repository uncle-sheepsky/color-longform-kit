# -*- coding: utf-8 -*-
"""롱폼 → 세로 숏폼 편집본(1080×1920 · 영상 칸 1080×1350 + 위아래 여백 · 30fps · 드롭 ~ 끝 34.67초 · 박 136~240).

  python tools/make_short.py [--music music/color_longform.wav]     (먼저: python make.py render · finish 로 out/video_full.mp4)
  → out/color_longform_short.mp4  (+ out/short_cam.json = 프레임마다 창 자리 · 확대)

방법(결정론 · 같은 입력이면 같은 결과):
 1) 분석: 롱폼 1360~2399프레임을 480×270 으로 풀어 프레임마다 「볼 거리 가로 위치」를 셈
    = (앞 프레임과 달라진 픽셀 × 2 + 그 프레임 바탕색과 먼 픽셀)의 가로 무게중심.
 2) 창 이동(4:5 창 864×1080 을 가로로 옮김 · 1.25배로 키워 위아래 여백 사이에 놓음) — 음악 박에 맞춤:
    드롭 136~156 · 박수 정점 208~213 = 박마다 다음 박의 볼 거리로 툭 건너감(4프레임 · 빠르게 감속) + 박마다 살짝 당겨짐(1.07 → 1)
    세계 156~172 · 올라감 196~207 = 2박마다 건너감 · 빛 172~192 = 천천히 따라감 · 꿀꺽 192.1 = 한 번 건너감 · 웅크림 207~208 = 멈춤
    글자 213~223.2 = 써지는 제목을 왼쪽 → 오른쪽으로 읽듯 훑음 → 다 써진 제목에 0.6초 머묾 → 226.4 부터 박수 친 캐릭터에 머묾(끝까지 아주 천천히 다가감)
    「이리저리」: 건너갈 때 지금 자리에서 260px 이상 떨어진 곳 중 볼 거리가 가장 많은 곳 · 4번째마다는 어디든 가장 많은 곳.
 3) 굽기: 원본 해상도 프레임에서 창을 잘라 1080×1350 으로 키움 → H.264 · 음악의 45.333~80초를 붙임(AAC 피크 여유로 −1 dB).
"""
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "out" / "video_full.mp4"
MUSIC = ROOT / (sys.argv[sys.argv.index("--music") + 1] if "--music" in sys.argv else "music/color_longform.wav")
OUT = ROOT / "out"
FPB, B0, B1 = 10, 136, 240
F0, NF = B0 * FPB, (B1 - B0) * FPB
W, H = 1920, 1080
IW, IH = 1080, 1350                            # 영상 칸 4:5 · 위아래 여백 285px
CW = H * IW / IH                               # 창 = 864×1080
AW, AH = 480, 270
_kit = (ROOT / "build/kit.js").read_text(encoding="utf-8")
PAL = json.loads(re.search(r"window\.PAL = (.*?);\n", _kit).group(1))
GEO = json.loads(re.search(r"window\.GEO = (.*?);\n", _kit).group(1))
PAD_RGB = tuple(PAL["night"])                  # 여백 = 어두운 바탕색
PAD_Y = (1920 - IH) // 2
_L = [p for p in GEO["letters"] if p["x"] + p["w"] < 976]
LOGO_X = (min(p["x"] for p in _L) + max(p["x"] + p["w"] for p in _L)) / 2 if _L else 545   # 끝 화면 제목 가운데
DURU_X = GEO["end_pose"]["x"] + GEO["end_pose"]["size"][0] / 2                              # 끝 화면 캐릭터 가운데


def frames(scale=None):
    vf = ["-vf", f"select=gte(n\\,{F0}),scale={scale[0]}:{scale[1]}:flags=area"] if scale else ["-vf", f"select=gte(n\\,{F0})"]
    w, h = scale or (W, H)
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(SRC), *vf, "-vsync", "0", "-frames:v", str(NF), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    n = w * h * 3
    for _ in range(NF):
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    p.stdout.close()
    p.wait()


def analyse():
    xs, prof, prev = [], [], None
    cols = np.arange(AW) * (W / AW)
    for fr in frames((AW, AH)):
        a = fr.astype(np.int16)
        bg = np.median(a.reshape(-1, 3)[::37], axis=0)
        far = (np.abs(a - bg).sum(2) > 60).astype(np.float32)
        mov = (np.abs(a - prev).sum(2) > 24).astype(np.float32) if prev is not None else np.zeros_like(far)
        w = (2 * mov + far).sum(0)
        prof.append(w)
        xs.append(float((w * cols).sum() / w.sum()) if w.sum() > 50 else W / 2)
        prev = a
    return np.array(xs), np.array(prof)


def ease3o(u):
    u = min(1.0, max(0.0, u))
    return 1 - (1 - u) ** 3


def plan(xs, prof):
    n = len(xs)
    lo, hi = CW / 2, W - CW / 2
    sm = np.convolve(np.pad(xs, 6, mode="edge"), np.ones(13) / 13, mode="valid")          # 천천히 따라갈 때(±6프레임 평균)
    CANDS = np.linspace(lo, hi, 13)

    def score(b, span, c):                                                               # 그 창 안 볼 거리 합(다음 span 박 동안)
        a, z = int((b - B0) * FPB), int((b + span - B0) * FPB)
        P = prof[a:max(a + 1, z)].mean(0)
        c0, c1 = int((c - CW / 2) * AW / W), int((c + CW / 2) * AW / W)
        return float(P[c0:c1].sum())

    def hop_to(b, span, cur, k):
        sc = {float(c): score(b, span, c) for c in CANDS}
        best = max(sc.values())
        far_ = {c: v for c, v in sc.items() if abs(c - cur) >= 260}
        if k % 4 == 0 or not far_ or max(far_.values()) < 0.35 * best:
            return max(sc, key=sc.get)
        return max(far_, key=far_.get)
    sched = [(b, 1) for b in range(136, 156)] + [(b, 2) for b in range(156, 172, 2)] + [(192.1, 3.9)] + [(b, min(2, 207 - b)) for b in range(196, 207, 2)] + [(b, 1) for b in range(208, 213)]
    hops, cur_h = [], W / 2
    for k, (b, span) in enumerate(sched):
        cur_h = hop_to(b, span, cur_h, k)
        hops.append((b, cur_h))
    cx, zoom = np.zeros(n), np.ones(n)
    cur = W / 2
    for f in range(n):
        b = B0 + f / FPB
        if 172 <= b < 192.1:                                                             # 빛: 천천히 따라감
            cur = float(np.clip(sm[f], lo, hi))
            cx[f] = cur
            continue
        if 213 <= b:                                                                     # 글자 → 캐릭터
            x213 = cx[int((213 - B0) * FPB) - 1]
            if b < 213.6:
                cx[f] = x213 + (lo - x213) * ease3o((b - 213) / 0.6)
            elif b < 223.2:
                cx[f] = lo + (LOGO_X - lo) * ((b - 213.6) / 9.6)
            elif b < 225:
                cx[f] = LOGO_X
            elif b < 226.4:
                u = (b - 225) / 1.4
                cx[f] = LOGO_X + (DURU_X - LOGO_X) * (0.5 - 0.5 * math.cos(math.pi * u))
            else:
                cx[f] = DURU_X + 18 * math.sin((b - 226.4) * 0.5)
                zoom[f] = 1 + 0.04 * min(1, max(0, (b - 228) / 12))
            cur = cx[f]
            continue
        if 207 <= b < 208:                                                               # 웅크림 = 멈춤
            cx[f] = cur
            continue
        prev_h = [h for h in hops if h[0] <= b + 1e-9]
        if not prev_h:
            cx[f] = cur
            continue
        hb, hx = prev_h[-1]
        i = hops.index(prev_h[-1])
        fromx = hops[i - 1][1] if i > 0 else W / 2
        if i > 0 and hops[i - 1][0] < 172 <= hb or hb == 192.1 or hb == 196 or hb == 208:   # 천천히 구간 뒤 첫 건너감은 그때 자리에서
            fromx = cx[max(0, int(round((hb - B0) * FPB)) - 1)]
        k = ease3o((b - hb) * FPB / 4)                                                   # 4프레임 동안 빠르게 감속
        cur = fromx + (hx - fromx) * k
        cx[f] = cur
        if (136 <= b < 156) or (208 <= b < 224):                                         # 박마다 살짝 당겨짐
            t = (b - math.floor(b)) * (60 / 180)
            zoom[f] = 1 + 0.07 * math.exp(-t / 0.12)
    return cx, zoom


def render(cx, zoom):
    silent = OUT / "short_video.mp4"
    enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1080x1920", "-r", "30", "-i", "-",
                            "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-pix_fmt", "yuv420p", "-threads", "1", str(silent)], stdin=subprocess.PIPE)
    for f, fr in enumerate(frames()):
        z = zoom[f]
        w, h = CW / z, H / z
        x0 = min(max(cx[f] - w / 2, 0), W - w)
        y0 = (H - h) / 2
        im = Image.fromarray(fr).resize((IW, IH), Image.LANCZOS, box=(x0, y0, x0 + w, y0 + h))
        cv = Image.new("RGB", (1080, 1920), PAD_RGB)
        cv.paste(im, (0, PAD_Y))
        enc.stdin.write(cv.tobytes())
    enc.stdin.close()
    enc.wait()
    final = OUT / "color_longform_short.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(silent), "-ss", f"{B0 * 60 / 180:.6f}", "-t", f"{NF / 30:.6f}", "-i", str(MUSIC),
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "volume=-1.0dB", "-c:a", "aac", "-b:a", "192k", "-shortest", str(final)], check=True)
    return final


if __name__ == "__main__":
    if not SRC.exists():
        sys.exit(f"{SRC} 가 없습니다 — 먼저 python make.py render · python make.py finish")
    xs, prof = analyse()
    cx, zoom = plan(xs, prof)
    (OUT / "short_cam.json").write_text(json.dumps({"cx": [round(v, 1) for v in cx], "zoom": [round(v, 4) for v in zoom]}), encoding="utf-8")
    print("완료", render(cx, zoom))
