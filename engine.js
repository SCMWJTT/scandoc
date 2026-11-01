/* ScanDoc engine: image pipeline, PDF writer, vault crypto, backup packing.
   No access to the screen or the app state. Works in the browser and in Node (for tests).
   Needs window.CONFIG (config.js) and, in the browser, a document for canvases. */
(function (root) {
'use strict';
const CFG = root.CONFIG;
let mk = (w, h) => { const c = root.document.createElement('canvas'); c.width = w; c.height = h; return c; };
function setCanvasFactory(f) { mk = f; }
const enc = new TextEncoder(), dec = new TextDecoder();

function homography(q) {
  // unit square (0,0)(1,0)(1,1)(0,1) -> quad q[0..3] (TL, TR, BR, BL)
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [q[0].x, q[0].y, q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y];
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; h = 0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return { a, b, c, d, e, f, g, h };
}

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

function quadSize(corners, W, H) {
  const P = corners.map(p => ({ x: p.x * W, y: p.y * H }));
  return { w: (dist(P[0], P[1]) + dist(P[3], P[2])) / 2, h: (dist(P[0], P[3]) + dist(P[1], P[2])) / 2 };
}

// Flatten the quad (pixel coords in src canvas) into a cw x ch image.
function warp(src, q, cw, ch) {
  const qw = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), qh = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const r = Math.max(qw / cw, qh / ch);
  let s = src, qq = q;
  if (r > 1.5) {                       // pre-shrink so bilinear sampling does not alias
    const sc = 1.5 / r;
    s = mk(Math.max(1, Math.round(src.width * sc)), Math.max(1, Math.round(src.height * sc)));
    const x = s.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, s.width, s.height);
    qq = q.map(p => ({ x: p.x * s.width / src.width, y: p.y * s.height / src.height }));
  }
  const sd = s.getContext('2d').getImageData(0, 0, s.width, s.height);
  const sw = sd.width, sh = sd.height, S8 = sd.data;
  const out = new ImageData(cw, ch), o = out.data;
  const Hm = homography(qq);
  const maxX = sw - 1.001, maxY = sh - 1.001;
  for (let j = 0; j < ch; j++) {
    const v = (j + 0.5) / ch;
    for (let i = 0; i < cw; i++) {
      const u = (i + 0.5) / cw;
      const w = Hm.g * u + Hm.h * v + 1;
      let sx = (Hm.a * u + Hm.b * v + Hm.c) / w - 0.5, sy = (Hm.d * u + Hm.e * v + Hm.f) / w - 0.5;
      sx = sx < 0 ? 0 : sx > maxX ? maxX : sx;
      sy = sy < 0 ? 0 : sy > maxY ? maxY : sy;
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const p = (j * cw + i) * 4;
      o[p]     = S8[i00] * w00 + S8[i10] * w10 + S8[i01] * w01 + S8[i11] * w11;
      o[p + 1] = S8[i00 + 1] * w00 + S8[i10 + 1] * w10 + S8[i01 + 1] * w01 + S8[i11 + 1] * w11;
      o[p + 2] = S8[i00 + 2] * w00 + S8[i10 + 2] * w10 + S8[i01 + 2] * w01 + S8[i11 + 2] * w11;
      o[p + 3] = 255;
    }
  }
  return out;
}

