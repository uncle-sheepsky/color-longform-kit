/* 브라우저 판 캐릭터 준비 — tools/prep.py 를 그대로 옮긴 것(그림 1장 = 동작 하나 「main」).
   analyze(그림)  : 색 묶음(k-means++ · 결정론 시드 · 10묶음) → 역할(선 · 종이 · 진한 면 · 키컬러 셋) → 층 나눔 · 눈 · 그림 순서 지도 · 테두리 빛
   build(분석, 설정) : 칠하는 색 · 돌아오는 순서 · 이름 · 제목 · 글꼴로 장면이 읽는 준비물(PAL · GEO · KIT · MK · 그림들)을 메모리에 만든다.
   파이썬 판과 다른 점: 색 묶음의 무작위 시드 계열이 달라(numpy 대신 mulberry32) 경계가 애매한 그림에서는 묶음이 조금 다르게 나올 수 있다 ·
   색은 원본 대신 층 크기(최대 1240×1100)로 줄인 그림에서 뽑는다 · 확대 · 축소는 브라우저 캔버스(고품질)로 한다. */

export const W = 1920, H = 1080;
const MAX_W = 1240, MAX_H = 1100, CONF = 46;
const ROLE = { ink: 0, deep: 1, k1: 2, k2: 3, k3: 4, paper: 5 };
const KEYS = ['k1', 'k2', 'k3'];
const LAYERS = ['ink', 'deep', 'k1', 'k2', 'k3'];
const DEFAULT_OTHERS = ['#38836D', '#465CB2', '#FBB700', '#D6338A', '#5EA0D6', '#8060CE', '#7EBA40', '#20A0AA'];
const DEFAULT_OTHER_NAMES = ['MINT', 'NAVY', 'LEMON', 'MAGENTA', 'SKY', 'VIOLET', 'LIME', 'TEAL'];
const SLOTS = ['stand', 'ready', 'surprise', 'wave', 'shy', 'peek', 'tickle', 'play', 'play_lean', 'play_mash', 'play_bomb', 'cheer', 'thanks', 'congrats',
  'cold', 'eat', 'coffee', 'hot', 'no', 'hug', 'love', 'lift', 'gift', 'clap', 'end'];

// ── 작은 도구 ──────────────────────────────────────────────────────────────
export const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const rgb2hex = c => '#' + c.map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('').toUpperCase();
export function pyRound(x) { const f = Math.floor(x), d = x - f; if (d > 0.5) return f + 1; if (d < 0.5) return f; return f % 2 === 0 ? f : f + 1; }   // 파이썬 round(짝수 쪽)
const mix = (a, b, t) => a.map((x, i) => pyRound(x + (b[i] - x) * t));
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const tick = () => new Promise(r => setTimeout(r, 0));
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
export function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
const ctxOf = c => c.getContext('2d', { willReadFrequently: true });
function resized(src, w, h, sx = 0, sy = 0, sw = src.width, sh = src.height) {
  const c = mkCanvas(w, h), x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(src, sx, sy, sw, sh, 0, 0, w, h); return c;
}
function maskCanvas(mask, w, h, col = [255, 255, 255]) {       // 알파 = mask(0~255) · 색 = col
  const c = mkCanvas(w, h), x = ctxOf(c), id = x.createImageData(w, h), d = id.data;
  for (let i = 0, n = w * h; i < n; i++) { const a = mask[i]; if (!a) continue; const j = i * 4; d[j] = col[0]; d[j + 1] = col[1]; d[j + 2] = col[2]; d[j + 3] = a; }
  x.putImageData(id, 0, 0); return c;
}
function alphaCanvas(af, w, h, col = [255, 255, 255]) {         // af = 0~1 실수 → 알파(버림 · 파이썬 astype(uint8)과 같게)
  const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = (clamp01(af[i]) * 255) | 0; return maskCanvas(m, w, h, col);
}
const pixels = c => ctxOf(c).getImageData(0, 0, c.width, c.height).data;

// ── 형태 연산(scipy.ndimage 와 같은 정의) ──────────────────────────────────────
// 거리: 4이웃(L1) 또는 8이웃(체스판) · 두 번 훑기로 정확 · border = 그림 밖을 목표로 칠지
function chamfer(src, w, h, diag, border) {
  const n = w * h, INF = 1e9, d = new Int32Array(n);
  for (let i = 0; i < n; i++) d[i] = src[i] ? 0 : INF;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    let m = d[i]; if (m === 0) continue;
    if (x > 0 && d[i - 1] + 1 < m) m = d[i - 1] + 1;
    if (y > 0) { if (d[i - w] + 1 < m) m = d[i - w] + 1; if (diag) { if (x > 0 && d[i - w - 1] + 1 < m) m = d[i - w - 1] + 1; if (x < w - 1 && d[i - w + 1] + 1 < m) m = d[i - w + 1] + 1; } }
    d[i] = m;
  }
  for (let y = h - 1, i = n - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--, i--) {
    let m = d[i]; if (m === 0) continue;
    if (x < w - 1 && d[i + 1] + 1 < m) m = d[i + 1] + 1;
    if (y < h - 1) { if (d[i + w] + 1 < m) m = d[i + w] + 1; if (diag) { if (x < w - 1 && d[i + w + 1] + 1 < m) m = d[i + w + 1] + 1; if (x > 0 && d[i + w - 1] + 1 < m) m = d[i + w - 1] + 1; } }
    d[i] = m;
  }
  if (border) for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) { const b = Math.min(x + 1, w - x, y + 1, h - y); if (b < d[i]) d[i] = b; }
  return d;
}
function dilate(m, w, h, n, diag = false) { const d = chamfer(m, w, h, diag, false), o = new Uint8Array(w * h); for (let i = 0; i < o.length; i++) o[i] = d[i] <= n ? 1 : 0; return o; }
function erode(m, w, h, n, diag = false) { const inv = new Uint8Array(w * h); for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1; const d = chamfer(inv, w, h, diag, true), o = new Uint8Array(w * h); for (let i = 0; i < o.length; i++) o[i] = d[i] > n ? 1 : 0; return o; }
const opening = (m, w, h, n, diag = false) => dilate(erode(m, w, h, n, diag), w, h, n, diag);   // iterations=n(십자) 또는 (2n+1)² 네모(diag)
function label(m, w, h, conn8 = false) {                        // 연결 덩어리 번호(1부터 · 래스터 순서) + 크기 · 상자 [x0, y0, x1, y1)
  const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), sizes = [], boxes = [];
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (!m[i] || lab[i]) continue;
    cnt++; let sp = 0; stack[sp++] = i; lab[i] = cnt; let size = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (sp) {
      const j = stack[--sp], x = j % w, y = (j - x) / w; size++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!conn8 && dx && dy)) continue;
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx; if (m[k] && !lab[k]) { lab[k] = cnt; stack[sp++] = k; }
      }
    }
    sizes.push(size); boxes.push([x0, y0, x1 + 1, y1 + 1]);
  }
  return { lab, n: cnt, sizes, boxes };
}
function edtNearest(feat, w, h) {                               // 가장 가까운 목표 픽셀(유클리드 · 정확) 번호 · 없으면 −1
  const n = w * h, fy = new Int32Array(n).fill(-1);
  for (let x = 0; x < w; x++) {
    let last = -1;
    for (let y = 0; y < h; y++) { const i = y * w + x; if (feat[i]) last = y; fy[i] = last; }
    last = -1;
    for (let y = h - 1; y >= 0; y--) { const i = y * w + x; if (feat[i]) last = y; if (last >= 0 && (fy[i] < 0 || last - y < y - fy[i])) fy[i] = last; }
  }
  const out = new Int32Array(n).fill(-1), v = new Int32Array(w), z = new Float64Array(w + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w; let k = -1;
    for (let q = 0; q < w; q++) {
      const fq = fy[row + q]; if (fq < 0) continue;
      const gq = (y - fq) * (y - fq);
      if (k < 0) { k = 0; v[0] = q; z[0] = -Infinity; z[1] = Infinity; continue; }
      let s;
      for (;;) { const p = v[k], gp = (y - fy[row + p]) * (y - fy[row + p]); s = ((gq + q * q) - (gp + p * p)) / (2 * (q - p)); if (s <= z[k]) k--; else break; }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    if (k < 0) continue;
    let j = 0;
    for (let x = 0; x < w; x++) { while (z[j + 1] < x) j++; const p = v[j]; out[row + x] = fy[row + p] * w + p; }
  }
  return out;
}
function gaussBlur(src, w, h, sigma) {                          // scipy gaussian_filter(truncate 4 · 가장자리 반사) — 분리형
  const r = Math.ceil(4 * sigma), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const refl = (i, n) => { while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1; return i; };
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let t = -r; t <= r; t++) a += k[t + r] * src[y * w + refl(x + t, w)]; tmp[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let t = -r; t <= r; t++) a += k[t + r] * tmp[refl(y + t, h) * w + x]; out[y * w + x] = a; }
  return out;
}

