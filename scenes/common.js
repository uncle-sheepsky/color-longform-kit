/* 장면 페이지 공용(s12 · s34 · s56) — 캔버스 · 이징 · 스프링 · 캐릭터 층 그리기.
   캐릭터에 따라 달라지는 값은 전부 준비물에서 읽는다: window.PAL(색) · window.GEO(끝 화면 · 기준점) · window.KIT(이름 · 글자) · window.MK(동작 층 목록)
   — 모두 tools/prep.py 가 build/ 에 만든다.
   결정론 규칙: 화면 = 프레임 번호의 순수 함수 · Math.random / 시계 시간 / CSS 애니메이션 / 캔버스 blur 를 쓰지 않음 ·
   빛 번짐은 미리 구운 가우시안 그림(assets/glow 등) · imageSmoothingQuality 'low' · 캔버스를 자기 자신에서 읽지 않음. */
const G = window.GEO, PAL = window.PAL, KIT = window.KIT, W = 1920, H = 1080, FPB = 10, SPB = 1 / 3, TAU = Math.PI * 2;   // FPB = 박당 프레임(♩180 · 30fps) · SPB = 박당 초
const cv = document.getElementById('cv'), G2D = cv.getContext('2d', { willReadFrequently: true }); let g = G2D;
// 빈 실행용 가짜 붓: 로드 전에 모든 프레임을 한 번 「그리는 척」 해서 필요한 층 목록만 모은다
const NOOP = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient') ? () => ({ addColorStop() {} }) : (typeof CanvasRenderingContext2D.prototype[k] === 'function' ? () => {} : undefined), set: () => true });
gsap.ticker.lagSmoothing(0);
const E = n => gsap.parseEase(n);                             // 이징은 손으로 짜지 않고 GSAP 이징 함수를 값으로만 씀(시간 진행은 프레임 번호)
const ez = { p2o: E('power2.out'), p3o: E('power3.out'), p2i: E('power2.in'), p3i: E('power3.in'), p2io: E('power2.inOut'), p3io: E('power3.inOut'), expoI: E('expo.in'), expoO: E('expo.out'), expoIO: E('expo.inOut'), sine: E('sine.inOut'), backO: E('back.out(2)') };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)), lerp = (a, b, p) => a + (b - a) * p, prog = (x, a, b) => clamp((x - a) / (b - a));
function hash01(i) { let x = (i + 1) * 747796405 + 2891336453; x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 2246822519) >>> 0; x = (x ^ (x >>> 13)) >>> 0; return x / 4294967296; }
const rgb = (a, al = 1) => `rgba(${a[0]},${a[1]},${a[2]},${al})`;
const mixC = (a, c, t) => a.map((v, i) => Math.round(v + (c[i] - v) * clamp(t)));
const P = { paper: PAL.paper, ink: PAL.ink, tick: PAL.tick, cream: G.colors.cream };
const K1 = PAL.k1, K2 = PAL.k2, K3 = PAL.k3, KD = PAL.deep;     // 캐릭터 자기 색 셋(돌아오는 순서) · 진한 면 색
const NIGHT = PAL.night, NIGHT2 = PAL.night2;                  // 어두운 바탕 · 칸 바탕
const OTHERS = PAL.others;                                     // 남의 색 8가지(캐릭터 색이 아닌 색)
/* 닫힌 형태 스프링: imp = 충격 응답(튀었다 잦아듦) · stp = 계단 응답(넘쳤다 자리 잡음) · t = 초 */
function imp(t, f = 2.2, z = 0.32) { if (t <= 0) return 0; const w = TAU * f, wd = w * Math.sqrt(1 - z * z); return Math.exp(-z * w * t) * Math.sin(wd * t); }
function stp(t, f = 2.0, z = 0.45) { if (t <= 0) return 0; const w = TAU * f, wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t)); }

