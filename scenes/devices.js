/* 장치 공용 — 작은 아이콘(상징) 8종과 그것을 움직이는 계산 장치 넷.
   아이콘 = 코드로 그린 단순 도형(소용돌이 · 구름 · 발자국 · 하트 · 리본 · 토글 · 볼터치 · 별). 캐릭터를 그리는 데 쓰지 않고, 화면을 채우는 장치의 몸으로만 쓴다.
   장치: 은하(캐릭터를 중심으로 도는 원반 · 안쪽이 빨리 돎) · 탄막 무늬(박마다 퍼지는 아이콘 고리 · 나선) · 수박식 물리(떨어져 부딪혀 쌓임) · 리듬게임 노트(박에 맞춰 내려와 닿음).
   전부 프레임 번호의 순수 함수다(물리만 로드할 때 고정 걸음으로 한 번 미리 계산해 표로 읽음). Math.random · 시계 시간을 쓰지 않는다.
   페이지 전역(g · rgb · hash01 · TAU · lerp · clamp · imp · stp · ez · SPB · FPB · DRY)을 호출 시점에 쓴다. */
const SYM_NAMES = ['spiral', 'cloud', 'hoof', 'heart', 'scarf', 'toggle', 'blush', 'star'];
function symSpiral(x, y, R, lw, col, rot = 0, dir = 1) {
  const turns = 2.25, n = 90; g.save(); g.translate(x, y); g.rotate(rot); g.scale(dir, 1); g.beginPath();
  for (let i = 0; i <= n; i++) { const t = i / n, a = t * turns * TAU, r = R * (1 - t * 0.92); i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.lineWidth = lw; g.lineCap = 'round'; g.strokeStyle = col; g.stroke(); g.restore();
}
function symCloudPath(x, y, r, bumps = 9) {
  g.beginPath();
  for (let i = 0; i <= bumps; i++) { const a0 = i / bumps * TAU - Math.PI / 2, px = x + Math.cos(a0) * r, py = y + Math.sin(a0) * r;
    if (i === 0) g.moveTo(px, py); else { const am = a0 - Math.PI / bumps; g.quadraticCurveTo(x + Math.cos(am) * r * 1.32, y + Math.sin(am) * r * 1.32, px, py); } }
  g.closePath();
}
function symHeartPath(x, y, s) {
  g.beginPath(); g.moveTo(x, y + s * 0.35);
  g.bezierCurveTo(x - s * 0.05, y + s * 0.3, x - s * 0.55, y + s * 0.02, x - s * 0.5, y - s * 0.22); g.bezierCurveTo(x - s * 0.45, y - s * 0.5, x - s * 0.08, y - s * 0.52, x, y - s * 0.25);
  g.bezierCurveTo(x + s * 0.08, y - s * 0.52, x + s * 0.45, y - s * 0.5, x + s * 0.5, y - s * 0.22); g.bezierCurveTo(x + s * 0.55, y + s * 0.02, x + s * 0.05, y + s * 0.3, x, y + s * 0.35); g.closePath();
}
function symbol(name, x, y, s, col, rot = 0, a = 1) {         // s ≈ 반지름(px) · col = [r,g,b]
  if (DRY || s <= 0.5 || a <= 0.01) return;
  const c = rgb(col); g.save(); g.globalAlpha *= a; g.fillStyle = c; g.strokeStyle = c;
  if (name === 'spiral') symSpiral(x, y, s, Math.max(2, s * 0.16), c, rot);
  else if (name === 'cloud') { symCloudPath(x, y, s * 0.78); g.fill(); }
  else if (name === 'hoof') { g.translate(x, y); g.rotate(rot * 0.3); for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * s * 0.3, 0, s * 0.27, s * 0.46, sx * 0.18, 0, TAU); g.fill(); } }
  else if (name === 'heart') { g.translate(x, y); g.rotate(rot * 0.25); symHeartPath(0, s * 0.1, s * 1.7); g.fill(); }
  else if (name === 'scarf') { g.translate(x, y); g.rotate(-0.25 + rot * 0.15); g.beginPath(); const th = s * 0.42, L = s * 1.3; for (let k = -L; k <= L; k += s * 0.13) { const yy = s * 0.18 * Math.sin(k / (s * 0.55) + rot * 2); k === -L ? g.moveTo(k, yy - th / 2) : g.lineTo(k, yy - th / 2); } for (let k = L; k >= -L; k -= s * 0.13) g.lineTo(k, s * 0.18 * Math.sin(k / (s * 0.55) + rot * 2) + th / 2); g.closePath(); g.fill(); }
  else if (name === 'toggle') { g.translate(x, y); g.rotate(0.4 + rot * 0.2); const w = s * 1.3, h = w * 0.32; g.beginPath(); g.moveTo(-w / 2 + h / 2, -h / 2); g.arcTo(w / 2, -h / 2, w / 2, h / 2, h / 2); g.arcTo(w / 2, h / 2, -w / 2, h / 2, h / 2); g.arcTo(-w / 2, h / 2, -w / 2, -h / 2, h / 2); g.arcTo(-w / 2, -h / 2, w / 2, -h / 2, h / 2); g.closePath(); g.fill(); g.lineWidth = w * 0.08; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(0, h * 1.6); g.stroke(); }
  else if (name === 'blush') { for (const dx of [-0.55, 0.55]) { g.beginPath(); g.ellipse(x + dx * s, y, s * 0.42, s * 0.25, 0, 0, TAU); g.fill(); } }
  else if (name === 'star') { g.beginPath(); for (let i = 0; i < 8; i++) { const an = rot + i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? s * 0.32 : s; i ? g.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr) : g.moveTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); } g.closePath(); g.fill(); }
  g.restore();
}

