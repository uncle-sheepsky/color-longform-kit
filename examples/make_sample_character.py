"""시험 캐릭터 「MOMO」를 코드로 그린다 — 키트가 처음부터 끝까지 도는지 확인하는 용도(CC0 · 마음대로 쓰세요).

  python examples/make_sample_character.py          → examples/sample/<동작>/NN.png
  python tools/prep.py --character examples/sample  → 이 캐릭터로 준비물 만들기

생김새: 둥근 머리 · 고양이 귀 · 머리 위 진한 갈색 잎 하나 · 빨간 목도리 · 청록 코트 · 분홍 볼(안에 빨간 빗금 두 획) · 진한 갈색 발.
      = 선(ink) · 종이(머리 · 손) · 진한 면(잎 · 발) · 키컬러 셋(빨강 · 청록 · 분홍)이 또렷이 갈리게 일부러 단순하게.
동작: stand(6장 · 2번 장 = 눈 감음) · ready(두 손 모음) · surprise(놀람) · cheer(만세)
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent / "sample"
SS = 2                                    # 2배로 그려 줄임(가장자리 부드럽게)
CW, CH = 1100, 1200                       # 캔버스
INK = (44, 24, 38, 255)
PAPER = (252, 244, 230, 255)
DEEP = (92, 52, 34, 255)
RED = (222, 58, 66, 255)
TEAL = (52, 158, 168, 255)
PINK = (248, 164, 170, 255)
LW = 16


def S(v):
    return v * SS


def ell(d, cx, cy, rx, ry, fill, lw=LW):
    d.ellipse([S(cx - rx), S(cy - ry), S(cx + rx), S(cy + ry)], fill=fill, outline=INK if lw else None, width=S(lw) if lw else 0)


def poly(d, pts, fill, lw=LW):
    P = [(S(x), S(y)) for x, y in pts]
    d.polygon(P, fill=fill)
    if lw:
        d.line(P + [P[0]], fill=INK, width=S(lw), joint="curve")
        for x, y in P:
            d.ellipse([x - S(lw) / 2, y - S(lw) / 2, x + S(lw) / 2, y + S(lw) / 2], fill=INK)


def arc(d, cx, cy, rx, ry, a0, a1, lw=LW, col=INK):
    d.arc([S(cx - rx), S(cy - ry), S(cx + rx), S(cy + ry)], a0, a1, fill=col, width=S(lw))


def leaf(cx, cy, L, ang):
    """물방울 잎: 끝이 뾰족한 볼록 도형(꼭짓점 목록)."""
    pts = []
    for i in range(41):
        t = i / 40
        w = math.sin(math.pi * t) ** 0.8 * L * 0.42
        x, y = -L * t, w
        pts.append((x, y))
    for i in range(40, -1, -1):
        t = i / 40
        w = math.sin(math.pi * t) ** 0.8 * L * 0.42
        pts.append((-L * t, -w))
    ca, sa = math.cos(ang), math.sin(ang)
    return [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts]


def draw(arms="side", eyes="open", mouth="smile", bob=0.0, tilt=0.0):
    im = Image.new("RGBA", (S(CW), S(CH)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    hx, hy = 550, 430 + bob                # 머리 가운데
    by = 880 + bob * 0.5                   # 몸 가운데
    # 발(진한 면)
    ell(d, 430, 1110, 95, 55, DEEP)
    ell(d, 670, 1110, 95, 55, DEEP)
    # 팔(뒤): 만세 · 놀람은 위로
    def arm(side, mode):
        sx = 1 if side > 0 else -1
        if mode == "side":
            ell(d, 550 + sx * 255, by + 40, 70, 120, TEAL); ell(d, 550 + sx * 275, by + 150, 58, 55, PAPER)
        elif mode == "up":
            ell(d, 550 + sx * 300, by - 170, 66, 120, TEAL); ell(d, 550 + sx * 335, by - 290, 58, 55, PAPER)
        elif mode == "wide":
            ell(d, 550 + sx * 300, by - 60, 120, 66, TEAL); ell(d, 550 + sx * 420, by - 95, 56, 56, PAPER)
    if arms in ("side", "up", "wide"):
        arm(-1, arms); arm(1, arms)
    # 몸(코트)
    ell(d, 550, by, 270, 250, TEAL)
    d.line([S(550), S(by - 150), S(550), S(by + 230)], fill=INK, width=S(10))
    for k in range(3):
        ell(d, 590, by - 60 + k * 95, 16, 16, PAPER, lw=8)
    if arms == "together":                 # 두 손 모음(앞)
        ell(d, 470, by - 20, 80, 70, TEAL); ell(d, 630, by - 20, 80, 70, TEAL)
        ell(d, 550, by - 55, 70, 62, PAPER)
    # 귀(뒤) · 머리
    for sx in (-1, 1):
        poly(d, [(hx + sx * 150, hy - 220), (hx + sx * 300, hy - 300), (hx + sx * 285, hy - 110)], PAPER)
        poly(d, [(hx + sx * 185, hy - 205), (hx + sx * 270, hy - 255), (hx + sx * 262, hy - 150)], PINK, lw=0)
    ell(d, hx, hy, 330, 300, PAPER)
    # 목도리(빨강) + 매듭 꼬리
    poly(d, [(330, hy + 245), (770, hy + 245), (790, hy + 325), (310, hy + 325)], RED)
    poly(d, [(640, hy + 300), (720, hy + 300), (760, hy + 430), (650, hy + 410)], RED)
    # 머리 위 잎(진한 면) + 잎맥
    L = leaf(hx + 40, hy - 285, 230, math.radians(-120 + tilt))
    poly(d, L, DEEP)
    tip = L[40]
    d.line([S(hx + 40), S(hy - 285), S((hx + 40) * 0.45 + tip[0] * 0.55), S((hy - 285) * 0.45 + tip[1] * 0.55)], fill=PAPER, width=S(9))
    # 얼굴
    ey = hy + 20
    for sx in (-1, 1):
        x = hx + sx * 120
        if eyes == "open":
            ell(d, x, ey, 34, 46, INK, lw=0); ell(d, x - 10, ey - 16, 11, 11, PAPER, lw=0)
        elif eyes == "closed":
            arc(d, x, ey, 36, 22, 10, 170, lw=12)
        elif eyes == "happy":
            arc(d, x, ey + 12, 36, 30, 190, 350, lw=12)
        elif eyes == "wide":
            ell(d, x, ey, 40, 54, INK, lw=0); ell(d, x - 12, ey - 20, 13, 13, PAPER, lw=0)
    for sx in (-1, 1):                     # 볼(분홍) + 빗금 두 획(빨강)
        cx = hx + sx * 205
        ell(d, cx, ey + 85, 58, 34, PINK, lw=0)
        for dx in (-14, 14):
            d.line([S(cx + dx - 7), S(ey + 102), S(cx + dx + 7), S(ey + 68)], fill=RED, width=S(8))
    if mouth == "smile":
        arc(d, hx - 22, ey + 70, 24, 20, 20, 160, lw=10); arc(d, hx + 22, ey + 70, 24, 20, 20, 160, lw=10)
    elif mouth == "o":
        ell(d, hx, ey + 95, 26, 32, INK, lw=0); ell(d, hx, ey + 102, 15, 16, PINK, lw=0)
    elif mouth == "open":
        d.chord([S(hx - 45), S(ey + 60), S(hx + 45), S(ey + 140)], 0, 180, fill=INK)
        ell(d, hx, ey + 118, 22, 12, PINK, lw=0)
    return im.resize((CW, CH), Image.LANCZOS)


POSES = {
    "stand": [dict(bob=b, eyes="closed" if i == 2 else "open", tilt=3 * math.sin(i)) for i, b in enumerate([0, -6, -9, -6, 0, 3])],
    "ready": [dict(arms="together", bob=b, eyes="open") for b in (0, -5, -8, -4)],
    "surprise": [dict(arms="wide", eyes="wide", mouth="o", bob=b) for b in (0, -10, -14, -8)],
    "cheer": [dict(arms="up", eyes="happy", mouth="open", bob=b, tilt=6) for b in (0, -14, -20, -10)],
}


def main():
    for name, frames in POSES.items():
        d = OUT / name
        d.mkdir(parents=True, exist_ok=True)
        for i, kw in enumerate(frames):
            draw(**kw).save(d / f"{i:02d}.png")
        print(f"{name}: {len(frames)}장")
    print(f"→ {OUT}")


if __name__ == "__main__":
    main()
