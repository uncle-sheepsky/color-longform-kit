/* 페이지 흐름: 그림 넣기 → 분석(prep.js) → 색 · 이름 고치기(바꾸면 바로 다시 만듦) → 장면 띄우기(scenes.js) → 미리 보기 → 굽기(render.js) */
import { analyze, build, hex2rgb, rgb2hex, mkCanvas } from './prep.js';
import { mountScenes, TOTAL } from './scenes.js';
let R = null;                                                   // 굽기 모듈(mp4-muxer 를 CDN 에서 불러옴) — 페이지가 그 CDN 을 기다리지 않게 필요할 때 불러옴
const render = () => (R = R || import('./render.js'));
const FILES = { wide: 'what-your-color_16x9.mp4', tall: 'what-your-color_9x16.mp4', feed: 'what-your-color_4x5.mp4' };

const $ = id => document.getElementById(id);
const MUSIC_URL = new URL('../music/color_longform.wav', import.meta.url);
const ORIGINAL = 'https://youtu.be/2T3t7NSwQis';
const FPS = 30, V0 = 1360;                                       // 세로 영상 = 1360프레임(드롭)부터
/* 예시 그림(CC0 아님 · 시험용 — NOTICE). colors = 미리 맞춘 칠하는 색 · eyes = 두 눈 자리(층 크기 비율) · parts = 색이 가까운 쪽에 붙일 부위 이름 */
const PRESETS = {
  duru: { file: 'duru.png', name: 'DURU', label: '두루', sample: true, parts: [{ name: 'SCARF', c: [237, 57, 59] }, { name: 'COAT', c: [203, 119, 42] }, { name: 'CHEEK', c: [253, 161, 150] }] },
  melon: { file: 'melon.png', name: 'MELON', label: '멜론', sample: true,
    colors: { paper: [234, 246, 178] },                         // 몸(종이) = 연한 그물 색 → 색 1(초록 껍질 무늬)이 돌아오는 게 보이게. 그대로 두면 종이와 색 1이 같은 초록
    eyes: [[0.336, 0.577], [0.688, 0.576]],                     // 자동으로 찾으면 꼭지 두 끝을 눈으로 잡음 → 실제 눈동자 자리
    parts: [{ name: 'RIND', c: [154, 214, 74] }, { name: 'CHEEK', c: [250, 128, 128] }, { name: 'BLUSH', c: [235, 40, 50] }] },
};
const ROLES = [['ink', '선', '가장 어두운 색'], ['paper', '종이', '선만 남은 몸의 바탕'], ['deep', '진한 면', '머리카락 · 뿔 같은 진한 면']];
const KEY_WHEN = ['18.7초부터', '24.7초부터', '30.7초부터'];
const SECTIONS = [[0, 240, '선화'], [240, 560, '남의 색'], [560, 740, '색 1'], [740, 920, '색 2'], [920, 1100, '색 3'], [1100, 1220, '엇나간 자리'],
  [1220, 1360, '자리 찾기 · 정적'], [1360, 1560, '드롭'], [1560, 1720, '원판 속 세계'], [1720, 1960, '빛'], [1960, 2400, '끝 화면']];
const S = { A: null, B: null, scenes: null, keyOrder: [0, 1, 2], colors: {}, partNames: ['', '', ''], eyes: null, picking: 0, pick: [], font: null, fontName: '',
  music: null, PXF: null, srcName: '', preset: null, initial: null, frame: 1500, timer: 0, rebuilding: false, again: false, loading: false, rendering: false, abort: null, wc: undefined };
const tcOf = f => { const s = f / FPS; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const css = c => `rgb(${c.join(',')})`;
const lum = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const euro = w => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 && c % 28 !== 8 ? w + '으로' : w + '로'; };   // 받침이 있으면 「으로」(ㄹ 받침은 「로」)
const sameEyes = (a, b) => a && b && a.length === 2 && b.length === 2 && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1 && Math.abs(p[1] - b[i][1]) < 1);

