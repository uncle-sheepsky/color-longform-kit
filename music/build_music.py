# -*- coding: utf-8 -*-
"""「WHAT YOUR COLOR.」 롱폼 음악 — 종이 미술실의 작은 실내 악단(80초 · ♩180 · 60마디 · 240박 · CC0).

  python music/build_music.py            → music/out/longform/mix.wav (+ report.json · stems/)
  준비: VSCO 2 Community Edition(CC0) SFZ 샘플 — 환경변수 VSCO_SFZ_DIR 또는 music/VSCO-2-CE-SFZ/ (README 참고)

세계(먼저 정함): 실제 악기 녹음(VSCO 2 CE)만 — 현 피치카토 · 마림바 · 클라리넷 · 약음 트럼펫 · 바순 · 플루트 · 하프 · 콘트라베이스 ·
관현악 북. 합성 소리는 「신호 두 음」(시작과 끝)과 박수만. 걸음은 스윙(8분 앞 58%) — 2박 걸음(저음 1 · 3 / 피치카토 2 · 4).
색 하나 = 악기 하나(k1 = 약음 트럼펫 · k2 = 바순 · k3 = 플루트 · 남의 색 = 솔로 바이올린).

화성: 안달루시아 하강 Bm–A–G–F#7(남의 색 · 몰아치기 · 드롭) · B 드론(시작 · 빛 = 도리아 E/B) ·
내려가는 저음 줄(k1: D–A/C#–Bm–Bm/A–G–Gm–D/F#–E7) · 단조 ii–V(k3) · 나폴리 화음 C(블랙홀) ·
첫 박수에서 단조 → 장조(B) 도착 · 정점 B–E–G–F#7(I–IV–♭VI–V).

박 지도(영상과 같음 · 박 = ♩180 의 한 박 = 1/3초): 무음 132.5~136 · 드롭 136 · 세계 156~172 · 빛 172~192.1 · 꿀꺽 192.1 ·
해 196 · 웅크림 207(한 박 비움) · 첫 박수 208(그 전 박수 0) · 글자 213~223.2(효과음 없음) · 잦아듦 224~236 · 신호 두 음 0.25 · 236.5.
규칙: 주선율 ≤ MIDI 76 · 대선율은 주선율이 화음음으로 머물 때만 16분 늦게 · 3도 이상 아래 · 방울 없음 · 흔드는 타악 없음 ·
      스윙을 쓰므로 음 길이도 스윙 위치로 셈(다음 음 시작까지 — 안 그러면 박 위 음마다 틈이 생겨 톡톡 끊김).
"""
import bisect
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, welch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import band  # noqa: E402
from band import SR, chord, voice, bass_note, inst, perc  # noqa: E402

TAG = sys.argv[sys.argv.index("--tag") + 1] if "--tag" in sys.argv else "longform"
OUT = HERE / "out" / TAG
BPM, BARS, BEATS = 180, 60, 240
HOLES = [(132.5, 136.0)]
CLAP_B = 208
BAD = {1, 2, 6, 10, 11}                       # 2도 · 7도 · 증4도(겹치면 거슬리는 음정)
s = band.Song(TAG, "WHAT YOUR COLOR. — 실내 악단", BPM, 4, BARS, swing=0.58, tail=2.0, lufs=-14.0)
EV = []                                       # (박, 길이, midi, 역할)

# ── 화음 시간표(박 → 화음) ──
HARM = [(0, "Bm"), (12, "G/B"), (16, "A/B"), (20, "F#7"),
        (24, "Bm"), (28, "A"), (32, "G"), (36, "F#7"), (40, "Bm"), (44, "A"), (48, "G"), (52, "F#7"),
        (56, "D"), (58, "A/C#"), (60, "Bm"), (62, "Bm/A"), (64, "G"), (66, "Gm"), (68, "D/F#"), (70, "E7"), (72, "A7"),
        (74, "Bm"), (78, "A"), (82, "G"), (86, "F#7"),
        (92, "Gmaj7"), (96, "C#m7b5"), (100, "F#7"), (104, "Bm"), (108, "F#7"),
        (110, "Bm"), (112, "A"), (114, "G"), (116, "F#7"), (118, "Bm"), (120, "A"), (122, "G"), (124, "F#7"),
        (136, "Bm"), (140, "A"), (144, "G"), (148, "F#7"), (152, "Bm"),
        (156, "Gmaj7"), (160, "Em9"), (164, "Cmaj7"), (168, "F#7"),
        (172, "Bm9"), (176, "E/B"), (180, "Bm9"), (184, "E/B"), (188, "G"), (190, "A"), (192, "G"),
        (196, "G"), (200, "A"), (204, "F#7"),
        (208, "B"), (212, "E"), (216, "G"), (220, "F#7"),
        (224, "B"), (228, "E"), (232, "F#7"), (234, "B")]
HB = [h[0] for h in HARM]


def chord_at(b):
    return HARM[bisect.bisect_right(HB, b + 1e-9) - 1][1]


