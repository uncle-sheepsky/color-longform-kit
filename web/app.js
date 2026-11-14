/* 페이지 흐름: 그림 넣기 → 분석(prep.js) → 색 · 이름 고치기 → 준비물 만들기 → 장면 띄우기(scenes.js) → 미리 보기 → 굽기(render.js) */
import { analyze, build, hex2rgb, rgb2hex, mkCanvas } from './prep.js';
import { mountScenes, TOTAL } from './scenes.js';
import { FORMATS, loadMusic, webCodecsInfo, renderWebCodecs, renderRealtime } from './render.js';

const $ = id => document.getElementById(id);
const MUSIC_URL = new URL('../music/color_longform.wav', import.meta.url);
const ORIGINAL = 'https://youtu.be/2T3t7NSwQis';
const ROLE_UI = [
  ['ink', '선', '가장 어두운 색 — 선만 남은 판의 선'],
  ['paper', '종이', '밝고 넓은 바탕색 — 선만 남은 판의 몸'],
  ['deep', '진한 면', '선보다 밝은 진한 면(머리카락 · 신발 등) — 44초 정적 장면'],
];
const S = { A: null, B: null, scenes: null, keyOrder: [0, 1, 2], colors: {}, partNames: ['', '', ''], eyes: null, eyePick: [], font: null, music: null, busy: false, dirty: false, PXF: null, srcName: 'character', abort: null, wc: undefined };

function status(el, msg, isErr = false) { el.textContent = msg || ''; el.classList.toggle('err', !!isErr); }
const enable = (id, on) => $(id).classList.toggle('off', !on);

// ── 준비: 픽셀 글꼴 표(키트 scenes/devices.js 의 5×7 표를 그대로 읽음) ──────────────────
async function loadPXF() {
  const t = await (await fetch(new URL('../scenes/devices.js', import.meta.url))).text();
  const body = t.slice(t.indexOf('const PXF = {') + 'const PXF = '.length, t.indexOf('};', t.indexOf('const PXF = {')) + 1);
  return Function('"use strict"; return (' + body + ');')();
}

// ── 1) 그림 넣기 ──────────────────────────────────────────────────────────────
function loadImage(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('그림을 열지 못했습니다 — PNG 파일인지 확인해 주세요')); im.src = url; }); }
function nameFrom(file) { const s = file.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toUpperCase().slice(0, 12).trim(); return s || 'HELLO'; }
async function takeImage(url, srcName, preset = null) {
  if (S.busy) return;
  S.busy = true; status($('st1'), '그림 읽는 중…');
  try {
    if (!S.PXF) S.PXF = await loadPXF();
    const im = await loadImage(url);
    const A = await analyze(im, s => status($('st1'), s + '…'));
    S.A = A; S.srcName = srcName; S.keyOrder = [0, 1, 2]; S.colors = {}; S.partNames = ['', '', '']; S.eyes = null; S.eyePick = [];
    $('name').value = preset ? preset.name : nameFrom(srcName); $('title1').value = '{name}'; $('title2').value = 'IN COLOR';
    if (preset) S.partNames = presetParts(A, preset.parts);
    status($('st1'), `그림 읽음 · 층 크기 ${A.w}×${A.h}`);
    renderControls();
    await rebuild();
    enable('s2', true); enable('s3', true); enable('s4', true);
    $('s2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { console.error(e); status($('st1'), String(e.message || e), true); }
  finally { S.busy = false; }
}
function presetParts(A, parts) {                                // 시험 캐릭터: 색상이 가까운 쪽에 부위 이름(빨강 = 목도리 · 청록 = 코트 · 분홍 = 볼)
  const names = ['', '', ''];
  [0, 1, 2].forEach(i => { const c = A.pal0['k' + (i + 1)]; let best = null, bd = 1e9; for (const p of parts) { const d = Math.hypot(...p.c.map((v, j) => v - c[j])); if (d < bd) { bd = d; best = p.name; } } names[i] = best || ''; });
  return names;
}
$('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) takeImage(URL.createObjectURL(f), f.name); });
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) takeImage(URL.createObjectURL(f), f.name); });
$('momo').addEventListener('click', () => takeImage(new URL('momo.png', import.meta.url).href, 'momo.png',
  { name: 'MOMO', parts: [{ name: 'SCARF', c: [222, 58, 66] }, { name: 'COAT', c: [52, 158, 168] }, { name: 'CHEEK', c: [248, 164, 170] }] }));