// Running-sum box blur on RGBA (alpha forced to 255). Row-wise passes keep memory access sequential.
function boxBlur(src, w, h, r) {
  const st = w * 4, dd = 2 * r + 1, inv = 1 / dd;
  const tmp = new Uint8ClampedArray(src.length), out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * st;
    let s0 = 0, s1 = 0, s2 = 0;
    for (let x = -r; x <= r; x++) { const k = row + (x < 0 ? 0 : x >= w ? w - 1 : x) * 4; s0 += src[k]; s1 += src[k + 1]; s2 += src[k + 2]; }
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      tmp[o] = s0 * inv; tmp[o + 1] = s1 * inv; tmp[o + 2] = s2 * inv;
      const xi = row + (x + r + 1 >= w ? w - 1 : x + r + 1) * 4, xo = row + (x - r < 0 ? 0 : x - r) * 4;
      s0 += src[xi] - src[xo]; s1 += src[xi + 1] - src[xo + 1]; s2 += src[xi + 2] - src[xo + 2];
    }
  }
  const sums = new Int32Array(w * 3);
  for (let y = -r; y <= r; y++) {
    const ry = (y < 0 ? 0 : y >= h ? h - 1 : y) * st;
    for (let x = 0, k = 0; x < w; x++, k += 3) { const q = ry + x * 4; sums[k] += tmp[q]; sums[k + 1] += tmp[q + 1]; sums[k + 2] += tmp[q + 2]; }
  }
  for (let y = 0; y < h; y++) {
    const ro = y * st, ri = (y + r + 1 >= h ? h - 1 : y + r + 1) * st, rd = (y - r < 0 ? 0 : y - r) * st;
    for (let x = 0, k = 0; x < w; x++, k += 3) {
      const o = ro + x * 4, qi = ri + x * 4, qd = rd + x * 4;
      out[o] = sums[k] * inv; out[o + 1] = sums[k + 1] * inv; out[o + 2] = sums[k + 2] * inv; out[o + 3] = 255;
      sums[k] += tmp[qi] - tmp[qd]; sums[k + 1] += tmp[qi + 1] - tmp[qd + 1]; sums[k + 2] += tmp[qi + 2] - tmp[qd + 2];
    }
  }
  return out;
}

// Estimate the paper colour everywhere (shadows, yellowing) from a small copy.
function estimateBg(img) {
  const W = img.width, H = img.height;
  const sw = Math.max(24, Math.round(W / 12)), sh = Math.max(24, Math.round(H / 12));
  const full = mk(W, H); full.getContext('2d').putImageData(img, 0, 0);
  const small = mk(sw, sh), sx = small.getContext('2d');
  sx.imageSmoothingQuality = 'high'; sx.drawImage(full, 0, 0, sw, sh);
  const sd = sx.getImageData(0, 0, sw, sh), d = sd.data;
  const k = 2, tmp = new Uint8ClampedArray(d.length);
  // max filter (removes dark text), horizontal then vertical
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let c = 0; c < 3; c++) {
    let m = 0; for (let t = -k; t <= k; t++) { const v = d[(y * sw + Math.min(sw - 1, Math.max(0, x + t))) * 4 + c]; if (v > m) m = v; }
    tmp[(y * sw + x) * 4 + c] = m;
  }
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let c = 0; c < 3; c++) {
    let m = 0; for (let t = -k; t <= k; t++) { const v = tmp[(Math.min(sh - 1, Math.max(0, y + t)) * sw + x) * 4 + c]; if (v > m) m = v; }
    d[(y * sw + x) * 4 + c] = m;
  }
  const bl = boxBlur(d, sw, sh, 3);
  for (let i = 0; i < d.length; i++) d[i] = bl[i];
  sx.putImageData(sd, 0, 0);
  const fx = full.getContext('2d'); fx.clearRect(0, 0, W, H); fx.imageSmoothingQuality = 'high'; fx.drawImage(small, 0, 0, W, H);
  return fx.getImageData(0, 0, W, H).data;
}