def next_change(b):
    i = bisect.bisect_right(HB, b + 1e-9)
    return HB[i] if i < len(HB) else 1e9


def pcs(sym, n=None):
    r, q, _ = chord(sym)
    return {(r + x) % 12 for x in (q[:n] if n else q)}


def in_hole(b):
    return any(a <= b < z for a, z in HOLES)


def mel(txt):
    return band.line(txt, bar=None)


def clip(notes, end):
    return [(b, min(d, end - b), m) for b, d, m in notes if b < end]


# ── 연주 ──
def P(role, bus, name, notes, at=0.0, **kw):
    for b, d, m in notes:
        bb = at + b
        if in_hole(bb):
            continue
        inst(s, bus, name, m, bb, d, **kw)
        EV.append((bb, d, m, role))


def lead(notes, at, sus, stac=None, amp=1.0, vel=92, pan=0.0, send=0.18):
    """주선율: 음 길이 = 스윙 반영(다음 음 시작까지) · 쉼 없이 이어지면 40ms 겹쳐 이음 · 꼬리 0.3초. stac(짧은 음 녹음)은 금관 짧은 음에만."""
    notes = sorted(notes)
    for i, (b, d, m) in enumerate(notes):
        bb = at + b
        if in_hole(bb):
            continue
        if stac and d <= 0.5:
            P("lead", "lead", stac, [(b, d, m)], at=at, amp=amp, vel=vel, pan=pan, send=send, rel=0.12)
            continue
        joined = i + 1 < len(notes) and abs(notes[i + 1][0] - (b + d)) < 1e-6
        dur = s.pos(bb + d) - s.pos(bb) + (0.04 if joined else 0.0)
        rr = int(band.h01(bb, m, len(sus)) * 97) + 1
        y = band.sample_note(sus, m, dur, vel=vel, rr=rr, release=0.30)
        y *= amp * (0.9 + 0.1 * band.h01(m, bb, 3))
        s.add("lead", y, s.pos(bb), pan=pan, send=send)
        EV.append((bb, d, m, "lead"))


def counter(notes, at, name, amp=0.5, lo=50, minlen=0.75, pan=-0.25, vel=70):
    """대선율: 주선율이 화음음으로 머물 때만 · 16분 늦게 · 3도 이상 아래 · 겹쳐 거슬리는 음정(2도 · 7도 · 증4도) 없음."""
    out = []
    for b, d, m in notes:
        sym = chord_at(at + b)
        if d < minlen or m % 12 not in pcs(sym):
            continue
        tri = pcs(sym, 3)
        cand = [t for t in range(lo, m - 2) if t % 12 in tri and (m - t) % 12 not in BAD]
        if cand:
            out.append((b + 0.25, d - 0.25, cand[-1]))
    P("counter", "counter", name, out, at=at, amp=amp, vel=vel, pan=pan, send=0.22, rel=0.15, attack=0.03)


_prev = {}


def comp(b, name="ViolinEnsPizz", lo=55, hi=67, amp=0.55, vel=80, dur=0.5, key="pz", pan=0.2, role="comp", bus="comp", attack=0.0):
    if in_hole(b):
        return
    v = voice(chord_at(b), lo, hi, _prev.get(key))
    _prev[key] = v
    for m in v:
        inst(s, bus, name, m, b, dur, amp=amp / len(v) ** 0.5, vel=vel, pan=pan, send=0.15, attack=attack)
        EV.append((b, dur, m, role))


def backbeats(b0, b1, anchor, **kw):
    for b in range(int(b0), int(math.ceil(b1))):
        if (b - anchor) % 2 == 1:
            comp(b, **kw)


def bass(b, m, d=1.0, amp=0.9, name="ContrabassPizz", vel=95):
    if in_hole(b):
        return
    if 24 <= b < 52.5 and name == "ContrabassPizz":                               # 남의 색 구간 = 활로 긋는 저음(길게)
        name, amp, vel = "ContrabassSusVB", amp * 0.8, 85
    inst(s, "bass", name, m, b, d, amp=amp, vel=vel, send=0.06)
    EV.append((b, d, m, "bass"))


def two_feel(b0, b1, amp=0.9):
    for b in range(int(b0), int(b1)):
        sym, st = chord_at(b), HB[bisect.bisect_right(HB, b + 1e-9) - 1]
        k = b - st
        if k % 4 == 0:
            bass(b, bass_note(sym, 28, 47), 1.5, amp)
        elif k % 4 == 2:
            bass(b, bass_note(sym, 28, 47, "fifth"), 1.5, amp * 0.85)


def walk(b0, b1, amp=0.9):
    for b in range(int(b0), int(b1)):
        sym, st = chord_at(b), HB[bisect.bisect_right(HB, b + 1e-9) - 1]
        k, nc = b - st, next_change(b)
        if k == 0:
            m = bass_note(sym, 28, 47)
        elif b + 1 == nc and nc < b1:
            m = bass_note(chord_at(nc), 29, 47) - 1                              # 다음 화음 근음으로 반음 아래에서 걸어 들어감
        else:
            m = bass_note(sym, 28, 47, "fifth" if k % 2 == 1 else "third")
        bass(b, m, 1.0, amp * (1.0 if k == 0 else 0.82))