async function loadPXF() {                                      // 픽셀 글꼴 표(키트 scenes/devices.js 의 5×7 표를 그대로 읽음)
  const t = await (await fetch(new URL('../scenes/devices.js', import.meta.url))).text();
  const body = t.slice(t.indexOf('const PXF = {') + 'const PXF = '.length, t.indexOf('};', t.indexOf('const PXF = {')) + 1);
  return Function('"use strict"; return (' + body + ');')();
}

// ── 화면 전환 ─────────────────────────────────────────────────────────────────
function showLanding() { stopPlay(); $('editor').hidden = true; $('landing').hidden = false; $('back').hidden = !S.scenes; window.scrollTo({ top: 0 }); }
function showEditor() { $('landing').hidden = true; $('editor').hidden = false; window.scrollTo({ top: 0 }); }
function setVars() {                                             // 페이지 강조색 = 지금 캐릭터의 색 1 · 2 · 3
  const r = document.documentElement.style;
  [1, 2, 3].forEach(i => r.setProperty('--c' + i, css(curColor('k' + i))));
}

// ── 1) 그림 넣기 ──────────────────────────────────────────────────────────────
function loadImage(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('그림을 열지 못했어요. PNG 파일인지 확인해 주세요.')); im.src = url; }); }
function nameFrom(file) { const s = file.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toUpperCase().slice(0, 12).trim(); return s || 'HELLO'; }
function presetParts(A, parts) {
  return [0, 1, 2].map(i => { const c = A.pal0['k' + (i + 1)]; let best = '', bd = 1e9; for (const p of parts) { const d = Math.hypot(...p.c.map((v, j) => v - c[j])); if (d < bd) { bd = d; best = p.name; } } return best; });
}
async function takeImage(url, srcName, preset = null) {
  if (S.loading || S.rendering) return;
  S.loading = true; $('err1').hidden = true; $('loading').hidden = false; $('st1').textContent = '그림 읽는 중…';
  document.querySelectorAll('#landing button, #drop').forEach(b => b.setAttribute('aria-busy', 'true'));
  try {
    if (!S.PXF) S.PXF = await loadPXF();
    const im = await loadImage(url);
    const A = await analyze(im, s => { $('st1').textContent = s + '…'; });
    const init = { keyOrder: [0, 1, 2], colors: preset && preset.colors ? { ...preset.colors } : {},
      partNames: preset ? presetParts(A, preset.parts) : ['', '', ''],
      eyes: preset && preset.eyes ? preset.eyes.map(([fx, fy]) => [Math.round(fx * A.w), Math.round(fy * A.h)]) : null };
    Object.assign(S, { A, srcName, preset, initial: init, picking: 0, pick: [] }, structuredClone(init));
    $('name').value = preset ? preset.name : nameFrom(srcName); $('title1').value = '{name}'; $('title2').value = 'IN COLOR';
    S.frame = 1500;
    renderControls(); fontWarn();
    $('st1').textContent = '장면 준비 중…';
    await rebuildNow();
    showEditor();
  } catch (e) { console.error(e); $('err1').textContent = String(e.message || e); $('err1').hidden = false; }
  finally { S.loading = false; $('loading').hidden = true; document.querySelectorAll('[aria-busy]').forEach(b => b.removeAttribute('aria-busy')); }
}
$('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) takeImage(URL.createObjectURL(f), f.name); e.target.value = ''; });
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) takeImage(URL.createObjectURL(f), f.name); });
document.addEventListener('dragover', e => { if ($('landing').hidden && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', e => { if (!$('landing').hidden || S.rendering) return; const f = e.dataTransfer && e.dataTransfer.files[0]; if (f && /image\//.test(f.type)) { e.preventDefault(); showLanding(); takeImage(URL.createObjectURL(f), f.name); } });   // 편집 화면에 그림을 떨어뜨려도 새 그림으로
for (const [id, key] of [['sample', 'duru'], ['sample2', 'melon']]) $(id).addEventListener('click', () => takeImage(new URL(PRESETS[key].file, import.meta.url).href, PRESETS[key].file, PRESETS[key]));
$('another').addEventListener('click', showLanding);
$('back').addEventListener('click', showEditor);

// ── 2) 색 · 눈 · 이름 ──────────────────────────────────────────────────────────
const natKey = key => 'k' + (S.keyOrder[+key[1] - 1] + 1);          // 지금 색 i 가 분석의 몇 번째 묶음인지
const curColor = k => S.colors[k] || (k.startsWith('k') ? S.A.pal0[natKey(k)] : S.A.pal0[k]);
const layerOf = key => key.startsWith('k') ? S.A.lay[natKey(key)] : key === 'paper' ? S.A.lay.sil : S.A.lay[key];
function chip(key, title, sub, extra) {
  const d = document.createElement('div'); d.className = 'chip'; d.dataset.key = key; d.tabIndex = 0; d.setAttribute('aria-label', `${title}: 그림에서 이 색 자리 보기`);
  const sw = document.createElement('label'); sw.className = 'sw'; sw.style.background = css(curColor(key));
  const inp = document.createElement('input'); inp.type = 'color'; inp.value = rgb2hex(curColor(key)).toLowerCase(); inp.setAttribute('aria-label', `${title} 색 고르기`);
  inp.addEventListener('input', () => { S.colors[key] = hex2rgb(inp.value); sw.style.background = inp.value; hex.textContent = inp.value.toUpperCase(); if (key.startsWith('k')) { setVars(); renderOrderBadges(); } drawCheck(key); queueRebuild(); });
  sw.append(inp);
  const t = document.createElement('div'); t.className = 't';
  const hex = document.createElement('small'); hex.className = 'hex'; hex.textContent = rgb2hex(curColor(key));
  t.innerHTML = `<b>${title}</b><small>${sub}</small>`; t.append(hex); if (extra) t.append(extra);
  d.append(sw, t);
  const on = () => drawCheck(key), off = () => drawCheck(null);
  d.addEventListener('mouseenter', on); d.addEventListener('mouseleave', off); d.addEventListener('focusin', on); d.addEventListener('focusout', off);
  return d;
}
function renderOrderBadges() { document.querySelectorAll('#order .num').forEach((n, i) => { const c = curColor('k' + (i + 1)); n.style.background = css(c); n.style.color = lum(c) > 0.55 ? '#2a1203' : '#fff'; }); }
function renderControls() {
  const A = S.A;
  const roles = $('roles'); roles.innerHTML = '';
  for (const [k, l, h] of ROLES) roles.append(chip(k, l, h + (k === 'deep' && !A.hasDeep ? ' (이 그림엔 없어 선과 종이 사이 색)' : '')));
  const order = $('order'); order.innerHTML = '';
  [0, 1, 2].forEach(i => {
    const key = 'k' + (i + 1), part = document.createElement('input');
    part.type = 'text'; part.className = 'part'; part.maxLength = 16; part.value = S.partNames[i]; part.placeholder = `부위 이름(영문) · 비우면 PART${i + 1}`; part.setAttribute('aria-label', `색 ${i + 1} 부위 이름`);
    part.addEventListener('input', () => { S.partNames[i] = part.value; queueRebuild(); });
    const row = document.createElement('div'); row.className = 'row';
    const num = document.createElement('span'); num.className = 'num'; num.textContent = i + 1; num.setAttribute('aria-hidden', 'true');
    row.append(num, chip(key, `색 ${i + 1}`, KEY_WHEN[i], part)); order.append(row);
    if (i < 2) {
      const sw = document.createElement('div'); sw.className = 'swap';
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `⇅ 색 ${i + 1} · ${i + 2} 순서 바꾸기`;
      b.addEventListener('click', () => swapKeys(i, i + 1)); sw.append(b); order.append(sw);
    }
  });
  renderOrderBadges(); setVars(); renderEyes(); drawCheck(null);
  const w = $('warns'); w.innerHTML = '';
  for (const m of A.warnings) { const p = document.createElement('p'); p.className = 'warn'; p.textContent = m; w.append(p); }
}
function swapKeys(i, j) {
  [S.keyOrder[i], S.keyOrder[j]] = [S.keyOrder[j], S.keyOrder[i]];
  [S.partNames[i], S.partNames[j]] = [S.partNames[j], S.partNames[i]];
  const a = S.colors['k' + (i + 1)], b = S.colors['k' + (j + 1)]; delete S.colors['k' + (i + 1)]; delete S.colors['k' + (j + 1)];
  if (b) S.colors['k' + (i + 1)] = b; if (a) S.colors['k' + (j + 1)] = a;
  renderControls(); queueRebuild();
}
/* 확인 그림: 평소 = 그림 + 눈(빨간 원) + 색 1~3 자리(숫자) · 칸에 올리면 = 그 층만 그 색으로 */
const TINT = new Map();
function tinted(key) {
  const col = key === 'tick' ? (S.A.tickMedian || curColor('k1')) : curColor(key), id = key + col.join();
  if (!TINT.has(id)) { const m = layerOf(key), c = mkCanvas(S.A.w, S.A.h), g = c.getContext('2d'), im = g.createImageData(S.A.w, S.A.h); for (let i = 0; i < m.length; i++) { if (!m[i]) continue; im.data[i * 4] = col[0]; im.data[i * 4 + 1] = col[1]; im.data[i * 4 + 2] = col[2]; im.data[i * 4 + 3] = m[i]; } g.putImageData(im, 0, 0); if (TINT.size > 40) TINT.clear(); TINT.set(id, c); }
  return TINT.get(id);
}
function drawCheck(focus) {
  const A = S.A; if (!A) return;
  const W = 300, k = W / A.w, H = Math.round(A.h * k), c = $('chk'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.clearRect(0, 0, W, H); g.imageSmoothingQuality = 'high';
  if (focus) {
    g.globalAlpha = 0.18; g.drawImage(A.cr, 0, 0, W, H); g.globalAlpha = 1;
    g.drawImage(tinted(focus), 0, 0, W, H);
    if (focus !== 'ink') { g.globalAlpha = 0.5; g.drawImage(tinted('ink'), 0, 0, W, H); g.globalAlpha = 1; }
    return;
  }
  g.drawImage(A.cr, 0, 0, W, H);
  const eyes = S.picking ? S.pick : (S.eyes || A.eyes);
  for (const [x, y] of eyes) { for (const [lw, col] of [[6, '#fff'], [3, '#e3262b']]) { g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); g.arc(x * k, y * k, 9, 0, Math.PI * 2); g.stroke(); } }
  if (S.picking) return;
  [0, 1, 2].forEach(i => {
    const [fx, fy] = A.fit[natKey('k' + (i + 1))], x = fx * W, y = fy * H, col = curColor('k' + (i + 1));
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = css(col); g.beginPath(); g.arc(x, y, 9.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = lum(col) > 0.55 ? '#2a1203' : '#fff'; g.font = 'bold 13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y + 0.5);
  });
}
function renderEyes() {
  const A = S.A, st = $('eyestate');
  if (S.picking) st.textContent = S.picking === 1 ? '그림에서 왼쪽 눈을 누르세요' : '이제 오른쪽 눈을 누르세요';
  else st.textContent = S.eyes ? (sameEyes(S.eyes, S.initial && S.initial.eyes) ? '눈: 예시 그림에 맞춰 둔 자리' : '눈: 직접 찍은 자리') : A.eyes.length ? '눈: 자동으로 찾음' : '눈: 못 찾음 (눈 다시 찍기를 눌러 주세요)';
  $('pickeyes').textContent = S.picking ? '취소' : '눈 다시 찍기';
  $('chk').classList.toggle('pick', !!S.picking);
}
$('pickeyes').addEventListener('click', () => { S.picking = S.picking ? 0 : 1; S.pick = []; renderEyes(); drawCheck(null); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.picking) { S.picking = 0; S.pick = []; renderEyes(); drawCheck(null); } });
$('chk').addEventListener('click', e => {
  if (!S.picking) return;
  const r = e.currentTarget.getBoundingClientRect();
  S.pick.push([(e.clientX - r.left) / r.width * S.A.w, (e.clientY - r.top) / r.height * S.A.h]);
  if (S.pick.length === 2) { S.eyes = S.pick.slice().sort((a, b) => a[0] - b[0]); S.picking = 0; S.pick = []; queueRebuild(); } else S.picking = 2;
  renderEyes(); drawCheck(null);
});
$('reset').addEventListener('click', () => { Object.assign(S, structuredClone(S.initial), { picking: 0, pick: [] }); renderControls(); queueRebuild(); });
['name', 'title1', 'title2'].forEach(id => $(id).addEventListener('input', () => { fontWarn(); queueRebuild(); }));
function fontWarn() {
  const nonLatin = /[^\x00-\x7F]/.test($('name').value + $('title1').value + $('title2').value) && !S.font;
  $('fontwarn').hidden = !nonLatin; $('fontwarn').textContent = nonLatin ? '한글 같은 글자는 픽셀 글꼴에 없어서 「?」로 나와요. 제목 글꼴을 넣어 주세요.' : '';
}
$('font').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const fam = 'KitTitleFont' + Date.now(), ff = new FontFace(fam, await f.arrayBuffer()); await ff.load(); document.fonts.add(ff); S.font = fam; $('fontname').textContent = f.name; queueRebuild(); }
  catch (err) { S.font = null; $('fontname').textContent = '글꼴 파일을 읽지 못했어요'; }
  fontWarn(); e.target.value = '';
});