// ── 1) 색 ───────────────────────────────────────────────────────────────────
const lumOf = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function palette(cr) {
  const w = cr.width, h = cr.height, d = pixels(cr), n = w * h;
  const op = new Uint8Array(n); let nop = 0;
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] > 200) { op[i] = 1; nop++; }
  // 면 안쪽(3×3 이웃의 채널별 최대 − 최소 < 24)만 — 선과 면 사이 섞인 가장자리 색이 묶음을 차지하지 않게
  const flat = new Uint8Array(n); let nflat = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!op[i]) continue;
    let rng3 = 0;
    for (let ch = 0; ch < 3; ch++) {
      let mx = 0, mn = 255;
      for (let dy = -1; dy <= 1; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)); for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)); const v = d[(yy * w + xx) * 4 + ch]; if (v > mx) mx = v; if (v < mn) mn = v; } }
      if (mx - mn > rng3) rng3 = mx - mn;
    }
    if (rng3 < 24) { flat[i] = 1; nflat++; }
  }
  const use = nflat > 0.2 * nop ? flat : op;
  let idxs = []; for (let i = 0; i < n; i++) if (use[i]) idxs.push(i);
  if (!idxs.length) throw new Error('불투명한 픽셀이 없습니다 — 투명 바탕 PNG 인지 확인해 주세요');
  if (idxs.length > 200000) { const r0 = rng(0), a = Int32Array.from(idxs); for (let i = 0; i < 200000; i++) { const j = i + Math.floor(r0() * (a.length - i)); const t = a[i]; a[i] = a[j]; a[j] = t; } idxs = Array.from(a.subarray(0, 200000)); }
  const M = idxs.length, px = new Float64Array(M * 3);
  idxs.forEach((p, i) => { px[i * 3] = d[p * 4]; px[i * 3 + 1] = d[p * 4 + 1]; px[i * 3 + 2] = d[p * 4 + 2]; });
  const K = 10, r1 = rng(1), C = [];
  const pick = i => [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]];
  C.push(pick(Math.floor(r1() * M)));
  const d2 = new Float64Array(M).fill(Infinity);
  for (let k = 1; k < K; k++) {                                 // k-means++ 시작점(결정론 시드) — 밝은 면이 넓어도 진한 색이 묶음을 갖게
    const c = C[k - 1]; let sum = 0;
    for (let i = 0; i < M; i++) { const a = px[i * 3] - c[0], b = px[i * 3 + 1] - c[1], e = px[i * 3 + 2] - c[2], v = a * a + b * b + e * e; if (v < d2[i]) d2[i] = v; sum += d2[i]; }
    let t = r1() * sum, j = 0; for (; j < M - 1; j++) { t -= d2[j]; if (t <= 0) break; }
    C.push(pick(j));
  }
  const lab = new Uint8Array(M);
  for (let it = 0; it < 30; it++) {
    const acc = new Float64Array(K * 3), cnt = new Float64Array(K);
    for (let i = 0; i < M; i++) {
      let bd = Infinity, bj = 0;
      for (let j = 0; j < K; j++) { const a = px[i * 3] - C[j][0], b = px[i * 3 + 1] - C[j][1], e = px[i * 3 + 2] - C[j][2], v = a * a + b * b + e * e; if (v < bd) { bd = v; bj = j; } }
      lab[i] = bj; acc[bj * 3] += px[i * 3]; acc[bj * 3 + 1] += px[i * 3 + 1]; acc[bj * 3 + 2] += px[i * 3 + 2]; cnt[bj]++;
    }
    for (let j = 0; j < K; j++) if (cnt[j]) C[j] = [acc[j * 3] / cnt[j], acc[j * 3 + 1] / cnt[j], acc[j * 3 + 2] / cnt[j]];
  }
  const cnt = new Float64Array(K); for (let i = 0; i < M; i++) cnt[lab[i]]++;
  const share = Array.from(cnt, v => v / M), lum = C.map(lumOf);
  const sat = C.map(c => { const mx = Math.max(...c), mn = Math.min(...c); return mx > 0 ? (mx - mn) / Math.max(mx, 1) : 0; });
  const hue = C.map(v => ((Math.atan2(Math.sqrt(3) * (v[1] - v[2]), 2 * v[0] - v[1] - v[2]) * 180 / Math.PI) % 360 + 360) % 360);
  const dist = (i, j) => Math.hypot(C[i][0] - C[j][0], C[i][1] - C[j][1], C[i][2] - C[j][2]);
  const all = [...Array(K).keys()];
  const ink = all.reduce((a, j) => lum[j] < lum[a] ? j : a, 0);
  const nearInk = new Set(all.filter(j => dist(j, ink) < 30));   // 선 색이 두 묶음으로 갈린 것 = 모두 선
  const lmax = Math.max(...lum), light = all.filter(j => lum[j] > 0.8 * lmax);
  const paper = light.reduce((a, j) => share[j] > share[a] ? j : a, light[0]);
  const byLum = all.slice().sort((a, b) => lum[a] - lum[b]);
  const dark2 = byLum.filter(j => !nearInk.has(j) && j !== paper && lum[j] < 110 && sat[j] < 0.75 && share[j] > 0.004);
  const deep = dark2.length ? dark2[0] : ink;                   // 진한 면 = 선보다 확실히 다른 어두운 색이 있을 때만
  const taken = new Set([...nearInk, paper, deep]);
  const cand = all.filter(j => !taken.has(j) && sat[j] >= 0.3 && share[j] > 0.003).sort((a, b) => share[b] * sat[b] - share[a] * sat[a]);
  const same = (j, k) => Math.min(Math.abs(hue[j] - hue[k]), 360 - Math.abs(hue[j] - hue[k])) <= 25 && Math.abs(lum[j] - lum[k]) < 40 && Math.abs(sat[j] - sat[k]) < 0.25;
  let keys = [];
  for (const j of cand) if (!keys.some(k => same(j, k))) keys.push(j);   // 같은 색의 밝기 차이(그림자)는 하나만 · 색상만 같고 밝기가 크게 다르면 다른 색
  const vivid = Math.min(3, keys.length);                       // 채도 0.3 이상의 뚜렷한 색 수(나머지 자리는 아래 rest 가 채움)
  const rest = all.filter(j => !taken.has(j) && !keys.includes(j) && !keys.some(k => same(j, k))).sort((a, b) => sat[b] - sat[a]);
  keys = keys.concat(rest).slice(0, 3);
  const role = {};
  keys.forEach((j, i) => { role[j] = 'k' + (i + 1); });
  nearInk.forEach(j => { role[j] = 'ink'; });
  role[paper] = 'paper';
  if (!(deep in role)) role[deep] = 'deep';
  for (const j of all) if (!(j in role)) {                      // 나머지 = 밝으면 종이 · 어두우면 선 · 가운데면 가장 가까운 키컬러
    if (lum[j] > 150 && sat[j] < 0.3) role[j] = 'paper';
    else if (lum[j] < 60 || !keys.length) role[j] = 'ink';
    else role[j] = role[keys.reduce((a, k) => dist(j, k) < dist(j, a) ? k : a, keys[0])];
  }
  const col = j => C[j].map(v => pyRound(v));
  const pal = { ink: col(ink), paper: col(paper), deep: deep !== ink ? col(deep) : C[ink].map((v, i) => pyRound(v * 0.6 + C[paper][i] * 0.4)) };
  const fallback = [[214, 51, 138], [70, 92, 178], [251, 183, 0]];  // 뚜렷한 색이 셋보다 적은 그림: 남는 자리는 빈 층(그 색은 화면에 나오지 않음)
  for (let i = 0; i < 3; i++) pal['k' + (i + 1)] = keys[i] !== undefined ? col(keys[i]) : fallback[i];
  return { pal, cen: all.map(j => ({ role: role[j], c: C[j] })), hasDeep: deep !== ink, nKeys: keys.length, vivid,
    clusters: all.map(j => ({ c: col(j), share: share[j], role: role[j] })) };
}