/* ── 캐릭터 층 ── 층 = sil(실루엣) · ink(선) · deep(진한 면) · k1 · k2 · k3(키컬러) · tick(작은 표시) · full(원본) */
const LAYER = {}, IMG = {}; let DRY = null;
function layer(cut, i, k) { i = i % MK[cut].n; const key = cut + '|' + i + '|' + k; if (DRY) { DRY.add(key); return null; } return LAYER[key] || null; }
function loadOnce(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); res(c); }; im.onerror = () => rej(new Error(src)); im.src = src; }); }
async function pool(tasks, n = 6) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) await tasks[i++](); })); }
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; };
const [VER, vg] = mk(1250, 1150), [TMP, tg] = mk(1920, 1150);   // 층 합성용 작업 캔버스(층 그림은 1250×1150 안이어야 함 — prep.py 가 맞춤)
// 매 프레임 붓 상태를 처음으로(lineWidth 도 — 0 을 넣으면 무시돼 앞 프레임 값이 남는다)
function ctxReset(c) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'low'; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 1; c.strokeStyle = '#000'; c.fillStyle = '#000'; }
function tintTo(c, m, col, a = 1) { if (!m || a <= 0) return; ctxReset(tg); tg.clearRect(0, 0, m.width, m.height); tg.drawImage(m, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = rgb(col); tg.fillRect(0, 0, m.width, m.height); c.save(); c.globalAlpha *= a; c.drawImage(TMP, 0, 0, m.width, m.height, 0, 0, m.width, m.height); c.restore(); }
/* 선화 판(층 좌표): base = 지금 입은 색 · pour = 발치에서 차오르는 새 색(level 0~1 · 물결) · peel = 머리부터 벗겨진 정도 */
function ver(cut, i, o) {
  const m = MK[cut], w = m.w, h = m.h, L = k => layer(cut, i, k);
  if (DRY) { for (const k of ['sil', 'ink', 'tick']) L(k); return { w, h }; }
  ctxReset(vg); vg.clearRect(0, 0, w + 4, h + 4);
  const sil = L('sil'), ink = L('ink');
  tintTo(vg, sil, o.base || P.paper);
  if (o.pour && o.pour.level > 0) {
    vg.save(); vg.beginPath(); const lv = h * (1 - o.pour.level); vg.moveTo(0, h + 4); vg.lineTo(0, lv);
    for (let x = 0; x <= w; x += 12) vg.lineTo(x, lv + 14 * Math.sin(x / 40 + o.pour.t * 9) * (1 - o.pour.level * 0.6));
    vg.lineTo(w, h + 4); vg.closePath(); vg.clip(); tintTo(vg, sil, o.pour.c); vg.restore();
  }
  if (o.peel > 0) {
    vg.save(); vg.beginPath(); const ey = (h + 40) * o.peel - 20; vg.moveTo(-10, -10); vg.lineTo(w + 10, -10);
    for (let x = w + 10; x >= -10; x -= 12) vg.lineTo(x, ey + 22 * Math.sin(x / 47 + o.peel * 9) + 10 * Math.sin(x / 13));
    vg.closePath(); vg.clip(); tintTo(vg, sil, P.paper); vg.restore();
  }
  if (!o.base || o.base === P.paper || o.peel > 0) tintTo(vg, L('tick'), P.tick);
  tintTo(vg, ink, P.ink);
  return { w, h };
}
/* 동작의 화면 상자: 가운데 x · 발치 y · 화면 키(px) */
function boxOf(cut, cx, bottom, hpx) { const m = MK[cut], s = hpx / (m.h / m.u), w = m.w / m.u * s, h = m.h / m.u * s; return { x: cx - w / 2, y: bottom - h, w, h }; }
/* 젤리: 가로 띠 40개로 나눠 띠마다 눌림 · 부풂 · 흔들림을 따로 — 발치 가운데가 고정점 */
function jelly(src, sw, sh, r, J) {
  if (DRY) return;
  const n = 40, hs = sh / n, bxm = r.x + r.w / 2, by = r.y + r.h;
  for (let i = 0; i < n; i++) {
    const v = 1 - (i + 0.5) / n, sy = 1 - J.sq, sx = 1 + J.sq * 0.8 + (J.bulge || 0) * Math.sin(Math.PI * v);
    const dx = (J.sway || 0) * v * v + (J.shake || 0) * Math.sin(i * 0.9 + (J.ph || 0)) * v;
    g.drawImage(src, 0, i * hs, sw, hs + 1, bxm - (r.w / 2) * sx + dx, by - (r.h - i * hs * r.h / sh) * sy, r.w * sx, (hs + 1) * r.h / sh * sy);
  }
}
/* 동작의 몇 번째 장인지: b0 박부터 장마다 ms 만큼(없으면 동작의 장 시간) 돌아감 */
function frameOf(cut, b, b0, ms) { const m = MK[cut], arr = ms ? Array(m.n).fill(ms) : m.ms, tot = arr.reduce((a, v) => a + v, 0); let t = ((b - b0) * SPB * 1000) % tot; for (let i = 0; i < m.n; i++) { if (t < arr[i]) return i; t -= arr[i]; } return m.n - 1; }
const seqOf = (seq, b) => { let f = seq[0][1]; for (const [bb, k] of seq) if (bb <= b) f = k; return f; };
const BLINK = (b, at) => (b >= at && b < at + 0.25 ? 2 : 0);  // 깜빡: 그 박에서 ¼박 동안 2번 장(눈 감은 장 — 장이 셋보다 적으면 0번으로 돌아감)
function glow(x, y, s, a) { if (!IMG.glow || a <= 0) return; g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(a); g.drawImage(IMG.glow, x - s / 2, y - s / 2, s, s); g.restore(); }
function paper() {                                            // 크림 종이 바탕
  g.fillStyle = rgb(P.cream); g.fillRect(0, 0, W, H);
  if (IMG.grain) { g.save(); g.globalAlpha = 0.5; for (let y = 0; y < H; y += IMG.grain.height) for (let x = 0; x < W; x += IMG.grain.width) g.drawImage(IMG.grain, x, y); g.restore(); }
  const v = g.createRadialGradient(960, 540, 500, 960, 540, 1250); v.addColorStop(0, 'rgba(120,70,20,0)'); v.addColorStop(1, 'rgba(120,70,20,0.12)'); g.fillStyle = v; g.fillRect(0, 0, W, H);
}
function night() {                                            // 어두운 바탕(결 · 가장자리 어둡게)
  g.fillStyle = rgb(NIGHT); g.fillRect(0, 0, W, H);
  if (IMG.grain) { g.save(); g.globalAlpha = 0.07; for (let y = 0; y < H; y += IMG.grain.height) for (let x = 0; x < W; x += IMG.grain.width) g.drawImage(IMG.grain, x, y); g.restore(); }
  const v = g.createRadialGradient(960, 540, 420, 960, 540, 1200); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)'); g.fillStyle = v; g.fillRect(0, 0, W, H);
}
const DUST = Array.from({ length: 26 }, (_, i) => ({ x: 300 + 1320 * hash01(i + 301), y: 140 + 800 * hash01(i + 303), s: 6 + 12 * hash01(i + 305), ph: TAU * hash01(i + 307) }));
function motes(b, a) { for (const d of DUST) glow(d.x + 10 * Math.sin(b * 0.6 + d.ph), ((d.y - 10 * b) % H + H) % H, d.s * 2.4, a * (0.55 + 0.45 * Math.sin(b * 2.1 + d.ph))); }   // 떠다니는 먼지 빛
function lineChar(cut, fi, cx, bottom, hpx, J, o = {}) { const d = ver(cut, fi, o), r = boxOf(cut, cx, bottom, hpx); jelly(VER, d.w, d.h, r, J); return r; }
const DOTP = {}; function dotPat(col) { const k = col.join(); if (!DOTP[k]) { const c = document.createElement('canvas'); c.width = c.height = 22; const x = c.getContext('2d'); x.fillStyle = rgb(col); x.beginPath(); x.arc(11, 11, 7, 0, TAU); x.fill(); DOTP[k] = c; } return DOTP[k]; }
const TINTC = {};
function tintedImg(src, im, col) { const k = src + '|' + col.join(); if (!TINTC[k]) { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = rgb(col); x.fillRect(0, 0, c.width, c.height); TINTC[k] = c; } return TINTC[k]; }
function grainOver(a) { if (!IMG.grain || DRY) return; g.save(); g.globalAlpha = a; for (let y = 0; y < H; y += IMG.grain.height) for (let x = 0; x < W; x += IMG.grain.width) g.drawImage(IMG.grain, x, y); g.restore(); }