// Cleanup in place. bg = estimateBg() result, needed when c.paperWhite.
function applyClean(img, bg, c) {
  const d = img.data, W = img.width, H = img.height, n = d.length;
  if (c.paperWhite && bg) {
    const gain = new Float32Array(256);                       // gain per paper level
    for (let v = 0; v < 256; v++) gain[v] = 255 / (Math.max(40, v) * CFG.paperBias);
    for (let i = 0; i < n; i += 4) {
      d[i] = d[i] * gain[bg[i]]; d[i + 1] = d[i + 1] * gain[bg[i + 1]]; d[i + 2] = d[i + 2] * gain[bg[i + 2]];
    }
  }
  const sat = c.gray ? 0 : (c.saturation == null ? 100 : c.saturation) / 100;
  if (sat !== 1) {
    for (let i = 0; i < n; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = l + (d[i] - l) * sat; d[i + 1] = l + (d[i + 1] - l) * sat; d[i + 2] = l + (d[i + 2] - l) * sat;
    }
  }
  if (c.exposure || c.brightness || c.contrast) {
    const gain = Math.pow(2, (c.exposure || 0) / 100), cc = (c.contrast || 0) * 1.5, bri = (c.brightness || 0) * 1.28;
    const f = (259 * (cc + 255)) / (255 * (259 - cc));
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = f * (v * gain - 128) + 128 + bri;
    for (let i = 0; i < n; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  }
  if (c.sharpness > 0) {
    const r = Math.max(1, Math.round(Math.max(W, H) / 900)), bl = boxBlur(d, W, H, r), a = c.sharpness / 100 * 1.5;
    for (let i = 0; i < n; i += 4) {
      d[i] = d[i] + a * (d[i] - bl[i]); d[i + 1] = d[i + 1] + a * (d[i + 1] - bl[i + 1]); d[i + 2] = d[i + 2] + a * (d[i + 2] - bl[i + 2]);
    }
  }
  if (c.bw) {
    const lv = c.level;
    for (let i = 0; i < n; i += 4) {
      const v = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) < lv ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
}

const pageLongIn = doc => (doc.pageSize !== 'orig' && CFG.pageSizes[doc.pageSize])
  ? Math.max(CFG.pageSizes[doc.pageSize].w, CFG.pageSizes[doc.pageSize].h) : CFG.origLongInches;

// Where the warped page sits on the paper. ppi = pixels per inch.
function layout(doc, nat, ppi) {
  const ar = nat.w / nat.h, m = doc.margin, ps = CFG.pageSizes[doc.pageSize];
  let pw, ph, cw, ch, dx, dy;
  if (!ps || doc.pageSize === 'orig') {
    const cl = Math.max(1, CFG.origLongInches - 2 * m);
    const cwi = ar >= 1 ? cl : cl * ar, chi = ar >= 1 ? cl / ar : cl;
    pw = (cwi + 2 * m) * ppi; ph = (chi + 2 * m) * ppi; cw = cwi * ppi; ch = chi * ppi; dx = m * ppi; dy = m * ppi;
  } else {
    let pwi = ps.w, phi = ps.h; if (ar > CFG.landscapeAbove) { pwi = ps.h; phi = ps.w; }
    pw = pwi * ppi; ph = phi * ppi;
    if (doc.fit === 'fill') { cw = Math.max(pw, ph * ar); ch = cw / ar; dx = (pw - cw) / 2; dy = (ph - ch) / 2; }
    else if (doc.fit === 'stretch') { cw = pw; ch = ph; dx = 0; dy = 0; }
    else { const aw = pw - 2 * m * ppi, ah = ph - 2 * m * ppi; cw = Math.min(aw, ah * ar); ch = cw / ar; dx = (pw - cw) / 2; dy = (ph - ch) / 2; }
  }
  return { pw: Math.round(pw), ph: Math.round(ph), cw: Math.max(1, Math.round(cw)), ch: Math.max(1, Math.round(ch)), dx: Math.round(dx), dy: Math.round(dy), wIn: pw / ppi, hIn: ph / ppi };
}

// Full page render. src = rotated working or full canvas. cache (optional) keeps the warp and paper estimate.
function renderPage(doc, page, src, ppi, cache, overlay) {
  const W = src.width, H = src.height;
  const L = layout(doc, quadSize(page.corners, W, H), ppi);
  const key = [L.cw, L.ch, W, H, page.corners.map(p => p.x.toFixed(4) + ',' + p.y.toFixed(4)).join(';')].join('|');
  let raw;
  if (cache && cache.key === key) raw = cache.raw;
  else {
    raw = warp(src, page.corners.map(p => ({ x: p.x * W, y: p.y * H })), L.cw, L.ch);
    if (cache) { cache.key = key; cache.raw = raw; cache.bg = null; }
  }
  const out = new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height);
  let bg = null;
  if (page.clean.paperWhite) { bg = (cache && cache.bg) || estimateBg(raw); if (cache) cache.bg = bg; }
  applyClean(out, bg, page.clean);
  const pc = mk(L.pw, L.ph), x = pc.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, L.pw, L.ph);
  const tmp = mk(L.cw, L.ch); tmp.getContext('2d').putImageData(out, 0, 0);
  x.drawImage(tmp, L.dx, L.dy);
  if (overlay) applyOverlay(pc, overlay);
  return { canvas: pc, L };
}