// ── 2) 층 ───────────────────────────────────────────────────────────────────
async function split(cr, cen, progress) {
  const w = cr.width, h = cr.height, W2 = w * 2, H2 = h * 2, N = W2 * H2;
  const a = pixels(resized(cr, W2, H2));
  const al = new Float32Array(N), idx = new Uint8Array(N), solid = new Uint8Array(N), conf = new Uint8Array(N);
  const Cc = cen.map(e => e.c), R = cen.map(e => ROLE[e.role]);
  let anyConf = false, anyEdge = false;
  for (let i = 0; i < N; i++) {
    const r = a[i * 4], g = a[i * 4 + 1], b = a[i * 4 + 2];
    al[i] = a[i * 4 + 3] / 255;
    let bd = Infinity, bj = 0;
    for (let j = 0; j < Cc.length; j++) { const x = r - Cc[j][0], y = g - Cc[j][1], z = b - Cc[j][2], v = x * x + y * y + z * z; if (v < bd) { bd = v; bj = j; } }
    idx[i] = bj;
    if (al[i] > 0.5) { solid[i] = 1; if (Math.sqrt(bd) < CONF) { conf[i] = 1; anyConf = true; } else anyEdge = true; }
  }
  await progress('층 나누는 중 (가장자리)');
  if (anyEdge && anyConf) {                                     // 섞인 가장자리 = 가장 가까운 확실한 픽셀의 층(선과 면 사이에 다른 색 테가 끼지 않게)
    const near = edtNearest(conf, W2, H2);
    for (let i = 0; i < N; i++) if (!conf[i] && near[i] >= 0) idx[i] = idx[near[i]];
  }
  const lab = new Uint8Array(N); for (let i = 0; i < N; i++) lab[i] = R[idx[i]];
  const inkM = new Uint8Array(N); for (let i = 0; i < N; i++) inkM[i] = lab[i] === ROLE.ink && solid[i] ? 1 : 0;
  const nearInk = dilate(inkM, W2, H2, 3);
  for (const k of ['deep', 'k1', 'k2', 'k3']) {                // 선 옆의 가는 테(선 · 종이 사이 섞인 색이 우연히 이 색에 가까운 것)는 선으로
    const rk = ROLE[k], m = new Uint8Array(N); let any = false;
    for (let i = 0; i < N; i++) if (lab[i] === rk && solid[i]) { m[i] = 1; any = true; }
    if (!any) continue;
    const op = opening(m, W2, H2, 2);
    for (let i = 0; i < N; i++) if (m[i] && !op[i] && nearInk[i]) lab[i] = ROLE.ink;
  }
  const cls = {};
  for (const k of LAYERS) { const m = new Uint8Array(N), rk = ROLE[k]; for (let i = 0; i < N; i++) m[i] = lab[i] === rk && solid[i] ? 1 : 0; cls[k] = m; }
  await progress('층 나누는 중 (작은 표시)');
  // tick = 다른 키컬러 면 안에 박힌 작은 키컬러 덩어리(둘레 6px 의 60% 이상이 다른 키컬러)
  let nsolid = 0; for (let i = 0; i < N; i++) nsolid += solid[i];
  const tickM = new Uint8Array(N);
  for (const k of KEYS) {
    const L = label(cls[k], W2, H2);
    for (let c = 0; c < L.n; c++) {
      const size = L.sizes[c]; if (!(0.00005 * nsolid < size && size < 0.01 * nsolid)) continue;   // 큰 면 · 몇 픽셀짜리 부스러기는 건너뜀
      const [bx0, by0, bx1, by1] = L.boxes[c], x0 = Math.max(0, bx0 - 8), y0 = Math.max(0, by0 - 8), x1 = Math.min(W2, bx1 + 8), y1 = Math.min(H2, by1 + 8), bw = x1 - x0, bh = y1 - y0;
      const dd = new Int16Array(bw * bh).fill(-1), q = new Int32Array(bw * bh); let qh = 0, qt = 0;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (L.lab[(y + y0) * W2 + x + x0] === c + 1) { dd[y * bw + x] = 0; q[qt++] = y * bw + x; }
      let ring = 0, other = 0;
      while (qh < qt) {
        const j = q[qh++], x = j % bw, y = (j - x) / bw, dj = dd[j];
        if (dj > 0) { ring++; const gi = (y + y0) * W2 + x + x0; if (KEYS.some(k2 => k2 !== k && cls[k2][gi])) other++; }
        if (dj >= 6) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue; const t = yy * bw + xx; if (dd[t] < 0) { dd[t] = dj + 1; q[qt++] = t; } }
      }
      if (ring && other / ring >= 0.6) for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (dd[y * bw + x] === 0) tickM[(y + y0) * W2 + x + x0] = 1;
    }
  }
  for (const k of KEYS) for (let i = 0; i < N; i++) if (tickM[i]) cls[k][i] = 0;
  const down = f => {                                           // 2배 크기의 0~1 값 → ×255 버림 → 상자 평균으로 줄임
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += f((2 * y + dy) * W2 + 2 * x + dx); o[y * w + x] = Math.round(s / 4); }
    return o;
  };
  const out = { sil: down(i => (clamp01(al[i]) * 255) | 0), tick: down(i => tickM[i] ? (al[i] * 255) | 0 : 0) };
  for (const k of LAYERS) out[k] = down(i => cls[k][i] ? (al[i] * 255) | 0 : 0);
  return out;
}