// ── 다시 만들기(바꿀 때마다 · 잠깐 멈춘 뒤 한 번) ─────────────────────────────────────
function queueRebuild() { if (!S.A) return; clearTimeout(S.timer); $('busy').hidden = false; $('busytxt').textContent = '바꾼 내용 입히는 중'; S.timer = setTimeout(rebuildNow, 450); }
async function rebuildNow() {
  clearTimeout(S.timer); S.timer = 0;
  if (S.rebuilding) { S.again = true; return S.rebuilding; }
  const run = (async () => {
    $('busy').hidden = false;
    try {
      const B = await build(S.A, { keyOrder: S.keyOrder, colors: S.colors, name: $('name').value, title: [$('title1').value, $('title2').value].filter(s => s.trim()),
        partNames: { k1: S.partNames[0], k2: S.partNames[1], k3: S.partNames[2] }, eyes: S.eyes, font: S.font, PXF: S.PXF });
      const sc = await mountScenes(B, $('host'));               // 새 장면을 다 띄운 뒤에 옛 장면을 내림(미리 보기가 비지 않게)
      if (S.scenes) S.scenes.dispose();
      S.B = B; S.scenes = sc; $('done').hidden = true;
      showFrame(S.frame);
    } catch (e) { console.error(e); $('busytxt').textContent = '만들지 못했어요: ' + (e.message || e); return; }
    finally { S.rebuilding = false; }
    if (S.again) { S.again = false; return rebuildNow(); }
    if (!S.timer) $('busy').hidden = true;
  })();
  S.rebuilding = run; return run;
}