/* ── 은하: 중심을 도는 기운 원반 · 각속도 ∝ r^-1.5(안쪽이 빨리 돎 → 팔이 감김) · 깊이(sinθ)로 앞 · 뒤를 나눠 캐릭터 앞뒤에 그림 ── */
function makeGalaxy(seed, n, rMin, rMax, arms, cols, symFrac) {
  return Array.from({ length: n }, (_, i) => { const u = hash01(seed + i * 3), r = rMin + (rMax - rMin) * Math.pow(u, 0.7), arm = i % arms;
    return { r, th0: arm * TAU / arms + Math.log(r / rMin) * 1.9 + 0.5 * (hash01(seed + i * 3 + 1) - 0.5), col: cols[i % cols.length], sym: hash01(seed + i * 3 + 2) < symFrac ? SYM_NAMES[i % SYM_NAMES.length] : null, s: 0.6 + 0.8 * hash01(seed + i * 7 + 5), ph: TAU * hash01(seed + i * 11) }; });
}
function galaxy(GX, b, cx, cy, opt) {                         // opt: { tilt, spin, layer: 'back'|'front', size, a, collapse:{u, x, y}, rScale, skip }
  const t = b * SPB, tilt = opt.tilt ?? 0.32, spin = opt.spin ?? 1, ref = GX[0] ? GX[0].r : 1, rs = opt.rScale ?? 1;
  for (const P of GX) {
    if (opt.skip && opt.skip(P)) continue;
    const w = spin * 1.6 * Math.pow(ref / P.r, 1.5), th = P.th0 + w * t, depth = Math.sin(th);
    if ((opt.layer === 'back' && depth > 0) || (opt.layer === 'front' && depth <= 0)) continue;
    let x = cx + P.r * rs * Math.cos(th), y = cy + P.r * rs * Math.sin(th) * tilt, sz = (opt.size || 10) * P.s * (0.75 + 0.35 * depth), a = (opt.a ?? 1) * (0.55 + 0.45 * depth) * (0.7 + 0.3 * Math.sin(b * 2.3 + P.ph));
    if (opt.collapse && opt.collapse.u > 0) { const u = opt.collapse.u, rr = P.r * (1 - u), th2 = th + u * 6; x = lerp(x, opt.collapse.x + rr * 0.25 * Math.cos(th2), u); y = lerp(y, opt.collapse.y + rr * 0.25 * Math.sin(th2), u); sz *= 1 - 0.6 * u; }
    if (P.sym && opt.symbols !== false) symbol(P.sym, x, y, sz * 2.2, P.col, th + b * 0.5, a);
    else { const gr = g.createRadialGradient(x, y, 0, x, y, sz * 2.4); gr.addColorStop(0, rgb(P.col, a)); gr.addColorStop(0.4, rgb(P.col, a * 0.8)); gr.addColorStop(1, rgb(P.col, 0)); g.fillStyle = gr; g.fillRect(x - sz * 2.4, y - sz * 2.4, sz * 4.8, sz * 4.8); }
  }
}