def arp(b0, b1, step=0.5, lo=50, hi=62, name="Harp", amp=0.45, vel=72, pan=-0.3, role="arp", bus="arp"):
    pat = [0, 1, 2, 3, 2, 1]
    t, i = b0, 0
    while t < b1 - 1e-9:
        tones = sorted(m for m in range(lo, hi + 1) if m % 12 in pcs(chord_at(t)))
        m = tones[pat[i % len(pat)] % len(tones)]
        if not in_hole(t):
            inst(s, bus, name, m, t, step * 1.6, amp=amp, vel=vel, pan=pan, send=0.25)
            EV.append((t, step, m, role))
        t += step
        i += 1


def roll(b, notes, name="Harp", gap=0.06, amp=0.5, vel=85, pan=0.0, d=3.0):
    for k, m in enumerate(notes):
        inst(s, "arp", name, m, b + k * gap, d, amp=amp, vel=vel, pan=pan, send=0.3)
        EV.append((b + k * gap, d, m, "roll"))


# ── 북(관현악 북 · 스윙 걸음) ──
def groove(b0, b1, style, anchor, g=1.0, skip=()):
    for b in range(int(b0), int(math.ceil(b1))):
        if in_hole(b) or any(a <= b < z for a, z in skip):
            continue
        i = (b - anchor) % 4
        if style in ("two", "back", "shout") and i == 0 or style == "back" and i == 2 or style == "shout" and i == 2:
            perc(s, 36, b, amp=0.85 * g, vel=100)
        if style == "half" and i == 0:
            perc(s, 36, b, amp=0.8 * g, vel=100)
        if style == "two" and i in (1, 3):
            perc(s, 37, b, amp=0.45 * g, vel=80)
        if style in ("back", "shout") and i in (1, 3):
            perc(s, 38, b, amp=0.6 * g, vel=100)
        if style == "half" and i == 2:
            perc(s, 38, b, amp=0.6 * g, vel=100)
        if style == "taps" and i in (1, 3):
            perc(s, 37, b, amp=0.35 * g, vel=70)
        if style == "shout":
            perc(s, 59, b, amp=0.22 * g, vel=90, dur=0.8, pan=0.35, bus="cym")      # 심벌 막대 = 박 잡이(흔드는 소리 아님)
        if style in ("two", "back", "shout") and i == 3 or style == "shout" and i == 1:
            if not in_hole(b + 0.5) and not any(a <= b + 0.5 < z for a, z in skip):
                perc(s, 37, b + 0.5, amp=0.25 * g, vel=60)                           # 스윙 뒤 8분 고스트


def _perc_wav(key):
    sf = band.sfz("GM-StylePerc")
    r = [r for r in sf["regions"] if r["lokey"] <= key <= r["hikey"]][0]
    return band.wav(os.path.join(sf["base"], sf["dpath"], r["sample"])).copy() * 10 ** (r["volume"] / 20)


def swell(end_b, amp=0.5, key=50):
    """매단 심벌 크레센도 — 소리가 가장 커지는 곳이 end_b 에 오게 놓고 거기서 끊음."""
    y = _perc_wav(key)
    env = np.abs(y)
    k = int(np.argmax(np.convolve(env, np.ones(2400) / 2400, mode="same")))
    y = y[:k + int(0.03 * SR)]
    y[-int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))
    s.add("cym", y * amp, s.pos(end_b) - k / SR, pan=0.0, send=0.2)


def snare_roll(b0, b1, amp=0.5):
    y = _perc_wav(39)
    n = int((s.pos(b1) - s.pos(b0)) * SR)
    while len(y) < n:
        y = np.concatenate([y, y])
    y = y[:n] * np.linspace(0.08, 1, n) ** 2
    s.add("perc", y * amp, s.pos(b0), pan=0.05, send=0.1)


def clap(b, amp=0.6):
    rng = np.random.default_rng(int(b * 100))
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    env = sum(np.exp(-np.clip(t - o, 0, None) / 0.006) * (t >= o) for o in (0.0, 0.009, 0.018)) * 0.5 + np.exp(-t / 0.07) * (t >= 0.027)
    y = sosfilt(butter(2, [900, 3200], "bandpass", fs=SR, output="sos"), rng.standard_normal(n)) * env
    s.add("clap", y / np.abs(y).max() * amp, s.pos(b), pan=0.0, send=0.18)
    EV.append((b, 0.25, 0, "clap"))