// ── 3) 미리 보기 ──────────────────────────────────────────────────────────────
const pv = $('pv'), pg = pv.getContext('2d');
function showFrame(f) {
  if (!S.scenes || S.rendering) return;
  f = Math.max(0, Math.min(TOTAL - 1, f | 0)); S.frame = f;
  try { const cv = S.scenes.frame(f); pg.imageSmoothingQuality = 'high'; pg.drawImage(cv, 0, 0, pv.width, pv.height); } catch (e) { $('busytxt').textContent = String(e.message || e); $('busy').hidden = false; }
  $('scrub').value = f; $('tc').textContent = tcOf(f);
  const si = SECTIONS.findIndex(([a, b]) => f >= a && f < b);
  document.querySelectorAll('.seg').forEach((s, i) => s.classList.toggle('on', i === si));
  if (si >= 0) { $('segname').innerHTML = `<b>${SECTIONS[si][2]}</b>`; $('segtime').textContent = `${tcOf(SECTIONS[si][0])} ~ ${tcOf(SECTIONS[si][1])}`; }
}
const SEG_BG = ['#6b5446', 'linear-gradient(90deg,#38836d,#465cb2,#fbb700,#d6338a)', 'var(--c1)', 'var(--c2)', 'var(--c3)', 'linear-gradient(90deg,var(--c2),var(--c3),var(--c1))',
  '#4b3427', 'linear-gradient(90deg,var(--c1),var(--c2),var(--c3))', '#355f74', '#262e57', '#fd9702'];