/* ── 탄막 무늬: 발사 = { b, n, speed(px/s), rot, curl(rad/s), sym, cols, size } · 탄 위치 = 출발점 + 방향 · 속도 · 경과(나선은 경과에 따라 방향이 돎) ── */
function danmaku(shots, b, ox, oy, life = 2.4) {
  for (const S of shots) {
    const t = (b - S.b) * SPB; if (t < 0 || t > life) continue;
    const fade = 1 - clamp((t - life + 0.6) / 0.6), grow = ez.backO(clamp(t / 0.18));
    for (let k = 0; k < S.n; k++) { const an = S.rot + k * TAU / S.n + (S.curl || 0) * t, d = S.speed * t + 40; symbol(S.sym || SYM_NAMES[k % SYM_NAMES.length], ox + Math.cos(an) * d, oy + Math.sin(an) * d * 0.92, (S.size || 26) * grow, S.cols[k % S.cols.length], an + t * 3, fade); }
  }
}

/* ── 수박식 물리: 떨어지는 원들이 부딪혀 쌓임 · 로드 때 고정 걸음으로 미리 계산(프레임 → 위치 표) ── */
function suikaSim(drops, B0, frames, opt = {}) {
  const floor = opt.floor ?? 1050, L = opt.left ?? 40, R = opt.right ?? 1880, sub = 6, dt = SPB / FPB / sub, grav = 3200, out = new Array(frames), bodies = [];
  let di = 0; const ds = drops.slice().sort((a, b) => a.b - b.b);
  for (let f = 0; f < frames; f++) {
    const b = B0 + f / FPB;
    while (di < ds.length && ds[di].b <= b) { const D = ds[di++]; bodies.push({ x: D.x, y: -D.r - 30, vx: D.vx || 0, vy: 520, r: D.r, rot: 0, vr: (hash01(di * 7) - 0.5) * 6, D, gone: false }); }
    for (let s = 0; s < sub; s++) {
      for (const B of bodies) { B.vy += grav * dt; B.x += B.vx * dt; B.y += B.vy * dt; B.rot += B.vr * dt; }
      for (let it = 0; it < 2; it++) for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const A = bodies[i], C = bodies[j]; if (A.D.gen !== C.D.gen) continue; const dx = C.x - A.x, dy = C.y - A.y, d = Math.hypot(dx, dy) || 1e-6, ov = A.r + C.r - d; if (ov <= 0) continue;
        const nx = dx / d, ny = dy / d; A.x -= nx * ov / 2; A.y -= ny * ov / 2; C.x += nx * ov / 2; C.y += ny * ov / 2;
        const rv = (C.vx - A.vx) * nx + (C.vy - A.vy) * ny; if (rv < 0) { const jn = -(1.3) * rv / 2; A.vx -= jn * nx; A.vy -= jn * ny; C.vx += jn * nx; C.vy += jn * ny; A.vr += 0.002 * jn * (A.D.gen % 2 ? 1 : -1); }
      }
      for (const B of bodies) { const open = opt.release && B.D.gen !== undefined && b >= (opt.release[B.D.gen] ?? 1e9);
        if (!open && B.y + B.r > floor) { B.y = floor - B.r; if (B.vy > 0) B.vy *= -0.28; B.vx *= 0.92; B.vr *= 0.9; }
        if (B.x - B.r < L) { B.x = L + B.r; B.vx = Math.abs(B.vx) * 0.5; } if (B.x + B.r > R) { B.x = R - B.r; B.vx = -Math.abs(B.vx) * 0.5; } }
    }
    out[f] = bodies.filter(B => B.y - B.r < 1300).map(B => [B.x, B.y, B.rot, B.D]);
  }
  return out;
}
function suikaDraw(table, f, sc = 1) { const L = table[Math.max(0, Math.min(table.length - 1, f))]; if (!L) return; for (const [x, y, rot, D] of L) symbol(D.sym, x, y, D.r * sc, D.col, rot, 1); }

