/* 영상 굽기 — 브라우저 안에서 프레임마다 장면을 시크해 그린 그림을 WebCodecs 로 H.264(안 되면 VP9 · AV1) 인코딩하고,
   CC0 음악(music/color_longform.wav)을 AAC(안 되면 Opus)로 넣어 MP4 로 묶는다. WebCodecs 가 없는 브라우저는 MediaRecorder 로 실시간 녹화.
   세로판 = tools/make_short.py 와 같은 방법: 롱폼의 드롭 ~ 끝(136~240박 · 34.67초)에서 「볼 거리」 가로 위치를 재고,
   4:5 창(864×1080)을 음악 박에 맞춰 옮겨 1080×1350 으로 키움(9:16 은 위아래에 어두운 여백 · 4:5 는 칸만). */
import { Muxer, ArrayBufferTarget } from 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs';

const FPS = 30, W = 1920, H = 1080, FPB = 10, SR = 48000;
const B0 = 136, B1 = 240, F0 = B0 * FPB, NF = (B1 - B0) * FPB;  // 세로판 = 1360~2399프레임
const IW = 1080, IH = 1350, CW = H * IW / IH, AW = 480, AH = 270, PAD_Y = (1920 - IH) / 2;
export const FORMATS = {
  wide: { w: 1920, h: 1080, label: '16:9 가로 (80초)', file: 'what-your-color_16x9.mp4', bitrate: 12e6 },
  tall: { w: 1080, h: 1920, label: '9:16 세로 (34.7초)', file: 'what-your-color_9x16.mp4', bitrate: 10e6 },
  feed: { w: 1080, h: 1350, label: '4:5 세로 (34.7초)', file: 'what-your-color_4x5.mp4', bitrate: 9e6 },
};

// ── 음악 ─────────────────────────────────────────────────────────────────────
export async function loadMusic(url) {                          // 16비트 PCM WAV → 채널별 Float32
  const r = await fetch(url); if (!r.ok) throw new Error(`음악 파일을 못 읽었습니다 (${r.status})`);
  const buf = await r.arrayBuffer(), dv = new DataView(buf);
  let p = 12, fmt = null;
  while (p + 8 <= buf.byteLength) {
    const id = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3)), size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') fmt = { ch: dv.getUint16(p + 10, true), sr: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('16비트 PCM WAV 만 읽을 수 있습니다');
      const n = Math.floor(size / (2 * fmt.ch)), chans = Array.from({ length: fmt.ch }, () => new Float32Array(n));
      for (let i = 0, q = p + 8; i < n; i++) for (let c = 0; c < fmt.ch; c++, q += 2) chans[c][i] = dv.getInt16(q, true) / 32768;
      return { sr: fmt.sr, chans };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('WAV 형식을 읽지 못했습니다');
}
function slice(music, t0, dur, gainDb = 0) {
  const a = Math.round(t0 * music.sr), n = Math.round(dur * music.sr), g = Math.pow(10, gainDb / 20);
  return { sr: music.sr, chans: music.chans.map(c => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (c[a + i] || 0) * g; return o; }) };
}

// ── 코덱 고르기 ───────────────────────────────────────────────────────────────
async function pickVideo(w, h, bitrate) {
  const tries = [['avc', 'avc1.640028'], ['avc', 'avc1.640032'], ['avc', 'avc1.4d0028'], ['avc', 'avc1.4d0032'], ['vp9', 'vp09.00.40.08'], ['av1', 'av01.0.08M.08']];
  for (const [kind, codec] of tries) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: FPS, latencyMode: 'quality', ...(kind === 'avc' ? { avc: { format: 'avc' } } : {}) };
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return { kind, cfg }; } catch (e) { /* 다음 후보 */ }
  }
  return null;
}
async function pickAudio(ch) {
  for (const [kind, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate: SR, numberOfChannels: ch, bitrate: 192000 };
    try { const s = await AudioEncoder.isConfigSupported(cfg); if (s.supported) return { kind, cfg }; } catch (e) { /* 다음 후보 */ }
  }
  return null;
}
export async function webCodecsInfo() {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const v = await pickVideo(1920, 1080, 12e6), vt = await pickVideo(1080, 1920, 10e6), a = await pickAudio(2);
  return v && vt && a ? { video: v.kind, audio: a.kind } : null;
}
async function encodeAudio(pcm, ac) {                           // → [{ chunk, meta }]
  const out = []; let err = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => out.push({ chunk, meta }), error: e => { err = e; } });
  enc.configure(ac.cfg);
  const n = pcm.chans[0].length, ch = pcm.chans.length, step = 4800;
  for (let i = 0; i < n; i += step) {
    const m = Math.min(step, n - i), data = new Float32Array(m * ch);
    for (let c = 0; c < ch; c++) data.set(pcm.chans[c].subarray(i, i + m), c * m);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: pcm.sr, numberOfFrames: m, numberOfChannels: ch, timestamp: Math.round(i * 1e6 / pcm.sr), data });
    enc.encode(ad); ad.close();
  }
  await enc.flush(); enc.close();
  if (err) throw err;
  return out;
}