function rotCanvas(src, rot, maxSide) {
  const sw = src.width, sh = src.height, s = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * s), h = Math.round(sh * s), swap = rot % 180 !== 0;
  const c = mk(swap ? h : w, swap ? w : h), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high'; x.translate(c.width / 2, c.height / 2); x.rotate(rot * Math.PI / 180);
  x.drawImage(src, -w / 2, -h / 2, w, h);
  return c;
}

const rotCornersCW = c => { const m = c.map(p => ({ x: 1 - p.y, y: p.x })); return [m[3], m[0], m[1], m[2]]; };
function rotatePage(page, dir) {
  const n = dir > 0 ? 1 : 3;
  for (let i = 0; i < n; i++) page.corners = rotCornersCW(page.corners);
  page.rot = (page.rot + 90 * n) % 360;
}

// Minimal PDF writer: one JPEG per page. pages = [{jpeg:Uint8Array, w, h, wPt, hPt}]
function buildPdf(pages, title) {
  const enc = new TextEncoder(), chunks = [], off = []; let pos = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
  const obj = (n, dict, stream) => {
    off[n] = pos; push(n + ' 0 obj\n' + dict + '\n');
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  const safe = String(title || 'Scan').replace(/[^\x20-\x7e]/g, '').replace(/[\\()]/g, '') || 'Scan';
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const stamp = 'D:' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const kids = pages.map((_, i) => (4 + i * 3) + ' 0 R').join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
  obj(3, '<< /Title (' + safe + ') /Producer (ScanDoc) /CreationDate (' + stamp + ') >>');
  pages.forEach((p, i) => {
    const pg = 4 + i * 3, ct = pg + 1, im = pg + 2, wp = p.wPt.toFixed(2), hp = p.hPt.toFixed(2);
    obj(pg, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + wp + ' ' + hp + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R >>');
    const content = enc.encode('q ' + wp + ' 0 0 ' + hp + ' 0 0 cm /Im0 Do Q');
    obj(ct, '<< /Length ' + content.length + ' >>', content);
    obj(im, '<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>', p.jpeg);
  });
  const total = 4 + pages.length * 3, xref = pos;
  push('xref\n0 ' + total + '\n0000000000 65535 f \n');
  for (let n = 1; n < total; n++) push(String(off[n]).padStart(10, '0') + ' 00000 n \n');
  push('trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(chunks, { type: 'application/pdf' });
}

/* ---------- redaction and purpose stamp (flattened into the pixels) ---------- */
// ov = { redact: [{x,y,w,h} as fractions of the page], stamp: 'text' | '' }
function applyOverlay(canvas, ov) {
  const x = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  if (ov.redact && ov.redact.length) {
    x.fillStyle = '#000';
    for (const b of ov.redact) x.fillRect(Math.floor(b.x * W), Math.floor(b.y * H), Math.ceil(b.w * W) + 1, Math.ceil(b.h * H) + 1);
  }
  if (ov.stamp) {
    const diag = Math.hypot(W, H);
    let fs = Math.max(9, Math.round(W * 0.03));
    x.save();
    x.translate(W / 2, H / 2); x.rotate(-Math.atan2(H, W) * 0.8);
    x.font = 'bold ' + fs + 'px sans-serif';
    const tw = x.measureText(ov.stamp).width;
    if (tw > diag * 0.75) { fs = Math.max(8, Math.floor(fs * diag * 0.75 / tw)); x.font = 'bold ' + fs + 'px sans-serif'; }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = Math.max(2, fs / 8); x.strokeStyle = 'rgba(255,255,255,0.55)'; x.fillStyle = 'rgba(170,30,30,0.36)';
    const gap = fs * 6;
    for (let k = -4; k <= 4; k++) { x.strokeText(ov.stamp, 0, k * gap); x.fillText(ov.stamp, 0, k * gap); }
    x.restore();
  }
}
const stampText = (purpose, d) => 'For ' + (purpose || 'this purpose').trim() + ', ' +
  (d || new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' only';

// nearest standard paper for an imported PDF page (size in points), or 'orig'
function pickPageSize(wPt, hPt) {
  const a = Math.min(wPt, hPt), b = Math.max(wPt, hPt), near = (v, t) => Math.abs(v - t) / t < 0.025;
  if (near(a, 612) && near(b, 792)) return 'letter';
  if (near(a, 612) && near(b, 1008)) return 'legal';
  if (near(a, 595) && near(b, 842)) return 'a4';
  return 'orig';
}

/* ---------- crypto: AES-GCM, key from passphrase by PBKDF2 ---------- */
const subtle = () => (root.crypto || globalThis.crypto).subtle;
const rand = n => (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(n));
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
async function deriveKey(pass, salt, iter) {
  const base = await subtle().importKey('raw', enc.encode(String(pass).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, bytes) {                       // -> iv(12) + ciphertext
  const iv = rand(12), ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
async function open(key, bytes) {                       // throws if the key is wrong or data was changed
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}
const sealJSON = (key, obj) => seal(key, enc.encode(JSON.stringify(obj)));
const openJSON = async (key, bytes) => JSON.parse(dec.decode(await open(key, bytes)));
const CHECK = 'scandoc-vault-ok';
async function createVault(pass, iter) {
  const salt = rand(16), key = await deriveKey(pass, salt, iter);
  return { key, meta: { salt: b64(salt), iter, check: b64(await seal(key, enc.encode(CHECK))) } };
}
async function unlockVault(meta, pass) {                // key, or null when the passphrase is wrong
  try {
    const key = await deriveKey(pass, unb64(meta.salt), meta.iter);
    return dec.decode(await open(key, unb64(meta.check))) === CHECK ? key : null;
  } catch (e) { return null; }
}

/* ---------- backup files ---------- */
// plain archive: 'SCDOCARC' + u32 JSON length + JSON + blobs back to back (sizes in JSON)
function packArchive(meta, blobs) {
  const sizes = blobs.map(b => b.size !== undefined ? b.size : b.length);
  const m = enc.encode(JSON.stringify(Object.assign({}, meta, { sizes })));
  const head = new Uint8Array(12); head.set(enc.encode('SCDOCARC')); new DataView(head.buffer).setUint32(8, m.length);
  return new Blob([head, m].concat(blobs), { type: 'application/octet-stream' });
}
async function unpackArchive(buf) {
  const u = new Uint8Array(buf);
  if (dec.decode(u.subarray(0, 8)) !== 'SCDOCARC') throw new Error('Not a ScanDoc backup');
  const len = new DataView(u.buffer, u.byteOffset).getUint32(8), meta = JSON.parse(dec.decode(u.subarray(12, 12 + len)));
  let off = 12 + len; const blobs = [];
  for (const s of meta.sizes) { blobs.push(new Blob([u.slice(off, off + s)])); off += s; }
  return { meta, blobs };
}
// encrypted wrapper: 'SCDOCENC' + u32 header length + header JSON + sealed archive
async function encryptBackup(archiveBlob, pass, iter) {
  const salt = rand(16), key = await deriveKey(pass, salt, iter);
  const sealed = await seal(key, new Uint8Array(await archiveBlob.arrayBuffer()));
  const h = enc.encode(JSON.stringify({ v: 1, salt: b64(salt), iter }));
  const head = new Uint8Array(12); head.set(enc.encode('SCDOCENC')); new DataView(head.buffer).setUint32(8, h.length);
  return new Blob([head, h, sealed], { type: 'application/octet-stream' });
}
async function decryptBackup(buf, pass) {               // -> ArrayBuffer of the archive, or null if wrong passphrase
  const u = new Uint8Array(buf), len = new DataView(u.buffer, u.byteOffset).getUint32(8), h = JSON.parse(dec.decode(u.subarray(12, 12 + len)));
  try {
    const key = await deriveKey(pass, unb64(h.salt), h.iter);
    return (await open(key, u.subarray(12 + len))).buffer;
  } catch (e) { return null; }
}
const sniffBackup = buf => { const t = dec.decode(new Uint8Array(buf, 0, 8)); return t === 'SCDOCENC' ? 'enc' : t === 'SCDOCARC' ? 'arc' : null; };

const api = { setCanvasFactory, homography, quadSize, warp, boxBlur, estimateBg, applyClean, pageLongIn, layout, renderPage, rotCanvas,
  rotCornersCW, rotatePage, buildPdf, applyOverlay, stampText, pickPageSize, deriveKey, seal, open, sealJSON, openJSON, createVault, unlockVault,
  packArchive, unpackArchive, encryptBackup, decryptBackup, sniffBackup, b64, unb64, rand };
root.Engine = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