/* ── 리듬게임 노트: { hb(닿는 박), x, sym, col, size } · y = 닿는 줄 − (남은 박 × 속도) · 닿으면 고리가 한 번 퍼짐 ── */
function notesDraw(notes, b, hitY, pxPerBeat, ringCol) {
  for (const N of notes) {
    const d = N.hb - b;
    if (d > 0 && d < 3.2) { const y = hitY - d * pxPerBeat, s = (N.size || 34) * (1 + 0.15 * Math.sin(b * 9 + N.x)); symbol(N.sym, N.x, y, s, N.col, b * 2 + N.x, clamp((3.2 - d) / 0.6)); }
    else if (d <= 0 && d > -0.6) { const u = -d / 0.6, k = ez.p3o(u); g.save(); g.globalAlpha = 0.85 * (1 - u); g.strokeStyle = rgb(ringCol || N.col); g.lineWidth = 10 * (1 - u) + 2; g.beginPath(); g.ellipse(N.x, hitY, 30 + 120 * k, (30 + 120 * k) * 0.45, 0, 0, TAU); g.stroke(); g.restore();
      symbol(N.sym, N.x, hitY, (N.size || 34) * (1 + 0.6 * (1 - u)) * (1 - u), N.col, 0, 1 - u); }
  }
}

/* 은하 입자의 지금 자리(그리지 않고 좌표만) — 빨려 드는 길의 출발점 */
function galaxyPos(P, b, cx, cy, tilt, spin, ref) { const th = P.th0 + spin * 1.6 * Math.pow(ref / P.r, 1.5) * b * SPB; return [cx + P.r * Math.cos(th), cy + P.r * Math.sin(th) * tilt, th]; }
/* 캣멀-롬 곡선: 점 목록을 지나는 매끈한 길 · u 0~1 */
function crPath(pts, u) {
  const n = pts.length - 1, x = clamp(u) * n, i = Math.min(n - 1, Math.floor(x)), t = x - i, p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const f = (a, b2, c, d) => 0.5 * ((2 * b2) + (-a + c) * t + (2 * a - 5 * b2 + 4 * c - d) * t * t + (-a + 3 * b2 - 3 * c + d) * t * t * t);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}
function rrPath(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

/* 픽셀 글꼴(5×7) — 코드가 쳐지는 연출용 · 글꼴 래스터 없이 사각형만(결정론) · 소문자는 대문자 모양으로 */
const PXF = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000', G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001', O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001', S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100', W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
  '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110', '2': '01110100010000100010001000100011111', '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110', '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100',
  '.': '00000000000000000000000000110001100', ',': '00000000000000000000001100010001000', '(': '00010001000100001000010000010000010', ')': '01000001000001000010000100010001000',
  '=': '00000000001111100000111110000000000', '"': '01010010100101000000000000000000000', '#': '01010010101111101010111110101001010', ';': '00000011000110000000011000100010000',
  '_': '00000000000000000000000000000011111', '-': '00000000000000011111000000000000000', '>': '01000001000001000001000100010001000', '<': '00010001000100010000010000010000010',
  '{': '00110010000100011000001000010000110', '}': '01100000100001000011000100001001100', '[': '01110010000100001000010000100001110', ']': '01110000100001000010000100001001110',
  ':': '00000011000110000000011000110000000', '/': '00001000100010001000100010001000000', '+': '00000001000010011111001000010000000', '*': '00000101010111000100011101010100000',
  '?': '01110100010000100010001000000000100', '!': '00100001000010000100001000000000100', "'": '00100001000100000000000000000000000', ' ': '00000000000000000000000000000000000'
};
function pxText(str, x, y, px, col, a = 1, n = Infinity) {   // n = 지금까지 쳐진 글자 수
  if (DRY || a <= 0.01) return 0; g.fillStyle = rgb(col, a); let cx = x, k = 0;
  for (const ch0 of str) { if (k >= n) break; const ch = ch0.toUpperCase(), gl = PXF[ch] || PXF['?'];
    for (let i = 0; i < 35; i++) if (gl.charCodeAt(i) === 49) g.fillRect(cx + (i % 5) * px, y + Math.floor(i / 5) * px, px, px);
    cx += 6 * px; k++; }
  return cx;
}