// ── 2) 색 · 이름 ──────────────────────────────────────────────────────────────
const curColor = k => S.colors[k] || (k.startsWith('k') ? S.A.pal0['k' + (S.keyOrder[+k[1] - 1] + 1)] : S.A.pal0[k]);
function markDirty() { S.dirty = true; $('apply').disabled = false; status($('st2'), '바꾼 내용은 「바꾼 내용 적용」을 눌러야 미리 보기 · 영상에 들어갑니다.'); }
function renderControls() {
  const A = S.A, box = $('swatches'); box.innerHTML = '';
  const row = (key, label, hint, extra) => {
    const d = document.createElement('div'); d.className = 'sw';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = rgb2hex(curColor(key)).toLowerCase(); inp.setAttribute('aria-label', label + ' 색');
    inp.addEventListener('input', () => { S.colors[key] = hex2rgb(inp.value); markDirty(); drawCheck(); });
    const t = document.createElement('div'); t.innerHTML = `<div class="name">${label}</div><div class="hint">${hint}</div>`;
    d.append(inp, t); if (extra) d.append(extra); box.append(d);
  };
  for (const [k, l, h] of ROLE_UI) row(k, l, h + (k === 'deep' && !A.hasDeep ? ' · 이 그림엔 따로 없어 선과 종이 사이 색을 씀' : ''));
  [0, 1, 2].forEach(i => {
    const key = 'k' + (i + 1), ctl = document.createElement('div'); ctl.className = 'ctl';
    const up = document.createElement('button'); up.className = 'ghost'; up.textContent = '↑ 앞으로'; up.disabled = i === 0;
    const dn = document.createElement('button'); dn.className = 'ghost'; dn.textContent = '↓ 뒤로'; dn.disabled = i === 2;
    const nm = document.createElement('input'); nm.type = 'text'; nm.placeholder = `부위 이름(영문 · 예: SCARF) · 비우면 PART${i + 1}`; nm.value = S.partNames[i]; nm.maxLength = 16; nm.style.maxWidth = '240px';
    nm.addEventListener('input', () => { S.partNames[i] = nm.value; markDirty(); });
    const swap = j => { [S.keyOrder[i], S.keyOrder[j]] = [S.keyOrder[j], S.keyOrder[i]]; [S.partNames[i], S.partNames[j]] = [S.partNames[j], S.partNames[i]]; const a = S.colors['k' + (i + 1)], b = S.colors['k' + (j + 1)]; delete S.colors['k' + (i + 1)]; delete S.colors['k' + (j + 1)]; if (b) S.colors['k' + (i + 1)] = b; if (a) S.colors['k' + (j + 1)] = a; renderControls(); markDirty(); drawCheck(); };
    up.addEventListener('click', () => swap(i - 1)); dn.addEventListener('click', () => swap(i + 1));
    ctl.append(up, dn, nm);
    row(key, `색 ${i + 1}`, ['첫째로 돌아오는 색(18.7초~)', '둘째로 돌아오는 색(24.7초~)', '셋째로 돌아오는 색(30.7초~)'][i], ctl);
  });
  const w = $('warns'); w.innerHTML = '';
  for (const m of A.warnings) { const p = document.createElement('p'); p.className = 'warn'; p.textContent = '⚠ ' + m; w.append(p); }
  drawCheck();
}
function drawCheck() {
  const A = S.A; if (!A) return;
  const th = 300, k = th / A.h, tw = Math.max(1, Math.round(A.w * k)), c = $('chkFull'); c.width = tw; c.height = th;
  const g = c.getContext('2d'); g.clearRect(0, 0, tw, th); g.imageSmoothingQuality = 'high'; g.drawImage(A.cr, 0, 0, tw, th);
  g.lineWidth = 3; g.strokeStyle = '#f00';
  for (const [x, y] of (S.eyePick.length ? S.eyePick : S.eyes || A.eyes)) { g.beginPath(); g.arc(x * k, y * k, 8, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = '#00f';
  [0, 1, 2].forEach(i => { const [fx, fy] = A.fit['k' + (S.keyOrder[i] + 1)]; g.beginPath(); g.moveTo(fx * tw - 8, fy * th); g.lineTo(fx * tw + 8, fy * th); g.moveTo(fx * tw, fy * th - 8); g.lineTo(fx * tw, fy * th + 8); g.stroke(); g.fillStyle = '#00f'; g.font = 'bold 13px system-ui'; g.fillText(String(i + 1), fx * tw + 6, fy * th - 6); });
  const L = $('layers'); L.innerHTML = '';
  const layerOf = key => key.startsWith('k') ? A.lay['k' + (S.keyOrder[+key[1] - 1] + 1)] : A.lay[key];
  const tickCol = A.tickMedian || curColor('k1');
  for (const [key, label] of [['sil', '실루엣(종이)'], ['ink', '선'], ['deep', '진한 면'], ['k1', '색 1'], ['k2', '색 2'], ['k3', '색 3'], ['tick', '작은 표시']]) {
    const m = layerOf(key), col = key === 'sil' ? curColor('paper') : key === 'tick' ? tickCol : curColor(key);
    const tc = mkCanvas(A.w, A.h), tg = tc.getContext('2d'), id = tg.createImageData(A.w, A.h);
    for (let i = 0; i < m.length; i++) { if (!m[i]) continue; id.data[i * 4] = col[0]; id.data[i * 4 + 1] = col[1]; id.data[i * 4 + 2] = col[2]; id.data[i * 4 + 3] = m[i]; }
    tg.putImageData(id, 0, 0);
    const out = mkCanvas(Math.round(A.w * 120 / A.h), 120), og = out.getContext('2d'); og.imageSmoothingQuality = 'high'; og.drawImage(tc, 0, 0, out.width, out.height);
    const f = document.createElement('figure'); f.append(out); const cap = document.createElement('figcaption'); cap.textContent = label; f.append(cap); L.append(f);
  }
}
['name', 'title1', 'title2'].forEach(id => $(id).addEventListener('input', markDirty));
$('font').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) { S.font = null; markDirty(); return; }
  try { const fam = 'KitTitleFont' + Date.now(); const ff = new FontFace(fam, await f.arrayBuffer()); await ff.load(); document.fonts.add(ff); S.font = fam; markDirty(); status($('st2'), `글꼴 「${f.name}」 읽음 — 「바꾼 내용 적용」을 눌러 주세요.`); }
  catch (err) { S.font = null; status($('st2'), '글꼴 파일을 읽지 못했습니다: ' + (err.message || err), true); }
});
$('chkFull').addEventListener('click', e => {                 // 두 눈을 차례로 찍기(층 px 로 바꿔 저장)
  if (!S.A) return;
  const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * S.A.w, y = (e.clientY - r.top) / r.height * S.A.h;
  S.eyePick.push([x, y]);
  if (S.eyePick.length === 2) { S.eyes = S.eyePick.slice().sort((a, b) => a[0] - b[0]); S.eyePick = []; markDirty(); status($('st2'), '눈 자리를 바꿨습니다 — 「바꾼 내용 적용」을 눌러 주세요.'); }
  else status($('st2'), '눈 하나를 찍었습니다. 다른 눈을 눌러 주세요.');
  drawCheck();
});
$('apply').addEventListener('click', () => rebuild());
$('reset').addEventListener('click', () => { S.colors = {}; S.keyOrder = [0, 1, 2]; S.eyes = null; S.eyePick = []; renderControls(); markDirty(); });