SECTIONS.forEach(([a, b, label], i) => {
  const s = document.createElement('button'); s.type = 'button'; s.className = 'seg'; s.style.flex = `${b - a} 1 0`; s.style.background = SEG_BG[i];
  s.title = `${label} (${tcOf(a)})`; s.setAttribute('aria-label', `${label}, ${tcOf(a)}부터`);
  s.addEventListener('click', () => { stopPlay(); showFrame(a + Math.min(90, (b - a) >> 1)); });
  $('segs').append(s);
});
function placeBracket() {                                        // 세로 영상 구간 표시(막대 위 실제 위치에서)
  const segs = $('segs'), first = segs.children[7]; if (!first || !segs.offsetWidth) return;
  const L = first.offsetLeft, i = $('vbracket').querySelector('i'), sp = $('vbracket').querySelector('span');
  i.style.left = L + 'px'; i.style.right = '0'; sp.style.left = L + 'px';
}
new ResizeObserver(placeBracket).observe($('segs'));
$('scrub').addEventListener('input', e => { stopPlay(); showFrame(+e.target.value); });
let play = null;
async function ensureMusic() { if (!S.music) S.music = await (await render()).loadMusic(MUSIC_URL); return S.music; }
function setPlayIcon(on) { $('playicon').setAttribute('d', on ? 'M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z' : 'M7 4.5v15l13-7.5z'); $('play').setAttribute('aria-label', on ? '멈추기' : '소리와 함께 재생'); }
function stopPlay() { if (!play) return; play.stop = true; try { play.src.stop(); } catch (e) { /* 이미 멈춤 */ } play.ctx.close(); play = null; setPlayIcon(false); }
$('play').addEventListener('click', async () => {
  if (play) return stopPlay();
  if (S.rendering || !S.scenes) return;
  $('play').disabled = true;
  try {
    const m = await ensureMusic(), ctx = new AudioContext({ sampleRate: m.sr }), buf = ctx.createBuffer(m.chans.length, m.chans[0].length, m.sr);
    m.chans.forEach((c, i) => buf.copyToChannel(c, i));
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    const f0 = S.frame >= TOTAL - 1 ? 0 : S.frame, t0 = ctx.currentTime + 0.05; src.start(t0, f0 / FPS);
    play = { ctx, src, stop: false }; setPlayIcon(true);
    const p = play, step = () => { if (p.stop) return; const f = f0 + Math.floor((ctx.currentTime - t0) * FPS); if (f >= TOTAL) { stopPlay(); return; } if (f >= f0) showFrame(f); requestAnimationFrame(step); };
    requestAnimationFrame(step);
  } catch (e) { console.error(e); }
  finally { $('play').disabled = false; }
});

