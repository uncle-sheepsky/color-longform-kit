// 렌더러 — 장면 페이지(1920×1080)를 프레임마다 시크해 캔버스 픽셀을 굽는다.
// 래스터 = SwiftShader(소프트웨어 그리기 · 결정론) · 판정 = 페이지 안에서 원시 픽셀로 잰 해시(window.__hash).
// 사용:
//   node render.mjs --page scenes/s12.html --spot 0,100,300 [--out spot/s12]   : 지정 프레임만 PNG 로(눈으로 확인)
//   node render.mjs --page scenes/s12.html --video out/s12.mp4 --name s12_fwd   : 모든 프레임 → ffmpeg(H.264) + 프레임별 해시 gates/s12_fwd.json
//   node render.mjs --page scenes/s12.html --sha-only --order rev --name s12_rev : 파일 없이 해시만 거꾸로(같은 프레임이 같은 픽셀인지 대조)
//   --from N --to M  : 프레임 범위 · --build <폴더> : build/ 대신 다른 준비물 폴더를 씀(비교 시험용)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(k);
const PAGE = arg('--page', null);
if (!PAGE) { console.error('--page scenes/<장면>.html 이 필요합니다'); process.exit(1); }
const BUILD = path.resolve(HERE, arg('--build', 'build'));
if (!fs.existsSync(path.join(BUILD, 'masks.js'))) { console.error(`준비물이 없습니다: ${BUILD} — 먼저 python tools/prep.py`); process.exit(1); }
const pw = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.js')).href);
const { chromium } = pw.default ?? pw;

const FPS = 30, VW = 1920, VH = 1080;
const SPOT = arg('--spot', null), VIDEO = arg('--video', null), SHA_ONLY = has('--sha-only'), ORDER = arg('--order', 'fwd');

// 정적 서버: 저장소 루트를 그대로 · /build/ 는 --build 폴더로
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = rel.startsWith('/build/') ? BUILD : HERE, p = path.join(base, rel.startsWith('/build/') ? rel.slice(7) : rel);
  if (!p.startsWith(base) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

const FLAGS = ['--disable-lcd-text', '--disable-font-subpixel-positioning', '--force-color-profile=srgb', '--disable-partial-raster',
  '--disable-skia-runtime-opts', '--disable-gpu-rasterization', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu'];
const browser = await chromium.launch({ args: FLAGS });
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const quit = async code => { await browser.close(); srv.close(); process.exit(code); };
await page.goto(`http://127.0.0.1:${PORT}/${PAGE}`, { waitUntil: 'load' });
for (let t = 0; ; t += 250) {                                // 준비 끝 · 오류 · 페이지 스크립트 오류 중 먼저 오는 것까지 기다림
  if (errs.length || await page.evaluate('window.__ready === true || !!window.__err')) break;
  if (t > 900000) { console.error('준비 시간 초과(15분)'); await quit(2); }
  await new Promise(r => setTimeout(r, 250));
}
const loadErr = await page.evaluate('window.__err || null');
if (loadErr) { console.error('로드 오류:', loadErr); await quit(2); }
if (errs.length) { console.error('페이지 오류:', errs); await quit(2); }
const dryErr = await page.evaluate('window.__dryErr || null');
if (dryErr) { console.error('빈 실행 오류:', dryErr); await quit(2); }
const t0 = Date.now(), name0 = path.basename(PAGE, '.html');

if (SPOT) {
  const out = path.join(HERE, arg('--out', path.join('spot', name0))); fs.mkdirSync(out, { recursive: true });
  for (const f of SPOT.split(',').map(Number)) {
    const b64 = await page.evaluate(ff => { window.__seekF(ff); return document.getElementById('cv').toDataURL('image/png').split(',')[1]; }, f);
    fs.writeFileSync(path.join(out, `f${String(f).padStart(4, '0')}.png`), Buffer.from(b64, 'base64'));
  }
  console.log(`스팟 ${SPOT.split(',').length}장 · ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out}`);
} else {
  const TOTAL = await page.evaluate('window.__TOTAL'), FROM = +arg('--from', 0), TO = +arg('--to', TOTAL - 1);
  const frames = []; for (let f = FROM; f <= TO; f++) frames.push(f);
  if (ORDER === 'rev') frames.reverse();
  let ff = null;
  if (VIDEO && !SHA_ONLY) {
    fs.mkdirSync(path.dirname(path.join(HERE, VIDEO)), { recursive: true });
    ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15',
      '-profile:v', 'high', '-level', '4.2', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-r', String(FPS), path.join(HERE, VIDEO)], { stdio: ['pipe', 'inherit', 'inherit'] });
  }
  const shas = {};
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k];
    if (ff) {
      const r = await page.evaluate(x => { window.__seekF(x); return [window.__hash(), document.getElementById('cv').toDataURL('image/png').split(',')[1]]; }, f);
      shas[f] = r[0];
      if (!ff.stdin.write(Buffer.from(r[1], 'base64'))) await new Promise(res => ff.stdin.once('drain', res));
    } else {
      shas[f] = await page.evaluate(x => { window.__seekF(x); return window.__hash(); }, f);
    }
    if (k % 120 === 0) process.stdout.write(`  ${k}/${frames.length} f${f} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  if (ff) { ff.stdin.end(); await new Promise(res => ff.on('close', res)); }
  fs.mkdirSync(path.join(HERE, 'gates'), { recursive: true });
  const name = arg('--name', `${name0}_${ORDER}`);
  fs.writeFileSync(path.join(HERE, 'gates', `${name}.json`), JSON.stringify(shas));
  console.log(`완료 ${frames.length}프레임 · ${((Date.now() - t0) / 1000).toFixed(1)}s · gates/${name}.json`);
}
if (errs.length) { console.error('페이지 오류:', errs); await quit(2); }
await quit(0);