async function rebuild() {
  if (!S.A) return;
  const was = S.busy; S.busy = true; $('apply').disabled = true; $('go').disabled = true;
  try {
    stopPlay();
    const B = await build(S.A, { keyOrder: S.keyOrder, colors: S.colors, name: $('name').value, title: [$('title1').value, $('title2').value].filter(s => s.trim()),
      partNames: { k1: S.partNames[0], k2: S.partNames[1], k3: S.partNames[2] }, eyes: S.eyes, font: S.font, PXF: S.PXF }, s => status($('st2'), s + '…'));
    if (S.scenes) { S.scenes.dispose(); S.scenes = null; }
    S.B = B;
    S.scenes = await mountScenes(B, $('host'), s => status($('st2'), s + '…'));
    S.dirty = false;
    const nonLatin = /[^\x00-\x7F]/.test($('name').value + $('title1').value + $('title2').value) && !S.font;
    status($('st2'), `준비 끝 · 눈 ${S.eyes ? '직접 찍음' : B.report.eyes_found ? '찾음' : '못 찾음(그림에서 두 눈을 눌러 주세요)'} · 제목 글자 ${B.report.letters}개`
      + (nonLatin ? ' · ⚠ 한글 등은 픽셀 글꼴에 없어 「?」로 나옵니다 — 글꼴 파일을 넣어 주세요' : ''));
    showFrame(+$('scrub').value || 1500);
    $('caption').value = caption();
  } catch (e) { console.error(e); status($('st2'), String(e.message || e), true); $('apply').disabled = false; }
  finally { S.busy = was; $('go').disabled = false; }
}