// 선 픽셀을 「선을 따라 그려지는 순서」로(덩어리마다 가장 위 점에서 너비 우선 · 덩어리는 위 → 아래 · 몫 = 크기 비율) → R(상위) · G(하위) · A = 선 여부
function orderMap(inkA, w, h) {
  const n = w * h, ink = new Uint8Array(n); for (let i = 0; i < n; i++) ink[i] = inkA[i] > 8 ? 1 : 0;
  const L = label(ink, w, h, true), order = new Float64Array(n);
  if (L.n) {
    const total = L.sizes.reduce((a, b) => a + b, 0); let off = 0;
    const ord = [...Array(L.n).keys()].sort((a, b) => (Math.floor(L.boxes[a][1] / 40) - Math.floor(L.boxes[b][1] / 40)) || (L.boxes[a][0] - L.boxes[b][0]));
    const dist = new Int32Array(n).fill(-1), q = new Int32Array(n);
    for (const k of ord) {
      const [x0, y0, x1, y1] = L.boxes[k]; let st = -1;
      for (let y = y0; y < y1 && st < 0; y++) for (let x = x0; x < x1; x++) if (L.lab[y * w + x] === k + 1) { st = y * w + x; break; }
      let qh = 0, qt = 0, dmax = 0; q[qt++] = st; dist[st] = 0;
      while (qh < qt) {
        const j = q[qh++], x = j % w, y = (j - x) / w, dj = dist[j] + 1;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const t = yy * w + xx; if (L.lab[t] === k + 1 && dist[t] < 0) { dist[t] = dj; if (dj > dmax) dmax = dj; q[qt++] = t; } }
      }
      const share = L.sizes[k] / total;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const t = y * w + x; if (L.lab[t] === k + 1) order[t] = off + share * dist[t] / Math.max(1, dmax); }
      off += share;
    }
  }
  const c = mkCanvas(w, h), x = ctxOf(c), id = x.createImageData(w, h), d = id.data;
  for (let i = 0; i < n; i++) { if (!ink[i]) continue; const v = Math.max(0, Math.min(65535, Math.floor(order[i] * 65535))); d[i * 4] = v >> 8; d[i * 4 + 1] = v & 255; d[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0); return c;
}

// ── 3) 기준점 ────────────────────────────────────────────────────────────────
function findEyes(lay, w, h) {                                  // 진한 채움 덩어리 가운데 위쪽 · 비슷한 크기 · 같은 높이의 한 쌍
  const n = w * h, dark = new Uint8Array(n); let top = h, bot = -1, silSum = 0;
  for (let i = 0; i < n; i++) { if (lay.sil[i] > 128) { const y = (i / w) | 0; if (y < top) top = y; if (y > bot) bot = y; silSum++; } dark[i] = lay.ink[i] > 128 || lay.deep[i] > 128 ? 1 : 0; }
  if (bot < 0) return [];
  const hh = bot - top + 1, r = Math.max(2, Math.floor(0.011 * hh));
  const core = opening(dark, w, h, r, true), L = label(core, w, h), blobs = [];
  for (let c = 0; c < L.n; c++) {
    const [x0, y0, x1, y1] = L.boxes[c], a = L.sizes[c], bw = x1 - x0, bh = y1 - y0;
    let sx = 0, sy = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (L.lab[y * w + x] === c + 1) { sx += x; sy += y; }
    const cx = sx / a, cy = sy / a;
    if (!(0.0002 * silSum < a && a < 0.02 * silSum) || !(0.35 < bw / bh && bw / bh < 2.8) || cy > top + 0.75 * hh) continue;
    blobs.push([cx, cy, a]);
  }
  let best = [], score = 1e18;
  for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) {
    const [x1, y1, a1] = blobs[i], [x2, y2, a2] = blobs[j];
    if (Math.abs(y1 - y2) > 0.08 * hh || Math.abs(x1 - x2) < 0.06 * hh) continue;
    const s = Math.abs(Math.log(a1 / a2)) * 3 + Math.abs(y1 - y2) / hh * 10 + (y1 + y2) / 2 / hh;
    if (s < score) { score = s; best = [[x1, y1], [x2, y2]].sort((p, q) => p[0] - q[0] || p[1] - q[1]); }
  }
  return best;
}
function pieceOf(lay, w, h, pal) {                              // 가장 큰 진한 면 덩어리(없으면 가장 큰 키컬러 덩어리) → 조각 · 회전 중심(가장 안쪽 점)
  let silSum = 0; for (let i = 0; i < w * h; i++) if (lay.sil[i] > 128) silSum++;
  for (const k of ['deep', 'k1', 'k2', 'k3']) {
    const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = lay[k][i] > 128 ? 1 : 0;
    const L = label(m, w, h); if (!L.n) continue;
    let ci = 0; for (let c = 1; c < L.n; c++) if (L.sizes[c] > L.sizes[ci]) ci = c;
    if (L.sizes[ci] < 0.004 * silSum) continue;
    const [bx0, by0, bx1, by1] = L.boxes[ci], x0 = Math.max(0, bx0 - 4), y0 = Math.max(0, by0 - 4), x1 = Math.min(w, bx1 + 4), y1 = Math.min(h, by1 + 4), pw = x1 - x0, ph = y1 - y0;
    const comp = new Uint8Array(pw * ph); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) comp[y * pw + x] = L.lab[(y + y0) * w + x + x0] === ci + 1 ? 1 : 0;
    const dl = dilate(comp, pw, ph, 2), alpha = new Uint8Array(pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) if (dl[y * pw + x]) alpha[y * pw + x] = lay[k][(y + y0) * w + x + x0];
    const bg = new Uint8Array(pw * ph); for (let i = 0; i < bg.length; i++) bg[i] = comp[i] ? 0 : 1;   // 구멍 메움: 테두리에서 닿는 바탕만 바탕
    const outside = new Uint8Array(pw * ph), q = []; for (let x = 0; x < pw; x++) for (const y of [0, ph - 1]) if (bg[y * pw + x]) q.push(y * pw + x); for (let y = 0; y < ph; y++) for (const x of [0, pw - 1]) if (bg[y * pw + x]) q.push(y * pw + x);
    for (const s of q) outside[s] = 1;
    while (q.length) { const j = q.pop(), x = j % pw, y = (j - x) / pw; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= pw || yy >= ph) continue; const t = yy * pw + xx; if (bg[t] && !outside[t]) { outside[t] = 1; q.push(t); } } }
    const near = edtNearest(outside, pw, ph); let bi = 0, bd = -1;
    for (let i = 0; i < near.length; i++) { if (outside[i] || near[i] < 0) continue; const x = i % pw, y = (i - x) / pw, nx = near[i] % pw, ny = (near[i] - nx) / pw, dd = (x - nx) ** 2 + (y - ny) ** 2; if (dd > bd) { bd = dd; bi = i; } }
    return { piece: maskCanvas(alpha, pw, ph, pal[k === 'deep' ? 'deep' : k]), eye: [bi % pw, Math.floor(bi / pw)], layer: k };
  }
  return { piece: maskCanvas(lay.sil.map(v => v > 128 ? 255 : 0), w, h, pal.ink), eye: [w >> 1, h >> 1], layer: 'sil' };
}