def chirp(b):
    """신호 두 음: 짧은 두 음(완전4도 위로 · 사각파 합성) — 곡 끝이 B 장조라 F#4 → B4."""
    for k, (m, d) in enumerate(((66, 0.09), (71, 0.24))):
        f = 440 * 2 ** ((m - 69) / 12)
        t = np.arange(int((d + 0.12) * SR)) / SR
        y = np.where((f * t) % 1 < 0.25, 1.0, -1.0) * np.exp(-t / (d * 0.7)) * np.minimum(1, t / 0.002)
        y = sosfilt(butter(2, 5000, "lowpass", fs=SR, output="sos"), y)
        s.add("chirp", y * 0.3, s.pos(b + 0.25 * k), pan=0.0, send=0.25)
        EV.append((b + 0.25 * k, 0.25, m, "chirp"))


def timp(b, m, amp=0.7, d=2.0):
    if not in_hole(b):
        inst(s, "timp", "Timpani", m, b, d, amp=amp, vel=110, send=0.2)


def crash(b, amp=0.5):
    perc(s, 49, b, amp=amp, vel=110, dur=3.0, bus="cym", send=0.2)


def strings(b, d, lo, hi, name="ViolinEnsSusVib", amp=0.5, attack=0.25, key="st", pan=-0.1):
    comp(b, name=name, lo=lo, hi=hi, amp=amp, vel=80, dur=d, key=key, pan=pan, role="str", bus="str", attack=attack)