/* ── 자기 색 판(층 좌표) ── A = 부위별 색이 와 있는 정도 { k1, k2, k3, deep } · o.tru = 부위별 「원래 색」 비율(0 = 바뀐 자리 색 · 기본 1)
   o.off = 부위별 판 어긋남(층 px) · o.dots = 판을 망점으로 · o.map = 자리 바뀐 색 표 · o.full = 원본 그대로 */
const DEEP_KEY = KIT.deep_follows;                            // 진한 면 층이 따라가는 키컬러(그 색이 올 때 같이 옴)
const PART_L = [[DEEP_KEY, DEEP_KEY], ['deep', DEEP_KEY], ...['k1', 'k2', 'k3'].filter(k => k !== DEEP_KEY).map(k => [k, k])];   // [층, 그 층이 따르는 색 키] · 그리는 순서
const TRUE_C = { k1: K1, k2: K2, k3: K3 };
const SWAP = { k1: K2, k2: K3, k3: K1, deep: KD };            // 자리 바뀜(키컬러를 한 칸씩 돌림 · 진한 면은 그대로)
const ALL = { k1: 1, k2: 1, k3: 1 };
const TRU0 = { k1: 0, k2: 0, k3: 0 };
function verOwn(cut, i, A, o = {}) {
  const m = MK[cut], L = k => layer(cut, i, k);
  if (DRY) { for (const k of ['sil', 'ink', 'tick', 'k1', 'k2', 'k3', 'deep', 'full']) L(k); return { w: m.w, h: m.h }; }
  ctxReset(vg); vg.clearRect(0, 0, m.w + 4, m.h + 4); tintTo(vg, L('sil'), P.paper);
  if (o.full) { ctxReset(vg); vg.clearRect(0, 0, m.w + 4, m.h + 4); vg.drawImage(L('full'), 0, 0); return { w: m.w, h: m.h }; }
  for (const [lk, key] of PART_L) {
    const a = A[key] || 0; if (a <= 0) continue; const M = L(lk); if (!M) continue;
    const tr = o.tru && o.tru[key] !== undefined ? o.tru[key] : 1, off = (o.off && lk !== 'deep' && o.off[key]) || [0, 0];   // 진한 면 층(눈동자 등)은 제자리 — 같이 떨면 눈이 두 겹
    for (const [isTrue, wgt] of [[false, 1 - tr], [true, tr]]) {
      if (wgt <= 0) continue;
      ctxReset(tg); tg.clearRect(0, 0, m.w + 4, m.h + 4);
      if (isTrue && !o.dots) { tg.drawImage(L('full'), 0, 0); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(M, 0, 0); }
      else { const c = isTrue ? (lk === 'deep' ? KD : TRUE_C[key]) : (o.map || SWAP)[lk === 'deep' ? 'deep' : key]; tg.drawImage(M, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = o.dots ? tg.createPattern(dotPat(c), 'repeat') : rgb(c); tg.fillRect(0, 0, m.w, m.h); }
      vg.save(); vg.globalAlpha = a * wgt; vg.drawImage(TMP, 0, 0, m.w, m.h, off[0], off[1], m.w, m.h); vg.restore();
    }
  }
  if (!(A.k3 > 0.5)) tintTo(vg, L('tick'), P.tick);
  tintTo(vg, L('ink'), P.ink);
  return { w: m.w, h: m.h };
}
function charOwn(cut, fi, cx, bottom, hpx, J, A, o) { const d = verOwn(cut, fi, A, o), r = boxOf(cut, cx, bottom, hpx); jelly(VER, d.w, d.h, r, J); return r; }
function partGlow(cut, fi, key, col, r, J, a) {              // 그 부위가 제 색으로 번짐(알파 겹 · 블러 없음)
  if (DRY || a <= 0.01) return; const m = MK[cut], M = layer(cut, fi, key); if (!M) return;
  ctxReset(vg); vg.clearRect(0, 0, m.w + 4, m.h + 4); tintTo(vg, M, col);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const [s, al] of [[1.06, 0.10], [1.03, 0.16], [1.012, 0.22]]) { g.globalAlpha = al * a; jelly(VER, m.w, m.h, { x: r.x + r.w * (1 - s) / 2, y: r.y + r.h * (1 - s) / 2, w: r.w * s, h: r.h * s }, J); }
  g.restore();
}
const closeB = hpx => 560 + G.anchors.eye_from_bottom * hpx;  // 얼굴 클로즈업: 눈높이가 화면 y≈560 에 오는 발치 자리