// ── 4) 굽기 ──────────────────────────────────────────────────────────────────
const WANT = { wide: true, tall: true, feed: false };
const FMT_UI = { wide: ['16:9', '가로 · 80초', '유튜브'], tall: ['9:16', '세로 · 34.7초', '쇼츠 · 릴스 · 틱톡'], feed: ['4:5', '세로 · 34.7초', '인스타 게시물'] };
const SHAPE = { wide: [34, 19], tall: [15, 26], feed: [21, 26] };
for (const k of Object.keys(FILES)) {
  const l = document.createElement('label'); l.className = 'fmt';
  const c = document.createElement('input'); c.type = 'checkbox'; c.checked = WANT[k]; c.addEventListener('change', () => { WANT[k] = c.checked; });
  const [w, h] = SHAPE[k], [ratio, len, where] = FMT_UI[k];
  l.innerHTML = `<span class="ck" aria-hidden="true">✓</span><span class="shape" style="width:${w}px;height:${h}px" aria-hidden="true"></span><b>${ratio}</b><small>${len}<br>${where}</small>`;
  l.prepend(c); $('formats').append(l);
}
function caption() {
  const nm = ($('name').value || '').trim();
  return `${nm ? nm + ' · ' : ''}WHAT YOUR COLOR.\n원본 영상: ${ORIGINAL}\n템플릿(원하는 캐릭터를 넣어 만드는 템플릿): ${location.href.split('#')[0].split('?')[0]}\n음악 · 화면 코드: color-longform-kit (CC0)`;
}
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('caption').value); $('copy').textContent = '복사했어요'; setTimeout(() => { $('copy').textContent = '설명 문구 복사'; }, 1500); } catch (e) { $('caption').select(); } });
(async () => {
  const forceRT = new URLSearchParams(location.search).get('mode') === 'realtime';
  let M = null;
  try { M = await render(); } catch (e) { R = null; $('engine').textContent = '영상을 굽는 데 필요한 파일을 인터넷(jsDelivr)에서 불러오지 못했어요. 연결을 확인하고 새로 고침해 주세요.'; return; }
  S.wc = forceRT ? null : await M.webCodecsInfo().catch(() => null);
  $('engine').textContent = S.wc ? `이 브라우저는 프레임마다 그려서 굽습니다(${S.wc.video.toUpperCase()} · ${S.wc.audio.toUpperCase()}).`
    : '이 브라우저는 영상 길이만큼 실시간으로 녹화해서 만듭니다. 녹화하는 동안 이 탭을 앞에 두세요. Chrome · Edge 최신판에서는 더 빨라요.';
})();
function lockEditing(on) { document.querySelectorAll('#editor .card:not(#make) input, #editor .card:not(#make) button, #play, #scrub, .seg, #formats input').forEach(el => { el.disabled = on; }); }
$('go').addEventListener('click', async () => {
  if (!S.scenes || S.rendering) return;
  const want = { ...WANT };
  if (!want.wide && !want.tall && !want.feed) { $('prog').hidden = false; $('st4').textContent = '만들 형식을 하나 이상 고르세요.'; return; }
  if (S.timer || S.rebuilding) { $('st4').textContent = '바꾼 내용 입히는 중…'; await rebuildNow(); }
  S.rendering = true; stopPlay(); lockEditing(true);
  const ac = new AbortController(); S.abort = ac;
  $('results').querySelectorAll('a[download]').forEach(a => URL.revokeObjectURL(a.href));   // 앞서 만든 영상은 메모리에서 내림
  $('go').disabled = true; $('stop').hidden = false; $('prog').hidden = false; $('results').innerHTML = ''; $('share').hidden = true; $('done').hidden = true; $('bar').style.width = '0';
  const th = $('thumb').getContext('2d'), t0 = performance.now();
  try {
    $('st4').textContent = '음악 읽는 중…'; const music = await ensureMusic();
    const opts = { scenes: S.scenes, music, want, pad: S.B.PAL.night, geo: S.B.GEO, signal: ac.signal,
      onProgress: p => {
        $('bar').style.width = (100 * p.done / Math.max(1, p.total)).toFixed(1) + '%';
        const el = (performance.now() - (p.t0 || t0)) / 1000, eta = p.done > 10 && p.t0 ? el / p.done * (p.total - p.done) : null;
        $('st4').textContent = `${p.phase} · ${p.done} / ${p.total}` + (eta !== null ? ` · 약 ${Math.ceil(eta)}초 남음` : '') + (p.dropped ? ` · 빠진 프레임 ${p.dropped}` : '');
        if (p.src) { const c = $('thumb'), s = Math.min(c.width / p.src.width, c.height / p.src.height), w = p.src.width * s, h = p.src.height * s; th.fillStyle = '#000'; th.fillRect(0, 0, c.width, c.height); th.imageSmoothingQuality = 'low'; th.drawImage(p.src, (c.width - w) / 2, (c.height - h) / 2, w, h); }
      } };
    const M = await render(), out = S.wc ? await M.renderWebCodecs(opts) : await M.renderRealtime(opts);
    const slug = (($('name').value || 'character').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'character').toLowerCase();
    for (const k of ['wide', 'tall', 'feed']) {
      const blob = out[k]; if (!blob) continue;
      const url = URL.createObjectURL(blob), ext = blob.ext || 'mp4', fn = FILES[k].replace('what-your-color', `what-your-color_${slug}`).replace(/\.mp4$/, '.' + ext);
      const row = document.createElement('div'); row.className = 'result';
      const v = document.createElement('video'); v.src = url; v.controls = true; v.playsInline = true; v.preload = 'metadata';
      v.addEventListener('loadedmetadata', () => { if (v.currentTime === 0 && v.paused) v.currentTime = Math.min(v.duration * 0.6, 50); }, { once: true });   // 첫 프레임은 어두워서 중간 장면을 대표 그림으로
      const info = document.createElement('div'), [ratio, len] = FMT_UI[k];
      info.innerHTML = `<b>${ratio} · ${len}</b><small>${fn} · ${(blob.size / 1048576).toFixed(1)}MB${blob.dropped ? ` · 빠진 프레임 ${blob.dropped}` : ''}</small><br>`;
      const a = document.createElement('a'); a.href = url; a.download = fn; a.className = 'btn primary small'; a.textContent = '내려받기'; a.dataset.format = k;
      info.append(a); row.append(v, info); $('results').append(row);
    }
    $('bar').style.width = '100%'; $('prog').hidden = true;
    const took = `다 됐어요 · ${((performance.now() - t0) / 1000).toFixed(0)}초 걸림. `;
    $('done').hidden = false;
    if (S.preset && S.preset.sample) $('done').textContent = took + `${euro(S.preset.label)} 만든 영상은 시험용이에요(다시 배포 · 상업적 이용 불가). 올릴 영상은 내 캐릭터 그림으로 만들어 주세요.`;
    else { $('done').textContent = took + '소리를 켜고 끝까지 한 번 보세요. 내 캐릭터답게 보이는지는 직접 보는 게 가장 정확해요.'; $('caption').value = caption(); $('share').hidden = false; }
    $('make').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) { console.error(e); $('st4').textContent = e.name === 'AbortError' ? '멈췄어요.' : '만들지 못했어요: ' + (e.message || e); }
  finally { S.rendering = false; S.abort = null; $('go').disabled = false; $('stop').hidden = true; lockEditing(false); showFrame(S.frame); }
});
$('stop').addEventListener('click', () => { if (S.abort) S.abort.abort(); });