// ── 글자 ─────────────────────────────────────────────────────────────────────
function glyph(ch, font, cap, color, PXF, SS = 3) {             // 글자 하나 → 잘라 낸 그림(가장자리 여백 6px)
  if (!font) {                                                  // 픽셀 글꼴: 5×7 칸을 cap/7 크기 네모로
    const gl = PXF[ch.toUpperCase()] || PXF['?'], px = Math.max(2, Math.floor(cap / 7)), c = mkCanvas(5 * px + 12, 7 * px + 12), x = c.getContext('2d');
    x.fillStyle = `rgb(${color.join(',')})`;
    for (let i = 0; i < 35; i++) if (gl[i] === '1') x.fillRect(6 + (i % 5) * px, 6 + Math.floor(i / 5) * px, px, px);
    return c;
  }
  const t = mkCanvas(8, 8).getContext('2d'); t.font = `${cap * SS}px "${font}"`;
  const m = t.measureText(ch), l = Math.ceil(m.actualBoundingBoxLeft), r = Math.ceil(m.actualBoundingBoxRight), a = Math.ceil(m.actualBoundingBoxAscent), d = Math.ceil(m.actualBoundingBoxDescent), pad = 6 * SS;
  const big = mkCanvas(Math.max(1, l + r) + 2 * pad, Math.max(1, a + d) + 2 * pad), x = big.getContext('2d');
  x.font = t.font; x.textBaseline = 'alphabetic'; x.fillStyle = `rgb(${color.join(',')})`; x.fillText(ch, pad + l, pad + a);
  return resized(big, Math.max(1, Math.floor(big.width / SS)), Math.max(1, Math.floor(big.height / SS)));
}

// ── 빛 조각 · 끝 화면 바탕(캐릭터와 무관 — 한 번만 만듦) ─────────────────────────────
let LIGHT = null;
const SLOPE = -0.4083969465648855, X0 = 1586.2786259541986;    // 끝 화면 경계(흰 빛줄): 오른쪽 위 → 왼쪽 아래로 캐릭터 한가운데를 지남
const SUN = { cx: 1607.55, cy: 676.62, r: 743.53 }, WAVE = { cx: 2278.72, cy: 5398.83, r: 4829.74 };
function circleAlpha(cx, cy, r) { const a = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r; a[y * W + x] = clamp01(0.5 - d); } return a; }
function lightAssets(cream, orange) {
  const key = cream.join() + '|' + orange.join(); if (LIGHT && LIGHT.key === key) return LIGHT;
  const out = { key };
  let a = new Float32Array(256 * 256); for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) a[y * 256 + x] = Math.exp(-((Math.hypot(x - 128, y - 128) / 42) ** 2) / 2);
  out.glow = alphaCanvas(a, 256, 256);                                                           // 둥근 빛(가우시안)
  const Wg = 1600, Hg = 1400; a = new Float32Array(Wg * Hg);
  for (let y = 0; y < Hg; y++) for (let x = 0; x < Wg; x++) { const d = Math.abs((x - 800) - SLOPE * (y - 700)) / Math.sqrt(1 + SLOPE * SLOPE); a[y * Wg + x] = 0.85 * Math.exp(-((d / 5) ** 2) / 2) + 0.45 * Math.exp(-((d / 26) ** 2) / 2) + 0.18 * Math.exp(-((d / 90) ** 2) / 2); }
  out.streak_glow = alphaCanvas(a, Wg, Hg);                                                      // 경계 빛줄 번짐
  a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { const width = 110 + 0.42 * y; for (let x = 0; x < W; x++) { const cone = Math.exp(-(((x - W / 2) / width) ** 2) * 1.6) * Math.pow(clamp01(y / H), 0.55) * Math.exp(-(((y - H * 0.55) / (H * 0.95)) ** 2)); const pool = Math.exp(-((((x - W / 2) / 560) ** 2) + (((y - H * 0.97) / 90) ** 2)) / 2) * 0.8; a[y * W + x] = cone + pool; } }
  out.cone = alphaCanvas(a, W, H);                                                               // 핀 조명 원뿔
  const r11 = rng(11), gm = new Uint8Array(512 * 512); for (let i = 0; i < gm.length; i++) gm[i] = Math.min(40, Math.abs(gauss(r11)) * 14) | 0;
  out.grain = maskCanvas(gm, 512, 512, [40, 40, 40]);                                            // 종이 결
  const r7 = rng(7), base = mkCanvas(W, H), bx = ctxOf(base), id = bx.createImageData(W, H), d = id.data;   // 크림 종이(가장자리 살짝 어둡게 · 잔결)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const vig = Math.hypot((x - 960) / 960, (y - 540) / 540), k = 1 - 0.05 * clamp01(vig - 0.4), nz = gauss(r7) * 2.2, j = (y * W + x) * 4; for (let ch = 0; ch < 3; ch++) d[j + ch] = Math.max(0, Math.min(255, cream[ch] * k + nz)) | 0; d[j + 3] = 255; }
  bx.putImageData(id, 0, 0); out.bg_base = base;
  out.sunA = circleAlpha(SUN.cx, SUN.cy, SUN.r); out.waveA = circleAlpha(WAVE.cx, WAVE.cy, WAVE.r);
  out.bg_sun = alphaCanvas(out.sunA, W, H, orange);
  LIGHT = out; return out;
}

