/* 장면 실행기 — 키트의 장면 페이지 네 개(scenes/s12 · s34 · s56 · end.html)를 고치지 않고 그대로 iframe 안에서 돌린다.
   페이지가 읽는 build/ 준비물(kit.js · masks.js · 그림)은 디스크 대신 이 페이지 메모리에서 건넨다:
   - kit.js · masks.js 는 같은 내용의 인라인 스크립트로 바꿔 넣음
   - 그림은 페이지 안 `new Image()` 를 「메모리 그림을 그대로 담은 캔버스」로 바꿔치기해서 건넴(PNG 로 다시 굽지 않음 = 픽셀 그대로)
   - GSAP 은 저장소에 넣지 않으므로 CDN 에서 읽음(키트의 package.json 과 같은 판) */
export const GSAP_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js';
export const SCENES = [['s12', 560], ['s34', 800], ['s56', 600], ['end', 440]];
export const TOTAL = SCENES.reduce((a, s) => a + s[1], 0);   // 2400프레임 = 80초 @30fps

const safeJSON = v => JSON.stringify(v).replace(/</g, '\\u003c');
/* iframe 안에서 맨 먼저 도는 바꿔치기 — 'build/…' 경로의 그림을 부모 창 메모리(window.parent.__kitStore)에서 꺼내 캔버스로 돌려줌 */
const SHIM = `(function () {
  window.addEventListener('error', function (e) { window.__pageErr = String(e.message || e); });
  var store = window.parent.__kitStore, RealImage = window.Image;
  window.Image = function () {
    var c = document.createElement('canvas'), onload = null, onerror = null;
    Object.defineProperty(c, 'onload', { get: function () { return onload; }, set: function (f) { onload = f; } });
    Object.defineProperty(c, 'onerror', { get: function () { return onerror; }, set: function (f) { onerror = f; } });
    Object.defineProperty(c, 'src', { set: function (v) {
      var key = String(v).replace(/^(\\.\\.\\/)*build\\//, ''), s = store && store.get(key);
      if (!s) { var im = new RealImage(); im.onload = function () { c.width = im.naturalWidth; c.height = im.naturalHeight; c.naturalWidth = c.width; c.naturalHeight = c.height; c.getContext('2d').drawImage(im, 0, 0); if (onload) onload(); }; im.onerror = function () { if (onerror) onerror(new Error(v)); }; im.src = v; return; }
      c.width = s.width; c.height = s.height; c.naturalWidth = s.width; c.naturalHeight = s.height; c.getContext('2d').drawImage(s, 0, 0);
      setTimeout(function () { if (onload) onload(); }, 0);
    } });
    return c;
  };
})();`;

let HTML = null;                                                // 장면 페이지 원문(한 번만 읽음)
async function sceneHTML(name) {
  HTML = HTML || {};
  if (!HTML[name]) { const r = await fetch(new URL(`../scenes/${name}.html`, import.meta.url)); if (!r.ok) throw new Error(`장면 페이지를 못 읽었습니다: ${name} (${r.status})`); HTML[name] = r.text(); }
  return HTML[name];
}
function rewrite(html, name, data) {
  const base = new URL(`../scenes/${name}.html`, import.meta.url).href;
  const kit = `window.PAL = ${safeJSON(data.PAL)};\nwindow.GEO = ${safeJSON(data.GEO)};\nwindow.KIT = ${safeJSON(data.KIT)};`;
  const masks = `window.MK = ${safeJSON(data.MK)};`;
  let n = 0;
  const out = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    n++;
    if (/gsap/.test(src)) return `<script src="${GSAP_URL}"></script>`;
    if (/build\/kit\.js$/.test(src)) return `<script>${kit}</script>`;
    if (/build\/masks\.js$/.test(src)) return `<script>${masks}</script>`;
    return `<script src="${new URL(src, base).href}"></script>`;
  });
  if (!n) throw new Error(`장면 페이지 형식이 예상과 다릅니다: ${name}`);
  return out.replace(/<meta charset="utf-8">/i, `<meta charset="utf-8">\n<base href="${base}">\n<script>${SHIM}</script>`);
}

/* 네 장면을 띄우고 준비될 때까지 기다림 → { frame(f) → 그 프레임을 그린 캔버스, dispose() } */
export async function mountScenes(data, host, onStep = () => {}) {
  window.__kitStore = data.store;
  const frames = [];
  for (const [name, n] of SCENES) {
    onStep(`장면 준비 중 (${name})`);
    const html = rewrite(await sceneHTML(name), name, data);
    const fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1;
    fr.style.cssText = 'position:absolute;left:-10000px;top:0;width:1920px;height:1080px;border:0;visibility:hidden;pointer-events:none';
    host.appendChild(fr);
    fr.srcdoc = html;
    await new Promise(res => fr.addEventListener('load', res, { once: true }));
    const win = fr.contentWindow;
    for (let t = 0; ; t += 50) {
      if (win.__ready) break;
      const err = win.__err || win.__dryErr || win.__pageErr;
      if (err) throw new Error(`장면 ${name} 오류: ${err}`);
      if (t > 120000) throw new Error(`장면 ${name} 준비 시간 초과 — 인터넷 연결(GSAP CDN)을 확인해 주세요`);
      await new Promise(r => setTimeout(r, 50));
    }
    if (win.__TOTAL !== n) throw new Error(`장면 ${name} 프레임 수가 다릅니다: ${win.__TOTAL} ≠ ${n}`);
    frames.push({ name, n, fr, win, cv: fr.contentDocument.getElementById('cv') });
  }
  const starts = []; let acc = 0; for (const s of frames) { starts.push(acc); acc += s.n; }
  return {
    total: acc,
    frame(f) {                                                  // 전체 프레임 번호(0~2399) → 그 장면을 시크해서 캔버스를 돌려줌
      f = Math.max(0, Math.min(acc - 1, f | 0));
      let i = frames.length - 1; while (starts[i] > f) i--;
      const s = frames[i]; s.win.__seekF(f - starts[i]);
      if (s.win.__pageErr) throw new Error(`장면 ${s.name} 오류: ${s.win.__pageErr}`);
      return s.cv;
    },
    dispose() { frames.forEach(s => s.fr.remove()); },
  };
}
