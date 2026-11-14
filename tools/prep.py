"""캐릭터 준비 — character/ 의 내 캐릭터 그림으로 영상에 필요한 준비물(build/)을 전부 만든다.

  python tools/prep.py                          # character/ 를 씀
  python tools/prep.py --character examples/sample   # 다른 폴더를 씀(예: 시험 캐릭터)

입력
  character/<동작 이름>/00.png, 01.png …   투명 바탕 PNG(또는 WEBP) · 동작마다 폴더 하나 · 장 이름 순서대로 재생
  (그림 1장만 있어도 됨: character/main/00.png — 모든 장면이 이 그림을 돌려 씀)
  config.json   캐릭터 이름 · 끝 제목 · 동작 배정(poses) · 색 덮어쓰기 · 기준점 덮어쓰기
  fonts/ 안의 .ttf/.otf 하나(없으면 픽셀 글꼴로 대신 그림)

하는 일
  1) 색: 모든 그림의 색을 k-means++(결정론 시드 · 10묶음)로 묶어 역할을 정함 —
     가장 어두운 = 선(ink) · 다음 어두운(충분히 진할 때만) = 진한 면(deep) · 밝고 넓은 = 종이(paper) ·
     채도 0.3 이상에서 넓이 × 채도가 큰 순서(색상 25° 안은 하나만) = 키컬러 k1 · k2 · k3(영상에서 하나씩 돌아오는 색)
  2) 층: 그림마다 픽셀을 가장 가까운 묶음의 역할로 나눔(2배로 키워 나눈 뒤 줄여 가장자리를 부드럽게 ·
     어느 묶음과도 먼 가장자리 픽셀은 가장 가까운 확실한 픽셀을 따름) → sil · ink · deep · k1 · k2 · k3 · tick · full
     tick = 다른 키컬러 면 안에 박힌 작은 키컬러 점(볼 빗금 · 단추처럼) — 선만 남은 판에서도 남는 표시
  3) 기준점(그림에서 계산 · config.json "anchors" 로 덮어쓰기): 눈 위치 · 키컬러 조각의 무게중심 · 가장 큰 진한 면 덩어리 · 박수 자리
  4) 그림 순서 지도(선이 선을 따라 그려지는 순서) · 실루엣 테두리 빛 · 빛 조각(미리 구운 가우시안)
  5) 끝 화면(썸네일 구도): 크림 종이 · 해 · 물결 · 망점 · 제목 글자(한 글자씩) · 색종이 · 박수 자국 · 끝 자세(반은 선화 · 반은 색)
출력: build/ (지워도 다시 만들 수 있음) · build/check.png = 눈으로 확인할 한 장(팔레트 · 층 · 기준점 · 끝 화면 배치)
"""
import json
import re
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
W, H = 1920, 1080
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
CH = ROOT / (sys.argv[sys.argv.index("--character") + 1] if "--character" in sys.argv else "character")
OUT, FONTS = ROOT / "build", ROOT / "fonts"
LAYERS = ["ink", "deep", "k1", "k2", "k3"]
CONF = 46.0                  # 묶음 중심까지 이보다 멀면 「섞인 가장자리」 픽셀
MAX_W, MAX_H = 1240, 1100    # 층 그림 크기 상한(장면의 작업 캔버스 1250×1150)

# 장면이 부르는 동작 자리(slot) — 없으면 → 뒤의 자리로 차례로 대신함(마지막은 stand). config.json "poses" 로 내 폴더를 배정.
SLOTS = {
    "stand": [], "ready": ["stand"], "surprise": ["stand"], "wave": ["stand"], "shy": ["stand"], "peek": ["stand"], "tickle": ["stand"],
    "play": ["ready", "stand"], "play_lean": ["play", "ready", "stand"], "play_mash": ["play", "ready", "stand"], "play_bomb": ["play_mash", "play", "surprise", "stand"],
    "cheer": ["stand"], "thanks": ["stand"], "congrats": ["cheer", "stand"], "cold": ["stand"], "eat": ["stand"], "coffee": ["stand"], "hot": ["stand"],
    "no": ["stand"], "hug": ["stand"], "love": ["stand"], "lift": ["cheer", "stand"], "gift": ["stand"],
    "clap": ["ready", "stand"], "end": ["stand"],
}


# ── 입력 ──────────────────────────────────────────────────────────────────
def poses():
    ps = {}
    for d in sorted(p for p in CH.iterdir() if p.is_dir()):
        fs = sorted([*d.glob("*.png"), *d.glob("*.webp")])
        if fs:
            ps[d.name] = fs
    for f in sorted([*CH.glob("*.png"), *CH.glob("*.webp")]):    # 폴더 없이 그림 한 장 = 동작 하나
        ps.setdefault(f.stem, [f])
    if not ps:
        raise SystemExit(f"{CH} 에 그림이 없습니다 — character/README.md 를 보세요")
    return ps


def assign(ps):
    """자리 → 내 동작 폴더. config.json poses > 같은 이름 폴더 > 대신할 자리 > 기본(stand · 없으면 첫 폴더)."""
    want = CFG.get("poses", {})
    base = want.get("stand") or ("stand" if "stand" in ps else next(iter(ps)))
    out = {}
    for slot, chain in SLOTS.items():
        pick = want.get(slot) or (slot if slot in ps else None)
        if pick is None:
            for alt in chain:
                pick = want.get(alt) or (alt if alt in ps else None)
                if pick:
                    break
        out[slot] = pick if pick in ps else base
    bad = [v for v in want.values() if v not in ps]
    if bad:
        raise SystemExit(f"config.json poses 에 없는 폴더: {bad} — character/ 안 폴더 이름: {list(ps)}")
    return out


# ── 색 ────────────────────────────────────────────────────────────────────
def lum_of(c):
    return c @ np.array([0.2126, 0.7152, 0.0722])