// ── 분석(색 · 층 · 눈 · 순서 지도 — 칠하는 색과 무관) ─────────────────────────────
export async function analyze(img, onStep = () => {}) {
  const progress = async s => { onStep(s); await tick(); };
  await progress('그림 읽는 중');
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height, src = mkCanvas(sw, sh); src.getContext('2d').drawImage(img, 0, 0);
  const sd = pixels(src); let u = null, transparent = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const al = sd[(y * sw + x) * 4 + 3]; if (al < 250) transparent++; if (al > 40) { if (!u) u = [x, y, x + 1, y + 1]; else { if (x < u[0]) u[0] = x; if (y < u[1]) u[1] = y; if (x + 1 > u[2]) u[2] = x + 1; if (y + 1 > u[3]) u[3] = y + 1; } } }
  if (!u) throw new Error('빈 그림입니다 — 투명 바탕 PNG 인지 확인해 주세요');
  const warnings = [];
  if (transparent < 0.02 * sw * sh) warnings.push('바탕이 투명하지 않은 것 같습니다. 투명 바탕 PNG 를 넣으면 캐릭터만 깔끔하게 나옵니다.');
  const pad = Math.max(6, pyRound(0.008 * Math.max(u[2] - u[0], u[3] - u[1])));
  const box = [Math.max(0, u[0] - pad), Math.max(0, u[1] - pad), Math.min(sw, u[2] + pad), Math.min(sh, u[3] + pad)], bw = box[2] - box[0], bh = box[3] - box[1];
  const s = Math.min(MAX_W / bw, MAX_H / bh), w = Math.max(1, pyRound(bw * s)), h = Math.max(1, pyRound(bh * s));
  if (s > 1.05) warnings.push(`캐릭터 그림이 작아 ${s.toFixed(1)}배로 키워 씁니다. 키 1,000px 이상인 그림을 넣으면 얼굴 클로즈업이 또렷해집니다.`);
  const cr = resized(src, w, h, box[0], box[1], bw, bh);
  await progress('색 뽑는 중 (k-means++ · 10묶음)');
  const P = palette(cr);
  if (P.nKeys < 3) warnings.push(`색 묶음이 ${P.nKeys}가지만 보입니다. 비는 색 자리는 화면에 나오지 않습니다(색 칸에서 칠할 색은 고를 수 있음).`);
  else if (P.vivid < 3) warnings.push(`뚜렷한 색(채도 높은 색)이 ${P.vivid}가지만 보여, 색 ${P.vivid + 1}~3 자리는 그림에서 비슷한 면(종이 · 회색에 가까운 색)을 대신 썼습니다. 색 칸에서 칠할 색을 직접 고르거나, 색이 또렷한 그림을 넣어 보세요.`);
  await progress('층 나누는 중');
  const lay = await split(cr, P.cen, progress);
  await progress('눈 · 그림 순서 찾는 중');
  const eyes = findEyes(lay, w, h);
  const fit = {};
  for (const k of KEYS) { let s0 = 0, sx = 0, sy = 0; for (let i = 0; i < w * h; i++) { const v = lay[k][i]; if (!v) continue; s0 += v; sx += v * (i % w); sy += v * Math.floor(i / w); } fit[k] = s0 > 50 ? [Math.round(sx / s0 / w * 1000) / 1000, Math.round(sy / s0 / h * 1000) / 1000] : [0.5, 0.5]; }
  const tk = []; for (let i = 0; i < w * h; i++) if (lay.tick[i] > 128) tk.push(i);
  let tickMedian = null;
  if (tk.length > 20) { const cd = pixels(cr); tickMedian = [0, 1, 2].map(ch => { const v = tk.map(i => cd[i * 4 + ch]).sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : Math.floor((v[m - 1] + v[m]) / 2); }); }
  const order = orderMap(lay.ink, w, h);
  await progress('테두리 빛 굽는 중');
  // 실루엣 테두리 빛(빛 구간: 캐릭터를 화면 가운데 · 키 720 · 발치 H+24 에)
  const s_ = 720 / h, w_ = pyRound(w * s_), h_ = pyRound(h * s_), ox = pyRound(W / 2 - w_ / 2), oy = pyRound(H + 24 - h_);
  const silC = resized(maskCanvas(lay.sil, w, h), w_, h_), sd2 = pixels(silC), S = new Float32Array(W * H);
  for (let y = 0; y < h_; y++) { const yy = y + oy; if (yy < 0 || yy >= H) continue; for (let x = 0; x < w_; x++) { const xx = x + ox; if (xx < 0 || xx >= W) continue; S[yy * W + xx] = sd2[(y * w_ + x) * 4 + 3] / 255; } }
  let ry0 = H, ry1 = 0, rx0 = W, rx1 = 0; const rim = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = S[y * W + x] - (y >= 14 ? S[(y - 14) * W + x] : 0); if (v > 0) { rim[y * W + x] = Math.min(1, v); if (y < ry0) ry0 = y; if (y > ry1) ry1 = y; if (x < rx0) rx0 = x; if (x > rx1) rx1 = x; } }
  const rimA = new Float32Array(W * H);
  if (ry1 >= ry0) {                                             // 테두리 둘레(가우시안 반경 48 + 여유)만 흐림
    const M = 60, X0r = Math.max(0, rx0 - M), Y0r = Math.max(0, ry0 - M), X1r = Math.min(W, rx1 + M + 1), Y1r = Math.min(H, ry1 + M + 1), cw = X1r - X0r, ch = Y1r - Y0r, sub = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) sub[y * cw + x] = rim[(y + Y0r) * W + x + X0r];
    const g1 = gaussBlur(sub, cw, ch, 2.5), g2 = gaussBlur(sub, cw, ch, 12);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) rimA[(y + Y0r) * W + x + X0r] = clamp01(g1[y * cw + x] * 1.1 + g2[y * cw + x] * 0.8);
  }
  const s6_rim = alphaCanvas(rimA, W, H);
  return { cr, w, h, pal0: P.pal, hasDeep: P.hasDeep, clusters: P.clusters, nKeys: P.nKeys, lay, eyes, fit, tickMedian, order, s6_rim, warnings, scaleUp: s };
}

// ── 준비물 만들기(칠하는 색 · 순서 · 이름 · 글꼴) ────────────────────────────────
/* opts = { keyOrder: [0,1,2](분석의 k 번호 → 새 k1 · k2 · k3) · colors: { ink, paper, deep, k1, k2, k3 }(새 이름 기준 [r,g,b] · 없으면 뽑힌 색)
           name · title: ['{name}', 'IN COLOR'] · partNames: { k1, k2, k3 } · font: 글꼴 이름(document.fonts 에 올린 것) 또는 null · PXF: 픽셀 글꼴 표 } */