# ── 곡 ──
def arrange():
    # 0~24 선화: B 드론 · 하프가 천천히 · 아이콘이 박마다 한 음씩 · 11.5 원래 색 비침 = 하프 화음 · 21~23.5 노트 = 피치카토가 올라감
    chirp(0.25)
    for bar in range(5):
        inst(s, "bass", "ContrabassSusVB", 35, bar * 4, 4.0, amp=0.55, vel=70, attack=0.35, send=0.1)
    arp(1, 20, step=0.5, lo=59, hi=74, amp=0.35, vel=64)
    for k, m in enumerate((47, 50, 54, 59, 62)):
        P("arp", "tick", "Marimba", [(7 + k, 1.0, m)], amp=0.5, vel=88, pan=0.15)
    roll(11.5, [47, 54, 59, 62, 66, 69], amp=0.4)
    P("lead", "lead", "ClarinetSus", [(12, 4, 62), (16, 4, 61)], amp=0.55, vel=60, attack=0.2)
    bass(20, 30, 4, 0.8)
    for b, m in ((21, 66), (22, 70), (23, 73), (23.5, 76)):
        P("arp", "comp", "ViolinEnsPizz", [(b, 0.5, m)], amp=0.55, vel=90, pan=0.2)
    inst(s, "timp", "TimpaniRolls", 42, 22, 2.0, amp=0.35, vel=70, attack=0.5)

    # 24~56 남의 색: 클라리넷이 남의 노래(안달루시아 하강 두 바퀴) · 2박 걸음 · 52.5 색이 빠짐 = 악단이 멈추고 바순만 내려감
    TA = mel("F#4:1 B4:.5 D5:.5 r:.5 C#5:.5 B4:1 | A4:1 C#5:.5 E5:.5 r:.5 D5:.5 C#5:1 | "
             "B4:.5 D5:.5 G4:1 r:.5 B4:.5 D5:.5 B4:.5 | A#4:1.5 C#5:.5 E5:2")
    TB = mel("D5:.5 C#5:.5 B4:.5 F#4:.5 r:.5 B4:.5 D5:1 | E5:.5 D5:.5 C#5:.5 A4:.5 r:.5 C#5:.5 E5:1 | "
             "D5:1 B4:.5 G4:.5 r:.5 A4:.5 B4:1 | C#5:1 A#4:1 F#4:2")
    game = TA + band.shift(clip(TB, 12.5), 16)
    lead(game, 24, "SViolinVib", amp=1.5 * 10 ** (-0.9 / 20))                 # 솔로 바이올린(클라리넷과 같은 크기로 맞춘 값)
    counter(game, 24, "ViolaEnsSusVib", amp=0.45, lo=54)
    backbeats(24, 52.5, 24)
    two_feel(24, 40)
    walk(40, 52)
    bass(52, 30, 0.5)
    groove(24, 40, "two", 24, 0.8)
    groove(40, 52.5, "back", 24, 0.85, skip=[(52.5, 56)])
    for b0, _sym in HARM:                                                          # 밑에 긴 비올라 화음(화음 바뀔 때마다)
        if 24 <= b0 < 52.5:
            z = min(next_change(b0), 52.5)
            strings(b0, z - b0, 50, 62, name="ViolaEnsSusVib", amp=0.35, attack=min(0.25, (z - b0) * 60 / 180 * 0.5), key="pad", pan=-0.2)
    P("lead", "lead", "BassoonSus", mel("E4:.5 C#4:1 A#3:1 F#3:1"), at=52.5, amp=0.8, vel=80)

    # 56~74 k1 = 약음 트럼펫 · 내려가는 저음 줄(2박마다 화음)
    RED = mel("F#4:1 A4:1 E4:.5 A4:.5 C#5:1 D5:1.5 B4:.5 F#4:2 G4:.5 B4:.5 D5:1 D5:.5 Bb4:.5 G4:1 "
              "A4:1.5 F#4:.5 G#4:.5 B4:.5 D5:1 C#5:2")
    lead(RED, 56, "TrumpetStraightMuteSus", amp=0.9, pan=0.1)
    counter(RED, 56, "CelloEnsSusVib", amp=0.45, lo=48)
    for b in range(56, 74, 2):
        bass(b, bass_note(chord_at(b), 28, 47), 2.0, 0.9)
    backbeats(56, 74, 56)
    groove(56, 74, "back", 56, 0.75)

    # 74~92 k2 = 바순 · 반 빠르기 골짜기(하프 4분 · 북 1 · 3)
    OCH = mel("B3:2 D4:1 F#4:1 E4:3 C#4:1 D4:2 B3:1 G3:1 A#3:2 C#4:2 E4:1 F#4:1")
    lead(OCH, 74, "BassoonSus", amp=1.0, vel=95)
    arp(74, 92, step=1.0, lo=62, hi=74, amp=0.35, vel=60, pan=0.3)
    for b in range(74, 92, 2):
        bass(b, bass_note(chord_at(b), 28, 47, "root" if (b - 74) % 4 == 0 else "fifth"), 2.0, 0.8)
    groove(74, 92, "half", 74, 0.7)

    # 92~110 k3 = 플루트 · 단조 ii–V · 박마다 아이콘이 쌓임 = 낮은 마림바 한 음(주선율이 새 음을 치는 박은 비움)
    PINK = mel("B4:1.5 A4:.5 B4:1 D5:1 E5:1.5 C#5:.5 B4:2 A#4:1 C#5:1 E5:2 D5:1.5 C#5:.5 B4:2 A#4:1 C#5:1")
    lead(PINK, 92, "FluteSusVib", amp=2.2, vel=90, pan=-0.05)
    counter(PINK, 92, "ClarinetSus", amp=0.4, lo=55)
    on = {round(92 + b, 3) for b, d, m in PINK}
    for b in range(92, 110):
        if b not in on:
            tones = sorted(m for m in range(45, 58) if m % 12 in pcs(chord_at(b)))
            P("tick", "tick", "Marimba", [(b, 0.5, tones[(b - 92) % len(tones)])], amp=0.4, vel=70, pan=0.35)
    backbeats(92, 110, 92)
    two_feel(92, 110)
    groove(92, 110, "two", 92, 0.8)

    # 110~122 몰아치기: 박마다 현 스피카토 화음(박마다 캐릭터가 바뀜) · 걷는 저음 · 122~131 자리 찾기 = F#7 위에서 버팀
    for b in range(110, 122):
        comp(b, name="ViolinEnsSpic", lo=62, hi=74, amp=1.1, vel=105, dur=0.5, key="sp", pan=0.15)
        comp(b, name="CelloEnsSpic", lo=45, hi=59, amp=0.8, vel=100, dur=0.5, key="cs", pan=-0.15)
    walk(110, 122, 0.95)
    groove(110, 122, "shout", 110, 0.9)
    backbeats(122, 124, 122)
    bass(122, bass_note("G", 28, 47), 2.0)
    lead(mel("C#5:4 E5:3"), 124, "ClarinetSus", amp=0.75, vel=80)
    for k in range(14):                                                             # 피치카토 8분이 F#7 위로 감김
        b = 124 + 0.5 * k
        P("arp", "comp", "ViolinEnsPizz", [(b, 0.5, [54, 58, 61, 64][k % 4])], amp=0.5, vel=80, pan=0.25)
    for b in range(124, 131):
        bass(b, 30, 1.0, 0.75)
    groove(122, 131, "taps", 122, 0.8)
    timp(124, 42, 0.45); timp(128, 42, 0.5)
    perc(s, 75, 131, amp=0.8, vel=110); timp(131, 42, 0.85); perc(s, 36, 131, amp=0.8)     # 딸깍
    strings(131, 1.5, 66, 76, name="ViolinEnsTrem", amp=0.6, attack=0.4, key="tr")
    snare_roll(131, 132.5, 0.55)
    swell(132.5, 0.5, key=48)
    # 132.5~136 무음(뒤에서 통째로 0)

    # 136~156 드롭: 같은 노래를 금관이 크게(트럼펫 + 트롬본 옥타브 아래) · 호른 대선율 · 현 스피카토 뒷박 · 방울 없음
    DROP = TA + band.shift(mel("B4:1 F#4:.5 B4:.5 D5:2"), 16)
    lead(DROP, 136, "TrumpetSus", "TrumpetStac", amp=1.0, vel=105, pan=0.05)
    P("lead2", "lead", "TromboneStac", [(b, d, m - 12) for b, d, m in DROP], at=136, amp=0.5, vel=95, pan=-0.1, send=0.15)
    counter(DROP, 136, "FHornSus", amp=0.5, lo=50)
    backbeats(136, 156, 136, name="ViolinEnsSpic", lo=59, hi=71, amp=0.6, vel=100, key="dsp")
    walk(136, 156, 1.0)
    groove(136, 156, "shout", 136, 1.0)
    crash(136, 0.6); timp(136, 47, 0.9); crash(152, 0.4)

    # 156~172 원판 속 세계: 은하(클라리넷) · 테트리스(마림바 16분) · 네 줄(162 금관 찌름) · 블랙홀 = 나폴리 화음 C · 박은 이어짐
    lead(mel("B4:1 D5:1 F#4:2"), 156, "ClarinetSus", amp=0.8)
    arp(158.75, 162, step=0.25, lo=55, hi=67, name="Marimba", amp=0.4, vel=85, pan=0.25)
    for m in (52, 59, 64, 67):
        inst(s, "lead", "TromboneStac", m, 162, 0.5, amp=0.35, vel=105, send=0.2)
    timp(162, 40, 0.7)
    for k, m in enumerate((72, 71, 67, 64, 62, 60, 59, 55, 52, 48)):                # 블랙홀로 하프가 빨려 내려감
        inst(s, "arp", "Harp", m, 163 + 0.1 * k, 1.5, amp=0.4, vel=80, send=0.3)
    lead(mel("E4:2 B3:2 C#4:2 A#3:2"), 164, "BassoonSus", amp=0.9, vel=90)
    backbeats(156, 172, 156)
    two_feel(156, 164)
    for b, m in ((164, 36), (166, 43), (168, 30), (170, 37)):
        bass(b, m, 2.0, 0.85)
    groove(156, 164, "two", 156, 0.8)
    groove(164, 172, "half", 164, 0.75)

    # 172~192.1 빛: B 도리아 드론(Bm9 ↔ E/B) · 플루트가 천천히 · 클라리넷 대선율 · 하프 8분 · 188~ 흡수 = 현 트레몰로 + 북 롤
    LIGHT = mel("F#4:2 C#5:2 B4:2 G#4:2 D5:3 C#5:1 E5:2 B4:2 D5:2 C#5:2")
    lead(LIGHT, 172, "FluteSusVib", amp=2.0, vel=85)
    counter(LIGHT, 172, "ClarinetSus", amp=0.25, lo=54)
    arp(172, 192, step=0.5, lo=50, hi=62, amp=0.4, vel=70)
    for b in range(172, 188, 2):
        bass(b, 35 if (b - 172) % 4 == 0 else 42, 2.0, 0.8)
    bass(188, 31, 2.0); bass(190, 33, 2.0)
    groove(172, 188, "two", 172, 0.65)
    groove(188, 192, "taps", 188, 1.0)
    strings(188, 2, 62, 74, name="ViolinEnsTrem", amp=0.45, attack=0.5, key="tr2")
    strings(190, 2.1, 62, 74, name="ViolinEnsTrem", amp=0.6, attack=0.3, key="tr2")
    snare_roll(189, 192.1, 0.45)
    swell(192.1, 0.45)

    # 192.1 꿀꺽 · ~196 범람: 큰 북 + 팀파니 + 심벌 · 하프가 위로 쏟아짐 · 현이 G 로 부풂
    perc(s, 36, 192.1, amp=1.0, vel=120); timp(192.1, 43, 0.9); crash(192.1, 0.55)
    for k, m in enumerate((55, 59, 62, 67, 71, 74, 79 - 12, 71, 74)):
        inst(s, "arp", "Harp", m, 192.25 + 0.15 * k, 1.5, amp=0.4, vel=85, send=0.3)
    strings(192.1, 3.9, 59, 71, amp=0.65, attack=0.4, key="fl")
    strings(192.1, 3.9, 43, 55, name="CelloEnsSusVib", amp=0.5, attack=0.4, key="flc")
    bass(192.1, 31, 3.9, 0.9)

    # 196~207 해가 맺힘 → 올라감(G–A–F#7) · 207 웅크림 = 한 박 비움 · 208 첫 박수 = 단조가 장조(B)로
    RISE = mel("D5:2 B4:1 G4:1 C#5:2 E5:1 C#5:1 A#4:1 C#5:1 E5:1")
    lead(RISE, 196, "TrumpetSus", "TrumpetStac", amp=0.85, vel=90)
    counter(RISE, 196, "FHornSus", amp=0.45, lo=50)
    arp(196, 204, step=0.5, lo=50, hi=62, amp=0.38, vel=72)
    backbeats(196, 207, 196)
    two_feel(196, 204)
    for b in range(204, 207):
        bass(b, 30, 1.0, 0.85)
    groove(196, 200, "two", 196, 0.8)
    groove(200, 207, "back", 196, 0.9, skip=[(207, 208)])
    strings(204, 3.0, 64, 76, name="ViolinEnsTrem", amp=0.55, attack=0.6, key="tr3")
    snare_roll(204, 207, 0.4)

    # 208~224 첫 박수 → 정점(B–E–G–F#7) · 박수 2 · 4 · 글자엔 효과음 없음
    PEAK = mel("D#5:1 F#4:.5 B4:.5 r:.5 C#5:.5 D#5:1 E5:1.5 B4:.5 G#4:1 B4:1 D5:1.5 B4:.5 G4:1 B4:1 C#5:1 A#4:1 E5:2")
    lead(PEAK, 208, "TrumpetSus", "TrumpetStac", amp=1.0, vel=108)
    P("lead2", "lead", "TromboneStac", [(b, d, m - 12) for b, d, m in PEAK], at=208, amp=0.45, vel=95, pan=-0.1, send=0.15)
    counter(PEAK, 208, "FHornSus", amp=0.5, lo=50)
    backbeats(208, 224, 208, name="ViolinEnsSpic", lo=59, hi=71, amp=0.6, vel=100, key="psp")
    walk(208, 224, 1.0)
    groove(208, 224, "shout", 208, 1.0)
    crash(208, 0.7); timp(208, 47, 1.0); perc(s, 36, 208, amp=1.0, vel=120)
    clap(208, 0.75)
    for b in range(209, 224, 2):
        clap(b, 0.55)

    # 224~236 잦아듦: 마림바가 노래를 천천히 · 북이 하나씩 빠짐 · 236 하프 B 장화음 · 236.5 신호 두 음
    SET = mel("D#5:1 B4:1 F#4:2 G#4:1 B4:1 E5:2 C#5:1 A#4:1 B4:2")
    lead(SET, 224, "Marimba", amp=2.2, vel=85)
    arp(224, 236, step=0.5, lo=50, hi=62, amp=0.35, vel=64)
    for b in range(224, 236, 2):
        bass(b, bass_note(chord_at(b), 28, 47), 2.0, 0.75)
    groove(224, 228, "two", 224, 0.6)
    groove(228, 232, "taps", 224, 0.5)
    roll(236, [35, 47, 54, 59, 63, 66], amp=0.45, d=4.0)
    strings(236, 4.0, 59, 71, name="ViolinEnsSusVib-Quiet", amp=0.35, attack=0.5, key="end")
    chirp(236.5)


