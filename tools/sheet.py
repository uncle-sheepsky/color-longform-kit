"""스팟 그림을 한 장으로 — 눈으로(또는 AI 가 그림으로) 한 번에 훑어보기.

  python tools/sheet.py spot/s12            → spot/s12_sheet.jpg (4칸씩 · 프레임 번호와 박 · 초를 적음)
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

START_BEAT = {"s12": 0, "s34": 56, "s56": 136, "end": 196}   # 페이지 0프레임의 전체 박(♩180 · 박당 10프레임)


def main():
    d = Path(sys.argv[1])
    fs = sorted(d.glob("f*.png"))
    if not fs:
        sys.exit(f"{d} 에 f####.png 가 없습니다 — 먼저 node render.mjs --page … --spot …")
    b0 = START_BEAT.get(d.name, 0)
    cols, tw = 4, 480
    th = tw * 9 // 16
    rows = (len(fs) + cols - 1) // cols
    S = Image.new("RGB", (cols * tw, rows * (th + 22)), (20, 20, 20))
    dr = ImageDraw.Draw(S)
    for i, f in enumerate(fs):
        x, y = (i % cols) * tw, (i // cols) * (th + 22)
        S.paste(Image.open(f).convert("RGB").resize((tw, th), Image.LANCZOS), (x, y + 22))
        fr = int(f.stem[1:])
        b = b0 + fr / 10
        dr.text((x + 4, y + 4), f"{d.name} f{fr}  beat {b:g}  {b / 3:.1f}s", fill=(230, 230, 230))
    out = d.parent / f"{d.name}_sheet.jpg"
    S.save(out, quality=88)
    print(out)


if __name__ == "__main__":
    main()