// ── 한 파일 = 인코더 + 묶개 ─────────────────────────────────────────────────────
async function makeTrack(fmt, vc, ac, audioChunks) {
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: vc.kind, width: fmt.w, height: fmt.h, frameRate: FPS },
    audio: { codec: ac.kind, numberOfChannels: ac.cfg.numberOfChannels, sampleRate: SR }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let err = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { err = e; } });
  enc.configure(vc.cfg);
  for (const { chunk, meta } of audioChunks) muxer.addAudioChunk(chunk, meta);
  let n = 0;
  return {
    async add(src) {                                            // src = 캔버스 · 프레임 번호는 차례대로
      if (err) throw err;
      const vf = new VideoFrame(src, { timestamp: Math.round(n * 1e6 / FPS), duration: Math.round(1e6 / FPS) });   // 기다리기 전에 지금 그림을 떠 둠
      while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 2));
      enc.encode(vf, { keyFrame: n % (2 * FPS) === 0 }); vf.close(); n++;
    },
    async finish() { await enc.flush(); enc.close(); if (err) throw err; muxer.finalize(); return new Blob([muxer.target.buffer], { type: 'video/mp4' }); },
    abort() { try { enc.close(); } catch (e) { /* 이미 닫힘 */ } },
  };
}

// ── 세로판 카메라(tools/make_short.py 의 plan() 을 그대로) ───────────────────────────
function profileOf(px, prev) {                                  // 480×270 RGBA → [가로 무게중심, 열별 볼 거리]
  const n = AW * AH, rs = [], gs = [], bs = [];
  for (let p = 0; p < n; p += 37) { rs.push(px[p * 4]); gs.push(px[p * 4 + 1]); bs.push(px[p * 4 + 2]); }   // np.median(a.reshape(-1,3)[::37]) 와 같은 표본(37픽셀마다)
  const med = a => { a.sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const bg = [med(rs), med(gs), med(bs)], w = new Float64Array(AW);
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    const j = (y * AW + x) * 4;
    const far = Math.abs(px[j] - bg[0]) + Math.abs(px[j + 1] - bg[1]) + Math.abs(px[j + 2] - bg[2]) > 60 ? 1 : 0;
    const mov = prev && Math.abs(px[j] - prev[j]) + Math.abs(px[j + 1] - prev[j + 1]) + Math.abs(px[j + 2] - prev[j + 2]) > 24 ? 1 : 0;
    w[x] += 2 * mov + far;
  }
  let s = 0, sx = 0; for (let x = 0; x < AW; x++) { s += w[x]; sx += w[x] * x * (W / AW); }
  return [s > 50 ? sx / s : W / 2, w];
}
export function planCamera(xs, prof, geo) {
  const ease3o = u => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
  const L = geo.letters.filter(p => p.x + p.w < 976);
  const LOGO_X = L.length ? (Math.min(...L.map(p => p.x)) + Math.max(...L.map(p => p.x + p.w))) / 2 : 545, CHAR_X = geo.end_pose.x + geo.end_pose.size[0] / 2;
  const n = xs.length, lo = CW / 2, hi = W - CW / 2;
  const pad = [...Array(6).fill(xs[0]), ...xs, ...Array(6).fill(xs[n - 1])], sm = xs.map((_, f) => { let s = 0; for (let k = 0; k < 13; k++) s += pad[f + k]; return s / 13; });
  const CANDS = Array.from({ length: 13 }, (_, i) => lo + (hi - lo) * i / 12);
  const score = (b, span, c) => {                               // 그 창 안 볼 거리 합(다음 span 박 동안)
    const a = Math.trunc((b - B0) * FPB), z = Math.trunc((b + span - B0) * FPB), e = Math.max(a + 1, z), c0 = Math.trunc((c - CW / 2) * AW / W), c1 = Math.trunc((c + CW / 2) * AW / W);
    let s = 0, cnt = 0; for (let f = a; f < Math.min(e, prof.length); f++) { cnt++; for (let x = c0; x < c1; x++) s += prof[f][x]; }
    return cnt ? s / cnt : 0;
  };
  const hopTo = (b, span, cur, k) => {
    const sc = CANDS.map(c => [c, score(b, span, c)]), best = Math.max(...sc.map(e => e[1])), far = sc.filter(([c]) => Math.abs(c - cur) >= 260);
    const argmax = arr => arr.reduce((a, e) => e[1] > a[1] ? e : a)[0];
    if (k % 4 === 0 || !far.length || Math.max(...far.map(e => e[1])) < 0.35 * best) return argmax(sc);
    return argmax(far);
  };
  const sched = [];
  for (let b = 136; b < 156; b++) sched.push([b, 1]);
  for (let b = 156; b < 172; b += 2) sched.push([b, 2]);
  sched.push([192.1, 3.9]);
  for (let b = 196; b < 207; b += 2) sched.push([b, Math.min(2, 207 - b)]);
  for (let b = 208; b < 213; b++) sched.push([b, 1]);
  const hops = []; let curH = W / 2;
  sched.forEach(([b, span], k) => { curH = hopTo(b, span, curH, k); hops.push([b, curH]); });
  const cx = new Float64Array(n), zoom = new Float64Array(n).fill(1); let cur = W / 2;
  for (let f = 0; f < n; f++) {
    const b = B0 + f / FPB;
    if (b >= 172 && b < 192.1) { cur = Math.min(hi, Math.max(lo, sm[f])); cx[f] = cur; continue; }   // 빛: 천천히 따라감
    if (b >= 213) {                                             // 글자 → 캐릭터
      const x213 = cx[Math.trunc((213 - B0) * FPB) - 1];
      if (b < 213.6) cx[f] = x213 + (lo - x213) * ease3o((b - 213) / 0.6);
      else if (b < 223.2) cx[f] = lo + (LOGO_X - lo) * ((b - 213.6) / 9.6);
      else if (b < 225) cx[f] = LOGO_X;
      else if (b < 226.4) { const u = (b - 225) / 1.4; cx[f] = LOGO_X + (CHAR_X - LOGO_X) * (0.5 - 0.5 * Math.cos(Math.PI * u)); }
      else { cx[f] = CHAR_X + 18 * Math.sin((b - 226.4) * 0.5); zoom[f] = 1 + 0.04 * Math.min(1, Math.max(0, (b - 228) / 12)); }
      cur = cx[f]; continue;
    }
    if (b >= 207 && b < 208) { cx[f] = cur; continue; }         // 웅크림 = 멈춤
    let i = -1; for (let j = 0; j < hops.length; j++) if (hops[j][0] <= b + 1e-9) i = j;
    if (i < 0) { cx[f] = cur; continue; }
    const [hb, hx] = hops[i];
    let fromx = i > 0 ? hops[i - 1][1] : W / 2;
    if ((i > 0 && hops[i - 1][0] < 172 && 172 <= hb) || hb === 192.1 || hb === 196 || hb === 208) fromx = cx[Math.max(0, Math.round((hb - B0) * FPB) - 1)];
    cur = fromx + (hx - fromx) * ease3o((b - hb) * FPB / 4);    // 4프레임 동안 빠르게 감속
    cx[f] = cur;
    if ((b >= 136 && b < 156) || (b >= 208 && b < 224)) { const t = (b - Math.floor(b)) * (60 / 180); zoom[f] = 1 + 0.07 * Math.exp(-t / 0.12); }   // 박마다 살짝 당겨짐
  }
  return { cx, zoom };
}
function cropWindow(cam, k) { const z = cam.zoom[k], w = CW / z, h = H / z; return [Math.min(Math.max(cam.cx[k] - w / 2, 0), W - w), (H - h) / 2, w, h]; }