# ── 구간 크기: 구간마다 잰 크기를 목표 아치(TARGET)에 맞춰 배율을 자동으로 정함 ──
GAINS = {"lead": 1.0, "counter": 0.5, "comp": 1.4, "str": 0.55, "bass": 1.3, "arp": 0.45, "tick": 0.4,
         "perc": 0.42, "cym": 0.45, "timp": 0.6, "clap": 0.6, "chirp": 0.55}
SECTIONS = [("선화", 0, 24), ("남의색", 24, 52.5), ("빠짐", 52.5, 56), ("k1", 56, 74), ("k2", 74, 92), ("k3", 92, 110),
            ("몰아치기", 110, 122), ("자리찾기", 122, 132.5), ("드롭", 136, 156), ("세계", 156, 172), ("빛", 172, 192.1),
            ("범람", 192.1, 196), ("올라감", 196, 207), ("박수정점", 208, 224), ("잦아듦", 224, 236), ("끝", 236, 240)]


def sec(b):
    return b * 60.0 / BPM


TARGET = {"선화": -19.5, "남의색": -15.5, "빠짐": -18.5, "k1": -15.0, "k2": -16.0, "k3": -15.5, "몰아치기": -14.0,
          "자리찾기": -15.0, "드롭": -12.0, "세계": -14.5, "빛": -16.5, "범람": -13.5, "올라감": -14.0, "박수정점": -12.0,
          "잦아듦": -18.0, "끝": -20.5}     # 구간 크기 아치(통합 −14 기준 상대값)