/* ── 숏폼 구도 목록(전신 · 거대 글자 · 화면 속 화면 · 얼굴 · 2×2 · 동그라미로 열림 · 망점 · 둘 · 3×3 · 4×4) ── */
function popK3(b0, b) { return 1 + 0.07 * (1 - ez.p3o(prog(b, b0, b0 + 0.45))); }
function kick3(b) { return imp((b - Math.floor(b)) * SPB, 2.6, 0.35); }   // 박마다 한 번 튀는 값
function halfChar(cut, fi, cx, bottom, hpx, J, col) {        // 망점 실루엣(그 색) + 흰 선
  const m = MK[cut], L = k => layer(cut, fi, k);
  if (DRY) { L('sil'); L('ink'); return; }
  ctxReset(vg); vg.clearRect(0, 0, m.w + 4, m.h + 4); vg.drawImage(L('sil'), 0, 0); vg.globalCompositeOperation = 'source-in'; vg.fillStyle = vg.createPattern(dotPat(col), 'repeat'); vg.fillRect(0, 0, m.w, m.h); vg.globalCompositeOperation = 'source-over';
  tintTo(vg, L('ink'), P.paper);
  jelly(VER, m.w, m.h, boxOf(cut, cx, bottom, hpx), J);
}
function typeRow(b, a) {                                      // 거대 글자(캐릭터 이름) — 질감 · 천천히 흐름
  if (DRY) return; const s = 2.7;
  let x = -260 + ((b * 70) % 320);
  g.save(); g.globalAlpha = a;
  for (let rep = 0; rep < 2; rep++) for (const src of G.type_row) { const im = IMG['t_' + src]; if (!im) continue; const w = im.width * s, h = im.height * s; g.drawImage(tintedImg(src, im, P.paper), x, 430 - h / 2, w, h); x += w + 40; }
  g.restore();
}
const typeJobs = () => G.type_row.map(src => () => loadOnce('../build/assets/' + src).then(c => { IMG['t_' + src] = c; }));
function shot3(comp, cut, b0, b, f, A, o, col) {
  const J = { sq: 0.011 * Math.sin(TAU * b / 4) + 0.035 * kick3(b), sway: 0, ph: f }, pk = popK3(b0, b), fi = frameOf(cut, b, b0);
  if (comp === 'full') charOwn(cut, fi, 960, 1110, 1030 * pk, J, A, o);
  else if (comp === 'type') { typeRow(b, 0.9); charOwn(cut, fi, 960, 1100, 900 * pk, J, A, o); }
  else if (comp === 'pip') {
    const k = ez.backO(prog(b, b0, b0 + 0.5)), x = 380, y = 90, w = 1160, h = 900;
    g.save(); g.translate(960, y + h / 2); g.scale(k, k); g.translate(-960, -(y + h / 2));
    g.fillStyle = rgb(NIGHT2); g.fillRect(x, y, w, h); g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); charOwn(cut, fi, 960, y + h + 12, 780, J, A, o); g.restore();
    g.lineWidth = 10; g.strokeStyle = rgb(P.cream); g.strokeRect(x, y, w, h); g.restore();
  }
  else if (comp === 'face') { const hpx = 1800 * pk; charOwn(cut, fi, 960, closeB(hpx), hpx, J, A, o); }
  else if (comp === 'iris') {
    const R = lerp(960, 1400, ez.p2o(prog(b, b0, b0 + 0.8)));   // 넓게 열린 원에서 시작(처음부터 작은 원이면 박마다 화면 전체가 한 프레임 색으로 번쩍)
    g.fillStyle = rgb(col); g.fillRect(0, 0, W, H); grainOver(0.3);
    g.save(); g.beginPath(); g.arc(960, 640, R, 0, TAU); g.clip(); night(); charOwn(cut, fi, 960, 1110, 1030, J, A, o); g.restore();
    g.lineWidth = 16; g.strokeStyle = rgb(P.cream); g.beginPath(); g.arc(960, 640, R, 0, TAU); g.stroke();
  }
  else if (comp === 'halftone') halfChar(cut, fi, 960, 1110, 1060 * pk, J, col);
  else if (comp === 'pair') { charOwn(cut, fi, 640, 980, 760 * pk, J, A, o); charOwn(cut, frameOf(cut, b, b0 - 0.8), 1290, 1110, 820 * pk, { ...J, ph: f + 3 }, A, o); }
  else if (comp === 'grid' || comp === 'tile3' || comp === 'tile4') {
    const n = comp === 'grid' ? 2 : comp === 'tile3' ? 3 : 4, cw = W / n, ch = H / n;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const q = r * n + c, x = c * cw, y = r * ch;
      g.save(); g.beginPath(); g.rect(x, y, cw, ch); g.clip(); g.fillStyle = rgb((r + c) % 2 ? NIGHT2 : (o.full ? [K1, K2, K3][q % 3] : col)); g.fillRect(x, y, cw, ch);
      charOwn(cut, frameOf(cut, b, b0 - q * 0.34), x + cw / 2, y + ch + 6, ch * 0.92 * pk, { ...J, ph: f + q }, A, o); g.restore();
    }
    g.fillStyle = rgb(NIGHT); for (let k = 1; k < n; k++) { g.fillRect(k * cw - 5, 0, 10, H); g.fillRect(0, k * ch - 5, W, 10); }
  }
}
function rings3(b, col) {                                     // 박마다 퍼지는 고리
  for (let k = 0; k < 3; k++) { const bb = Math.floor(b) - k, t = (b - bb) * SPB; if (t < 0 || t > 0.9) continue; const p = ez.expoO(clamp(t / 0.9));
    g.save(); g.globalAlpha = 0.8 * (1 - p); g.lineWidth = 24 * (1 - p) + 4; g.strokeStyle = rgb(col); g.beginPath(); g.arc(960, 640, 480 + 520 * p, 0, TAU); g.stroke(); g.restore(); }
}

