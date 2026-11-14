# AGENTS.md — AI 가 이 키트로 「사람의 캐릭터로 80초 롱폼」을 만들 때 따라갈 순서

목표: 사람이 준 캐릭터 그림으로 `out/color_longform.mp4`(1920×1080 · 30fps · 2,400프레임 · 80초 · 음악 포함)를 만들고, 형식 검사(`gates/report.json` 의 `all_pass: true`)를 통과시킨 뒤, **사람이 직접 보고 판정하게** 넘긴다.
사람용 설명은 `README.md`, 동작 자리 표는 `character/README.md`, 만든 방법은 `docs/방법.md`.

## 0. 먼저 알아 둘 것
- 화면 = `scenes/*.html` 네 페이지(구간 1~2 · 3~4 · 5~6 · 7~8). 각 페이지는 프레임 번호 하나로 그림을 그리는 순수 함수다. 캐릭터 고유 값은 전부 `tools/prep.py` 가 `build/` 에 만든 자료(`kit.js` · `masks.js` · 그림)에서 읽는다 — **장면 코드에 캐릭터 값을 직접 쓰지 말 것.**
- 렌더 = `render.mjs`(Playwright Chromium · SwiftShader 소프트웨어 그리기 · 프레임마다 캔버스 픽셀 해시).
- 음악 = `music/color_longform.wav`(완성본 · CC0). 다시 만들려면 VSCO 2 CE 샘플(3GB)이 필요 — 사람이 원할 때만.
- 시간: 렌더가 대부분(이 키트를 만든 컴퓨터 기준 · 영상 굽기 구간당 1.5~3분 · 역순 해시 구간당 1~2분 · `make.py all` 전체 약 14분). 오래 걸리는 명령은 기다리는 동안 다른 일을 하되 결과를 지어내지 말 것.

## 1. 준비(한 번)
```bash
npm install
npx playwright install chromium
pip install -r requirements.txt
```
`ffmpeg -version` · `ffprobe -version` 이 되는지 확인. 안 되면 사람에게 설치를 부탁한다(설치 방법은 OS 마다 다름).

## 2. 시험 캐릭터로 한 바퀴(환경 확인)
```bash
python examples/make_sample_character.py
python make.py prep --character examples/sample
python make.py spot
```
확인: `build/check.png`(팔레트 · 층 · 눈 · 조각 · 끝 화면 배치) · `spot/*_sheet.jpg` 가 그림으로 열리면 직접 본다. 여기서 막히면 사람 캐릭터로 넘어가지 말고 환경부터 고친다.
시간이 허락하면 `python make.py render` → `python make.py finish` 까지 돌려 `all_pass: true` 를 본다(환경이 결정론을 지키는지 확인).

## 3. 사람에게 물을 것(조용히 기본값으로 채우지 말 것)
1. **캐릭터 그림**: 어디 있는지 · 투명 바탕 PNG 인지 · 동작이 몇 개인지(1장이어도 됨). 그림의 권리가 그 사람에게 있는지(남의 캐릭터면 멈춤).
2. **이름 · 제목**: `config.json` 의 `name`(거대 글자 · 코드 글자) · `title`(끝 화면 제목 줄 · 기본 `["{name}", "IN COLOR"]`).
3. **동작 배정**: `character/README.md` 의 자리 표를 보여 주고, 어떤 동작을 어느 자리에 쓸지(`"poses"`). 묻지 않으면 같은 이름 폴더 → 대신 순서 → `stand`.
4. **글꼴**: 제목에 쓸 재배포 가능한 글꼴 파일이 있는지(없으면 픽셀 글꼴 — 한글 제목은 글꼴 필요).
5. **부위 이름**: 코드 글자에 나오는 k1 · k2 · k3 의 이름(`"part_names"` · 예 SCARF · COAT · CHEEK). 이름은 `prep` 으로 색이 뽑힌 뒤 `build/check.png` 를 보여 주며 묻는 게 정확하다.
6. **음악**: 들어 있는 곡을 그대로 쓸지 · 바꿀지(바꾸면 박 지도가 같아야 화면이 맞음 — `music/README.md`).
7. 끝나면 **올리기 · 공개는 사람이 한다**(이 키트는 업로드하지 않는다). AI 사용 고지 여부도 사람이 정한다.

## 4. 사람 캐릭터로 만들기 — 단계마다 확인
| 단계 | 명령 | 확인(통과해야 다음으로) |
|---|---|---|
| 그림 넣기 | `character/<동작>/00.png …` · `config.json` 고치기 | 한 폴더 안 장 크기가 같다 · 투명 바탕 |
| 준비 | `python make.py prep` | 출력의 팔레트 · 「눈 찾음」 여부 · **`build/check.png` 를 직접 본다**: ① k1 · k2 · k3 가 그 캐릭터의 대표 색 셋인가(순서 = 돌아오는 순서) ② sil · ink 층이 깨끗한가(선 옆에 다른 색 테가 없는가) ③ 빨간 원이 두 눈 위에 있는가 ④ 「piece」가 정적 장면에 크게 나와도 괜찮은 덩어리인가 ⑤ 끝 화면에서 제목이 왼쪽 절반 안 · 캐릭터가 오른쪽 · 파란 원(박수 자리)이 손 근처인가 |
| 스팟 | `python make.py spot` | `spot/<구간>_sheet.jpg` 4장을 본다: 캐릭터가 잘리거나 엉뚱하게 칠해진 장면이 없는가 · 얼굴 클로즈업에서 얼굴이 화면 안인가 |
| 전체 렌더 | `python make.py render` | 오류 없이 `out/s12.mp4` · `s34` · `s56` · `end.mp4` 와 `gates/*_fwd.json` · `*_rev.json` |
| 마무리 · 검사 | `python make.py finish` | `gates/report.json`: 결정론(구간마다 정순 해시 = 역순 해시 전부) · 프레임 2400 · 번쩍임 1초 ≤ 3 · 통합 −14 ± 0.5 LUFS · 트루피크 ≤ −1 dBTP · 무음 구간 · `all_pass: true` |
| (선택) 숏폼 편집본 | `python make.py short` | `out/color_longform_short.mp4` 1080×1920 · 34.67초 · 소리 있음 — 창이 캐릭터를 잘라 먹는 구간이 없는지 몇 프레임 본다 |
| 사람 판정 | — | **사람이 소리를 켜고 끝까지 본다.** 형식 검사는 「내 캐릭터답게 보이는가」「음악과 맞는가」를 판정하지 못한다. AI 가 대신 「좋다」고 말하지 말 것 |