def dry(keys=None):
    L = sum(s.bus[k][0] * GAINS[k] for k in (keys or GAINS) if k in s.bus)
    R = sum(s.bus[k][1] * GAINS[k] for k in (keys or GAINS) if k in s.bus)
    return np.stack([L, R], 1)


def lufs_of(x, a, z):
    try:
        v = pyln.Meter(SR).integrated_loudness(x[int(sec(a) * SR):int(sec(z) * SR)])
        return v if v > -70 else None
    except Exception:
        return None


def auto_secg():
    """구간마다 잰 크기(마른 합) → 목표 아치에 맞는 배율. 정규화는 마스터가 함."""
    x = dry()
    whole = pyln.Meter(SR).integrated_loudness(x)
    g = []
    for nm_, a, z in SECTIONS:
        v = lufs_of(x, a, z)
        g.append((a, 10 ** (((TARGET[nm_] + 14.0) - (v - whole)) / 20) if v is not None else 1.0))
    if "--diag" in sys.argv:
        for nm_, a, z in SECTIONS:
            row = {k: lufs_of(dry([k]), a, z) for k in GAINS if k in s.bus}
            print(nm_, " ".join(f"{k}:{round(v, 1)}" for k, v in row.items() if v is not None))
    return g


def apply_secg():
    SECG = auto_secg()
    print("SECG", [(a, round(v, 2)) for a, v in SECG])
    env = np.ones(s.N)
    w = int(0.06 * SR)
    for i, (b0, gg) in enumerate(SECG):
        i0 = int(s.pos(b0) * SR)
        i1 = int(s.pos(SECG[i + 1][0]) * SR) if i + 1 < len(SECG) else s.N
        env[i0:i1] = gg
    for i in range(1, len(SECG)):
        c = int(s.pos(SECG[i][0]) * SR)
        env[c - w:c + w] = SECG[i - 1][1] + (SECG[i][1] - SECG[i - 1][1]) * (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, 2 * w)))
    for k in s.bus:
        s.bus[k][0] *= env
        s.bus[k][1] *= env