// ── 3) 미리 보기 ──────────────────────────────────────────────────────────────
const pv = $('pv'), pg = pv.getContext('2d');
const tcOf = f => { const s = f / 30; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
function showFrame(f) {
  if (!S.scenes || S.rendering) return;                         // 굽는 동안엔 장면을 건드리지 않음
  f = Math.max(0, Math.min(TOTAL - 1, f | 0));
  try { const cv = S.scenes.frame(f); pg.imageSmoothingQuality = 'high'; pg.drawImage(cv, 0, 0, pv.width, pv.height); } catch (e) { status($('st2'), String(e.message || e), true); }
  $('scrub').value = f; $('tc').textContent = tcOf(f);
}
$('scrub').addEventListener('input', e => { stopPlay(); showFrame(+e.target.value); });
const JUMPS = [['선화', 60], ['남의 색', 330], ['색 1', 600], ['색 2', 780], ['색 3', 960], ['엇나간 자리', 1150], ['정적', 1340], ['드롭', 1400], ['원판 속 세계', 1600], ['빛', 1800], ['끝 화면', 2399]];
for (const [l, f] of JUMPS) { const b = document.createElement('button'); b.className = 'ghost'; b.textContent = l; b.addEventListener('click', () => { stopPlay(); showFrame(f); }); $('jumps').append(b); }
let play = null;
async function ensureMusic() { if (!S.music) S.music = await loadMusic(MUSIC_URL); return S.music; }
function stopPlay() { if (!play) return; play.stop = true; try { play.src.stop(); } catch (e) { /* 이미 멈춤 */ } play.ctx.close(); play = null; $('play').textContent = '▶ 소리와 함께 재생'; }
$('play').addEventListener('click', async () => {
  if (play) return stopPlay();
  if (S.rendering || !S.scenes) return;
  $('play').disabled = true;
  try {
    const m = await ensureMusic(), ctx = new AudioContext({ sampleRate: m.sr }), buf = ctx.createBuffer(m.chans.length, m.chans[0].length, m.sr);
    m.chans.forEach((c, i) => buf.copyToChannel(c, i));
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    const f0 = +$('scrub').value >= TOTAL - 1 ? 0 : +$('scrub').value, t0 = ctx.currentTime + 0.05; src.start(t0, f0 / 30);
    play = { ctx, src, stop: false }; $('play').textContent = '■ 멈추기';
    const p = play, step = () => { if (p.stop) return; const f = f0 + Math.floor((ctx.currentTime - t0) * 30); if (f >= TOTAL) { stopPlay(); return; } if (f >= f0) showFrame(f); requestAnimationFrame(step); };
    requestAnimationFrame(step);
  } catch (e) { status($('st2'), String(e.message || e), true); }
  finally { $('play').disabled = false; }
});

// ── 4) 굽기 ──────────────────────────────────────────────────────────────────
const WANT = { wide: true, tall: true, feed: false };
for (const [k, f] of Object.entries(FORMATS)) {
  const l = document.createElement('label'), c = document.createElement('input'); c.type = 'checkbox'; c.checked = WANT[k]; c.addEventListener('change', () => { WANT[k] = c.checked; });
  const sub = { wide: '유튜브 롱폼 · 1920×1080 · 처음부터 끝까지', tall: '릴스 · 틱톡 · 쇼츠 · 1080×1920 · 드롭부터 끝까지(4:5 칸 + 위아래 여백 · 창이 음악 박마다 볼 거리로 이동)', feed: '인스타 피드 · 1080×1350 · 위와 같은 창, 여백 없이' }[k];
  l.append(c); const t = document.createElement('span'); t.innerHTML = `${f.label}<small>${sub}</small>`; l.append(t); $('formats').append(l);
}
function caption() {
  const nm = ($('name').value || '').trim();
  return `${nm ? nm + ' — ' : ''}WHAT YOUR COLOR.\n원본 영상: ${ORIGINAL}\n템플릿(원하는 캐릭터를 넣어 만드는 템플릿): ${location.href.split('#')[0].split('?')[0]}\n음악 · 화면 코드: color-longform-kit (CC0)`;
}
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('caption').value); $('copy').textContent = '복사됨'; setTimeout(() => { $('copy').textContent = '설명 문구 복사'; }, 1500); } catch (e) { $('caption').select(); } });
(async () => {
  const forceRT = new URLSearchParams(location.search).get('mode') === 'realtime';
  S.wc = forceRT ? null : await webCodecsInfo().catch(() => null);
  $('engine').textContent = S.wc ? `이 브라우저: 프레임마다 그려 굽기(WebCodecs · 영상 ${S.wc.video.toUpperCase()} · 소리 ${S.wc.audio.toUpperCase()}) — 빠르고 끊김 없음.`
    : '이 브라우저는 프레임 굽기(WebCodecs)를 지원하지 않아 실시간 녹화로 만듭니다 — 영상 길이만큼 걸리고, 녹화 중에는 이 탭을 앞에 두세요. Chrome · Edge 최신판에서는 더 빠르게 만들 수 있습니다.';
})();
$('go').addEventListener('click', async () => {
  if (!S.scenes || S.busy) return;
  const want = { ...WANT }; if (!want.wide && !want.tall && !want.feed) { status($('st4'), '만들 형식을 하나 이상 고르세요.', true); $('prog').hidden = false; return; }
  if (S.dirty) await rebuild();
  S.busy = true; S.rendering = true; stopPlay(); enable('s3', false); enable('s2', false); enable('s1', false);
  const ac = new AbortController(); S.abort = ac;
  $('results').querySelectorAll('a[download]').forEach(a => URL.revokeObjectURL(a.href));   // 앞서 만든 영상은 메모리에서 내림
  $('go').disabled = true; $('stop').hidden = false; $('prog').hidden = false; $('results').innerHTML = ''; $('share').hidden = true;
  const t0 = performance.now();
  try {
    status($('st4'), '음악 읽는 중…'); const music = await ensureMusic();
    const opts = { scenes: S.scenes, music, want, pad: S.B.PAL.night, geo: S.B.GEO, signal: ac.signal,
      onProgress: p => { $('bar').max = p.total; $('bar').value = p.done; const el = (performance.now() - (p.t0 || t0)) / 1000, eta = p.done > 10 && p.t0 ? el / p.done * (p.total - p.done) : null;
        status($('st4'), `${p.phase} · ${p.done}/${p.total}` + (eta !== null ? ` · 남은 시간 약 ${Math.ceil(eta)}초` : '') + (p.dropped ? ` · 빠진 프레임 ${p.dropped}` : '')); } };
    const out = S.wc ? await renderWebCodecs(opts) : await renderRealtime(opts);
    const slug = (($('name').value || 'character').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'character').toLowerCase();
    for (const k of ['wide', 'tall', 'feed']) {
      const blob = out[k]; if (!blob) continue;
      const url = URL.createObjectURL(blob), ext = blob.ext || 'mp4', fn = FORMATS[k].file.replace('what-your-color', `what-your-color_${slug}`).replace(/\.mp4$/, '.' + ext);
      const fig = document.createElement('figure'), v = document.createElement('video'); v.src = url; v.controls = true; v.playsInline = true; v.preload = 'metadata';
      v.addEventListener('loadedmetadata', () => { if (v.currentTime === 0 && v.paused) v.currentTime = Math.min(v.duration * 0.6, 50); }, { once: true });   // 첫 프레임은 어두워서 중간 장면을 대표 그림으로
      const cap = document.createElement('figcaption'), a = document.createElement('a'); a.href = url; a.download = fn; a.className = 'btn'; a.textContent = `내려받기 · ${FORMATS[k].label}`; a.dataset.format = k;
      cap.innerHTML = `<span>${fn} · ${(blob.size / 1048576).toFixed(1)}MB${blob.dropped ? ` · 실시간 녹화 중 빠진 프레임 ${blob.dropped}` : ''}</span>`; cap.prepend(a);
      fig.append(v, cap); $('results').append(fig);
    }
    status($('st4'), `완성 · ${((performance.now() - t0) / 1000).toFixed(0)}초 걸림. 소리를 켜고 끝까지 한 번 보세요 — 내 캐릭터답게 보이는지는 직접 보고 판정하는 게 가장 정확합니다.`);
    $('bar').value = $('bar').max; $('caption').value = caption(); $('share').hidden = false;
  } catch (e) { console.error(e); status($('st4'), e.name === 'AbortError' ? '멈췄습니다.' : '만들지 못했습니다: ' + (e.message || e), e.name !== 'AbortError'); }
  finally { S.busy = false; S.rendering = false; S.abort = null; $('go').disabled = false; $('stop').hidden = true; enable('s1', true); enable('s2', true); enable('s3', true); }
});
$('stop').addEventListener('click', () => { if (S.abort) S.abort.abort(); });