def palette(ps):
    px = []
    for fs in ps.values():
        for f in fs[:4]:
            a = np.asarray(Image.open(f).convert("RGBA")).astype(np.int16)
            rgb, op = a[..., :3], a[..., 3] > 200
            rng3 = (ndi.maximum_filter(rgb, size=(3, 3, 1)) - ndi.minimum_filter(rgb, size=(3, 3, 1))).max(-1)
            flat = op & (rng3 < 24)                              # 면 안쪽(이웃과 색이 거의 같은 픽셀)만 — 선과 면 사이 섞인 가장자리 색이 묶음을 차지하지 않게
            px.append(rgb[flat if flat.sum() > 0.2 * op.sum() else op])
    px = np.concatenate(px).astype(float)
    px = px[np.random.default_rng(0).choice(len(px), min(len(px), 200000), replace=False)]
    K = 10
    rng = np.random.default_rng(1)
    c = [px[rng.integers(len(px))]]
    for _ in range(K - 1):                                       # k-means++ 시작점(결정론 시드) — 밝은 면이 넓어도 진한 색이 묶음을 갖게
        d2 = np.min(((px[:, None] - np.array(c)[None]) ** 2).sum(2), 1)
        c.append(px[rng.choice(len(px), p=d2 / d2.sum())])
    c = np.array(c)
    for _ in range(30):
        lab = ((px[:, None] - c[None]) ** 2).sum(2).argmin(1)
        c = np.array([px[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(K)])
    share = np.bincount(lab, minlength=K) / len(px)
    lum = lum_of(c)
    mx, mn = c.max(1), c.min(1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    hue = np.array([np.degrees(np.arctan2(np.sqrt(3) * (v[1] - v[2]), 2 * v[0] - v[1] - v[2])) % 360 for v in c])
    dist = lambda i, j: float(np.sqrt(((c[i] - c[j]) ** 2).sum()))
    ink = int(np.argmin(lum))
    near_ink = {j for j in range(K) if dist(j, ink) < 30}         # 선 색이 두 묶음으로 갈린 것 = 모두 선
    light = [j for j in range(K) if lum[j] > 0.8 * lum.max()]
    paper = max(light, key=lambda j: share[j])
    dark2 = [j for j in np.argsort(lum) if j not in near_ink and j != paper and lum[j] < 110 and sat[j] < 0.75 and share[j] > 0.004]
    deep = int(dark2[0]) if dark2 else ink                       # 진한 면 = 선보다 확실히 다른(거리 30 이상) 어두운 색이 있을 때만
    taken = near_ink | {paper, deep}
    cand = sorted([j for j in range(K) if j not in taken and sat[j] >= 0.3 and share[j] > 0.003], key=lambda j: -share[j] * sat[j])
    same = lambda j, k: min(abs(hue[j] - hue[k]), 360 - abs(hue[j] - hue[k])) <= 25 and abs(lum[j] - lum[k]) < 40 and abs(sat[j] - sat[k]) < 0.25
    keys = []
    for j in cand:                                               # 같은 색의 밝기 차이(그림자 · 묶음 갈림)는 하나만 — 색상만 같고 밝기가 크게 다르면(빨강 · 분홍) 다른 색
        if not any(same(j, k) for k in keys):
            keys.append(j)
    rest = sorted([j for j in range(K) if j not in taken and j not in keys and not any(same(j, k) for k in keys)], key=lambda j: -sat[j])
    keys = (keys + rest)[:3]
    if "key_order" in CFG:                                       # 돌아오는 순서 바꾸기: [2, 0, 1] = 지금 k3 를 첫째로 …
        keys = [keys[i] for i in CFG["key_order"]]
    role = {j: f"k{i + 1}" for i, j in enumerate(keys)}
    role.update({j: "ink" for j in near_ink})
    role[paper] = "paper"
    role.setdefault(deep, "deep")
    for j in range(K):                                           # 나머지 묶음 = 밝으면 종이 · 어두우면 선 · 가운데면 가장 가까운 키컬러
        if j not in role:
            role[j] = "paper" if lum[j] > 150 and sat[j] < 0.3 else ("ink" if lum[j] < 60 else role[min(keys, key=lambda k: ((c[j] - c[k]) ** 2).sum())])
    col = lambda j: [int(round(v)) for v in c[j]]
    pal = dict(ink=col(ink), paper=col(paper), deep=col(deep) if deep != ink else [int(round(v)) for v in c[ink] * 0.6 + c[paper] * 0.4],
               k1=col(keys[0]), k2=col(keys[1]), k3=col(keys[2]))
    return pal, [(role[j], c[j]) for j in range(K)], deep != ink


def hex2rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def mix(a, b, t):
    return [int(round(x + (y - x) * t)) for x, y in zip(a, b)]


# ── 층 ────────────────────────────────────────────────────────────────────
def split(im, cen, ss=2):
    """RGBA → {층: L 그림}. 2배로 키워 나누고 상자 평균으로 줄임."""
    big = im.resize((im.width * ss, im.height * ss), Image.LANCZOS)
    a = np.asarray(big).astype(np.float32)
    al = a[..., 3] / 255
    C = np.array([v for _, v in cen], np.float32)
    R = np.array([r for r, _ in cen])
    best = np.full(al.shape, 1e12, np.float32)
    idx = np.zeros(al.shape, np.int16)
    for i, cc in enumerate(C):
        d = ((a[..., :3] - cc) ** 2).sum(-1)
        m = d < best
        best[m], idx[m] = d[m], i
    solid = al > 0.5
    conf = (np.sqrt(best) < CONF) & solid
    if (~conf & solid).any() and conf.any():                    # 섞인 가장자리 = 가장 가까운 확실한 픽셀의 층(선과 면 사이에 다른 색 테가 끼지 않게)
        ii = ndi.distance_transform_edt(~conf, return_distances=False, return_indices=True)
        idx = idx[ii[0], ii[1]]
    lab = R[idx]
    near_ink = ndi.binary_dilation((lab == "ink") & solid, iterations=3)
    for k in ("deep", "k1", "k2", "k3"):                         # 선 옆의 가는 테(선 · 종이 사이 섞인 색이 우연히 이 색에 가까운 것)는 선으로
        m = (lab == k) & solid
        lab[m & ~ndi.binary_opening(m, iterations=2) & near_ink] = "ink"
    cls = {k: (lab == k) & solid for k in LAYERS}
    tick = np.zeros_like(solid)                                  # 다른 키컬러 면 안에 박힌 작은 키컬러 덩어리(둘레 6px 의 60% 이상이 다른 키컬러)
    keyset = {k: cls[k] for k in ("k1", "k2", "k3")}
    nsolid = float(solid.sum())
    for k, m in keyset.items():
        rl, n = ndi.label(m)
        if not n:
            continue
        sizes = ndi.sum(np.ones_like(rl), rl, range(1, n + 1))
        for i, sl in enumerate(ndi.find_objects(rl)):
            if not (0.00005 * nsolid < sizes[i] < 0.01 * nsolid):    # 큰 면(목도리 · 코트)과 몇 픽셀짜리 부스러기는 건너뜀
                continue
            y0, y1, x0, x1 = max(0, sl[0].start - 8), sl[0].stop + 8, max(0, sl[1].start - 8), sl[1].stop + 8
            comp = rl[y0:y1, x0:x1] == i + 1
            ring = ndi.binary_dilation(comp, iterations=6) & ~comp
            other = np.zeros_like(comp)
            for k2, m2 in keyset.items():
                if k2 != k:
                    other |= m2[y0:y1, x0:x1]
            if ring.sum() and (other & ring).sum() / ring.sum() >= 0.6:
                tick[y0:y1, x0:x1] |= comp
    for k in keyset:
        cls[k] = cls[k] & ~tick
    out = {"sil": al, "tick": tick * al, **{k: cls[k] * al for k in LAYERS}}
    return {k: Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).resize(im.size, Image.BOX) for k, m in out.items()}


def white(mask):
    return Image.merge("RGBA", (Image.new("L", mask.size, 255),) * 3 + (mask,))


def fill(mask, rgb):
    im = Image.new("RGBA", mask.size, tuple(rgb) + (0,))
    im.putalpha(mask)
    return im


def line_version(lay, pal):
    """선화 판 = 종이(실루엣) + 표시 + 선."""
    im = Image.new("RGBA", lay["sil"].size, (0, 0, 0, 0))
    im.alpha_composite(fill(lay["sil"], pal["paper"]))
    im.alpha_composite(fill(lay["tick"], pal["tick"]))
    im.alpha_composite(fill(lay["ink"], pal["ink"]))
    return im


def order_map(ink_alpha):
    """선 픽셀을 「선을 따라 그려지는 순서」로: 덩어리마다 가장 위 점에서 선을 따라 잰 거리(너비 우선) · 덩어리는 위 → 아래 · 몫 = 크기 비율.
    결과 0~65535 를 R(상위) · G(하위)에, A = 선 여부."""
    ink = ink_alpha > 8
    lab, n = ndi.label(ink, structure=np.ones((3, 3)))
    order = np.zeros(ink.shape, np.float64)
    if n:
        sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
        objs = ndi.find_objects(lab)
        total, off = float(sizes.sum()), 0.0
        for k in sorted(range(n), key=lambda k: (objs[k][0].start // 40, objs[k][1].start)):
            sl = objs[k]
            m = lab[sl] == k + 1
            ys, xs = np.nonzero(m)
            st = int(np.argmin(ys * 10000 + xs))
            dist = np.full(m.shape, -1, np.int32)
            q = deque([(ys[st], xs[st])])
            dist[ys[st], xs[st]] = 0
            hh, ww = m.shape
            while q:
                y, x = q.popleft()
                d = dist[y, x] + 1
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < hh and 0 <= xx < ww and m[yy, xx] and dist[yy, xx] < 0:
                            dist[yy, xx] = d
                            q.append((yy, xx))
            share = sizes[k] / total
            order[sl] = np.where(m, off + share * dist / max(1, dist.max()), order[sl])
            off += share
    v = np.clip(order * 65535, 0, 65535).astype(np.uint32)
    return Image.fromarray(np.dstack([(v >> 8).astype(np.uint8), (v & 255).astype(np.uint8), np.zeros_like(ink_alpha), np.where(ink, 255, 0).astype(np.uint8)]), "RGBA")


# ── 기준점 ─────────────────────────────────────────────────────────────────
def find_eyes(lay):
    """진한 채움 덩어리(선 · 진한 면에서 가는 선을 깎아 내고 남은 둥근 점) 가운데 위쪽 · 비슷한 크기 · 같은 높이의 한 쌍 → [(x, y) …](층 px)."""
    sil = np.asarray(lay["sil"]) > 128
    dark = (np.asarray(lay["ink"]) > 128) | (np.asarray(lay["deep"]) > 128)
    ys, xs = np.nonzero(sil)
    if not len(ys):
        return []
    top, bot = ys.min(), ys.max()
    h = bot - top + 1
    r = max(2, int(0.011 * h))
    core = ndi.binary_opening(dark, structure=np.ones((2 * r + 1, 2 * r + 1)))
    lab, n = ndi.label(core)
    blobs = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        m = lab[sl] == i + 1
        a = int(m.sum())
        bh, bw = m.shape
        cy, cx = ndi.center_of_mass(m)
        cy, cx = cy + sl[0].start, cx + sl[1].start
        if not (0.0002 * sil.sum() < a < 0.02 * sil.sum()) or not (0.35 < bw / bh < 2.8) or cy > top + 0.75 * h:
            continue
        blobs.append((cx, cy, a))
    best, score = [], 1e18
    for i in range(len(blobs)):
        for j in range(i + 1, len(blobs)):
            (x1, y1, a1), (x2, y2, a2) = blobs[i], blobs[j]
            if abs(y1 - y2) > 0.08 * h or abs(x1 - x2) < 0.06 * h:
                continue
            s = abs(np.log(a1 / a2)) * 3 + abs(y1 - y2) / h * 10 + (y1 + y2) / 2 / h
            if s < score:
                best, score = sorted([(x1, y1), (x2, y2)]), s
    return best


def piece_of(lay, pal, prefer_deep=True):
    """가장 큰 진한 면 덩어리(없으면 가장 큰 키컬러 덩어리) → (그 색으로 칠한 RGBA 조각, 회전 중심(조각 px))."""
    sil = np.asarray(lay["sil"]) > 128
    cands = (["deep"] if prefer_deep else []) + ["k1", "k2", "k3"]
    for k in cands:
        m = np.asarray(lay[k]) > 128
        lab, n = ndi.label(m)
        if not n:
            continue
        sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
        i = int(np.argmax(sizes))
        if sizes[i] < 0.004 * sil.sum():
            continue
        sl = ndi.find_objects(lab)[i]
        y0, y1, x0, x1 = max(0, sl[0].start - 4), sl[0].stop + 4, max(0, sl[1].start - 4), sl[1].stop + 4
        comp = lab[y0:y1, x0:x1] == i + 1
        alpha = np.asarray(lay[k])[y0:y1, x0:x1] * ndi.binary_dilation(comp, iterations=2)
        piece = fill(Image.fromarray(alpha.astype(np.uint8)), pal["deep" if k == "deep" else k])
        dt = ndi.distance_transform_edt(ndi.binary_fill_holes(comp))
        cy, cx = np.unravel_index(int(np.argmax(dt)), dt.shape)    # 가장 안쪽 점 = 회전 중심
        return piece, [int(cx), int(cy)], k
    m = Image.fromarray(np.where(sil, 255, 0).astype(np.uint8))
    return fill(m, pal["ink"]), [m.width // 2, m.height // 2], "sil"


# ── 글자 ───────────────────────────────────────────────────────────────────
PXF = {}   # 픽셀 글꼴(글꼴 파일이 없을 때) — scenes/devices.js 의 5×7 표를 그대로 읽어 씀


def load_pxf():
    t = (ROOT / "scenes/devices.js").read_text(encoding="utf-8")
    body = t[t.index("const PXF = {"):]
    body = body[:body.index("};")]
    for m in re.finditer(r"(?:([A-Z0-9])|'(.)'|\"(.)\")\s*:\s*'([01]{35})'", body):
        ch = m.group(1) or m.group(2) or m.group(3)
        PXF[ch] = m.group(4)


def glyph(ch, font, cap, color=(255, 255, 255), SS=3):
    """글자 하나 → 잘라 낸 RGBA(가장자리 여백 6px)."""
    if font is None:                                             # 픽셀 글꼴: 5×7 칸을 cap/7 크기 네모로
        if not PXF:
            load_pxf()
        gl, px = PXF.get(ch.upper(), PXF.get("?")), max(2, cap // 7)
        im = Image.new("RGBA", (5 * px + 12, 7 * px + 12), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        for i, b in enumerate(gl):
            if b == "1":
                x, y = 6 + (i % 5) * px, 6 + (i // 5) * px
                d.rectangle([x, y, x + px - 1, y + px - 1], fill=tuple(color) + (255,))
        return im
    f = ImageFont.truetype(str(font), cap * SS)
    l, t, r, b = f.getbbox(ch)
    pad = 6 * SS
    m = Image.new("L", (max(1, r - l) + 2 * pad, max(1, b - t) + 2 * pad), 0)
    ImageDraw.Draw(m).text((pad - l, pad - t), ch, font=f, fill=255)
    m = m.resize((max(1, m.width // SS), max(1, m.height // SS)), Image.LANCZOS)
    return fill(m, color)


# ── 빛 조각 · 바탕 ─────────────────────────────────────────────────────────
def alpha_png(a, rgb=(255, 255, 255)):
    return Image.fromarray(np.dstack([np.full(a.shape + (3,), rgb, np.uint8), (np.clip(a, 0, 1) * 255).astype(np.uint8)]), "RGBA")


def light_assets(A, slope):
    yy, xx = np.mgrid[0:256, 0:256]
    alpha_png(np.exp(-(np.hypot(xx - 128, yy - 128) / 42) ** 2 / 2)).save(A / "glow.png")          # 둥근 빛(가우시안)
    Wg, Hg = 1600, 1400                                                                              # 경계 빛줄 번짐: (800, 700)을 지나는 기울기 slope 직선
    yy, xx = np.mgrid[0:Hg, 0:Wg]
    d = np.abs((xx - 800) - slope * (yy - 700)) / np.sqrt(1 + slope * slope)
    alpha_png(0.85 * np.exp(-(d / 5) ** 2 / 2) + 0.45 * np.exp(-(d / 26) ** 2 / 2) + 0.18 * np.exp(-(d / 90) ** 2 / 2)).save(A / "streak_glow.png")
    yy, xx = np.mgrid[0:H, 0:W]                                                                      # 핀 조명 원뿔(위가 좁고 아래가 넓음)
    width = 110 + 0.42 * yy
    cone = np.exp(-((xx - W / 2) / width) ** 2 * 1.6) * np.clip(yy / H, 0, 1) ** 0.55 * np.exp(-((yy - H * 0.55) / (H * 0.95)) ** 2)
    pool = np.exp(-(((xx - W / 2) / 560) ** 2 + ((yy - H * 0.97) / 90) ** 2) / 2) * 0.8
    alpha_png(np.clip(cone + pool, 0, 1)).save(A / "cone.png")
    g = np.random.default_rng(11).normal(0, 1, (512, 512))                                           # 종이 결
    Image.merge("RGBA", (Image.new("L", (512, 512), 40),) * 3 + (Image.fromarray(np.clip(np.abs(g) * 14, 0, 40).astype(np.uint8)),)).save(A / "grain.png")


def place(im, cx, bottom, hpx, max_w=880):
    """그림을 화면 키 hpx(너무 넓으면 폭 max_w 에 맞춤) · 가운데 cx · 발치 bottom 에 놓을 크기와 자리."""
    s = min(hpx / im.height, max_w / im.width)
    w, h = round(im.width * s), round(im.height * s)
    return im.resize((w, h), Image.LANCZOS), round(cx - w / 2), round(bottom - h)


def circle_mask(cx, cy, r):
    """원 안 = 1 · 가장자리 1px 부드럽게."""
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.hypot(xx + 0.5 - cx, yy + 0.5 - cy) - r
    return np.clip(0.5 - d, 0, 1)


def main():
    OUT.mkdir(exist_ok=True)
    A = OUT / "assets"
    A.mkdir(exist_ok=True)
    (OUT / "order").mkdir(exist_ok=True)
    ps = poses()
    slot = assign(ps)
    pal, cen, has_deep = palette(ps)
    over = CFG.get("palette", {})
    for k, v in over.items():
        if k in pal:
            pal[k] = hex2rgb(v)
    report = dict(character=str(CH.relative_to(ROOT)) if CH.is_relative_to(ROOT) else str(CH), poses={k: len(v) for k, v in ps.items()}, slots=slot)

    # 층 굽기(쓰는 동작만)
    used = sorted(set(slot.values()))
    MK, LAY0 = {}, {}
    ms = CFG.get("frame_ms", 100)
    for name in used:
        ims = [Image.open(f).convert("RGBA") for f in ps[name]]
        if len({im.size for im in ims}) > 1:
            raise SystemExit(f"{name}: 한 동작 안의 그림은 캔버스 크기가 같아야 합니다 {[im.size for im in ims]}")
        u = None
        for im in ims:
            bb = im.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
            if bb is None:
                raise SystemExit(f"{name}: 빈 그림이 있습니다(투명 바탕 PNG 인지 확인)")
            u = bb if u is None else (min(u[0], bb[0]), min(u[1], bb[1]), max(u[2], bb[2]), max(u[3], bb[3]))
        pad = max(6, round(0.008 * max(u[2] - u[0], u[3] - u[1])))
        box = (max(0, u[0] - pad), max(0, u[1] - pad), min(ims[0].width, u[2] + pad), min(ims[0].height, u[3] + pad))
        bw, bh = box[2] - box[0], box[3] - box[1]
        s = min(MAX_W / bw, MAX_H / bh)
        size = (max(1, round(bw * s)), max(1, round(bh * s)))
        d = OUT / "mask" / name
        d.mkdir(parents=True, exist_ok=True)
        for i, im in enumerate(ims):
            cr = im.crop(box).resize(size, Image.LANCZOS)
            cr.save(d / f"{i:02d}_full.png")
            lay = split(cr, cen)
            for k, m in lay.items():
                white(m).save(d / f"{i:02d}_{k}.png")
            if i == 0:
                LAY0[name] = dict(lay, full=cr)
        MK[name] = dict(n=len(ims), w=size[0], h=size[1], u=1, src=[f"build/mask/{name}/{i:02d}" for i in range(len(ims))], ms=[ms] * len(ims), loop_ms=ms * len(ims))
        print(f"{name}: {len(ims)}장 · 층 {size[0]}×{size[1]}" + (" (원본보다 키움 — 큰 그림을 넣으면 클로즈업이 또렷해짐)" if s > 1.05 else ""))
    MKS = {sl: MK[p] for sl, p in slot.items()}

    # 작은 표시(tick) 색 · 진한 면이 따라가는 키컬러
    st = LAY0[slot["stand"]]
    tk = np.asarray(st["tick"]) > 128
    pal["tick"] = [int(v) for v in np.median(np.asarray(st["full"])[..., :3][tk], 0)] if tk.sum() > 20 else pal["k1"]
    dmask = ndi.binary_dilation(np.asarray(st["deep"]) > 128, iterations=6)
    touch = {k: int((dmask & (np.asarray(st[k]) > 128)).sum()) for k in ("k1", "k2", "k3")}
    deep_follows = CFG.get("deep_follows") or (max(touch, key=touch.get) if has_deep and any(touch.values()) else "k2")
    pal.update(night=CFG.get("night", [26, 11, 5]), night2=CFG.get("night2", [42, 19, 10]),
               others=[hex2rgb(c) if isinstance(c, str) else c for c in CFG.get("other_colors", ["#38836D", "#465CB2", "#FBB700", "#D6338A", "#5EA0D6", "#8060CE", "#7EBA40", "#20A0AA"])])
    pal["blocks"] = [pal["paper"], mix(pal["deep"], pal["paper"], 0.25), mix(pal["k1"], pal["k2"], 0.5), mix(pal["k2"], pal["paper"], 0.4), mix(pal["k1"], pal["k3"], 0.5)]

    # 기준점(stand 0번 장 · 층 px → 비율)
    an = {}
    sw, sh = st["sil"].size
    eyes = find_eyes(st)
    if eyes:
        ex, ey = eyes[0]                                          # 왼눈(화면 왼쪽)
        eyc = (eyes[0][1] + eyes[1][1]) / 2
    else:
        ex, ey, eyc = sw * 0.42, sh * 0.38, sh * 0.38
    an["eye_from_bottom"] = round(1 - eyc / sh, 4)               # 얼굴 클로즈업에서 눈높이를 화면 y≈560 에 맞추는 값
    r = dict(w=900 * sw / sh, h=900)                              # 자리 찾기 장면: stand 를 화면 키 900 · 가운데 960 · 발치 1075 에 둠
    an["eye_zoom"] = [round(960 - r["w"] / 2 + ex / sw * r["w"], 1), round(1075 - 900 + ey / sh * 900, 1)]
    an["fit"] = {}
    for k in ("k1", "k2", "k3"):
        m = np.asarray(st[k]).astype(float)
        if m.sum() > 50:
            cy, cx = ndi.center_of_mass(m)
            an["fit"][k] = [round(cx / sw, 3), round(cy / sh, 3)]
        else:
            an["fit"][k] = [0.5, 0.5]
    piece, peye, pk = piece_of(st, pal)
    piece.save(A / "horn.png")
    an["horn_eye"], an["horn_scale"] = peye, round(1448 / max(piece.size), 3)
    order_map(np.asarray(st["ink"])).save(OUT / "order/stand_0.png")

    # 실루엣 테두리 빛(빛 구간: ready 0번 장을 화면 가운데 · 키 720 · 발치 H+24 에)
    rd = LAY0[slot["ready"]]["sil"]
    mk_ = MK[slot["ready"]]
    s_ = 720 / (mk_["h"] / mk_["u"])
    w_, h_ = round(mk_["w"] / mk_["u"] * s_), round(mk_["h"] / mk_["u"] * s_)
    S = Image.new("L", (W, H), 0)
    S.paste(rd.resize((w_, h_), Image.LANCZOS), (round(W / 2 - w_ / 2), round(H + 24 - h_)))
    S = np.asarray(S).astype(float) / 255
    rim = np.clip(S - ndi.shift(S, (14, 0), order=1), 0, 1)
    alpha_png(np.clip(ndi.gaussian_filter(rim, 2.5) * 1.1 + ndi.gaussian_filter(rim, 12) * 0.8, 0, 1)).save(A / "s6_rim.png")

    # ── 끝 화면 ──
    E = CFG.get("end", {})
    slope, x0 = -0.4083969465648855, 1586.2786259541986          # 경계(흰 빛줄): 오른쪽 위 → 왼쪽 아래로 캐릭터 한가운데를 지남
    light_assets(A, slope)
    cream = hex2rgb(E.get("cream", "#FDDCA6"))
    orange = hex2rgb(E.get("sun", "#FD9702"))
    wave_c = hex2rgb(E["wave"]) if "wave" in E else pal["k1"]
    dot_c = hex2rgb(E["dots"]) if "dots" in E else wave_c
    sun = dict(cx=1607.55, cy=676.62, r=743.53)
    wave = dict(cx=2278.72, cy=5398.83, r=4829.74)
    rng = np.random.default_rng(7)
    yy, xx = np.mgrid[0:H, 0:W]
    vig = np.hypot((xx - 960) / 960, (yy - 540) / 540)
    base = np.array(cream, float)[None, None] * (1 - 0.05 * np.clip(vig - 0.4, 0, 1))[..., None] + rng.normal(0, 2.2, (H, W, 1))
    base = np.clip(base, 0, 255).astype(np.uint8)
    Image.fromarray(base).save(A / "bg_base.png")
    sa, wa = circle_mask(sun["cx"], sun["cy"], sun["r"]), circle_mask(wave["cx"], wave["cy"], wave["r"])
    alpha_png(sa, orange).save(A / "bg_sun.png")
    alpha_png(wa, wave_c).save(A / "bg_wave.png")
    plate = Image.fromarray(base).convert("RGBA")
    plate.alpha_composite(Image.open(A / "bg_sun.png"))
    plate.alpha_composite(Image.open(A / "bg_wave.png"))
    gl = Image.open(A / "streak_glow.png")
    band = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    band.alpha_composite(gl, (round(x0 + slope * 700 - 800), 0))
    band.putalpha(band.getchannel("A").point(lambda v: int(v * 0.35)))
    plate.alpha_composite(band)
    plate.convert("RGB").save(A / "plate.png")
    # 망점(왼쪽 위 모서리에서 멀어질수록 작아짐)
    dimg = Image.new("RGBA", (560, 400), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dimg)
    dots, boxes = [], []
    for j, y in enumerate(np.arange(4, 400, 13.0)):
        for x in np.arange(4 + (j % 2) * 13, 560, 26.0):
            rr = 11.5 * (1 - np.hypot(x / 560, y / 400) / 1.0)
            if rr < 1.0:
                continue
            dd.ellipse([x - rr, y - rr, x + rr, y + rr], fill=tuple(dot_c) + (255,))
            dots.append([float(x), float(y), round(float(rr), 2)])
            boxes.append([int(x - rr - 3), int(y - rr - 3), int(2 * rr + 7), int(2 * rr + 7), float(x), float(y)])
    dimg.save(A / "dots.png")
    # 끝 자세(반은 선화 · 반은 색) · 박수 준비 자세 — 화면 키 836 · 가운데 1390 · 발치 952
    def pose_parts(name, tag):
        L = LAY0[name]
        full = L["full"]
        line = line_version(L, pal)
        f2, x, y = place(full, 1390, 952, 836)
        l2 = line.resize(f2.size, Image.LANCZOS)
        f2.save(A / f"{tag}_full.png" if tag == "clap" else A / f"{tag}_color.png")
        l2.save(A / f"{tag}_line.png")
        return f2, l2, dict(x=x, y=y, w=f2.width, h=f2.height)
    ef, el, ebox = pose_parts(slot["end"], "end")
    lx = np.array([[x0 + slope * (yy_ + ebox["y"]) - ebox["x"] for yy_ in range(ef.height)]]).T
    left = np.arange(ef.width)[None, :] < lx
    sp = np.where(left[..., None], np.asarray(el), np.asarray(ef))
    Image.fromarray(sp.astype(np.uint8), "RGBA").save(A / "end_split.png")
    _, _, cbox = pose_parts(slot["clap"], "clap")
    an["hands"] = [round(cbox["x"] + cbox["w"] / 2, 1), round(cbox["y"] + 0.58 * cbox["h"], 1)]
    # 제목 글자(왼쪽 절반 · 한 글자 = 한 조각): 마지막 낱말만 여러 색 · 나머지는 짙은 제목색
    font = next(iter(sorted([*FONTS.glob("*.ttf"), *FONTS.glob("*.otf")])), None)
    name = CFG.get("name", "HELLO")
    lines = [ln.replace("{name}", name) for ln in CFG.get("title", ["{name}", "IN COLOR"])]
    title_c = hex2rgb(E["title"]) if "title" in E else mix(pal["ink"], pal["deep"], 0.4)
    multi = [pal["k1"], pal["k2"], pal["others"][0], pal["k3"], pal["others"][3]]
    letters, beats, b, prev_word = [], [], 229.0, None
    words_all = [(li, wi, w) for li, ln in enumerate(lines) for wi, w in enumerate(ln.split())]
    last = words_all[-1][:2] if words_all else None
    caps = [230, 165] + [150] * 8
    ytop = 334
    for li, ln in enumerate(lines):
        cap = caps[li]
        ims = []
        for wi, w in enumerate(ln.split()):
            for ci, ch in enumerate(w):
                is_last = (li, wi) == last
                col = multi[ci % len(multi)] if is_last else title_c
                ims.append((wi, glyph(ch, font, cap, col), col, is_last))
        if not ims:
            continue
        gap, wgap = 4, cap * 0.28
        total = sum(im.width for _, im, _, _ in ims) + gap * (len(ims) - 1) + wgap * (len({wi for wi, *_ in ims}) - 1)
        k = min(1.0, 830 / total, 250 / max(max(im.width, im.height) for _, im, _, _ in ims))
        x, pw = 120.0, None
        for wi, im, col, is_last in ims:
            if k < 1:
                im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
            if pw is not None and wi != pw:
                x += wgap * k
            fn = f"title_{len(letters):02d}.png"
            im.save(A / fn)
            letters.append(dict(src=fn, x=round(x), y=round(ytop + (cap * k - im.height) + 6), w=im.width, h=im.height, rgb=col,
                                fill=mix(pal["ink"], pal["paper"], 0.1) if is_last else mix(title_c, pal["paper"], 0.45)))
            if prev_word is not None:
                b += 0.9 if (li, wi) == prev_word else 1.5
            beats.append(round(b, 3))
            prev_word = (li, wi)
            x += im.width + gap * k
            pw = wi
        ytop += cap * k + 40
    if beats and beats[-1] > 239.2:                              # 글자가 많으면 229~239.2 박 안으로 줄여 담음
        s0 = (239.2 - 229) / (beats[-1] - 229)
        beats = [round(229 + (bb - 229) * s0, 3) for bb in beats]
    keep = [i for i, p in enumerate(letters) if p["x"] + p["w"] < 976]   # 화면 왼쪽 절반 안의 글자만(장면이 그렇게 거름)
    letters, beats = [letters[i] for i in keep], [beats[i] for i in keep]
    # 이름 큰 글자(거대 글자 장면 · 흰색 — 장면에서 색을 입힘)
    trow = []
    for i, ch in enumerate(name[:6]):
        if ch == " ":
            continue
        im = glyph(ch, font, 200)
        fn = f"type_{i:02d}.png"
        im.save(A / fn)
        trow.append(fn)
    # 색종이 셋(모양 · 남의 색) + 박수 자국 둘(손에서 바깥으로 그은 짧은 획)
    conf = []
    def save_piece(fn, im, x, y, rgb, mark=False):
        im.save(A / fn)
        conf.append(dict(src=fn, x=int(x), y=int(y), w=im.width, h=im.height, rgb=list(rgb), mark=mark))
    def shape(kind, rgb, s=76):
        im = Image.new("RGBA", (s * 3, s * 3), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        c = tuple(rgb) + (255,)
        if kind == 0:
            d.polygon([(s * 0.3, s * 0.9), (s * 2.6, s * 0.3), (s * 2.75, s * 1.0), (s * 0.45, s * 1.6)], fill=c)
        elif kind == 1:
            d.polygon([(s * 1.5, s * 0.2), (s * 2.8, s * 2.6), (s * 0.3, s * 2.3)], fill=c)
        else:
            pts = [(s * (0.3 + 2.4 * t), s * (1.5 + 0.7 * np.sin(t * 7))) for t in np.linspace(0, 1, 30)]
            d.line(pts, fill=c, width=int(s * 0.55), joint="curve")
        im = im.resize((s, s), Image.LANCZOS)
        return im.crop(im.getchannel("A").getbbox())
    def mark(ang, rgb):
        im = Image.new("RGBA", (180, 180), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        dx, dy = np.cos(ang), np.sin(ang)
        d.line([(90 - 60 * dx, 90 - 60 * dy), (90 + 60 * dx, 90 + 60 * dy)], fill=tuple(rgb) + (255,), width=26)
        for e in (-1, 1):
            d.ellipse([90 + e * 60 * dx - 13, 90 + e * 60 * dy - 13, 90 + e * 60 * dx + 13, 90 + e * 60 * dy + 13], fill=tuple(rgb) + (255,))
        im = im.resize((60, 60), Image.LANCZOS)
        return im.crop(im.getchannel("A").getbbox())
    hx_, hy_ = an["hands"]
    save_piece("confetti_00.png", shape(0, pal["others"][2]), ebox["x"] + 0.17 * ebox["w"], ebox["y"] + 0.02 * ebox["h"], pal["others"][2])
    save_piece("confetti_01.png", shape(1, pal["others"][0]), ebox["x"] + 1.0 * ebox["w"], ebox["y"] + 0.08 * ebox["h"], pal["others"][0])
    save_piece("confetti_02.png", mark(-0.9, orange), hx_ + 99, hy_ - 83, orange, True)
    save_piece("confetti_03.png", mark(-0.3, orange), hx_ + 116, hy_ - 37, orange, True)
    save_piece("confetti_04.png", shape(2, pal["k3"]), ebox["x"] + 0.98 * ebox["w"], ebox["y"] + 0.57 * ebox["h"], pal["k3"])

    an.update({k: v for k, v in CFG.get("anchors", {}).items()})   # config.json anchors 로 덮어쓰기
    GEO = dict(colors=dict(cream=cream, orange=orange, red=wave_c), sun=sun, wave=wave, streak=dict(slope=slope, x_at_y0=x0),
               end_pose=dict(x=ebox["x"], y=ebox["y"], size=[ebox["w"], ebox["h"]]), clap_pose=cbox,
               dots=dots, dot_boxes=boxes, letters=letters, letter_beats=beats, confetti=conf,
               piece_src=["confetti_00.png", "confetti_01.png", "confetti_04.png"], type_row=trow, anchors=an)
    PN = CFG.get("part_names", {})
    KIT = dict(code_name="".join(ch for ch in name.upper() if ch.isalnum()) or "CHAR",
               part_names={k: PN.get(k, d) for k, d in (("k1", "PART1"), ("k2", "PART2"), ("k3", "PART3"))},
               other_names=CFG.get("other_names", ["MINT", "NAVY", "LEMON", "MAGENTA", "SKY", "VIOLET", "LIME", "TEAL"]), deep_follows=deep_follows)
    (OUT / "kit.js").write_text("window.PAL = " + json.dumps(pal) + ";\nwindow.GEO = " + json.dumps(GEO) + ";\nwindow.KIT = " + json.dumps(KIT, ensure_ascii=False) + ";\n", encoding="utf-8")
    (OUT / "masks.js").write_text("window.MK = " + json.dumps(MKS, ensure_ascii=False) + ";\n", encoding="utf-8")
    report.update(palette=pal, anchors=an, eyes_found=bool(eyes), piece_layer=pk, deep_follows=deep_follows, font=font.name if font else "픽셀 글꼴(fonts/ 비어 있음)",
                  title=lines, letters=len(letters))
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    check_sheet(st, pal, an, eyes, piece, A)
    print("팔레트", {k: "#%02X%02X%02X" % tuple(pal[k]) for k in ("ink", "paper", "deep", "k1", "k2", "k3", "tick")})
    print("기준점", json.dumps(an, ensure_ascii=False))
    print("눈 찾음" if eyes else "눈을 못 찾음 — 기본값(키의 62% 높이)을 씀 · 필요하면 config.json anchors 로 지정")
    print(f"끝 제목 {lines} · 글자 {len(letters)} · 글꼴 {report['font']}")
    print("확인: build/check.png")


def check_sheet(st, pal, an, eyes, piece, A):
    """눈으로 확인할 한 장: 팔레트 · stand 0번 장의 층 · 기준점(눈 = 빨간 원 · 조각 중심 = 십자) · 진한 면 조각 · 끝 화면 배치."""
    sw, sh = st["sil"].size
    th = 300
    k = th / sh
    tw = max(1, round(sw * k))
    cells = []
    full = st["full"].resize((tw, th), Image.LANCZOS)
    bg = Image.new("RGBA", (tw, th), (200, 200, 200, 255)); bg.alpha_composite(full)
    d = ImageDraw.Draw(bg)
    for (x, y) in eyes:
        d.ellipse([x * k - 8, y * k - 8, x * k + 8, y * k + 8], outline=(255, 0, 0, 255), width=3)
    for kk, (fx, fy) in an["fit"].items():
        d.line([fx * tw - 8, fy * th, fx * tw + 8, fy * th], fill=(0, 0, 255, 255), width=3)
        d.line([fx * tw, fy * th - 8, fx * tw, fy * th + 8], fill=(0, 0, 255, 255), width=3)
    cells.append(("full + anchors (red=eyes, blue=part centers)", bg))
    for name in ["sil", "ink", "deep", "k1", "k2", "k3", "tick"]:
        col = pal.get(name, pal["paper"]) if name != "sil" else pal["paper"]
        c = Image.new("RGBA", (tw, th), (128, 128, 128, 255))
        c.alpha_composite(fill(st[name].resize((tw, th), Image.LANCZOS), col))
        cells.append((name, c))
    pc = Image.new("RGBA", (th, th), (26, 11, 5, 255))
    p2 = piece.copy(); p2.thumbnail((th - 20, th - 20))
    pc.alpha_composite(p2, ((th - p2.width) // 2, (th - p2.height) // 2))
    cells.append(("piece (static scene)", pc))
    end = Image.open(A / "plate.png").convert("RGBA")
    end.alpha_composite(Image.open(A / "dots.png"))
    geo = json.loads((OUT / "kit.js").read_text(encoding="utf-8").split("window.GEO = ")[1].split(";\nwindow.KIT")[0])
    for p in geo["letters"]:
        end.alpha_composite(Image.open(A / p["src"]), (p["x"], p["y"]))
    ep = geo["end_pose"]
    end.alpha_composite(Image.open(A / "end_split.png"), (ep["x"], ep["y"]))
    for p in geo["confetti"]:
        end.alpha_composite(Image.open(A / p["src"]), (p["x"], p["y"]))
    dd = ImageDraw.Draw(end)
    hx, hy = an["hands"]
    dd.ellipse([hx - 12, hy - 12, hx + 12, hy + 12], outline=(0, 0, 255, 255), width=4)
    end = end.resize((640, 360), Image.LANCZOS)
    cells.append(("end card layout (blue ring = clap point)", end))
    sheet_w = sum(c.width for _, c in cells[:5]) + 6 * 10
    row2 = sum(c.width for _, c in cells[5:]) + 6 * 10
    S = Image.new("RGB", (max(sheet_w, row2), 2 * (th + 40) + 120), (245, 245, 245))
    dS = ImageDraw.Draw(S)
    x, y = 10, 30
    for i, (lab, c) in enumerate(cells):
        if i == 5:
            x, y = 10, th + 70
        S.paste(c.convert("RGB"), (x, y))
        dS.text((x, y - 18), lab, fill=(0, 0, 0))
        x += c.width + 10
    for i, k in enumerate(["ink", "paper", "deep", "k1", "k2", "k3", "tick"]):
        dS.rectangle([10 + i * 110, 2 * (th + 40) + 40, 100 + i * 110, 2 * (th + 40) + 100], fill=tuple(pal[k]))
        dS.text((12 + i * 110, 2 * (th + 40) + 22), k, fill=(0, 0, 0))
    S.save(OUT / "check.png")


if __name__ == "__main__":
    main()