### 고치는 법(check.png 가 틀렸을 때)
- 색 역할이 틀림(선 색이 키컬러로 · 대표 색이 빠짐): 그림자 · 그러데이션이 많은 그림이면 묶음이 갈린다. `"palette": {"k1": "#RRGGBB"}` 는 **칠하는 색만** 바꾼다(층 나눔은 그대로). 층 나눔 자체가 틀리면 그림을 평평한 색으로 정리해 달라고 사람에게 말하거나, `tools/prep.py` 의 `palette()` 역할 규칙을 그 그림에 맞게 고친다.
- 돌아오는 순서: `"key_order": [2, 0, 1]`.
- 기준점(`build/report.json` 의 `anchors` · 다른 값으로 덮으려면 `config.json` `"anchors"`):
  - `eye_from_bottom` — 키에서 눈 높이(아래부터 비율). 얼굴 클로즈업에서 눈을 화면 y≈560 에 놓는 데 씀.
  - `eye_zoom` — 「자리 찾기」 끝에 다가가는 화면 좌표(stand 를 키 900 · 가운데 960 · 발치 1075 에 둔 상태의 왼눈).
  - `fit` — 키컬러 조각의 회전 중심(층 비율 [x, y]).
  - `horn_eye` · `horn_scale` — 정적 장면 조각(assets/horn.png)의 회전 중심(조각 px) · 화면 배율.
  - `hands` — 끝 화면 박수 자리(화면 좌표).
- 눈을 못 찾음: 눈이 선과 같은 색의 둥근 점이 아니면 못 찾는다 → `eye_zoom` · `eye_from_bottom` 을 스팟으로 보며 직접 정한다.

## 5. 장면을 고칠 때 지킬 규칙(결정론)
- 시간은 프레임 번호에서만: `Math.random` · `Date.now` · `performance.now` · CSS transition/animation · `requestAnimationFrame` 진행 금지. 무작위는 `hash01(정수)`.
- 캔버스 `filter: blur` 금지(빛 번짐은 `build/assets/glow.png` 같은 미리 구운 가우시안 그림) · `imageSmoothingQuality = 'low'`(high 는 시크 순서에 따라 ±1 이 갈림) · 캔버스를 자기 자신에서 읽지 않음(앞 프레임이 새어 듦) · 매 프레임 `ctxReset`.
- 이징은 손으로 짜지 않고 GSAP 이징 함수를 값으로(`ez.p3o(u)` 등).
- 화면 사건은 음악 박에 맞춘다: 박 = `f / FPB`(FPB 10). 박 지도 = `music/README.md`.
- 고친 뒤엔 그 구간을 정순 · 역순으로 다시 해시해 전부 같은지 본다(`make.py render` → `finish`). 장면을 크게 바꿨으면 번쩍임도 다시 잰다.
- 페이지 안 `__hash` 는 캔버스 원시 픽셀의 해시다. mp4 파일의 해시가 아니다(인코더 · 컨테이너가 달라도 화면 판정은 이것으로).

## 6. 정직하게 말할 것
- 같은 픽셀은 **한 컴퓨터 안**에서 확인된 것이다. 다른 컴퓨터 · 다른 Chromium 판에서 같은 해시가 나온다고 말하지 말 것(확인 안 됨).
- 검사를 건너뛰었거나 실패했으면 그대로 보고한다(`report.json` 을 그대로 보여 줌).
- 번쩍임 검사는 화면 평균 밝기만 본다 — 「광과민 안전 보장」이라고 하지 말 것.
- 이 키트는 사람 그림을 새로 그리지 않는다. 그림이 부족하면(동작이 1장뿐이면) 같은 그림을 돌려 쓴다는 걸 사람에게 알린다.

## 7. 자주 막히는 곳
- `준비물이 없습니다` → `python make.py prep` 먼저.
- `Executable doesn't exist`(Playwright) → `npx playwright install chromium`.
- `ffmpeg` 없음 → 사람에게 설치 부탁.
- 렌더가 `준비 시간 초과` → 그림이 아주 크거나 동작이 아주 많음. 층 그림은 prep 이 1240×1100 안으로 줄이므로 보통은 페이지 오류다 — 출력의 `페이지 오류:` 줄을 본다.
- 한글 · 공백이 든 경로: 대체로 되지만 ffmpeg 가 경로를 못 열면 영문 경로로 옮겨 본다.