/* ── 페이지 시작: 빈 실행으로 필요한 층을 모아 읽고 → 준비 끝 표시 ── */
window.__hash = () => { const d = G2D.getImageData(0, 0, W, H).data; let h1 = 0x811c9dc5, h2 = 0x01000193; const u = new Uint32Array(d.buffer); for (let i = 0; i < u.length; i++) { h1 = Math.imul(h1 ^ u[i], 16777619); h2 = Math.imul(h2 + u[i], 2246822519) ^ (h2 >>> 13); } return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'); };
async function boot(N, draw, assets, extra = [], after = null) {
  window.__TOTAL = N;
  window.__seekF = f => draw(Math.max(0, Math.min(N - 1, f | 0)));
  DRY = new Set();
  for (let f = 0; f < N; f++) { try { draw(f); } catch (e) { window.__dryErr = String(e && e.stack || e); } }
  const need = [...DRY]; DRY = null;
  const jobs = need.map(key => () => { const [cut, i, k] = key.split('|'); return loadOnce('../' + MK[cut].src[+i] + '_' + k + '.png').then(c => { LAYER[key] = c; }); });
  for (const n of assets) jobs.push(() => loadOnce('../build/assets/' + n).then(c => { IMG[n.replace(/\.png$/, '')] = c; }));
  jobs.push(...extra);
  try { await pool(jobs, 6); if (after) after(); } catch (e) { window.__err = String(e); return; }
  window.__NEED = need.length;
  draw(0); draw(N - 1); draw(0);
  window.__ready = true;
}