def clash_report():
    """주선율 × (대선율 · 배경 선율) 겹침 중 2도 · 7도 · 증4도 박 수 + 같은 박 동시 타격 수."""
    leads = [e for e in EV if e[3] == "lead"]
    out = {}
    for role in ("counter", "arp", "tick", "comp", "str"):
        oth = [e for e in EV if e[3] == role]
        bad, same, det = 0.0, 0, []
        for b, d, m, _ in leads:
            for b2, d2, m2, _ in oth:
                ov = min(b + d, b2 + d2) - max(b, b2)
                if ov > 1e-6 and abs(m - m2) % 12 in BAD:
                    pc = pcs(chord_at(max(b, b2)))
                    if m % 12 not in pc or m2 % 12 not in pc:              # 둘 다 화음음(7화음의 7도 등)이면 화음 그 자체 — 셈에서 뺌
                        bad += ov
                        det.append([round(b, 2), round(d, 2), m, m2])
                if role == "counter" and abs(b - b2) < 1e-6:
                    same += 1
        out[role] = {"dissonant_beats": round(bad, 2), "where": det[:12], **({"same_onsets": same} if role == "counter" else {})}
    return out


def main():
    arrange()
    apply_secg()
    OUT.mkdir(parents=True, exist_ok=True)
    band.master(s, GAINS, rev_rt=1.3, rev_wet=0.24, out_dir=OUT, fade_out=0.0, tp_target=-1.8)
    sr, x = wavfile.read(OUT / "mix.wav")
    x = x.astype(np.float64) / 32767
    n_end = int(sec(BEATS) * SR)
    x = x[:n_end]
    f = int(0.25 * SR)
    x[-f:] *= np.linspace(1, 0, f)[:, None] ** 1.5                               # 끝 0.25초 닫힘
    for a, z in HOLES:                                                            # 무음 = 통째로 0(리버브 꼬리 포함)
        ia, iz = int(sec(a) * SR), int(sec(z) * SR)
        k = int(0.004 * SR)
        x[ia - k:ia] *= np.linspace(1, 0, k)[:, None]
        x[ia:iz] = 0
    meter = pyln.Meter(SR)
    lufs = meter.integrated_loudness(x)
    x *= 10 ** ((-14.0 - lufs) / 20)
    tp = band.true_peak_db(x)
    if tp > -1.5:
        x *= 10 ** ((-1.5 - tp) / 20)
    lufs, tp = meter.integrated_loudness(x), band.true_peak_db(x)
    wavfile.write(OUT / "mix.wav", SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
    secs = {}
    for nm_, a, z in SECTIONS:
        try:
            secs[nm_] = round(meter.integrated_loudness(x[int(sec(a) * SR):int(sec(z) * SR)]), 1)
        except Exception:
            secs[nm_] = None
    fq, pw = welch(x.mean(1), SR, nperseg=8192)
    mel_ = [e[2] for e in EV if e[3] == "lead"]
    rep = json.loads((OUT / "report.json").read_text(encoding="utf-8"))
    rep.update({"final_lufs": round(lufs, 2), "final_true_peak_db": round(tp, 2), "dur_s": round(len(x) / SR, 3),
                "section_lufs_beats": secs, "melody_range_midi": [min(mel_), max(mel_)],
                "centroid_hz": round(float((fq * pw).sum() / pw.sum()), 1),
                "hole_peak": float(np.abs(x[int(sec(132.5) * SR):int(sec(136) * SR)]).max()),
                "claps_before_clap": sum(1 for e in EV if e[3] == "clap" and e[0] < CLAP_B),
                "events_in_letters_213_223": sorted({e[3] for e in EV if 213 <= e[0] < 223.2}),
                "crouch_207_208_events": sum(1 for e in EV if 207 <= e[0] < 208),
                "clash": clash_report()})
    (OUT / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in ("final_lufs", "final_true_peak_db", "dur_s", "melody_range_midi", "centroid_hz", "hole_peak",
                                          "claps_before_clap", "events_in_letters_213_223", "crouch_207_208_events", "clash", "section_lufs_beats")},
                     ensure_ascii=False))
    if "--bus" in sys.argv:
        for k, row in rep.get("bus_section_lufs", {}).items():
            print(k, row)


if __name__ == "__main__":
    main()