export async function build(A, opts, onStep = () => {}) {
  const progress = async s => { onStep(s); await tick(); };
  const { w, h } = A, order = opts.keyOrder || [0, 1, 2];
  const lay = { sil: A.lay.sil, ink: A.lay.ink, deep: A.lay.deep, tick: A.lay.tick };
  KEYS.forEach((k, i) => { lay[k] = A.lay['k' + (order[i] + 1)]; });
  const pal = { ink: A.pal0.ink, paper: A.pal0.paper, deep: A.pal0.deep };
  KEYS.forEach((k, i) => { pal[k] = A.pal0['k' + (order[i] + 1)]; });
  for (const [k, v] of Object.entries(opts.colors || {})) if (v && k in pal) pal[k] = v.slice();
  pal.tick = A.tickMedian || pal.k1;
  const dm = new Uint8Array(w * h); for (let i = 0; i < dm.length; i++) dm[i] = lay.deep[i] > 128 ? 1 : 0;
  const dmask = dilate(dm, w, h, 6), touch = {};
  for (const k of KEYS) { let c = 0; for (let i = 0; i < dm.length; i++) if (dmask[i] && lay[k][i] > 128) c++; touch[k] = c; }
  const deepFollows = A.hasDeep && KEYS.some(k => touch[k] > 0) ? KEYS.reduce((a, k) => touch[k] > touch[a] ? k : a, 'k1') : 'k2';
  pal.night = [26, 11, 5]; pal.night2 = [42, 19, 10];
  pal.others = (opts.otherColors || DEFAULT_OTHERS).map(c => typeof c === 'string' ? hex2rgb(c) : c);
  pal.blocks = [pal.paper, mix(pal.deep, pal.paper, 0.25), mix(pal.k1, pal.k2, 0.5), mix(pal.k2, pal.paper, 0.4), mix(pal.k1, pal.k3, 0.5)];

  const store = new Map(), put = (k, c) => store.set(k, c);
  await progress('층 그림 만드는 중');
  for (const k of ['sil', 'ink', 'deep', 'k1', 'k2', 'k3', 'tick']) put(`mask/main/00_${k}.png`, maskCanvas(lay[k], w, h));
  put('mask/main/00_full.png', A.cr);
  put('order/stand_0.png', A.order);
  put('assets/s6_rim.png', A.s6_rim);

  // 기준점(층 px → 비율)
  const an = {}, eyes = opts.eyes && opts.eyes.length === 2 ? opts.eyes : A.eyes;   // opts.eyes = 사람이 그림에서 직접 찍은 두 눈(층 px)
  let ex, ey, eyc;
  if (eyes.length) { [ex, ey] = eyes[0]; eyc = (eyes[0][1] + eyes[1][1]) / 2; } else { ex = w * 0.42; ey = h * 0.38; eyc = h * 0.38; }
  an.eye_from_bottom = Math.round((1 - eyc / h) * 10000) / 10000;
  const rw = 900 * w / h;
  an.eye_zoom = [Math.round((960 - rw / 2 + ex / w * rw) * 10) / 10, Math.round((1075 - 900 + ey / h * 900) * 10) / 10];
  an.fit = {}; KEYS.forEach((k, i) => { an.fit[k] = A.fit['k' + (order[i] + 1)]; });
  const pc = pieceOf(lay, w, h, pal);
  put('assets/horn.png', pc.piece);
  an.horn_eye = pc.eye; an.horn_scale = Math.round(1448 / Math.max(pc.piece.width, pc.piece.height) * 1000) / 1000;

  await progress('끝 화면 만드는 중');
  const E = opts.end || {}, cream = hex2rgb(E.cream || '#FDDCA6'), orange = hex2rgb(E.sun || '#FD9702');
  const waveC = E.wave ? hex2rgb(E.wave) : pal.k1, dotC = E.dots ? hex2rgb(E.dots) : waveC;
  const LA = lightAssets(cream, orange);
  for (const k of ['glow', 'streak_glow', 'cone', 'grain', 'bg_base', 'bg_sun']) put(`assets/${k}.png`, LA[k]);
  const bgWave = alphaCanvas(LA.waveA, W, H, waveC); put('assets/bg_wave.png', bgWave);
  const plate = mkCanvas(W, H), pg = plate.getContext('2d');
  pg.drawImage(LA.bg_base, 0, 0); pg.drawImage(LA.bg_sun, 0, 0); pg.drawImage(bgWave, 0, 0);
  pg.globalAlpha = 0.35; pg.drawImage(LA.streak_glow, pyRound(X0 + SLOPE * 700 - 800), 0); pg.globalAlpha = 1;
  put('assets/plate.png', plate);
  const dots = [], boxes = [], dimg = mkCanvas(560, 400), dg = dimg.getContext('2d');   // 망점(왼쪽 위 모서리에서 멀어질수록 작아짐)
  dg.fillStyle = `rgb(${dotC.join(',')})`;
  for (let j = 0, y = 4; y < 400; j++, y += 13) for (let x = 4 + (j % 2) * 13; x < 560; x += 26) {
    const rr = 11.5 * (1 - Math.hypot(x / 560, y / 400)); if (rr < 1) continue;
    dg.beginPath(); dg.arc(x, y, rr, 0, Math.PI * 2); dg.fill();
    dots.push([x, y, Math.round(rr * 100) / 100]); boxes.push([Math.trunc(x - rr - 3), Math.trunc(y - rr - 3), Math.trunc(2 * rr + 7), Math.trunc(2 * rr + 7), x, y]);
  }
  put('assets/dots.png', dimg);
  // 끝 자세(반은 선화 · 반은 색) · 박수 준비 자세 — 화면 키 836 · 가운데 1390 · 발치 952
  const line = mkCanvas(w, h), lg = line.getContext('2d');
  lg.drawImage(maskCanvas(lay.sil, w, h, pal.paper), 0, 0); lg.drawImage(maskCanvas(lay.tick, w, h, pal.tick), 0, 0); lg.drawImage(maskCanvas(lay.ink, w, h, pal.ink), 0, 0);
  const ps = Math.min(836 / h, 880 / w), pw = pyRound(w * ps), ph = pyRound(h * ps), ebox = { x: pyRound(1390 - pw / 2), y: pyRound(952 - ph), w: pw, h: ph };
  const f2 = resized(A.cr, pw, ph), l2 = resized(line, pw, ph);
  put('assets/end_color.png', f2); put('assets/end_line.png', l2); put('assets/clap_full.png', f2); put('assets/clap_line.png', l2);
  const fd = pixels(f2), ld = pixels(l2), sp = mkCanvas(pw, ph), sg = ctxOf(sp), sid = sg.createImageData(pw, ph);
  for (let y = 0; y < ph; y++) { const lx = X0 + SLOPE * (y + ebox.y) - ebox.x; for (let x = 0; x < pw; x++) { const j = (y * pw + x) * 4, s0 = x < lx ? ld : fd; sid.data[j] = s0[j]; sid.data[j + 1] = s0[j + 1]; sid.data[j + 2] = s0[j + 2]; sid.data[j + 3] = s0[j + 3]; } }
  sg.putImageData(sid, 0, 0); put('assets/end_split.png', sp);
  const cbox = { ...ebox };
  an.hands = [Math.round((cbox.x + cbox.w / 2) * 10) / 10, Math.round((cbox.y + 0.58 * cbox.h) * 10) / 10];

  await progress('제목 글자 만드는 중');
  const name = (opts.name || 'HELLO').trim() || 'HELLO';
  const lines = (opts.title || ['{name}', 'IN COLOR']).map(l => l.replace('{name}', name));
  const titleC = E.title ? hex2rgb(E.title) : mix(pal.ink, pal.deep, 0.4);
  const multi = [pal.k1, pal.k2, pal.others[0], pal.k3, pal.others[3]];
  const words = []; lines.forEach((ln, li) => ln.split(/\s+/).filter(Boolean).forEach((wd, wi) => words.push([li, wi])));
  const last = words.length ? words[words.length - 1] : null;
  const caps = [230, 165, 150, 150, 150, 150, 150, 150, 150, 150];
  let letters = [], beats = [], b = 229.0, prevWord = null, ytop = 334;
  lines.forEach((ln, li) => {
    const cap = caps[li] || 150, ims = [];
    ln.split(/\s+/).filter(Boolean).forEach((wd, wi) => { [...wd].forEach((ch, ci) => { const isLast = last && li === last[0] && wi === last[1], col = isLast ? multi[ci % multi.length] : titleC; ims.push([wi, glyph(ch, opts.font, cap, col, opts.PXF), col, isLast]); }); });
    if (!ims.length) return;
    const gap = 4, wgap = cap * 0.28, nw = new Set(ims.map(e => e[0])).size;
    const total = ims.reduce((a, e) => a + e[1].width, 0) + gap * (ims.length - 1) + wgap * (nw - 1);
    const k = Math.min(1, 830 / total, 250 / Math.max(...ims.map(e => Math.max(e[1].width, e[1].height))));
    let x = 120, pwi = null;
    for (let [wi, im, col, isLast] of ims) {
      if (k < 1) im = resized(im, Math.max(1, pyRound(im.width * k)), Math.max(1, pyRound(im.height * k)));
      if (pwi !== null && wi !== pwi) x += wgap * k;
      const fn = `title_${String(letters.length).padStart(2, '0')}.png`; put('assets/' + fn, im);
      letters.push({ src: fn, x: pyRound(x), y: pyRound(ytop + (cap * k - im.height) + 6), w: im.width, h: im.height, rgb: col, fill: isLast ? mix(pal.ink, pal.paper, 0.1) : mix(titleC, pal.paper, 0.45) });
      if (prevWord !== null) b += prevWord[0] === li && prevWord[1] === wi ? 0.9 : 1.5;
      beats.push(Math.round(b * 1000) / 1000); prevWord = [li, wi];
      x += im.width + gap * k; pwi = wi;
    }
    ytop += cap * k + 40;
  });
  if (beats.length && beats[beats.length - 1] > 239.2) { const s0 = (239.2 - 229) / (beats[beats.length - 1] - 229); beats = beats.map(bb => Math.round((229 + (bb - 229) * s0) * 1000) / 1000); }   // 글자가 많으면 229~239.2 박 안으로
  const keep = letters.map((p, i) => p.x + p.w < 976 ? i : -1).filter(i => i >= 0);
  letters = keep.map(i => letters[i]); beats = keep.map(i => beats[i]);
  const trow = [];                                              // 이름 큰 글자(거대 글자 장면 · 흰색 — 장면에서 색을 입힘)
  [...name].slice(0, 6).forEach((ch, i) => { if (ch === ' ') return; const fn = `type_${String(i).padStart(2, '0')}.png`; put('assets/' + fn, glyph(ch, opts.font, 200, [255, 255, 255], opts.PXF)); trow.push(fn); });

  // 색종이 셋(모양 · 남의 색) + 박수 자국 둘
  const conf = [];
  const crop = c => { const d = pixels(c); let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } if (x1 < 0) return c; const o = mkCanvas(x1 - x0 + 1, y1 - y0 + 1); o.getContext('2d').drawImage(c, -x0, -y0); return o; };
  const shape = (kind, col, s = 76) => {
    const c = mkCanvas(s * 3, s * 3), x = c.getContext('2d'); x.fillStyle = x.strokeStyle = `rgb(${col.join(',')})`;
    if (kind === 0) { x.beginPath(); [[0.3, 0.9], [2.6, 0.3], [2.75, 1.0], [0.45, 1.6]].forEach(([a, b2], i) => i ? x.lineTo(s * a, s * b2) : x.moveTo(s * a, s * b2)); x.closePath(); x.fill(); }
    else if (kind === 1) { x.beginPath(); [[1.5, 0.2], [2.8, 2.6], [0.3, 2.3]].forEach(([a, b2], i) => i ? x.lineTo(s * a, s * b2) : x.moveTo(s * a, s * b2)); x.closePath(); x.fill(); }
    else { x.lineWidth = Math.trunc(s * 0.55); x.lineJoin = 'round'; x.lineCap = 'butt'; x.beginPath(); for (let i = 0; i < 30; i++) { const t = i / 29, px = s * (0.3 + 2.4 * t), py = s * (1.5 + 0.7 * Math.sin(t * 7)); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
    return crop(resized(c, s, s));
  };
  const mark = (ang, col) => {
    const c = mkCanvas(180, 180), x = c.getContext('2d'), dx = Math.cos(ang), dy = Math.sin(ang); x.strokeStyle = x.fillStyle = `rgb(${col.join(',')})`; x.lineWidth = 26;
    x.beginPath(); x.moveTo(90 - 60 * dx, 90 - 60 * dy); x.lineTo(90 + 60 * dx, 90 + 60 * dy); x.stroke();
    for (const e of [-1, 1]) { x.beginPath(); x.arc(90 + e * 60 * dx, 90 + e * 60 * dy, 13, 0, Math.PI * 2); x.fill(); }
    return crop(resized(c, 60, 60));
  };
  const savePiece = (fn, im, x, y, col, mk = false) => { put('assets/' + fn, im); conf.push({ src: fn, x: Math.trunc(x), y: Math.trunc(y), w: im.width, h: im.height, rgb: col.slice(), mark: mk }); };
  const [hx, hy] = an.hands;
  savePiece('confetti_00.png', shape(0, pal.others[2]), ebox.x + 0.17 * ebox.w, ebox.y + 0.02 * ebox.h, pal.others[2]);
  savePiece('confetti_01.png', shape(1, pal.others[0]), ebox.x + 1.0 * ebox.w, ebox.y + 0.08 * ebox.h, pal.others[0]);
  savePiece('confetti_02.png', mark(-0.9, orange), hx + 99, hy - 83, orange, true);
  savePiece('confetti_03.png', mark(-0.3, orange), hx + 116, hy - 37, orange, true);
  savePiece('confetti_04.png', shape(2, pal.k3), ebox.x + 0.98 * ebox.w, ebox.y + 0.57 * ebox.h, pal.k3);

  Object.assign(an, opts.anchors || {});
  const GEO = { colors: { cream, orange, red: waveC }, sun: SUN, wave: WAVE, streak: { slope: SLOPE, x_at_y0: X0 },
    end_pose: { x: ebox.x, y: ebox.y, size: [ebox.w, ebox.h] }, clap_pose: cbox, dots, dot_boxes: boxes, letters, letter_beats: beats, confetti: conf,
    piece_src: ['confetti_00.png', 'confetti_01.png', 'confetti_04.png'], type_row: trow, anchors: an };
  const PN = opts.partNames || {};
  const ascii = (s, d) => (s || '').toUpperCase().replace(/[^A-Z0-9_]/g, '') || d;   // 코드 글자는 5×7 픽셀 글꼴(영문 · 숫자)이라 그 밖의 글자는 빼고 · 비면 기본값
  const KIT = { code_name: ascii(name, 'CHAR'),
    part_names: { k1: ascii(PN.k1, 'PART1'), k2: ascii(PN.k2, 'PART2'), k3: ascii(PN.k3, 'PART3') },
    other_names: opts.otherNames || DEFAULT_OTHER_NAMES, deep_follows: deepFollows };
  const one = { n: 1, w, h, u: 1, src: ['build/mask/main/00'], ms: [100], loop_ms: 100 };
  const MK = Object.fromEntries(SLOTS.map(s => [s, one]));
  return { store, PAL: pal, GEO, KIT, MK, report: { palette: pal, anchors: an, eyes_found: eyes.length > 0, piece_layer: pc.layer, deep_follows: deepFollows, title: lines, letters: letters.length, pieceCanvas: pc.piece } };
}