// ── 굽기(WebCodecs) ───────────────────────────────────────────────────────────
/* scenes = mountScenes() 결과 · want = { wide, tall, feed } · pad = 세로 여백 색 [r,g,b] · geo = GEO(끝 화면 글자 · 캐릭터 자리)
   onProgress({ phase, done, total }) · signal.aborted 이면 멈춤 → { wide: Blob, … } */
export async function renderWebCodecs({ scenes, music, want, pad, geo, onProgress, signal }) {
  const vt = {}, ac = await pickAudio(2);
  if (!ac) throw new Error('이 브라우저는 음악 인코딩(AAC · Opus)을 지원하지 않습니다');
  for (const k of Object.keys(want)) if (want[k]) { vt[k] = await pickVideo(FORMATS[k].w, FORMATS[k].h, FORMATS[k].bitrate); if (!vt[k]) throw new Error(`이 브라우저는 ${FORMATS[k].label} 영상 인코딩을 지원하지 않습니다`); }
  onProgress({ phase: '음악 인코딩', done: 0, total: 1 });
  const needShort = want.tall || want.feed;
  const aFull = want.wide ? await encodeAudio(music, ac) : null;
  const aShort = needShort ? await encodeAudio(slice(music, B0 * 60 / 180, NF / FPS, -1.0), ac) : null;   // 숏폼: 45.333~80초 · AAC 피크 여유로 −1 dB
  const tracks = {}, out = {};
  try {
    if (want.wide) tracks.wide = await makeTrack(FORMATS.wide, vt.wide, ac, aFull);
    const small = needShort ? document.createElement('canvas') : null; let sg = null, prevPx = null;
    const xs = [], prof = [];
    if (small) { small.width = AW; small.height = AH; sg = small.getContext('2d', { willReadFrequently: true }); sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high'; }
    const fStart = want.wide ? 0 : F0, total1 = scenes.total - fStart, t0 = performance.now();
    for (let f = fStart; f < scenes.total; f++) {               // 1차: 롱폼 굽기 + 세로판용 분석
      if (signal.aborted) throw new DOMException('멈춤', 'AbortError');
      const cv = scenes.frame(f);
      if (small && f >= F0) { sg.drawImage(cv, 0, 0, AW, AH); const px = sg.getImageData(0, 0, AW, AH).data; const [x, w] = profileOf(px, prevPx); xs.push(x); prof.push(w); prevPx = px; }
      if (tracks.wide) await tracks.wide.add(cv);
      if ((f & 7) === 0) { onProgress({ phase: want.wide ? '16:9 굽는 중' : '세로판 분석 중', done: f - fStart, total: total1, t0, src: cv }); await new Promise(r => setTimeout(r, 0)); }
    }
    if (tracks.wide) { onProgress({ phase: '16:9 마무리', done: total1, total: total1, t0 }); out.wide = await tracks.wide.finish(); delete tracks.wide; }
    if (needShort) {                                            // 2차: 창을 옮기며 세로판 굽기(같은 프레임을 다시 그림 = 같은 그림)
      const cam = planCamera(xs, prof, geo);
      const tall = want.tall ? Object.assign(document.createElement('canvas'), { width: 1080, height: 1920 }) : null;
      const feed = want.feed ? Object.assign(document.createElement('canvas'), { width: IW, height: IH }) : null;
      if (want.tall) tracks.tall = await makeTrack(FORMATS.tall, vt.tall, ac, aShort);
      if (want.feed) tracks.feed = await makeTrack(FORMATS.feed, vt.feed, ac, aShort);
      const t1 = performance.now();
      for (let k = 0; k < NF; k++) {
        if (signal.aborted) throw new DOMException('멈춤', 'AbortError');
        const cv = scenes.frame(F0 + k), [x0, y0, w, h] = cropWindow(cam, k);
        if (tall) { const g = tall.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.fillStyle = `rgb(${pad.join(',')})`; g.fillRect(0, 0, 1080, 1920); g.drawImage(cv, x0, y0, w, h, 0, PAD_Y, IW, IH); await tracks.tall.add(tall); }
        if (feed) { const g = feed.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(cv, x0, y0, w, h, 0, 0, IW, IH); await tracks.feed.add(feed); }
        if ((k & 7) === 0) { onProgress({ phase: '세로판 굽는 중', done: k, total: NF, t0: t1, src: tall || feed }); await new Promise(r => setTimeout(r, 0)); }
      }
      onProgress({ phase: '세로판 마무리', done: NF, total: NF, t0: t1 });
      for (const k of ['tall', 'feed']) if (tracks[k]) { out[k] = await tracks[k].finish(); delete tracks[k]; }
    }
    return out;
  } finally { for (const t of Object.values(tracks)) t.abort(); }
}

// ── 굽기(MediaRecorder · 실시간 녹화 — WebCodecs 가 없는 브라우저용) ─────────────────────
/* 실제 시간으로 음악을 틀며 그 시각의 프레임을 그려 녹화한다. 그리기가 1/30초보다 느리면 프레임이 빠질 수 있음 · 녹화 중엔 이 탭을 앞에 둘 것 */
export async function renderRealtime({ scenes, music, want, pad, geo, onProgress, signal }) {
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error('이 브라우저는 영상 녹화(MediaRecorder)를 지원하지 않습니다');
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm', out = {};
  let cam = null;
  if (want.tall || want.feed) {                                 // 세로판 창 계획은 녹화 전에 분석만 먼저(빠름)
    const small = Object.assign(document.createElement('canvas'), { width: AW, height: AH }), sg = small.getContext('2d', { willReadFrequently: true }); let prevPx = null; const xs = [], prof = [];
    for (let k = 0; k < NF; k++) { if (signal.aborted) throw new DOMException('멈춤', 'AbortError'); sg.drawImage(scenes.frame(F0 + k), 0, 0, AW, AH); const px = sg.getImageData(0, 0, AW, AH).data; const [x, w] = profileOf(px, prevPx); xs.push(x); prof.push(w); prevPx = px; if ((k & 15) === 0) { onProgress({ phase: '세로판 분석 중', done: k, total: NF }); await new Promise(r => setTimeout(r, 0)); } }
    cam = planCamera(xs, prof, geo);
  }
  const jobs = [];
  if (want.wide) jobs.push(['wide', 0, scenes.total, music]);
  if (want.tall) jobs.push(['tall', F0, scenes.total, slice(music, B0 * 60 / 180, NF / FPS, -1.0)]);
  if (want.feed) jobs.push(['feed', F0, scenes.total, slice(music, B0 * 60 / 180, NF / FPS, -1.0)]);
  for (const [key, fa, fb, pcm] of jobs) {
    const fmt = FORMATS[key], cv = Object.assign(document.createElement('canvas'), { width: fmt.w, height: fmt.h }), g = cv.getContext('2d');
    const draw = f => {
      const src = scenes.frame(f);
      if (key === 'wide') { g.drawImage(src, 0, 0); return; }
      const [x0, y0, w, h] = cropWindow(cam, f - F0); g.imageSmoothingQuality = 'high';
      if (key === 'tall') { g.fillStyle = `rgb(${pad.join(',')})`; g.fillRect(0, 0, 1080, 1920); g.drawImage(src, x0, y0, w, h, 0, PAD_Y, IW, IH); }
      else g.drawImage(src, x0, y0, w, h, 0, 0, IW, IH);
    };
    draw(fa);
    const actx = new AudioContext({ sampleRate: pcm.sr }), buf = actx.createBuffer(pcm.chans.length, pcm.chans[0].length, pcm.sr);
    pcm.chans.forEach((c, i) => buf.copyToChannel(c, i));
    const srcN = actx.createBufferSource(), dest = actx.createMediaStreamDestination(); srcN.buffer = buf; srcN.connect(dest);
    const cap = cv.captureStream(0), vtrack = cap.getVideoTracks()[0];   // 0 = 그린 뒤 requestFrame() 으로 한 장씩 넘김
    const stream = new MediaStream([vtrack, ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: fmt.bitrate, audioBitsPerSecond: 192000 }), parts = [];
    rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    const stopped = new Promise(r => { rec.onstop = r; });
    await actx.resume(); rec.start(1000);
    const tStart = actx.currentTime + 0.15; srcN.start(tStart);
    const dur = (fb - fa) / FPS; let last = -1, dropped = 0, ticker = null;
    await new Promise((res, rej) => {
      let done = false;
      const step = () => {                                      // 시계 = 음악 재생 시각(소리와 그림이 같은 시계)
        if (done) return;
        if (signal.aborted) { done = true; rej(new DOMException('멈춤', 'AbortError')); return; }
        const t = actx.currentTime - tStart, k = Math.floor(t * FPS);
        if (t >= dur) { done = true; res(); return; }
        if (k >= 0 && k !== last) { if (last >= 0 && k > last + 1) dropped += k - last - 1; draw(fa + Math.min(k, fb - fa - 1)); if (vtrack.requestFrame) vtrack.requestFrame(); last = k; onProgress({ phase: `${fmt.label} 실시간 녹화 중`, done: k, total: fb - fa, dropped, src: cv }); }
      };
      const raf = () => { step(); if (!done) requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
      if (actx.createScriptProcessor) {                         // 탭이 뒤로 가 화면 갱신(rAF)이 멈춰도 소리 처리 신호는 계속 옴 → 그것으로도 그림
        ticker = actx.createScriptProcessor(512, 1, 1); ticker.onaudioprocess = step;
        const mute = actx.createGain(); mute.gain.value = 0; ticker.connect(mute); mute.connect(actx.destination);
      }
    }).finally(() => { try { srcN.stop(); } catch (e) { /* 이미 멈춤 */ } if (ticker) ticker.onaudioprocess = null; });
    rec.stop(); await stopped; await actx.close();
    out[key] = new Blob(parts, { type: mime.split(';')[0] }); out[key].ext = ext; out[key].dropped = dropped;
  }
  return out;
}
